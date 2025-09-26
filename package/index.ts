import type { BetterAuthPlugin } from "better-auth";
import type { UsageOptions } from "./types.ts";
import {
    getSyncEndpoint,
    getUpsertCustomerEndpoint,
    getCheckEndpoint,
    getFeaturesEndpoint,
    getFeatureEndpoint,
    getConsumeEndpoint
} from "./endpoints/";

/**
 * Usage plugin for BetterAuth
 *
 * Responsibilities:
 *  - provide endpoints to register customers (in-memory by default)
 *  - consume (meter) feature usage with before/after hooks
 *  - check usage limits
 *  - sync/reset usage according to `feature.reset`
 *
 * Notes:
 *  - Customer shape is validated at runtime with `customerSchema` (zod).
 *  - By default customers are kept in-memory (options.customers). Persistent customers
 *  and customer based limits is in the roadmap
 */
export function usage<O extends UsageOptions = UsageOptions>(options: O) {
    return {
        id: "@eggermarc/usage",
        schema: {
            usage: {
                fields: {
                    referenceId: { type: "string", required: true, input: true },
                    referenceType: { type: "string", required: true, input: true },
                    feature: { type: "string", required: true, input: true },
                    amount: { type: "number", required: true, input: true },
                    afterAmount: { type: "number", required: true, input: true },
                    event: { type: "string", required: true },
                    lastResetAt: { type: "date", required: true },
                    createdAt: { type: "date", required: true },
                },
            },
            customer: {
                fields: {
                    referenceId: { type: "string", required: true, input: true, unique: true },
                    referenceType: { type: "string", required: true, input: true },
                    email: { type: "string", required: false, input: true },
                    name: { type: "string", required: false, input: true }
                },
            }
        },

        endpoints: {
            /**
             * Get feature metadata (merged with overrides if provided).
             */
            getFeature: getFeatureEndpoint(options),
            /**
             * Consume (meter) a feature for a given referenceId.
             * - runs before hook
             * - inserts usage row (adapter)
             * - runs after hook
             */
            consumeFeature: getConsumeEndpoint(options),
            listFeatures: getFeaturesEndpoint(options),
            /**
             * Check usage limit for a feature for a specific reference.
             * Returns a small enum ("in-limit"|"above-limit"|"below-limit") based on checkLimit util.
             */
            checkUsage: getCheckEndpoint(options),
            upsertCustomer: getUpsertCustomerEndpoint(),
            /**
             * Sync usage according to feature.reset rules.
             * This will insert a reset event row with zeroed usage if the feature requires it.
             *
             * Note: you might prefer running this as a background job for many customers,
             * rather than via an endpoint.
             */
            syncUsage: getSyncEndpoint(options)
        }
    } satisfies BetterAuthPlugin;
}

