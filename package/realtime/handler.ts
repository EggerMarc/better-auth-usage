import { Effect, Layer } from "effect"
import type { AuthContext } from "better-auth"
import type { ResolvedUsageOptions } from "@/types"
import { checkUsage, canUse } from "@/pipelines/check"
import { consumeUsage, useFeature } from "@/pipelines/consume"
import { resolveFeature } from "@/pipelines/features"
import { resolveOverrideKey } from "@/pipelines/resolve-override"
import { DriverService, DbService, LoggerService } from "@/services"
import { NotAuthorized } from "@/errors"
import { validateSessionToken, liftAuthorizeUser, type SocketAuth } from "./auth"
import { roomFor, type ClientMsg, type ServerMsg, type RpcMethod } from "./protocol"

/**
 * A transport-agnostic connection. Implemented by the Node `ws` server and by
 * the Cloudflare Durable Object — the handler logic below is identical for both.
 */
export interface WsConnection {
    auth: SocketAuth | null
    send(msg: ServerMsg): void
    join(room: string): void
    leave(room: string): void
}

export interface HandlerContext {
    options: ResolvedUsageOptions
    layer: Layer.Layer<DriverService | DbService | LoggerService>
    authCtx: AuthContext
}

type WsLayer = Layer.Layer<DriverService | DbService | LoggerService>

/** Map an Effect failure cause to a human-readable message. */
function causeToMessage(cause: unknown): string {
    const err = cause && typeof cause === "object" && "error" in cause ? (cause as any).error : null
    const tag = err?._tag
    switch (tag) {
        case "NotAuthorized":
            return `Not authorized: user "${err.userId}" cannot access "${err.feature}" for "${err.referenceId}"`
        case "FeatureNotFound":
            return `Feature "${err.featureKey}" not found`
        case "CustomerNotFound":
            return `Customer not found. Call upsert-customer first.`
        case "LimitExceeded":
            return `Usage limit exceeded for "${err.featureKey}": ${err.current}/${err.limit}`
        case "ValidationError":
            return `Validation error: ${err.message}`
        case "DriverError":
            return `Driver error during ${err.operation}`
        case "DbError":
            return `Database error during ${err.operation}`
        default:
            return err?.message ?? err?._tag ?? String(cause)
    }
}

/** Run an RPC pipeline; reply with `result` (id-correlated) or `error`. */
async function runRpc<A>(
    conn: WsConnection,
    id: string,
    effect: Effect.Effect<A, any, DriverService | DbService | LoggerService>,
    layer: WsLayer,
) {
    const exit = await Effect.runPromiseExit(effect.pipe(Effect.provide(layer)))
    if (exit._tag === "Success") {
        conn.send({ t: "result", id, data: exit.value })
    } else {
        conn.send({ t: "error", id, message: causeToMessage(exit.cause) })
    }
}

/** Authorize + resolve a feature for an RPC request. */
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
            return yield* Effect.fail(
                new NotAuthorized({ userId: auth.userId, referenceId: data.referenceId, feature: data.featureKey })
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

const rpcEffect = (
    method: RpcMethod,
    options: ResolvedUsageOptions,
    auth: SocketAuth,
    data: Extract<ClientMsg, { t: "rpc" }>["data"],
) =>
    Effect.gen(function* () {
        const feature = yield* authorizeAndResolve(options, auth, data)
        switch (method) {
            case "check":
                return yield* checkUsage({ referenceId: data.referenceId, feature, amount: data.amount })
            case "can-use":
                return yield* canUse({ referenceId: data.referenceId, feature, amount: data.amount })
            case "consume":
                return yield* consumeUsage({
                    referenceId: data.referenceId,
                    amount: data.amount ?? 1,
                    event: data.event ?? "use",
                    feature,
                })
            case "use-feature":
                return yield* useFeature({
                    referenceId: data.referenceId,
                    amount: data.amount ?? 1,
                    event: data.event ?? "use",
                    feature,
                })
        }
    })

/**
 * Handle one decoded inbound message for a connection. Transport-agnostic:
 * the caller owns the socket, room registry, and message parsing.
 */
export async function handleClientMessage(conn: WsConnection, msg: ClientMsg, ctx: HandlerContext): Promise<void> {
    const { options, layer, authCtx } = ctx

    // ── auth handshake ──
    if (msg.t === "auth") {
        const exit = await Effect.runPromiseExit(validateSessionToken(msg.token, authCtx))
        if (exit._tag === "Success") {
            conn.auth = exit.value
            conn.send({ t: "ready" })
        } else {
            conn.send({ t: "error", message: "Authentication failed" })
        }
        return
    }

    // Every other message requires a prior successful auth
    if (!conn.auth) {
        conn.send({ t: "error", message: "Not authenticated: send { t: 'auth', token } first" })
        return
    }
    const auth = conn.auth

    switch (msg.t) {
        case "subscribe": {
            const subscribed: typeof msg.subscriptions = []
            for (const sub of msg.subscriptions) {
                const feature = options.features[sub.feature]
                if (!feature) {
                    conn.send({ t: "error", message: `Feature ${sub.feature} not found` })
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
                    conn.send({ t: "error", message: `Not authorized for ${sub.feature}` })
                    continue
                }
                conn.join(roomFor(sub.feature, sub.referenceId))
                subscribed.push(sub)
            }
            conn.send({ t: "subscribed", subscriptions: subscribed })
            return
        }

        case "unsubscribe": {
            for (const sub of msg.subscriptions) {
                conn.leave(roomFor(sub.feature, sub.referenceId))
            }
            return
        }

        case "rpc": {
            await runRpc(conn, msg.id, rpcEffect(msg.method, options, auth, msg.data), layer)
            return
        }
    }
}
