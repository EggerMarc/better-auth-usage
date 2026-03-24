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
            yield* startSubscribeWorker(fullLayer)
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
    if (tag === "RedisError") {
        throw new APIError("INTERNAL_SERVER_ERROR", {
            message: `Redis error during ${err.operation}: ${err.cause instanceof Error ? err.cause.message : String(err.cause)}`
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
