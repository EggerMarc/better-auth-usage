import { Effect } from "effect"
import { RedisService, DbService, LoggerService } from "@/services"
import { CustomerNotFound } from "@/errors"
import type { Customer } from "@/types"

/**
 * Cache-first customer lookup.
 *
 * 1. Try Redis hash → return if found
 * 2. Fallback to DB → return if found, hydrate cache
 * 3. Not found → fail with CustomerNotFound
 *
 * Returns: Effect<Customer, CustomerNotFound | RedisError | DbError, RedisService | DbService | LoggerService>
 */
export const getCustomer = (referenceId: string) =>
    Effect.gen(function*() {
        const redis = yield* RedisService
        const db = yield* DbService
        const logger = yield* LoggerService

        const cached = yield* tryGetFromCache(redis, referenceId)
        if (cached) {
            return cached
        }

        const customer = yield* db.findOne<Customer>({
            model: "customer",
            where: [{ field: "referenceId", value: referenceId }],
        })

        if (!customer) {
            return yield* new CustomerNotFound({ referenceId })
        }

        yield* redis.hset(`customer:${referenceId}`, customerToHash(customer)).pipe(
            Effect.catchAll((err) =>
                Effect.sync(() =>
                    logger.warn("Failed to cache customer", { referenceId, error: err })
                )
            ),
            Effect.fork,
        )

        return customer
    })

/**
 * Optional customer lookup — same as getCustomer but returns null instead of failing.
 * Used in consume flow where customer is optional.
 */
export const getCustomerOptional = (referenceId: string) =>
    getCustomer(referenceId).pipe(
        Effect.catchTag("CustomerNotFound", () => Effect.succeed(null))
    )

/**
 * Try to read customer from Redis hash.
 */
const tryGetFromCache = (redis: RedisService, referenceId: string) =>
    Effect.gen(function*() {
        const data = yield* redis.hgetall(`customer:${referenceId}`)

        if (!data.referenceId) {
            return null
        }

        return {
            referenceId: data.referenceId,
            referenceType: data.referenceType,
            email: data.email || undefined,
            name: data.name || undefined,
            overrideKey: data.overrideKey || undefined,
        } as Customer
    })

/**
 * Convert a Customer object to a flat hash for Redis HSET.
 */
const customerToHash = (customer: Customer): Record<string, string> => {
    const hash: Record<string, string> = {
        referenceId: customer.referenceId,
        referenceType: customer.referenceType,
    }
    if (customer.email) hash.email = customer.email
    if (customer.name) hash.name = customer.name
    if (customer.overrideKey) hash.overrideKey = customer.overrideKey
    return hash
}
