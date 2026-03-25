import { Effect, Layer } from "effect"
import { Server as SocketServer, type Socket } from "socket.io"
import type { AuthContext } from "better-auth"
import type { ResolvedUsageOptions } from "@/types"
import { checkUsage, canUse } from "@/pipelines/check"
import { consumeUsage, useFeature } from "@/pipelines/consume"
import { resolveFeature } from "@/pipelines/features"
import { resolveOverrideKey } from "@/pipelines/resolve-override"
import { RedisService, DbService, LoggerService } from "@/services"
import { redactId } from "@/utils"
import { validateSessionToken, liftAuthorizeUser, type SocketAuth } from "./auth"

// ── Request types ──

interface SubscribeRequest {
    subscriptions: Array<{
        referenceId: string
        feature: string
        referenceType: string
    }>
}

interface CheckRequest {
    referenceId: string
    featureKey: string
    overrideKey?: string
    amount?: number
}

interface ConsumeRequest {
    referenceId: string
    featureKey: string
    amount: number
    event?: string
    overrideKey?: string
    requestId?: string
}

interface UseFeatureRequest {
    referenceId: string
    featureKey: string
    amount?: number
    event?: string
    overrideKey?: string
    requestId?: string
}

// ── Error mapping ──

/**
 * Map Effect pipeline errors to socket error events.
 * Mirrors the error mapping in `runPipeline` but emits via socket
 * instead of throwing APIError.
 */
function mapErrorToSocket(
    socket: Socket,
    eventName: string,
    cause: unknown,
    requestId?: string,
) {
    const err = cause && typeof cause === "object" && "error" in cause
        ? (cause as any).error
        : null
    const tag = err?._tag

    const emit = (message: string) =>
        socket.emit("error", { message, event: eventName, requestId })

    if (tag === "NotAuthorized") {
        return emit(`Not authorized: user "${err.userId}" cannot access "${err.feature}" for "${err.referenceId}"`)
    }
    if (tag === "FeatureNotFound") {
        return emit(`Feature "${err.featureKey}" not found`)
    }
    if (tag === "CustomerNotFound") {
        return emit(`Customer not found. Call upsert-customer first.`)
    }
    if (tag === "LimitExceeded") {
        return emit(`Usage limit exceeded for "${err.featureKey}": ${err.current}/${err.limit}`)
    }
    if (tag === "ValidationError") {
        return emit(`Validation error: ${err.message}`)
    }
    if (tag === "RedisError") {
        return emit(`Redis error during ${err.operation}`)
    }
    if (tag === "DbError") {
        return emit(`Database error during ${err.operation}`)
    }

    const message = err?.message ?? err?._tag ?? String(cause)
    return emit(`Error: ${message}`)
}

// ── Auth middleware ──

/**
 * Register Socket.IO handshake authentication middleware.
 *
 * Validates the token from `socket.handshake.auth.token` against
 * BetterAuth's session store. On success, attaches `socket.data.auth`
 * with userId and sessionId. Rejects the connection on failure.
 */
export const registerAuthMiddleware = (
    io: SocketServer,
    authCtx: AuthContext,
) =>
    Effect.gen(function* () {
        const logger = yield* LoggerService

        io.use(async (socket, next) => {
            const token = socket.handshake.auth?.token
            if (!token || typeof token !== "string") {
                logger.debug("WebSocket auth rejected: no token", { socketId: socket.id })
                return next(new Error("Authentication required: provide token in handshake auth"))
            }

            const result = await Effect.runPromiseExit(
                validateSessionToken(token, authCtx)
            )

            if (result._tag === "Failure") {
                const message = result.cause && "error" in result.cause
                    ? (result.cause as any).error?.message ?? "Authentication failed"
                    : "Authentication failed"
                logger.debug("WebSocket auth rejected", { socketId: socket.id, reason: message })
                return next(new Error(message))
            }

            socket.data.auth = result.value as SocketAuth
            logger.info("WebSocket authenticated", {
                socketId: socket.id,
                userId: result.value.userId,
            })
            next()
        })

        logger.info("WebSocket auth middleware registered")
    })

// ── Helpers ──

/**
 * Run an Effect pipeline and handle success/error uniformly.
 * On success, emits `resultEvent` with the result.
 * On error, emits `error` with mapped message.
 */
async function runWsPipeline<A>(
    socket: Socket,
    resultEvent: string,
    effect: Effect.Effect<A, any, RedisService | DbService | LoggerService>,
    layer: Layer.Layer<RedisService | DbService | LoggerService>,
    requestId?: string,
) {
    const exit = await Effect.runPromiseExit(
        effect.pipe(Effect.provide(layer))
    )
    if (exit._tag === "Success") {
        socket.emit(resultEvent, { ...exit.value as any, requestId })
    } else {
        mapErrorToSocket(socket, resultEvent, exit.cause, requestId)
    }
}

/**
 * Authorize + resolve feature for a WS request.
 * Returns the resolved Feature or fails with NotAuthorized/FeatureNotFound.
 */
const authorizeAndResolve = (
    options: ResolvedUsageOptions,
    auth: SocketAuth,
    data: { referenceId: string; featureKey: string; overrideKey?: string },
) =>
    Effect.gen(function* () {
        const authorized = yield* liftAuthorizeUser(options, {
            userId: auth.userId,
            referenceId: data.referenceId,
            referenceType: "user",
            feature: data.featureKey,
        })

        if (!authorized) {
            return yield* Effect.die(
                new Error(`Not authorized for ${data.featureKey}:${redactId(data.referenceId)}`)
            )
        }

        const overrideKey = yield* resolveOverrideKey({
            overrideKey: data.overrideKey,
            referenceId: data.referenceId,
        })

        return yield* resolveFeature({
            featureKey: data.featureKey,
            overrideKey,
            features: options.features,
            overrides: options.overrides,
        })
    })

// ── Connection handlers ──

/**
 * Set up Socket.IO connection handlers with full WS API.
 *
 * Supports:
 *   subscribe:usage / unsubscribe:usage — room subscriptions
 *   check         → check:result        — read-only usage check
 *   can-use       → can-use:result      — entitlement check
 *   consume       → consume:result      — consume usage
 *   use-feature   → use-feature:result  — atomic check + consume
 *
 * All mutations broadcast `usage:updated` to the relevant room.
 */
export const setupWebSocketHandlers = (
    io: SocketServer,
    options: ResolvedUsageOptions,
    layer: Layer.Layer<RedisService | DbService | LoggerService>,
) =>
    Effect.gen(function* () {
        const logger = yield* LoggerService

        const walEnabled = !!(options.cacheOptions?.redisUrl &&
            options.cacheOptions.wal?.enabled !== false)

        io.on("connection", (socket) => {
            const auth: SocketAuth = socket.data.auth
            logger.info("WebSocket connected", {
                socketId: socket.id,
                userId: auth.userId,
            })

            // ── subscribe:usage ──

            socket.on("subscribe:usage", async (data: SubscribeRequest) => {
                const subscribed: SubscribeRequest["subscriptions"] = []

                for (const sub of data.subscriptions) {
                    const feature = options.features[sub.feature]
                    if (!feature) {
                        socket.emit("error", {
                            message: `Feature ${sub.feature} not found`,
                            event: "subscribe:usage",
                        })
                        continue
                    }

                    const authorized = await Effect.runPromise(
                        liftAuthorizeUser(options, {
                            userId: auth.userId,
                            referenceId: sub.referenceId,
                            referenceType: sub.referenceType,
                            feature: feature.key,
                        })
                    )

                    if (!authorized) {
                        socket.emit("error", {
                            message: `Not authorized for ${sub.feature}:${redactId(sub.referenceId)}`,
                            event: "subscribe:usage",
                        })
                        continue
                    }

                    socket.join(`usage:${sub.feature}:${sub.referenceId}`)
                    subscribed.push(sub)
                }

                socket.emit("subscribed", { subscriptions: subscribed })
            })

            // ── unsubscribe:usage ──

            socket.on("unsubscribe:usage", (data: SubscribeRequest) => {
                for (const sub of data.subscriptions) {
                    socket.leave(`usage:${sub.feature}:${sub.referenceId}`)
                }
            })

            // ── check ──

            socket.on("check", async (data: CheckRequest) => {
                await runWsPipeline(
                    socket,
                    "check:result",
                    Effect.gen(function* () {
                        const feature = yield* authorizeAndResolve(options, auth, data)
                        return yield* checkUsage({
                            referenceId: data.referenceId,
                            feature,
                            amount: data.amount,
                        })
                    }),
                    layer,
                )
            })

            // ── can-use ──

            socket.on("can-use", async (data: CheckRequest) => {
                await runWsPipeline(
                    socket,
                    "can-use:result",
                    Effect.gen(function* () {
                        const feature = yield* authorizeAndResolve(options, auth, data)
                        return yield* canUse({
                            referenceId: data.referenceId,
                            feature,
                            amount: data.amount,
                        })
                    }),
                    layer,
                )
            })

            // ── consume ──

            socket.on("consume", async (data: ConsumeRequest) => {
                await runWsPipeline(
                    socket,
                    "consume:result",
                    Effect.gen(function* () {
                        const feature = yield* authorizeAndResolve(options, auth, data)
                        return yield* consumeUsage({
                            referenceId: data.referenceId,
                            amount: data.amount,
                            event: data.event ?? "use",
                            feature,
                            walEnabled,
                        })
                    }),
                    layer,
                    data.requestId,
                )
            })

            // ── use-feature ──

            socket.on("use-feature", async (data: UseFeatureRequest) => {
                await runWsPipeline(
                    socket,
                    "use-feature:result",
                    Effect.gen(function* () {
                        const feature = yield* authorizeAndResolve(options, auth, data)
                        return yield* useFeature({
                            referenceId: data.referenceId,
                            amount: data.amount ?? 1,
                            event: data.event ?? "use",
                            feature,
                            walEnabled,
                        })
                    }),
                    layer,
                    data.requestId,
                )
            })

            // ── disconnect ──

            socket.on("disconnect", () => {
                logger.debug("WebSocket disconnected", {
                    socketId: socket.id,
                    userId: auth.userId,
                })
            })
        })

        logger.info("WebSocket handlers registered")
    })
