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
    getWsEndpoint,
} from "./endpoints";
import { validateConfig } from "./config";

/**
 * Creates a usage plugin configured with the provided options.
 *
 * @param options - Plugin configuration; include `cacheOptions` to enable Redis cache and optional realtime features.
 * @returns A BetterAuth plugin with usage tracking, entitlement checks, and customer management endpoints.
 * @throws Error if config is invalid (empty features, maxLimit < minLimit, etc.)
 */
export function usage<const O extends UsageOptions>(options: O) {
    validateConfig(options);

    // Populate `key` from object keys so users don't have to write it
    const resolvedFeatures: Record<string, import("./types").Feature> = {}
    for (const [key, config] of Object.entries(options.features)) {
        resolvedFeatures[key] = { ...config, key }
    }
    const resolved = { ...options, features: resolvedFeatures }

    const plugin = {
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
                    name: { type: "string", required: false, input: true },
                    overrideKey: { type: "string", required: false, input: true },
                },
            }
        },

        endpoints: {
            // Existing endpoints (v2 — Effect-powered)
            getFeature: getFeatureEndpoint(resolved),
            consumeFeature: getConsumeEndpoint(resolved),
            listFeatures: getFeaturesEndpoint(resolved),
            checkUsage: getCheckEndpoint(resolved),
            checkCustomer: getCheckCustomerEndpoint(resolved),
            upsertCustomer: getUpsertCustomerEndpoint(resolved),
            syncUsage: getSyncEndpoint(resolved),

            // New entitlement endpoints
            canUse: getCanUseEndpoint(resolved),
            useFeature: getUseFeatureEndpoint(resolved),

            // WS discovery
            wsInfo: getWsEndpoint(resolved),
        },
    } satisfies BetterAuthPlugin

    return {
        ...plugin,
        /** @internal Phantom type carrying feature keys for client inference */
        _featureKeys: {} as keyof O["features"] & string,
    }
}
