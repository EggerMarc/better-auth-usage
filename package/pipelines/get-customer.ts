import { Effect } from "effect"
import { DriverService, DbService, LoggerService } from "@/services"
import { CustomerNotFound } from "@/errors"
import type { Customer } from "@/types"

/**
 * Cache-first customer lookup.
 *
 * 1. Try the driver cache → return if found
 * 2. Fallback to DB → return if found, hydrate cache
 * 3. Not found → fail with CustomerNotFound
 *
 * Returns: Effect<Customer, CustomerNotFound | DriverError | DbError, DriverService | DbService | LoggerService>
 */
export const getCustomer = (referenceId: string) =>
    Effect.gen(function*() {
        const driver = yield* DriverService
        const db = yield* DbService
        const logger = yield* LoggerService

        // A cache read failure must not abort the lookup — treat it as a miss
        // and fall through to the DB.
        const cached = yield* driver.getCustomer(referenceId).pipe(
            Effect.catchAll((err) =>
                Effect.sync(() => {
                    logger.warn("Driver getCustomer failed, falling back to DB", { referenceId, error: err })
                    return null
                })
            )
        )
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

        yield* driver.setCustomer(customer).pipe(
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
