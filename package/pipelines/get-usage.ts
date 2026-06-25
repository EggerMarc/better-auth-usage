import { Effect } from "effect"
import { DriverService, DbService, LoggerService } from "@/services"
import type { Feature, Usage, CachedUsage, CachedLimits } from "@/types"
import { shouldReset } from "@/utils"

interface GetUsageParams {
    referenceId: string
    feature: Omit<Feature, "hooks">
}

/**
 * Cache-first usage lookup.
 *
 * 1. Try the driver (counter + limits in one read) → return if found
 * 2. Fallback to DB → return if found
 * 3. On DB hit, hydrate the driver cache (non-blocking, errors logged)
 *
 * Returns: Effect<Usage, DriverError | DbError, DriverService | DbService | LoggerService>
 */
export const getUsage = ({ referenceId, feature }: GetUsageParams) =>
    Effect.gen(function* () {
        const driver = yield* DriverService
        const db = yield* DbService
        const logger = yield* LoggerService

        // 1. Try the driver cache
        const cached = yield* driver.getUsage(referenceId, feature.key)
        if (cached) {
            return {
                referenceId,
                feature: feature.key,
                amount: cached.current,
                lastResetAt: cached.lastResetAt ?? new Date(),
                createdAt: new Date(),
                event: "cache",
            } satisfies Usage
        }

        // 2. Fallback to DB
        const dbUsage = yield* getFromDb(db, referenceId, feature)

        // 3. Hydrate cache in background (log errors, don't fail the request)
        yield* hydrateCache(referenceId, feature, dbUsage).pipe(
            Effect.catchAll((err) =>
                Effect.sync(() =>
                    logger.debug("Failed to hydrate cache from DB", {
                        referenceId,
                        feature: feature.key,
                        error: err,
                    })
                )
            ),
            Effect.fork,  // run in background fiber, don't block the response
        )

        return dbUsage
    })

/**
 * Read usage from DB — single row per (referenceId, feature).
 * Auto-creates initial row if none exists.
 */
const getFromDb = (
    db: DbService,
    referenceId: string,
    feature: Omit<Feature, "hooks">
) =>
    Effect.gen(function* () {
        const result = yield* db.findOne<Usage>({
            model: "usage",
            where: [
                { field: "referenceId", value: referenceId },
                { field: "feature", value: feature.key },
            ],
        })

        if (result) {
            return result
        }

        // Auto-create initial usage row
        const now = new Date()
        const initial: Usage = {
            referenceId,
            amount: feature.resetValue ?? 0,
            feature: feature.key,
            createdAt: now,
            lastResetAt: now,
            updatedAt: now,
            event: "sync",
        }
        yield* db.create({ model: "usage", data: initial as Record<string, unknown> })
        return initial
    })

/**
 * After a DB hit, hydrate the driver cache with the current state.
 * Runs in a background fiber — errors are logged, not propagated.
 */
const hydrateCache = (
    referenceId: string,
    feature: Omit<Feature, "hooks">,
    usage: Usage
) =>
    Effect.gen(function* () {
        const driver = yield* DriverService

        const cachedUsage: CachedUsage = {
            referenceId,
            feature: feature.key,
            current: usage.amount,
            lastResetAt: usage.lastResetAt,
            maxLimit: feature.maxLimit,
            minLimit: feature.minLimit,
        }

        // Mirror the original behavior: only persist reset metadata (limits +
        // boundaries) when the feature actually has reset rules. Without it, the
        // meta stays empty so a cache hit reports `lastResetAt` as "now".
        const meta: CachedLimits = feature.reset
            ? {
                referenceId,
                feature: feature.key,
                lastResetAt: usage.lastResetAt,
                maxLimit: feature.maxLimit,
                minLimit: feature.minLimit,
                resetValue: feature.resetValue,
                ...(shouldReset(usage.lastResetAt, feature.reset).nextReset
                    ? { resetAt: shouldReset(usage.lastResetAt, feature.reset).nextReset }
                    : {}),
            }
            : { referenceId, feature: feature.key }

        yield* driver.hydrate(referenceId, feature.key, cachedUsage, meta)
    })
