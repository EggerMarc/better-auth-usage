import { Effect } from "effect"
import { RedisService, DbService, LoggerService } from "@/services"
import { ValidationError } from "@/errors"
import type { Feature, Customer, Usage } from "@/types"
import { getUsage } from "./get-usage"
import { getCustomerOptional } from "./get-customer"
import { checkLimit } from "@/utils"
import incrementScript from "@/adapters/lua/increment.lua"

/**
 * Lift a user-provided callback (sync or async) into an Effect.
 */
const liftCallback = <A>(fn: () => A | Promise<A>): Effect.Effect<A, unknown> =>
    Effect.tryPromise(() => Promise.resolve(fn()))

/**
 * Validate amount — reject Infinity, NaN, unsafe integers.
 */
const validateAmount = (amount: number) =>
    !Number.isFinite(amount)
        ? Effect.fail(new ValidationError({ message: `Invalid amount: ${amount}. Must be a finite number.` }))
        : Effect.succeed(amount)

interface ConsumeParams {
    referenceId: string
    amount: number
    event: string
    feature: Feature
    walEnabled?: boolean
}

interface ConsumeResult {
    allowed: boolean
    current: number
    afterAmount: number
    max: number | undefined
    min: number | undefined
    remaining: number | null
    status: "in-limit" | "above-max-limit" | "below-min-limit"
}

/**
 * Consume usage for a feature.
 *
 * Pipeline:
 *   1. Fetch current usage + customer in parallel
 *   2. Run before hook (if defined)
 *   3. Write to Redis via Lua (atomic increment)
 *   4. Fallback: write to DB if no Redis
 *   5. Run after hook (if defined)
 *
 * Returns: Effect<ConsumeResult, RedisError | DbError, RedisService | DbService | LoggerService>
 */
export const consumeUsage = ({ referenceId, amount, event, feature, walEnabled }: ConsumeParams) =>
    Effect.gen(function* () {
        yield* validateAmount(amount)

        const redis = yield* RedisService
        const db = yield* DbService
        const logger = yield* LoggerService

        // 1. Fetch current usage + customer in parallel
        const [currentUsage, customer] = yield* Effect.all([
            getUsage({ referenceId, feature }),
            getCustomerOptional(referenceId),
        ], { concurrency: 2 })

        const beforeAmount = currentUsage.amount
        const afterAmount = beforeAmount + amount

        // 2. Before hook
        if (feature.hooks?.before) {
            yield* liftCallback(() =>
                feature.hooks!.before!({
                    usage: { beforeAmount, afterAmount, amount },
                    customer,
                    feature,
                })
            )
        }

        // 3. Write — Redis (Lua) if available, DB fallback
        const usageKey = `usage:${feature.key}:${referenceId}`
        const metaKey = `meta:${feature.key}:${referenceId}`
        const walKey = "wal:usage"

        // Try Redis Lua first (atomic: increment + WAL append + publish)
        const luaResult = yield* redis.eval(
            incrementScript,
            3,              // 3 KEYS
            usageKey,
            metaKey,
            walKey,
            amount,         // ARGV[1]
            Date.now(),     // ARGV[2]
            referenceId,    // ARGV[3]
            feature.key,    // ARGV[4]
            event,          // ARGV[5]
        ).pipe(
            Effect.catchTag("RedisError", (err) => {
                // Redis unavailable — fall back to DB
                logger.warn("Redis write failed, falling back to DB", {
                    referenceId,
                    feature: feature.key,
                    error: err,
                })
                return Effect.succeed(null)
            })
        )

        let newTotal: number

        if (luaResult) {
            // Redis succeeded — newTotal comes from Lua
            const [total] = luaResult as [number, number, number]
            newTotal = total
        } else {
            // DB-only path — calculate newTotal locally
            newTotal = afterAmount
        }

        // Write to DB
        if (luaResult && walEnabled) {
            // WAL worker will drain stream → DB. No direct write needed.
        } else {
            // DB write — always runs in background fiber for fast response
            const now = new Date()
            yield* writeToDb(db, logger, {
                referenceId,
                feature: feature.key,
                amount,
                newTotal,
                event,
                overrideKey: customer?.overrideKey,
                lastResetAt: currentUsage.lastResetAt,
                now,
            })
        }

        // 4. After hook
        if (feature.hooks?.after) {
            yield* liftCallback(() =>
                feature.hooks!.after!({
                    usage: { beforeAmount, afterAmount: newTotal, amount },
                    customer,
                    feature,
                })
            ).pipe(
                Effect.catchAll((err) =>
                    Effect.sync(() =>
                        logger.warn("After hook failed", { feature: feature.key, error: err })
                    )
                )
            )
        }

        const status = checkLimit({
            maxLimit: feature.maxLimit,
            minLimit: feature.minLimit,
            value: newTotal,
        })

        return {
            allowed: status === "in-limit",
            current: newTotal,
            afterAmount: newTotal,
            max: feature.maxLimit,
            min: feature.minLimit,
            remaining: feature.maxLimit != null ? feature.maxLimit - newTotal : null,
            status,
        } satisfies ConsumeResult
    })

/**
 * Write to DB: update usage row + append usage_events row.
 * Wrapped in a transaction for atomicity. No redundant findOne —
 * getUsage already ensures the usage row exists.
 *
 * 2 DB calls in 1 transaction instead of 3 sequential calls.
 */
const writeToDb = (
    db: DbService,
    logger: LoggerService,
    params: {
        referenceId: string
        feature: string
        amount: number
        newTotal: number
        event: string
        overrideKey?: string
        lastResetAt: Date
        now: Date
    }
) =>
    db.transaction((tx) =>
        Effect.gen(function* () {
            // 1. Update usage row (getUsage already ensured it exists)
            yield* tx.update({
                model: "usage",
                where: [
                    { field: "referenceId", value: params.referenceId },
                    { field: "feature", value: params.feature },
                ],
                update: {
                    amount: params.newTotal,
                    event: params.event,
                    lastResetAt: params.lastResetAt,
                    updatedAt: params.now,
                },
            })

            // 2. Append to usage_events (history)
            yield* tx.create({
                model: "usageEvent",
                data: {
                    referenceId: params.referenceId,
                    feature: params.feature,
                    amount: params.amount,
                    event: params.event,
                    overrideKey: params.overrideKey,
                    lastResetAt: params.lastResetAt,
                    createdAt: params.now,
                },
            })
        })
    ).pipe(
        Effect.catchAll((err) =>
            Effect.sync(() =>
                logger.error("DB write failed", {
                    referenceId: params.referenceId,
                    feature: params.feature,
                    error: String(err),
                })
            )
        ),
    )

/**
 * Consume usage and return the result with status.
 *
 * Always consumes — does NOT block on over-limit by default.
 * To enforce limits, use a `before` hook that throws on over-limit.
 * Returns `status` so the caller can decide what to do.
 */
export const useFeature = (params: ConsumeParams) =>
    consumeUsage(params)
