import { Effect, Layer, Fiber } from "effect"
import { RedisService, makeRedisServiceLive, DbService, makeDbService, LoggerService, makeLoggerServiceLive } from "@/services"
import { recover, startSubscribeWorker, startPollWorker } from "@/wal"
import type { UsageOptions } from "@/types"
import type { AuthContext } from "better-auth"

/**
 * Shared state — initialized once, reused across requests.
 */
let sharedLayer: Layer.Layer<RedisService | LoggerService> | null = null
let capturedAdapter: any = null
let walFiber: Fiber.RuntimeFiber<any, any> | null = null
let walStarted = false

/**
 * Initialize the shared layer from plugin options.
 */
function getSharedLayer(options: UsageOptions): Layer.Layer<RedisService | LoggerService> {
    if (sharedLayer) return sharedLayer

    const loggerLayer = makeLoggerServiceLive(options.logger)

    if (options.cacheOptions?.redisUrl) {
        const redisLayer = makeRedisServiceLive(options.cacheOptions.redisUrl)
        sharedLayer = Layer.merge(redisLayer, loggerLayer)
    } else {
        const noopRedis = Layer.succeed(RedisService, {
            eval: () => Effect.succeed(null),
            get: () => Effect.succeed(null),
            set: () => Effect.void,
            del: () => Effect.void,
            hset: () => Effect.void,
            hgetall: () => Effect.succeed({}),
            publish: () => Effect.void,
            psubscribe: () => Effect.void,
            xgroupCreate: () => Effect.void,
            xreadgroup: () => Effect.succeed(null),
            xack: () => Effect.void,
            xlen: () => Effect.succeed(0),
            xtrim: () => Effect.void,
            quit: () => Effect.void,
        })
        sharedLayer = Layer.merge(noopRedis, loggerLayer)
    }

    return sharedLayer
}

/**
 * Start the WAL worker if Redis is configured and WAL is enabled.
 * Called once on first request.
 */
async function ensureWalStarted(options: UsageOptions) {
    if (walStarted) return
    walStarted = true

    if (!options.cacheOptions?.redisUrl) return

    const walConfig = options.cacheOptions.wal ?? {}
    if (walConfig.enabled === false) return

    // Need both Redis and DB layers for the WAL worker
    if (!capturedAdapter) return

    const shared = getSharedLayer(options)
    const dbLayer = Layer.succeed(DbService, makeDbService(capturedAdapter))
    const fullLayer = Layer.merge(shared, dbLayer)

    const strategy = walConfig.drainStrategy ?? "subscribe"
    const pollInterval = walConfig.pollInterval ?? 1000

    const walPipeline = Effect.gen(function* () {
        // Recovery first — reclaim pending entries from previous run
        yield* recover

        // Start worker based on strategy
        if (strategy === "subscribe") {
            yield* startSubscribeWorker
        } else {
            yield* startPollWorker(pollInterval)
        }
    })

    // Run WAL worker in a background fiber
    walFiber = Effect.runFork(
        walPipeline.pipe(Effect.provide(fullLayer))
    )
}

/**
 * Run an Effect pipeline with all required services.
 *
 * This is the bridge between BetterAuth's async endpoint handlers
 * and the Effect pipelines. Called at each endpoint.
 */
export async function runPipeline<A, E>(
    authCtx: AuthContext,
    options: UsageOptions,
    effect: Effect.Effect<A, E, RedisService | DbService | LoggerService>
): Promise<A> {
    // Capture the adapter from the first request for the WAL worker
    if (!capturedAdapter) {
        capturedAdapter = authCtx
    }

    const shared = getSharedLayer(options)
    const dbLayer = Layer.succeed(DbService, makeDbService(authCtx))
    const fullLayer = Layer.merge(shared, dbLayer)

    // Start WAL worker on first request (lazy init)
    await ensureWalStarted(options)

    return Effect.runPromise(
        effect.pipe(Effect.provide(fullLayer))
    )
}

/**
 * Check if WAL is enabled and active.
 * Used by consume pipeline to decide whether to skip direct DB writes.
 */
export function isWalActive(options: UsageOptions): boolean {
    if (!options.cacheOptions?.redisUrl) return false
    const walConfig = options.cacheOptions.wal ?? {}
    return walConfig.enabled !== false
}

/**
 * Reset the runtime (for testing).
 */
export function resetRuntime() {
    if (walFiber) {
        Effect.runSync(Fiber.interrupt(walFiber))
        walFiber = null
    }
    sharedLayer = null
    capturedAdapter = null
    walStarted = false
}
