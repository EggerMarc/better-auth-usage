import { Effect } from "effect"
import { Server as SocketServer } from "socket.io"
import { RedisService, LoggerService } from "@/services"

/**
 * UsageTracker — pure subscriber.
 *
 * Subscribes to Redis pub/sub events (published atomically by the Lua script)
 * and forwards them to Socket.IO rooms. No Redis writes, no cache dependency,
 * no own Redis connections.
 */
export const startRealtimeSubscriber = (io: SocketServer) =>
    Effect.gen(function* () {
        const redis = yield* RedisService
        const logger = yield* LoggerService

        logger.info("Realtime: subscribing to usage events")

        yield* redis.psubscribe("usage:events:*", (channel, message) => {
            const parsed = Effect.try(() => JSON.parse(message) as {
                feature: string
                refId: string
                [key: string]: unknown
            })

            Effect.runSync(
                parsed.pipe(
                    Effect.andThen((update) =>
                        Effect.sync(() =>
                            io.to(`usage:${update.feature}:${update.refId}`).emit("usage:updated", update)
                        )
                    ),
                    Effect.catchAll(() => Effect.void)
                )
            )
        })

        logger.info("Realtime: subscriber active")
    })
