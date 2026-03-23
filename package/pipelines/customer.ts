import { Effect } from "effect"
import { RedisService, DbService, LoggerService } from "@/services"
import { CustomerNotFound, DbError } from "@/errors"
import type { Customer } from "@/types"

/**
 * Upsert a customer — create or update.
 * If cache is available, syncs to Redis hash after DB write.
 */
export const upsertCustomer = (customer: Customer) =>
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
