import { Effect } from "effect"
import { RedisService, DbService, LoggerService } from "@/services"
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
 * - "carry-over" (default): usage stays, only Redis metadata (limits) updated
 * - "reset": usage counter reset to resetValue, reset event logged
 *
 * Pass `features` to enable plan transition handling.
 */
export const upsertCustomer = ({ customer, features }: UpsertCustomerParams) =>
    Effect.gen(function* () {
        const redis = yield* RedisService
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
            if (features && oldOverride !== newOverride && newOverride) {
                yield* handlePlanChange({
                    referenceId: customer.referenceId,
                    fromOverride: oldOverride,
                    toOverride: newOverride,
                    features,
                    redis,
                    db,
                    logger,
                })
            }
        } else {
            result = yield* db.create<Customer>({
                model: "customer",
                data: customer as any,
            })
        }

        // Sync to cache (background, errors logged)
        const hash: Record<string, string> = {
            referenceId: result.referenceId,
            referenceType: result.referenceType,
        }
        if (result.email) hash.email = result.email
        if (result.name) hash.name = result.name
        if (result.overrideKey) hash.overrideKey = result.overrideKey

        yield* redis.hset(`customer:${result.referenceId}`, hash).pipe(
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
    redis,
    db,
    logger,
}: {
    referenceId: string
    fromOverride: string | undefined
    toOverride: string
    features: Record<string, Feature>
    redis: RedisService
    db: DbService
    logger: LoggerService
}) =>
    Effect.gen(function* () {
        logger.info("Plan change detected", { referenceId, from: fromOverride, to: toOverride })

        const now = new Date()

        // Process all features concurrently — they're independent
        yield* Effect.all(
            Object.values(features).map((feature) =>
                handleFeaturePlanChange({
                    referenceId, toOverride, feature, now, redis, db, logger,
                })
            ),
            { concurrency: "unbounded" }
        )
    })

/**
 * Handle plan change for a single feature.
 */
const handleFeaturePlanChange = ({
    referenceId, toOverride, feature, now, redis, db, logger,
}: {
    referenceId: string
    toOverride: string
    feature: Feature
    now: Date
    redis: RedisService
    db: DbService
    logger: LoggerService
}) =>
    Effect.gen(function* () {
        const behavior = feature.onPlanChange ?? "carry-over"

        // Log plan-change event (both behaviors)
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

        if (behavior === "reset") {
            const resetValue = feature.resetValue ?? 0

            // Reset Redis counter + update DB — concurrent
            yield* Effect.all([
                redis.set(`usage:${feature.key}:${referenceId}`, resetValue).pipe(
                    Effect.catchAll((err) =>
                        Effect.sync(() =>
                            logger.warn("Failed to reset Redis counter", {
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
        }
    })
