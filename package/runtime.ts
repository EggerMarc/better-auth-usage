import { Effect, Layer, Fiber } from "effect"
import { APIError } from "better-auth/api"
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
 * Maps typed Effect errors to BetterAuth APIErrors at the boundary.
 *
 * Endpoints no longer need try-catch — error mapping is centralized here.
 */
export async function runPipeline<A, E>(
    authCtx: AuthContext,
    options: UsageOptions,
    effect: Effect.Effect<A, E, RedisService | DbService | LoggerService>
): Promise<A> {
    if (!capturedAdapter) {
        capturedAdapter = authCtx
    }

    const shared = getSharedLayer(options)
    const dbLayer = Layer.succeed(DbService, makeDbService(authCtx))
    const fullLayer = Layer.merge(shared, dbLayer)

    await ensureWalStarted(options)

    return Effect.runPromise(
        effect.pipe(
            Effect.catchAll((err: any) => {
                const tag = err?._tag

                if (tag === "FeatureNotFound") {
                    return Effect.die(new APIError("NOT_FOUND", {
                        message: `Feature ${err.featureKey} not found`
                    }))
                }
                if (tag === "CustomerNotFound") {
                    return Effect.die(new APIError("NOT_FOUND", {
                        message: `Customer not found`
                    }))
                }
                if (tag === "LimitExceeded") {
                    return Effect.die(new APIError("FORBIDDEN", {
                        message: `Limit exceeded for ${err.featureKey}`
                    }))
                }
                return Effect.die(new APIError("INTERNAL_SERVER_ERROR", {
                    message: `${err?.message ?? err?._tag ?? "Unknown error"}`
                }))
            }),
            Effect.provide(fullLayer),
        )
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
