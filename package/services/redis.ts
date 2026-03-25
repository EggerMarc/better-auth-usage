import { Context, Effect, Layer } from "effect"
import Redis from "ioredis"
import { RedisError } from "@/errors"

/**
 * ioredis has these commands at runtime but the type definitions
 * don't include them. We use client.call() which accepts any command.
 */
type RedisClient = Redis & {
    call(command: string, ...args: (string | number)[]): Promise<unknown>
}

/**
 * RedisService interface — defines what Redis operations the plugin needs.
 *
 * This is like a Rust trait: any implementation must provide these methods.
 * The "Live" layer wraps ioredis. Tests can provide a mock layer.
 */
export interface RedisService {
    /** Run a Lua script atomically */
    eval(script: string, numKeys: number, ...args: (string | number)[]): Effect.Effect<unknown, RedisError>

    /** GET a string value */
    get(key: string): Effect.Effect<string | null, RedisError>

    /** SET a string value */
    set(key: string, value: string | number): Effect.Effect<void, RedisError>

    /** DEL a key */
    del(key: string): Effect.Effect<void, RedisError>

    /** HSET — set hash fields */
    hset(key: string, data: Record<string, string | number>): Effect.Effect<void, RedisError>

    /** HGETALL — get all hash fields */
    hgetall(key: string): Effect.Effect<Record<string, string>, RedisError>

    /** PUBLISH to a pub/sub channel */
    publish(channel: string, message: string): Effect.Effect<void, RedisError>

    /** PSUBSCRIBE — pattern subscribe, returns a callback to handle messages */
    psubscribe(pattern: string, onMessage: (channel: string, message: string) => void): Effect.Effect<void, RedisError>

    /** XGROUP CREATE — create a consumer group (idempotent) */
    xgroupCreate(stream: string, group: string, startId: string): Effect.Effect<void, RedisError>

    /** XREADGROUP — read entries from a consumer group */
    xreadgroup(group: string, consumer: string, stream: string, id: string, count: number): Effect.Effect<Array<[string, string[]]> | null, RedisError>

    /** XACK — acknowledge processed entries */
    xack(stream: string, group: string, ...ids: string[]): Effect.Effect<void, RedisError>

    /** XLEN — get stream length */
    xlen(stream: string): Effect.Effect<number, RedisError>

    /** XTRIM — trim stream entries older than minId (uses MINID) */
    xtrim(stream: string, minId: string | number): Effect.Effect<void, RedisError>

    /** QUIT — disconnect */
    quit(): Effect.Effect<void, RedisError>
}

/**
 * The Effect "tag" for RedisService — used for dependency injection.
 *
 * When a pipeline does `yield* RedisService`, Effect knows to look for
 * a RedisService in the provided layers.
 */
export const RedisService = Context.GenericTag<RedisService>("RedisService")

/**
 * Wrap an ioredis call in an Effect that catches errors and maps to RedisError.
 */
const wrapRedis = <T>(operation: string, fn: () => Promise<T>): Effect.Effect<T, RedisError> =>
    Effect.tryPromise({
        try: fn,
        catch: (cause) => new RedisError({ cause, operation }),
    })

/**
 * Create the Live layer with proper resource lifecycle.
 * The Redis client is created when the layer is built and quit on shutdown.
 *
 * Usage:
 *   const layer = makeRedisServiceLive("redis://localhost:6379")
 *   Effect.runPromise(myPipeline.pipe(Effect.provide(layer)))
 */
export const makeRedisServiceLive = (redisUrl: string): Layer.Layer<RedisService> =>
    Layer.scoped(
        RedisService,
        Effect.gen(function* () {
            const client = new Redis(redisUrl, {
                maxRetriesPerRequest: 3,
                enableReadyCheck: false, // managed Redis (Upstash, etc.) may not allow INFO
                retryStrategy: (times) => {
                    if (times > 3) return null
                    return Math.min(times * 200, 2000)
                },
                lazyConnect: false,
            }) as RedisClient

            // Suppress unhandled error events — errors are caught per-operation via wrapRedis
            client.on("error", () => {})

            // Track subscriber clients for cleanup
            const subscriberClients: RedisClient[] = []

            // Register cleanup: quit all clients on layer teardown
            yield* Effect.addFinalizer(() =>
                Effect.tryPromise({
                    try: async () => {
                        await Promise.allSettled(subscriberClients.map(sub => sub.quit()))
                        await client.quit()
                    },
                    catch: () => new RedisError({ cause: "quit failed", operation: "quit" }),
                }).pipe(Effect.orDie)
            )

            return {
                eval: (script, numKeys, ...args) =>
                    wrapRedis("eval", () => client.eval(script, numKeys, ...args)),

                get: (key) =>
                    wrapRedis("get", () => client.get(key)),

                set: (key, value) =>
                    wrapRedis("set", () => client.set(key, String(value)).then(() => undefined)),

                del: (key) =>
                    wrapRedis("del", () => client.del(key).then(() => undefined)),

                hset: (key, data) =>
                    wrapRedis("hset", () => {
                        const args = Object.entries(data).flat().map(String)
                        return client.call("HSET", key, ...args).then(() => undefined)
                    }),

                hgetall: (key) =>
                    wrapRedis("hgetall", () => client.hgetall(key)),

                publish: (channel, message) =>
                    wrapRedis("publish", () => client.publish(channel, message).then(() => undefined)),

                psubscribe: (pattern, onMessage) =>
                    wrapRedis("psubscribe", async () => {
                        // Create a dedicated subscriber client (ioredis requires separate client for sub)
                        const sub = client.duplicate() as RedisClient
                        sub.on("error", () => {})
                        subscriberClients.push(sub)
                        await sub.psubscribe(pattern)
                        sub.on("pmessage", (_pattern, channel, message) => onMessage(channel, message))
                    }),

                xgroupCreate: (stream, group, startId) =>
                    wrapRedis("xgroupCreate", () =>
                        client.call("XGROUP", "CREATE", stream, group, startId, "MKSTREAM")
                            .then(() => undefined)
                    ).pipe(
                        // BUSYGROUP = group already exists — idempotent, not an error
                        Effect.catchAll((err) =>
                            err.cause && String(err.cause).includes("BUSYGROUP")
                                ? Effect.void
                                : Effect.fail(err)
                        )
                    ),

                xreadgroup: (group, consumer, stream, id, count) =>
                    wrapRedis("xreadgroup", async () => {
                        const result = await client.call(
                            "XREADGROUP", "GROUP", group, consumer,
                            "COUNT", count,
                            "STREAMS", stream, id
                        ) as Array<[string, Array<[string, string[]]>]> | null
                        if (!result) return null
                        return result[0]?.[1] ?? []
                    }),

                xack: (stream, group, ...ids) =>
                    wrapRedis("xack", () =>
                        client.call("XACK", stream, group, ...ids).then(() => undefined)
                    ),

                xlen: (stream) =>
                    wrapRedis("xlen", () => client.call("XLEN", stream) as Promise<number>),

                xtrim: (stream, minId) =>
                    wrapRedis("xtrim", () =>
                        client.call("XTRIM", stream, "MINID", "~", minId).then(() => undefined)
                    ),

                quit: () =>
                    wrapRedis("quit", () => client.quit().then(() => undefined)),
            } satisfies RedisService
        })
    )
