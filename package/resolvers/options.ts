import { getUsageAdapter, type UsageAdapter } from "@/adapters";
import { UsageCache } from "@/adapters/cache";
import { UsageTracker } from "@/realtime/usage-tracker";
import { UsageWebSocketServer } from "@/realtime/websocket-server";
import type { EndpointParams, UsageOptions, UsageOptionsWithCache } from "@/types";
import { APIError, type AuthContext } from "better-auth";
import { Server as SocketServer } from "socket.io";

export async function getUsageOptions({
    ctx, options
}: {
    ctx: AuthContext,
    options: UsageOptions
}) {

    let cache: UsageCache | undefined;
    let tracker: UsageTracker | undefined;
    let wsServer: UsageWebSocketServer | undefined;
    let io: SocketServer | undefined;
    let serverAdapter: UsageAdapter | undefined;
    const runtimeOptions: UsageOptionsWithCache = { ...options };

    serverAdapter = getUsageAdapter(ctx)

    if (!options.cacheOptions) {
        console.log("[better-auth-usage] Running without cache (DB-only mode)");
    }

    if (options.cacheOptions) {
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
    }

    return { adapter: getUsageAdapter(ctx), options: runtimeOptions }
}
