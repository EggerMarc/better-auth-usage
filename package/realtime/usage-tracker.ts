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
            try {
                const update = JSON.parse(message)
                const room = `usage:${update.feature}:${update.refId}`
                io.to(room).emit("usage:updated", update)
            } catch {
                // Malformed message — skip
            }
        })

        logger.info("Realtime: subscriber active")
    })
