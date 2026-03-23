import { Effect } from "effect"
import { RedisService, DbService, LoggerService } from "@/services"
import type { Feature, Customer, Usage } from "@/types"
import { getUsage } from "./get-usage"
import { getCustomerOptional } from "./get-customer"
import { checkLimit } from "@/utils"
import incrementScript from "@/adapters/lua/increment.lua"

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
            yield* Effect.tryPromise(() =>
                Promise.resolve(feature.hooks!.before!({
                    usage: { beforeAmount, afterAmount, amount },
                    customer,
                    feature,
                }))
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

        // Write to DB — skip if WAL worker handles it (Redis + WAL enabled)
        if (luaResult && walEnabled) {
            // WAL worker will drain stream → DB. No direct write needed.
        } else {
            // DB-only mode OR WAL disabled — write directly
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
                hasRedis: luaResult !== null && !walEnabled,
            })
        }

        // 4. After hook
        if (feature.hooks?.after) {
            yield* Effect.tryPromise(() =>
                Promise.resolve(feature.hooks!.after!({
                    usage: { beforeAmount, afterAmount: newTotal, amount },
                    customer,
                    feature,
                }))
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
 * Write to DB: upsert usage row (current total) + append usage_events row (delta).
 * When Redis is available, runs in background fiber. When DB-only, runs blocking.
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
        hasRedis: boolean
    }
) => {
    const pipeline = Effect.gen(function* () {
        // 1. Upsert usage — one row per (referenceId, feature)
        const existing = yield* db.findOne<any>({
            model: "usage",
            where: [
                { field: "referenceId", value: params.referenceId },
                { field: "feature", value: params.feature },
            ],
        })

        if (existing) {
            yield* db.update({
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
        } else {
            yield* db.create({
                model: "usage",
                data: {
                    referenceId: params.referenceId,
                    feature: params.feature,
                    amount: params.newTotal,
                    event: params.event,
                    lastResetAt: params.lastResetAt,
                    createdAt: params.now,
                    updatedAt: params.now,
                },
            })
        }

        // 2. Append to usage_events (history)
        yield* db.create({
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

    if (params.hasRedis) {
        // Redis is authoritative — DB write runs in background
        return pipeline.pipe(
            Effect.catchAll((err) =>
                Effect.sync(() =>
                    logger.error("Background DB write failed", {
                        referenceId: params.referenceId,
                        feature: params.feature,
                        error: err,
                    })
                )
            ),
            Effect.fork,
        )
    }

    // DB-only — write is blocking
    return pipeline
}

/**
 * Atomic check + consume: only increments if the result would be in-limit.
 *
 * This is the `useFeature` endpoint — checks first, consumes only if allowed.
 */
export const useFeature = (params: ConsumeParams) =>
    Effect.gen(function* () {
        const currentUsage = yield* getUsage({
            referenceId: params.referenceId,
            feature: params.feature,
        })

        const projected = currentUsage.amount + params.amount
        const status = checkLimit({
            maxLimit: params.feature.maxLimit,
            minLimit: params.feature.minLimit,
            value: projected,
        })

        if (status !== "in-limit") {
            return {
                allowed: false,
                current: currentUsage.amount,
                afterAmount: currentUsage.amount,
                max: params.feature.maxLimit,
                min: params.feature.minLimit,
                remaining: params.feature.maxLimit != null
                    ? params.feature.maxLimit - currentUsage.amount
                    : null,
                status,
            } satisfies ConsumeResult
        }

        // In limit — proceed with consume
        return yield* consumeUsage(params)
    })
