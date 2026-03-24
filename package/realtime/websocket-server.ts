import { Effect, Layer } from "effect"
import { Server as SocketServer } from "socket.io"
import type { UsageOptions } from "@/types"
import { checkUsage } from "@/pipelines/check"
import { RedisService, DbService, LoggerService } from "@/services"
import { redactId } from "@/utils"

interface SubscribeRequest {
    subscriptions: Array<{
        referenceId: string
        feature: string
        referenceType: string
    }>
}

/**
 * Lift authorizeReference (sync or async) into an Effect.
 */
const liftAuthorize = (fn: (...args: any[]) => boolean | Promise<boolean>, ...args: any[]) =>
    Effect.tryPromise(() => Promise.resolve(fn(...args)))

/**
 * Set up Socket.IO connection handlers.
 *
 * Accepts a `layer` that provides all services needed by pipelines.
 * This is the same layer used by `runPipeline` — passed in from runtime.ts
 * so the websocket handlers can run Effect pipelines with proper services.
 */
export const setupWebSocketHandlers = (
    io: SocketServer,
    options: UsageOptions,
    layer: Layer.Layer<RedisService | DbService | LoggerService>,
) =>
    Effect.gen(function* () {
        const logger = yield* LoggerService

        io.on("connection", (socket) => {
            logger.info("WebSocket connected", { socketId: socket.id })

            socket.on("subscribe:usage", async (data: SubscribeRequest) => {
                logger.info("WebSocket subscribe:usage", { socketId: socket.id, subscriptions: data.subscriptions.map(s => `${s.feature}:${s.referenceId}`) })
                for (const sub of data.subscriptions) {
                    const feature = options.features[sub.feature]
                    if (!feature) {
                        socket.emit("error", { message: `Feature ${sub.feature} not found` })
                        continue
                    }

                    if (feature.authorizeReference) {
                        const authorized = await Effect.runPromise(
                            liftAuthorize(feature.authorizeReference, {
                                referenceId: sub.referenceId,
                                referenceType: sub.referenceType,
                                feature: feature.key,
                                incomingId: "",
                            }).pipe(
                                Effect.catchAll(() => Effect.succeed(false))
                            )
                        )

                        if (!authorized) {
                            socket.emit("error", {
                                message: `Not authorized for ${sub.feature}:${redactId(sub.referenceId)}`
                            })
                            continue
                        }
                    }

                    socket.join(`usage:${sub.feature}:${sub.referenceId}`)
                }

                socket.emit("subscribed", { subscriptions: data.subscriptions })
            })

            socket.on("unsubscribe:usage", (data: SubscribeRequest) => {
                for (const sub of data.subscriptions) {
                    socket.leave(`usage:${sub.feature}:${sub.referenceId}`)
                }
            })

            socket.on("get:usage", async (data: { referenceId: string, feature: string }) => {
                const feature = options.features[data.feature]
                if (!feature) {
                    socket.emit("usage:error", { error: `Feature ${data.feature} not found` })
                    return
                }

                await Effect.runPromise(
                    checkUsage({
                        referenceId: data.referenceId,
                        feature,
                    }).pipe(
                        Effect.andThen((result) =>
                            Effect.sync(() => socket.emit("usage:current", result))
                        ),
                        Effect.catchAll(() =>
                            Effect.sync(() =>
                                socket.emit("usage:error", { error: "Failed to fetch usage" })
                            )
                        ),
                        Effect.provide(layer),
                    )
                )
            })

            socket.on("disconnect", () => {
                logger.debug("WebSocket disconnected", { socketId: socket.id })
            })
        })

        logger.info("WebSocket handlers registered")
    })
