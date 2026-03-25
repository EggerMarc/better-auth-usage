import { Effect } from "effect"
import { RedisService, DbService, LoggerService } from "@/services"
import type { Feature } from "@/types"
import { getUsage } from "./get-usage"
import { shouldReset } from "@/utils"

/**
 * Sync/reset usage for a feature.
 *
 * Checks if a reset boundary has been crossed and performs the reset if needed.
 * Updates Redis metadata with next reset time.
 */
export const syncUsage = ({
    referenceId,
    feature,
}: {
    referenceId: string
    feature: Omit<Feature, "hooks">
}) =>
    Effect.gen(function* () {
        const redis = yield* RedisService
        const db = yield* DbService
        const logger = yield* LoggerService

        if (!feature.reset || feature.reset === "never") {
            return { reset: false, message: "No reset required", feature: feature.key }
        }

        const usage = yield* getUsage({ referenceId, feature })
        const reset = shouldReset(usage.lastResetAt, feature.reset)
        const metaKey = `meta:${feature.key}:${referenceId}`

        if (!reset.shouldReset) {
            // No reset — write metadata with current timestamps
            yield* redis.hset(metaKey, {
                referenceId,
                feature: feature.key,
                lastResetAt: String(usage.lastResetAt.getTime()),
                ...(reset.nextReset && { resetAt: String(reset.nextReset.getTime()) }),
                ...(feature.maxLimit != null && { maxLimit: String(feature.maxLimit) }),
                ...(feature.minLimit != null && { minLimit: String(feature.minLimit) }),
                ...(feature.resetValue != null && { resetValue: String(feature.resetValue) }),
            }).pipe(
                Effect.catchAll((err) =>
                    Effect.sync(() =>
                        logger.warn("Failed to update metadata", { referenceId, feature: feature.key, error: err })
                    )
                )
            )
            return { reset: false, message: "No reset required", feature: feature.key }
        }

        // Reset needed — update usage row + append reset event to history
        const now = new Date()
        const resetValue = feature.resetValue ?? 0
        const resetDelta = resetValue - usage.amount

        // Append reset event + update usage row in a single transaction
        yield* db.transaction((tx) =>
            Effect.gen(function* () {
                yield* tx.create({
                    model: "usageEvent",
                    data: {
                        referenceId,
                        feature: feature.key,
                        amount: resetDelta,
                        event: "reset",
                        lastResetAt: now,
                        createdAt: now,
                    },
                })
                yield* tx.update({
                    model: "usage",
                    where: [
                        { field: "referenceId", value: referenceId },
                        { field: "feature", value: feature.key },
                    ],
                    update: {
                        amount: resetValue,
                        event: "reset",
                        lastResetAt: now,
                        updatedAt: now,
                    },
                })
            })
        )

        // Reset Redis counter + update metadata with post-reset timestamps
        const usageKey = `usage:${feature.key}:${referenceId}`
        const postResetReset = shouldReset(now, feature.reset)
        yield* Effect.all([
            redis.set(usageKey, feature.resetValue ?? 0),
            redis.hset(metaKey, {
                referenceId,
                feature: feature.key,
                lastResetAt: String(now.getTime()),
                ...(postResetReset.nextReset && { resetAt: String(postResetReset.nextReset.getTime()) }),
                ...(feature.maxLimit != null && { maxLimit: String(feature.maxLimit) }),
                ...(feature.minLimit != null && { minLimit: String(feature.minLimit) }),
                ...(feature.resetValue != null && { resetValue: String(feature.resetValue) }),
            }),
        ]).pipe(
            Effect.catchAll((err) =>
                Effect.sync(() =>
                    logger.warn("Failed to update Redis after reset", { referenceId, feature: feature.key, error: err })
                )
            )
        )

        logger.info("Usage reset", { referenceId, feature: feature.key, from: usage.amount, to: feature.resetValue ?? 0 })

        return { reset: true, feature: feature.key, previousAmount: usage.amount, newAmount: feature.resetValue ?? 0 }
    })
