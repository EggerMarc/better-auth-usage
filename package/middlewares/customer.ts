import type { UsageAdapter } from "@/adapters";
import { resolveGetCustomer } from "@/resolvers/get-customer";
import { redactId, tryCatch } from "@/utils";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { UsageOptionsWithCache } from "package/types";

interface CustomerMiddlewareParams {
    options: UsageOptionsWithCache,
    adapter: UsageAdapter
}

/**
 * Creates an authentication middleware that authorizes a reference against a resolved feature.
 *
 * @param options - Configuration for the middleware
 * @param adapter - Server adapter to access DB by resolver 
 * @throws APIError with type `"UNAUTHORIZED"` if the resolved feature's `authorizeReference` returns `false`
 */
export function getCustomerMiddleware({ options, adapter }: CustomerMiddlewareParams) {
    return createAuthMiddleware(async (ctx) => {
        console.log("[better-auth-usage] Calling get customer middleware")
        const { data: customer, error } = await tryCatch(resolveGetCustomer({ referenceId: ctx.body.referenceId, options, adapter }))

        if (error) {
            console.log(`[better-auth-usage] Failed customer middleware with error (type 1)\n${error.message}`)
            throw error
        }

        if (!customer) {
            console.log(`[better-auth-usage] Failed customer middleware with error. Customer not found (type 2)`)
            throw new APIError("NOT_FOUND", {
                message: `Customer with id ${redactId(ctx.body.referenceId)} not found`
            })
        }
    })
}

