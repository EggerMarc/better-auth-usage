import { Effect, Layer, Fiber } from "effect"
import { APIError } from "better-auth/api"
import { DriverService, makeDriverServiceLive, DbService, makeDbService, LoggerService, makeLoggerServiceLive } from "./services"
import { recover, startSubscribeWorker, startPollWorker } from "./wal"
import { startWsServer, type WsServerHandle } from "./realtime/ws-server"
import type { ResolvedUsageOptions } from "./types"
import type { UsageDriver } from "./drivers/types"
import type { AuthContext } from "better-auth"

/**
 * Shared state — initialized once, reused across requests.
 */
let sharedLayer: Layer.Layer<DriverService | LoggerService> | null = null
let capturedAdapter: any = null
let capturedDriver: UsageDriver | null = null
let walFiber: Fiber.RuntimeFiber<any, any> | null = null
let walStarted = false
let wsServer: WsServerHandle | null = null

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

    const hasWal = !!options.driver.wal
    // The driver supplies its own Node-WS port (redis/memory). DO has no port.
    const wsPort = options.driver.realtime?.port
    const hasRealtime = !!(options.driver.realtime && wsPort)
    if (!hasWal && !hasRealtime) return

    // Need the DB adapter (captured per-request) for both the WAL drain and
    // the realtime RPC pipelines.
    if (!capturedAdapter) return

    walStarted = true

    const shared = getSharedLayer(options)
    const dbLayer = Layer.succeed(DbService, makeDbService(capturedAdapter))
    const fullLayer = Layer.merge(shared, dbLayer)

    // Start the WAL drain worker (independent of realtime).
    if (hasWal) {
        const walConfig = options.cacheOptions?.wal ?? {}
        const strategy = walConfig.drainStrategy ?? "subscribe"
        const pollInterval = walConfig.pollInterval ?? 1000

        const walPipeline = Effect.gen(function*() {
            yield* recover
            if (strategy === "subscribe") {
                yield* startSubscribeWorker(fullLayer)
            } else {
                yield* startPollWorker(pollInterval)
            }
        })

        walFiber = Effect.runFork(walPipeline.pipe(Effect.provide(fullLayer)))
    }

    // Start the native WebSocket realtime server (independent of WAL).
    if (hasRealtime) {
        wsServer = await startWsServer({
            port: wsPort!,
            options,
            layer: fullLayer,
            authCtx: capturedAdapter,
            logger: options.logger,
        })
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
 * Reset the runtime (for testing). Returns a promise that resolves once the
 * driver has been closed.
 */
export function resetRuntime(): Promise<void> {
    if (walFiber) {
        Effect.runSync(Fiber.interrupt(walFiber))
        walFiber = null
    }
    // Await the WS server close so the port is released before the next start.
    const closingWs = wsServer?.close() ?? Promise.resolve()
    wsServer = null
    const closingDriver = capturedDriver?.close() ?? Promise.resolve()
    sharedLayer = null
    capturedAdapter = null
    capturedDriver = null
    walStarted = false
    return Promise.allSettled([closingWs, closingDriver]).then(() => {})
}
