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

        // Always update metadata with next reset time
        const metaKey = `meta:${feature.key}:${referenceId}`
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

        if (!reset.shouldReset) {
            return { reset: false, message: "No reset required", feature: feature.key }
        }

        // Reset needed — update usage row + append reset event to history
        const now = new Date()
        const resetValue = feature.resetValue ?? 0
        const resetDelta = resetValue - usage.amount

        // 1. Append reset event to history
        yield* db.create({
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

        // 2. Upsert the materialized usage row
        yield* db.update({
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

        // Reset Redis counter
        const usageKey = `usage:${feature.key}:${referenceId}`
        yield* redis.set(usageKey, feature.resetValue ?? 0).pipe(
            Effect.catchAll((err) =>
                Effect.sync(() =>
                    logger.warn("Failed to reset Redis counter", { referenceId, feature: feature.key, error: err })
                )
            )
        )

        logger.info("Usage reset", { referenceId, feature: feature.key, from: usage.amount, to: feature.resetValue ?? 0 })

        return { reset: true, feature: feature.key, previousAmount: usage.amount, newAmount: feature.resetValue ?? 0 }
    })
