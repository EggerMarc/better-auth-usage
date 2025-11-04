import { Server as SocketServer } from "socket.io";
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
import { getUsageAdapter, type UsageAdapter } from "./adapters";
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
    let cache: UsageCache | undefined;
    let tracker: UsageTracker | undefined;
    let wsServer: UsageWebSocketServer | undefined;
    let io: SocketServer | undefined;
    let serverAdapter: UsageAdapter | undefined;
    const runtimeOptions: UsageOptionsWithCache = { ...options };

    return {
        id: "usage",

        async init(ctx: AuthContext): Promise<void> {
            serverAdapter = getUsageAdapter(ctx)

            if (!options.cacheOptions) {
                console.log("[better-auth-usage] Running without cache (DB-only mode)");
                return;
            }

            console.log("[better-auth-usage] Initializing cache...");

            cache = new UsageCache({
                url: options.cacheOptions.redisUrl,
            });
            runtimeOptions.cache = cache;

            if (options.cacheOptions.enableRealtime) {
                if (!options.cacheOptions.port) {
                    throw new Error("Port is required when enableRealtime is true");
                }

                console.log("[better-auth-usage] Realtime enabled, starting WebSocket server...");

                io = new SocketServer({
                    cors: options.cacheOptions.cors || {
                        origin: "*",
                        credentials: true
                    }
                });

                const port = options.cacheOptions.port;
                io.listen(port);
                console.log(`[better-auth-usage] WebSocket server listening on port ${port}`);
                try {
                    tracker = new UsageTracker(
                        options.cacheOptions.redisUrl,
                        io,
                        cache
                    );
                    await tracker.connect();
                    runtimeOptions.tracker = tracker;
                    console.log("[better-auth-usage] Pub/sub tracker connected");
                } catch (err) {
                    throw new APIError("INTERNAL_SERVER_ERROR", {
                        message: `[ERROR][USAGE] Failed to initialize UsageTracker service ${err}`
                    })
                }

                wsServer = new UsageWebSocketServer(
                    io,
                    tracker,
                    runtimeOptions
                );

                console.log("[better-auth-usage] WebSocket handlers registered");
            } else {
                console.log("[better-auth-usage] Realtime disabled (cache-only mode)");
            }
        },

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
            consumeFeature: getConsumeEndpoint({
                options,
                adapter: serverAdapter!
            }),
            listFeatures: getFeaturesEndpoint(options),
            checkUsage: getCheckEndpoint({
                options,
                adapter: serverAdapter!
            }),
            checkCustomer: getCheckCustomerEndpoint({
                options,
                adapter: serverAdapter!
            }),
            upsertCustomer: getUpsertCustomerEndpoint(options),
            syncUsage: getSyncEndpoint({
                options,
                adapter: serverAdapter!
            })

        },
    } as BetterAuthPlugin;
}
