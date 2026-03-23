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
export const consumeUsage = ({ referenceId, amount, event, feature }: ConsumeParams) =>
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
            yield* Effect.tryPromise({
                try: () => feature.hooks!.before!({
                    usage: { beforeAmount, afterAmount, amount },
                    customer,
                    feature,
                }),
                catch: (cause) => cause,  // propagate hook errors as-is
            })
        }

        // 3. Write — Redis (Lua) if available, DB fallback
        const usageKey = `usage:${feature.key}:${referenceId}`
        const metaKey = `meta:${feature.key}:${referenceId}`

        // Try Redis Lua first
        const luaResult = yield* redis.eval(
            incrementScript,
            2,
            usageKey,
            metaKey,
            amount,
            Date.now(),
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
            // Redis succeeded
            const [total] = luaResult as [number, number, number]
            newTotal = total

            // Write to DB in background (will be replaced by WAL in Phase 4)
            yield* Effect.tryPromise({
                try: () => db.create({
                    model: "usage",
                    data: {
                        referenceId,
                        amount,
                        feature: feature.key,
                        event,
                        lastResetAt: currentUsage.lastResetAt,
                        createdAt: new Date(),
                    },
                }),
                catch: () => undefined,
            }).pipe(
                Effect.catchAll((err) =>
                    Effect.sync(() =>
                        logger.error("Background DB write failed", {
                            referenceId,
                            feature: feature.key,
                            error: err,
                        })
                    )
                ),
                Effect.fork,
            )
        } else {
            // DB-only path
            yield* db.create({
                model: "usage",
                data: {
                    referenceId,
                    amount,
                    feature: feature.key,
                    event,
                    lastResetAt: currentUsage.lastResetAt,
                    createdAt: new Date(),
                },
            })
            newTotal = afterAmount
        }

        // 4. After hook
        if (feature.hooks?.after) {
            yield* Effect.tryPromise({
                try: () => feature.hooks!.after!({
                    usage: { beforeAmount, afterAmount: newTotal, amount },
                    customer,
                    feature,
                }),
                catch: (cause) => cause,
            }).pipe(
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
