import { Effect } from "effect"
import { RedisService, DbService, LoggerService } from "@/services"
import { RedisError, DbError } from "@/errors"
import type { Feature, Usage } from "@/types"
import { shouldReset } from "@/utils"

interface GetUsageParams {
    referenceId: string
    feature: Omit<Feature, "hooks">
}

/**
 * Cache-first usage lookup.
 *
 * 1. Try Redis counter → return if found
 * 2. Fallback to DB → return if found
 * 3. On DB hit, hydrate Redis cache (non-blocking, errors logged not swallowed silently)
 *
 * Returns: Effect<Usage, RedisError | DbError, RedisService | DbService | LoggerService>
 *
 * The type signature tells you everything:
 * - Produces: Usage
 * - Can fail with: RedisError or DbError
 * - Needs: RedisService, DbService, and LoggerService to run
 */
export const getUsage = ({ referenceId, feature }: GetUsageParams) =>
    Effect.gen(function* () {
        const redis = yield* RedisService
        const db = yield* DbService
        const logger = yield* LoggerService

        // 1. Try Redis
        const cached = yield* tryGetFromCache(redis, referenceId, feature)
        if (cached) {
            return cached
        }

        // 2. Fallback to DB
        const dbUsage = yield* getFromDb(db, referenceId, feature)

        // 3. Hydrate cache in background (log errors, don't fail the request)
        yield* hydrateCache(redis, logger, referenceId, feature, dbUsage).pipe(
            Effect.catchAll((err) =>
                Effect.sync(() =>
                    logger.warn("Failed to hydrate cache from DB", {
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
 * Try to read usage from Redis counter + metadata hash.
 * Returns null if the key doesn't exist (cache miss).
 */
const tryGetFromCache = (
    redis: RedisService,
    referenceId: string,
    feature: Omit<Feature, "hooks">
) =>
    Effect.gen(function* () {
        const usageKey = `usage:${feature.key}:${referenceId}`
        const metaKey = `meta:${feature.key}:${referenceId}`

        const rawCounter = yield* redis.get(usageKey)

        if (rawCounter === null) {
            return null  // cache miss
        }

        const amount = Number(rawCounter)
        const meta = yield* redis.hgetall(metaKey)

        return {
            referenceId,
            feature: feature.key,
            amount,
            lastResetAt: meta.lastResetAt
                ? new Date(Number(meta.lastResetAt))
                : new Date(),
            createdAt: new Date(),
            event: "cache",
        } satisfies Usage
    })

/**
 * Read usage from DB via the adapter.
 * Uses findOne on the usage table (single row per ref+feature).
 *
 * For now, falls back to the existing getUsageQuery behavior
 * until we migrate to the dual-table schema.
 */
const getFromDb = (
    db: DbService,
    referenceId: string,
    feature: Omit<Feature, "hooks">
) =>
    Effect.gen(function* () {
        const result = yield* db.findMany<Usage>({
            model: "usage",
            where: [
                { field: "referenceId", value: referenceId },
                { field: "feature", value: feature.key },
            ],
            sortBy: { field: "createdAt", direction: "desc" },
        })

        if (result.length === 0) {
            // Auto-create initial usage record
            const now = new Date()
            const initial: Usage = {
                referenceId,
                amount: feature.resetValue ?? 0,
                feature: feature.key,
                createdAt: now,
                lastResetAt: now,
                event: "sync",
            }
            yield* db.create({ model: "usage", data: initial as any })
            return initial
        }

        // Sum all records (current schema — will become findOne after Phase 3)
        const last = result[0]
        const total = result.reduce((sum, r) => sum + r.amount, 0)
        return { ...last, amount: total } as Usage
    })

/**
 * After a DB hit, hydrate the Redis cache with the current state.
 * This runs in a background fiber — errors are logged, not propagated.
 */
const hydrateCache = (
    redis: RedisService,
    logger: LoggerService,
    referenceId: string,
    feature: Omit<Feature, "hooks">,
    usage: Usage
) =>
    Effect.gen(function* () {
        const usageKey = `usage:${feature.key}:${referenceId}`
        const metaKey = `meta:${feature.key}:${referenceId}`

        // Set the counter
        yield* redis.set(usageKey, usage.amount)

        // Set metadata if feature has reset rules
        if (feature.reset) {
            const reset = shouldReset(usage.lastResetAt, feature.reset)

            yield* redis.hset(metaKey, {
                referenceId,
                feature: feature.key,
                lastResetAt: String(usage.lastResetAt.getTime()),
                ...(reset.nextReset && { resetAt: String(reset.nextReset.getTime()) }),
                ...(feature.maxLimit != null && { maxLimit: String(feature.maxLimit) }),
                ...(feature.minLimit != null && { minLimit: String(feature.minLimit) }),
                ...(feature.resetValue != null && { resetValue: String(feature.resetValue) }),
            })
        }

        logger.debug("Hydrated cache from DB", { referenceId, feature: feature.key })
    })
