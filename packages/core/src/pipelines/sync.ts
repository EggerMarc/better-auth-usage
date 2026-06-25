import { Effect } from "effect"
import { DriverService, DbService, LoggerService } from "../services"
import type { Feature, CachedUsage, CachedLimits } from "../types"
import { getUsage } from "./get-usage"
import { shouldReset } from "../utils"

/**
 * Sync/reset usage for a feature.
 *
 * Checks if a reset boundary has been crossed and performs the reset if needed.
 * Updates driver metadata with the next reset time.
 */
export const syncUsage = ({
    referenceId,
    feature,
}: {
    referenceId: string
    feature: Omit<Feature, "hooks">
}) =>
    Effect.gen(function* () {
        const driver = yield* DriverService
        const db = yield* DbService
        const logger = yield* LoggerService

        if (!feature.reset || feature.reset === "never") {
            return { reset: false, message: "No reset required", feature: feature.key }
        }

        const usage = yield* getUsage({ referenceId, feature })
        const reset = shouldReset(usage.lastResetAt, feature.reset)

        if (!reset.shouldReset) {
            // No reset — refresh metadata (limits + next boundary), counter unchanged
            const cachedUsage: CachedUsage = {
                referenceId,
                feature: feature.key,
                current: usage.amount,
                lastResetAt: usage.lastResetAt,
                maxLimit: feature.maxLimit,
                minLimit: feature.minLimit,
            }
            const meta: CachedLimits = {
                referenceId,
                feature: feature.key,
                lastResetAt: usage.lastResetAt,
                maxLimit: feature.maxLimit,
                minLimit: feature.minLimit,
                resetValue: feature.resetValue,
                ...(reset.nextReset ? { resetAt: reset.nextReset } : {}),
            }
            yield* driver.hydrate(referenceId, feature.key, cachedUsage, meta).pipe(
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

        // Reset driver counter + update metadata with post-reset timestamps
        const postResetReset = shouldReset(now, feature.reset)
        const postMeta: CachedLimits = {
            referenceId,
            feature: feature.key,
            lastResetAt: now,
            maxLimit: feature.maxLimit,
            minLimit: feature.minLimit,
            resetValue: feature.resetValue,
            ...(postResetReset.nextReset ? { resetAt: postResetReset.nextReset } : {}),
        }
        yield* driver.reset(referenceId, feature.key, resetValue, postMeta).pipe(
            Effect.catchAll((err) =>
                Effect.sync(() =>
                    logger.warn("Failed to update driver after reset", { referenceId, feature: feature.key, error: err })
                )
            )
        )

        logger.info("Usage reset", { referenceId, feature: feature.key, from: usage.amount, to: feature.resetValue ?? 0 })

        return { reset: true, feature: feature.key, previousAmount: usage.amount, newAmount: feature.resetValue ?? 0 }
    })
