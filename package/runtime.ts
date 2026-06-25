import { Effect, Layer, Fiber } from "effect"
import { APIError } from "better-auth/api"
import { DriverService, makeDriverServiceLive, DbService, makeDbService, LoggerService, makeLoggerServiceLive } from "@/services"
import { recover, startSubscribeWorker, startPollWorker } from "@/wal"
import { startRealtimeSubscriber } from "@/realtime/usage-tracker"
import { setupWebSocketHandlers, registerAuthMiddleware } from "@/realtime/websocket-server"
import { Server as SocketServer } from "socket.io"
import type { ResolvedUsageOptions } from "@/types"
import type { UsageDriver } from "@/drivers/types"
import type { AuthContext } from "better-auth"

/**
 * Shared state — initialized once, reused across requests.
 */
let sharedLayer: Layer.Layer<DriverService | LoggerService> | null = null
let capturedAdapter: any = null
let capturedDriver: UsageDriver | null = null
let walFiber: Fiber.RuntimeFiber<any, any> | null = null
let walStarted = false
let ioServer: SocketServer | null = null

/**
 * Initialize the shared layer from plugin options.
 */
function getSharedLayer(options: ResolvedUsageOptions): Layer.Layer<DriverService | LoggerService> {
    if (sharedLayer) return sharedLayer

    capturedDriver = options.driver
    const loggerLayer = makeLoggerServiceLive(options.logger)
    const driverLayer = makeDriverServiceLive(options.driver)
    sharedLayer = Layer.merge(driverLayer, loggerLayer)

    return sharedLayer
}

/**
 * Start the WAL worker if the driver has a WAL capability.
 * Called once on first request.
 */
async function ensureWalStarted(options: ResolvedUsageOptions) {
    if (walStarted) return
    walStarted = true

    if (!options.driver.wal) return

    // Need the DB adapter (captured per-request) to drain into
    if (!capturedAdapter) {
        walStarted = false
        return
    }

    const shared = getSharedLayer(options)
    const dbLayer = Layer.succeed(DbService, makeDbService(capturedAdapter))
    const fullLayer = Layer.merge(shared, dbLayer)

    const walConfig = options.cacheOptions?.wal ?? {}
    const strategy = walConfig.drainStrategy ?? "subscribe"
    const pollInterval = walConfig.pollInterval ?? 1000

    const walPipeline = Effect.gen(function*() {
        // Recovery first — reclaim pending entries from previous run
        yield* recover

        // Start worker based on strategy
        if (strategy === "subscribe") {
            yield* startSubscribeWorker(fullLayer)
        } else {
            yield* startPollWorker(pollInterval)
        }
    })

    // Run WAL worker in a background fiber
    walFiber = Effect.runFork(
        walPipeline.pipe(Effect.provide(fullLayer))
    )

    // Start realtime WebSocket server if configured (legacy socket.io transport)
    if (options.cacheOptions?.enableRealtime && options.cacheOptions?.port) {
        const port = options.cacheOptions.port
        const cors = options.cacheOptions.cors ?? { origin: "*", credentials: true }

        ioServer = new SocketServer({ cors })
        ioServer.listen(port)

        // Register handshake auth middleware (validates token → attaches userId)
        Effect.runFork(
            registerAuthMiddleware(ioServer, capturedAdapter).pipe(Effect.provide(fullLayer))
        )

        // Start realtime subscriber (forwards driver events → Socket.IO)
        Effect.runFork(
            startRealtimeSubscriber(ioServer).pipe(Effect.provide(fullLayer))
        )

        // Register WebSocket connection handlers
        Effect.runFork(
            setupWebSocketHandlers(ioServer, options, fullLayer).pipe(Effect.provide(fullLayer))
        )

        console.log(`[better-auth-usage] WebSocket server listening on port ${port}`)
    }
}

/**
 * Run an Effect pipeline with all required services.
 * Maps typed Effect errors to BetterAuth APIErrors at the boundary.
 *
 * Endpoints no longer need try-catch — error mapping is centralized here.
 */
export async function runPipeline<A, E>(
    authCtx: AuthContext,
    options: ResolvedUsageOptions,
    effect: Effect.Effect<A, E, DriverService | DbService | LoggerService>
): Promise<A> {
    if (!capturedAdapter) {
        capturedAdapter = authCtx
    }

    const shared = getSharedLayer(options)
    const dbLayer = Layer.succeed(DbService, makeDbService(authCtx))
    const fullLayer = Layer.merge(shared, dbLayer)

    await ensureWalStarted(options)

    const exit = await Effect.runPromiseExit(
        effect.pipe(Effect.provide(fullLayer))
    )

    if (exit._tag === "Success") {
        return exit.value
    }

    // Map Effect errors to BetterAuth APIErrors with descriptive messages
    const cause = exit.cause
    const err = cause && "error" in cause ? (cause as any).error : null
    const tag = err?._tag

    if (tag === "NotAuthorized") {
        throw new APIError("UNAUTHORIZED", {
            message: `User "${err.userId}" is not authorized to access "${err.feature}" for reference "${err.referenceId}"`
        })
    }
    if (tag === "FeatureNotFound") {
        throw new APIError("NOT_FOUND", {
            message: `Feature "${err.featureKey}" not found. Check that this feature is defined in your usage plugin config.`
        })
    }
    if (tag === "CustomerNotFound") {
        throw new APIError("NOT_FOUND", {
            message: `Customer not found. Call upsert-customer before consuming usage.`
        })
    }
    if (tag === "LimitExceeded") {
        throw new APIError("FORBIDDEN", {
            message: `Usage limit exceeded for "${err.featureKey}": current ${err.current}, limit ${err.limit}`
        })
    }
    if (tag === "ValidationError") {
        throw new APIError("BAD_REQUEST", {
            message: `Validation error: ${err.message}`
        })
    }
    if (tag === "DriverError") {
        throw new APIError("INTERNAL_SERVER_ERROR", {
            message: `Driver error during ${err.operation}: ${err.cause instanceof Error ? err.cause.message : String(err.cause)}`
        })
    }
    if (tag === "DbError") {
        throw new APIError("INTERNAL_SERVER_ERROR", {
            message: `Database error during ${err.operation}: ${err.cause instanceof Error ? err.cause.message : String(err.cause)}`
        })
    }

    // Unknown error — extract as much info as possible
    const message = err?.message ?? err?._tag ?? String(cause)
    throw new APIError("INTERNAL_SERVER_ERROR", {
        message: `Usage plugin error: ${message}`
    })
}

/**
 * Check if WAL is enabled and active.
 * Used by consume pipeline to decide whether to skip direct DB writes.
 */
export function isWalActive(options: ResolvedUsageOptions): boolean {
    return !!options.driver.wal
}

/**
 * Reset the runtime (for testing). Returns a promise that resolves once the
 * driver has been closed.
 */
export function resetRuntime(): Promise<void> {
    if (walFiber) {
        Effect.runSync(Fiber.interrupt(walFiber))
        walFiber = null
    }
    if (ioServer) {
        ioServer.close()
        ioServer = null
    }
    const closing = capturedDriver?.close() ?? Promise.resolve()
    sharedLayer = null
    capturedAdapter = null
    capturedDriver = null
    walStarted = false
    return Promise.resolve(closing).catch(() => {})
}
