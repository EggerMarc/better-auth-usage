import type { UsageAdapter } from "@/adapters";
import { resolveGetCustomer } from "@/resolvers/get-customer";
import { tryCatch } from "@/utils";
import { createAuthMiddleware } from "better-auth/api";
import type { UsageOptionsWithCache } from "package/types";

interface CustomerMiddlewareParams {
    options: UsageOptionsWithCache,
    adapter: UsageAdapter
}

/**
 * Creates an authentication middleware that retrieves and validates a customer by referenceId.
 *
 * @param options - Usage options, optionally including a cache layer for customer lookup
 * @param adapter - Adapter used to retrieve the customer from the primary data store
 * @throws APIError with code `"NOT_FOUND"` if the customer does not exist
 * @throws APIError with code `"INTERNAL_SERVER_ERROR"` if the lookup fails
 */
export function getCustomerMiddleware({ options, adapter }: CustomerMiddlewareParams) {
    return createAuthMiddleware(async (ctx) => {
        console.log("[better-auth-usage] Calling get customer middleware")
        const { data: customer, error } = await tryCatch(resolveGetCustomer({ referenceId: ctx.body.referenceId, options, adapter }))

        if (error) {
            console.log(`[better-auth-usage] Failed customer middleware with error (type 1)\n${error.message}`)
            throw error
        }

    })
}

