import { getUsageAdapter, type UsageAdapter } from "@/adapters";
import { UsageCache } from "@/adapters/cache";
import { UsageTracker } from "@/realtime/usage-tracker";
import { UsageWebSocketServer } from "@/realtime/websocket-server";
import type { EndpointParams, UsageOptions, UsageOptionsWithCache } from "@/types";
import { APIError, type AuthContext } from "better-auth";
import { Server as SocketServer } from "socket.io";

class UsageInfrastructure {
    cache?: UsageCache;
    tracker?: UsageTracker;
    wsServer?: UsageWebSocketServer;
    io?: SocketServer;
    runtimeOptions?: UsageOptionsWithCache;
    initPromise?: Promise<void>;

    async initialize(options: UsageOptions) {
        if (this.runtimeOptions) return;

        const runtimeOptions: UsageOptionsWithCache = { ...options };

        if (!options.cacheOptions) {
            console.log("[better-auth-usage] Running without cache (DB-only mode)");
            this.runtimeOptions = runtimeOptions;
            return;
        }

        console.log("[better-auth-usage] Initializing cache...");

        this.cache = new UsageCache({
            url: options.cacheOptions.redisUrl,
        });
        runtimeOptions.cache = this.cache;

        if (options.cacheOptions.enableRealtime) {
            if (!options.cacheOptions.port) {
                throw new Error("Port is required when enableRealtime is true");
            }

            console.log("[better-auth-usage] Realtime enabled, starting WebSocket server...");

            this.io = new SocketServer({
                cors: options.cacheOptions.cors || {
                    origin: "*",
                    credentials: true
                }
            });

            const port = options.cacheOptions.port;
            this.io.listen(port);
            console.log(`[better-auth-usage] WebSocket server listening on port ${port}`);
            try {
                this.tracker = new UsageTracker(
                    options.cacheOptions.redisUrl,
                    this.io,
                    this.cache
                );
                await this.tracker.connect();
                runtimeOptions.tracker = this.tracker;
                console.log("[better-auth-usage] Pub/sub tracker connected");
            } catch (err) {
                throw new APIError("INTERNAL_SERVER_ERROR", {
                    message: `[ERROR][USAGE] Failed to initialize UsageTracker service ${err}`
                })
            }

            this.wsServer = new UsageWebSocketServer(
                this.io,
                this.tracker,
                runtimeOptions
            );

            console.log("[better-auth-usage] WebSocket handlers registered");
        } else {
            console.log("[better-auth-usage] Realtime disabled (cache-only mode)");
        }

        this.runtimeOptions = runtimeOptions;
    }

    async shutdown() {
        if (this.tracker) await this.tracker.disconnect();
        if (this.cache) await this.cache.disconnect();
        if (this.io) this.io.close();
        this.cache = undefined;
        this.tracker = undefined;
        this.wsServer = undefined;
        this.io = undefined;
        this.runtimeOptions = undefined;
        this.initPromise = undefined;
    }
}

const infrastructure = new UsageInfrastructure();

export async function getUsageOptions({
    ctx, options
}: {
    ctx: AuthContext,
    options: UsageOptions
}) {
    // Ensure infrastructure is initialized exactly once, even under concurrent requests
    if (!infrastructure.initPromise) {
        infrastructure.initPromise = infrastructure.initialize(options);
    }
    await infrastructure.initPromise;

    return { adapter: getUsageAdapter(ctx), options: infrastructure.runtimeOptions! }
}

export async function shutdownUsage() {
    await infrastructure.shutdown();
}
