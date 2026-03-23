import { type BetterAuthPlugin } from "better-auth";
import type { UsageOptions } from "./types";

export type { UsageOptions, InferFeatureKeys, InferOverrideKeys } from "./types";
export type { Feature, Customer, Usage, UsageEvent } from "./types";
import {
    getConsumeEndpoint,
    getCheckEndpoint,
    getCanUseEndpoint,
    getUseFeatureEndpoint,
    getSyncEndpoint,
    getUpsertCustomerEndpoint,
    getCheckCustomerEndpoint,
    getFeaturesEndpoint,
    getFeatureEndpoint,
} from "./endpoints/v2";

/**
 * Creates a usage plugin configured with the provided options.
 *
 * @param options - Plugin configuration; include `cacheOptions` to enable Redis cache and optional realtime features.
 * @returns A BetterAuth plugin with usage tracking, entitlement checks, and customer management endpoints.
 */
export function usage<const O extends UsageOptions>(options: O) {
    return {
        id: "usage",

        schema: {
            // Current usage state — one row per (referenceId, feature)
            usage: {
                fields: {
                    referenceId: { type: "string", required: true, input: true },
                    feature: { type: "string", required: true, input: true },
                    amount: { type: "number", required: true, input: true },
                    event: { type: "string", required: true },
                    lastResetAt: { type: "date", required: true },
                    createdAt: { type: "date", required: true },
                    updatedAt: { type: "date", required: true },
                },
            },
            // Append-only event log — one row per consumption event
            usageEvent: {
                fields: {
                    referenceId: { type: "string", required: true, input: true },
                    feature: { type: "string", required: true, input: true },
                    amount: { type: "number", required: true, input: true },
                    event: { type: "string", required: true },
                    overrideKey: { type: "string", required: false, input: true },
                    lastResetAt: { type: "date", required: true },
                    createdAt: { type: "date", required: true },
                },
            },
            customer: {
                fields: {
                    referenceId: {
                        type: "string",
                        required: true,
                        input: true,
                        unique: true
                    },
                    referenceType: {
                        type: "string",
                        required: true,
                        input: true
                    },
                    email: { type: "string", required: false, input: true },
                    name: { type: "string", required: false, input: true }
                },
            }
        },

        endpoints: {
            // Existing endpoints (v2 — Effect-powered)
            getFeature: getFeatureEndpoint(options),
            consumeFeature: getConsumeEndpoint(options),
            listFeatures: getFeaturesEndpoint(options),
            checkUsage: getCheckEndpoint(options),
            checkCustomer: getCheckCustomerEndpoint(options),
            upsertCustomer: getUpsertCustomerEndpoint(options),
            syncUsage: getSyncEndpoint(options),

            // New entitlement endpoints
            canUse: getCanUseEndpoint(options),
            useFeature: getUseFeatureEndpoint(options),
        },
    } satisfies BetterAuthPlugin;
}
