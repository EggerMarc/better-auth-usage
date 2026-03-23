import { Effect, Layer } from "effect"
import { RedisService, makeRedisServiceLive, DbService, makeDbService, LoggerService, makeLoggerServiceLive } from "@/services"
import type { UsageOptions } from "@/types"
import type { AuthContext } from "better-auth"

/**
 * The full service layer needed by all pipelines.
 * Built once per plugin init (Redis + Logger are long-lived).
 */
let sharedLayer: Layer.Layer<RedisService | LoggerService> | null = null

/**
 * Initialize the shared layer from plugin options.
 * Called once on first request (lazy init, like the old UsageInfrastructure singleton).
 */
function getSharedLayer(options: UsageOptions): Layer.Layer<RedisService | LoggerService> {
    if (sharedLayer) return sharedLayer

    const loggerLayer = makeLoggerServiceLive(options.logger)

    if (options.cacheOptions?.redisUrl) {
        const redisLayer = makeRedisServiceLive(options.cacheOptions.redisUrl)
        sharedLayer = Layer.merge(redisLayer, loggerLayer)
    } else {
        // No Redis — provide a no-op RedisService that always returns null/void
        const noopRedis = Layer.succeed(RedisService, {
            eval: () => Effect.succeed(null),
            get: () => Effect.succeed(null),
            set: () => Effect.void,
            del: () => Effect.void,
            hset: () => Effect.void,
            hgetall: () => Effect.succeed({}),
            publish: () => Effect.void,
            quit: () => Effect.void,
        })
        sharedLayer = Layer.merge(noopRedis, loggerLayer)
    }

    return sharedLayer
}

/**
 * Run an Effect pipeline with all required services.
 *
 * This is the bridge between BetterAuth's async endpoint handlers
 * and the Effect pipelines. Called at each endpoint:
 *
 *   async (ctx) => runPipeline(ctx.context, endpointOptions, myPipeline(params))
 */
export async function runPipeline<A, E>(
    authCtx: AuthContext,
    options: UsageOptions,
    effect: Effect.Effect<A, E, RedisService | DbService | LoggerService>
): Promise<A> {
    const shared = getSharedLayer(options)
    const dbLayer = Layer.succeed(DbService, makeDbService(authCtx))
    const fullLayer = Layer.merge(shared, dbLayer)

    return Effect.runPromise(
        effect.pipe(Effect.provide(fullLayer))
    )
}

/**
 * Reset the shared layer (for testing).
 */
export function resetRuntime() {
    sharedLayer = null
}
