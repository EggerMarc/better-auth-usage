import { APIError, type BetterAuthPlugin } from "better-auth";
import type { UsageOptions, UsageOptionsWithCache } from "./types";
import { UsageCache } from "./adapters/cache";
import { UsageTracker } from "./realtime/usage-tracker";
import { UsageWebSocketServer } from "./realtime/websocket-server";
import {
    getSyncEndpoint,
    getUpsertCustomerEndpoint,
    getCheckEndpoint,
    getFeaturesEndpoint,
    getFeatureEndpoint,
    getConsumeEndpoint
} from "./endpoints/";
import { type UsageAdapter } from "./adapters";
import type { AuthContext } from "better-auth";
import { getCheckCustomerEndpoint } from "./endpoints/check-customer";
/**
 * Creates a usage plugin configured with the provided options.
 *
 * The plugin may initialize an optional Redis-backed cache and an optional realtime WebSocket server when `init()` is called, depending on `options.cacheOptions`.
 *
 * @param options - Plugin configuration; include `cacheOptions` to enable the Redis cache and optional realtime features (CORS, port, and enableRealtime).
 * @returns A BetterAuth plugin object containing `id`, `init()`, `schema`, and `endpoints` for usage tracking and customer management.
 */
export function usage<O extends UsageOptions = UsageOptions>(options: O) {
    return {
        id: "usage",

        schema: {
            usage: {
                fields: {
                    referenceId: {
                        type: "string",
                        required: true,
                        input: true
                    },
                    feature: { type: "string", required: true, input: true },
                    amount: { type: "number", required: true, input: true },
                    event: { type: "string", required: true },
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
            getFeature: getFeatureEndpoint(options),
            consumeFeature: getConsumeEndpoint(options),
            listFeatures: getFeaturesEndpoint(options),
            checkUsage: getCheckEndpoint(options),
            checkCustomer: getCheckCustomerEndpoint(options),
            upsertCustomer: getUpsertCustomerEndpoint(options),
            syncUsage: getSyncEndpoint(options)

        },
    } as BetterAuthPlugin;
}
