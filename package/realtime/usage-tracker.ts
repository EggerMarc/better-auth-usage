import { Effect } from "effect"
import { Server as SocketServer } from "socket.io"
import { DriverService, LoggerService, wrapDriver } from "@/services"

/**
 * UsageTracker — bridges driver usage events to Socket.IO rooms.
 *
 * Subscribes to the driver's realtime event stream (Redis pub/sub, in-memory
 * emitter, …) and forwards each event to its room. No store writes, no cache
 * dependency. No-op when the driver has no realtime capability.
 */
export const startRealtimeSubscriber = (io: SocketServer) =>
    Effect.gen(function* () {
        const driver = yield* DriverService
        const logger = yield* LoggerService

        if (!driver.realtime) return

        logger.info("Realtime: subscribing to usage events")

        yield* wrapDriver("realtimeSubscribe", async () =>
            driver.realtime!.onUsageEvent((update) => {
                const room = `usage:${update.feature}:${update.refId}`
                logger.info("Realtime: broadcasting", { room, feature: update.feature, refId: update.refId })
                io.to(room).emit("usage:updated", update)
            })
        )

        logger.info("Realtime: subscriber active")
    })
