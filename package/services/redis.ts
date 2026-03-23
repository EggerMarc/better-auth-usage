import { Context, Effect, Layer } from "effect"
import Redis from "ioredis"
import { RedisError } from "@/errors"

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

    /** XTRIM — trim stream to max length */
    xtrim(stream: string, maxLen: number): Effect.Effect<void, RedisError>

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
            const client = new Redis(redisUrl)

            // Register cleanup: quit on layer teardown
            yield* Effect.addFinalizer(() =>
                Effect.tryPromise({
                    try: () => client.quit().then(() => undefined),
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
                    wrapRedis("hset", () => client.hset(key, data as any).then(() => undefined)),

                hgetall: (key) =>
                    wrapRedis("hgetall", () => client.hgetall(key)),

                publish: (channel, message) =>
                    wrapRedis("publish", () => client.publish(channel, message).then(() => undefined)),

                psubscribe: (pattern, onMessage) =>
                    wrapRedis("psubscribe", async () => {
                        // Create a dedicated subscriber client (ioredis requires separate client for sub)
                        const sub = client.duplicate()
                        await sub.psubscribe(pattern)
                        sub.on("pmessage", (_pattern, channel, message) => onMessage(channel, message))
                    }),

                xgroupCreate: (stream, group, startId) =>
                    wrapRedis("xgroupCreate", () =>
                        (client as any).xgroup("CREATE", stream, group, startId, "MKSTREAM")
                            .then(() => undefined)
                            .catch((err: any) => {
                                // BUSYGROUP = group already exists, that's fine
                                if (err.message?.includes("BUSYGROUP")) return undefined
                                throw err
                            })
                    ),

                xreadgroup: (group, consumer, stream, id, count) =>
                    wrapRedis("xreadgroup", async () => {
                        const result = await (client as any).xreadgroup(
                            "GROUP", group, consumer,
                            "COUNT", count,
                            "STREAMS", stream, id
                        )
                        if (!result) return null
                        // ioredis returns [[streamName, [[entryId, [field, value, ...]], ...]]]
                        const entries = result[0]?.[1] ?? []
                        return entries as Array<[string, string[]]>
                    }),

                xack: (stream, group, ...ids) =>
                    wrapRedis("xack", () =>
                        (client as any).xack(stream, group, ...ids).then(() => undefined)
                    ),

                xlen: (stream) =>
                    wrapRedis("xlen", () => (client as any).xlen(stream)),

                xtrim: (stream, maxLen) =>
                    wrapRedis("xtrim", () =>
                        (client as any).xtrim(stream, "MAXLEN", "~", maxLen).then(() => undefined)
                    ),

                quit: () =>
                    wrapRedis("quit", () => client.quit().then(() => undefined)),
            } satisfies RedisService
        })
    )
