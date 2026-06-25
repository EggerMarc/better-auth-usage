import { Effect } from "effect"
import { DriverService, DbService, LoggerService } from "@/services"
import type { Customer, Feature } from "@/types"

interface UpsertCustomerParams {
    customer: Customer
    features?: Record<string, Feature>
}

/**
 * Upsert a customer — create or update.
 *
 * If the customer's overrideKey changes (plan transition), handles
 * per-feature onPlanChange behavior:
 * - "carry-over" (default): usage stays, only metadata (limits) updated
 * - "reset": usage counter reset to resetValue, reset event logged
 *
 * Pass `features` to enable plan transition handling.
 */
export const upsertCustomer = ({ customer, features }: UpsertCustomerParams) =>
    Effect.gen(function* () {
        const driver = yield* DriverService
        const db = yield* DbService
        const logger = yield* LoggerService

        // Check if exists
        const existing = yield* db.findOne<Customer>({
            model: "customer",
            where: [{ field: "referenceId", value: customer.referenceId }],
        })

        let result: Customer

        if (existing) {
            result = yield* db.update<Customer>({
                model: "customer",
                where: [{ field: "referenceId", value: customer.referenceId }],
                update: customer,
            })

            // Detect plan change
            const oldOverride = existing.overrideKey
            const newOverride = customer.overrideKey
            if (features && oldOverride !== newOverride) {
                yield* handlePlanChange({
                    referenceId: customer.referenceId,
                    fromOverride: oldOverride,
                    toOverride: newOverride,
                    features,
                    driver,
                    db,
                    logger,
                })
            }
        } else {
            result = yield* db.create<Customer>({
                model: "customer",
                data: customer as Record<string, unknown>,
            })
        }

        // Sync to cache — the driver clears stale optional fields internally.
        yield* driver.setCustomer(result).pipe(
            Effect.catchAll((err) =>
                Effect.sync(() =>
                    logger.warn("Failed to cache customer", { referenceId: result.referenceId, error: err })
                )
            ),
            Effect.fork,
        )

        return result
    })

/**
 * Handle plan transition for all features when overrideKey changes.
 */
const handlePlanChange = ({
    referenceId,
    fromOverride,
    toOverride,
    features,
    driver,
    db,
    logger,
}: {
    referenceId: string
    fromOverride: string | undefined
    toOverride: string | undefined
    features: Record<string, Feature>
    driver: DriverService
    db: DbService
    logger: LoggerService
}) =>
    Effect.gen(function* () {
        logger.info("Plan change detected", { referenceId, from: fromOverride, to: toOverride ?? "base" })

        const now = new Date()

        // Process all features concurrently — they're independent
        yield* Effect.all(
            Object.values(features).map((feature) =>
                handleFeaturePlanChange({
                    referenceId, toOverride, feature, now, driver, db, logger,
                })
            ),
            { concurrency: "unbounded" }
        )
    })

/**
 * Handle plan change for a single feature.
 */
const handleFeaturePlanChange = ({
    referenceId, toOverride, feature, now, driver, db, logger,
}: {
    referenceId: string
    toOverride: string | undefined
    feature: Feature
    now: Date
    driver: DriverService
    db: DbService
    logger: LoggerService
}) =>
    Effect.gen(function* () {
        const behavior = feature.onPlanChange ?? "carry-over"

        if (behavior === "reset") {
            const resetValue = feature.resetValue ?? 0

            // Fetch current usage to compute delta for history
            const existing = yield* db.findOne<{ amount: number }>({
                model: "usage",
                where: [
                    { field: "referenceId", value: referenceId },
                    { field: "feature", value: feature.key },
                ],
            }).pipe(Effect.catchAll(() => Effect.succeed(null)))

            const currentAmount = existing?.amount ?? 0
            const delta = resetValue - currentAmount

            // Log plan-change event with actual delta
            yield* db.create({
                model: "usageEvent",
                data: {
                    referenceId,
                    feature: feature.key,
                    amount: delta,
                    event: "plan-change",
                    overrideKey: toOverride,
                    lastResetAt: now,
                    createdAt: now,
                },
            }).pipe(
                Effect.catchAll((err) =>
                    Effect.sync(() =>
                        logger.warn("Failed to log plan-change event", {
                            referenceId, feature: feature.key, error: err,
                        })
                    )
                )
            )

            // Reset cache counter + update DB — concurrent
            yield* Effect.all([
                driver.reset(`${referenceId}`, feature.key, resetValue, { lastResetAt: now }).pipe(
                    Effect.catchAll((err) =>
                        Effect.sync(() =>
                            logger.warn("Failed to reset cache counter", {
                                referenceId, feature: feature.key, error: err,
                            })
                        )
                    )
                ),
                db.update({
                    model: "usage",
                    where: [
                        { field: "referenceId", value: referenceId },
                        { field: "feature", value: feature.key },
                    ],
                    update: {
                        amount: resetValue,
                        event: "plan-change",
                        lastResetAt: now,
                        updatedAt: now,
                    },
                }).pipe(
                    Effect.catchAll((err) =>
                        Effect.sync(() =>
                            logger.warn("Failed to reset DB usage", {
                                referenceId, feature: feature.key, error: err,
                            })
                        )
                    )
                ),
            ], { concurrency: 2 })

            logger.info("Feature reset on plan change", {
                referenceId, feature: feature.key, resetTo: resetValue,
            })
        } else {
            // Carry-over: log plan-change event with zero delta (usage unchanged)
            yield* db.create({
                model: "usageEvent",
                data: {
                    referenceId,
                    feature: feature.key,
                    amount: 0,
                    event: "plan-change",
                    overrideKey: toOverride,
                    lastResetAt: now,
                    createdAt: now,
                },
            }).pipe(
                Effect.catchAll((err) =>
                    Effect.sync(() =>
                        logger.warn("Failed to log plan-change event", {
                            referenceId, feature: feature.key, error: err,
                        })
                    )
                )
            )
        }
    })
