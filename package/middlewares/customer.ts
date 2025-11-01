import type { UsageAdapter } from "@/adapters";
import { resolveGetCustomer } from "@/resolvers/get-customer";
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

        const customer = await resolveGetCustomer({ referenceId: ctx.body.referenceId, options, adapter })

        if (!customer) {
            throw new APIError("NOT_FOUND", {
                message: `Customer with id ${ctx.body.referenceId} not found`
            })
        }
    })
}

