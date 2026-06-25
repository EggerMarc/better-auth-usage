import { z } from "zod"
import type { UsageEventMessage } from "@/drivers/types"

/**
 * Native-WebSocket wire protocol — one JSON envelope per message, both
 * directions. Replaces socket.io so a single client works on Node and
 * Cloudflare (Durable Objects). Incoming (client→server) messages are
 * validated with zod (the project's input-validation convention); outgoing
 * (server→client) messages are typed only.
 */

/** Room name for a (feature, referenceId) pair — used for fan-out. */
export const roomFor = (feature: string, referenceId: string) => `usage:${feature}:${referenceId}`

// ── Client → Server (validated) ──

const subscriptionSchema = z.object({
    referenceId: z.string(),
    feature: z.string(),
    referenceType: z.string().default("user"),
})

export const clientMsgSchema = z.discriminatedUnion("t", [
    z.object({ t: z.literal("auth"), token: z.string() }),
    z.object({ t: z.literal("subscribe"), subscriptions: z.array(subscriptionSchema) }),
    z.object({
        t: z.literal("unsubscribe"),
        subscriptions: z.array(z.object({ referenceId: z.string(), feature: z.string() })),
    }),
    z.object({
        t: z.literal("rpc"),
        id: z.string(),
        method: z.enum(["check", "can-use", "consume", "use-feature"]),
        data: z.object({
            referenceId: z.string(),
            featureKey: z.string(),
            overrideKey: z.string().optional(),
            amount: z.number().optional(),
            event: z.string().optional(),
        }),
    }),
])

export type ClientMsg = z.infer<typeof clientMsgSchema>
export type RpcMethod = Extract<ClientMsg, { t: "rpc" }>["method"]

/** Parse + validate a raw inbound frame. Returns null on malformed input. */
export function parseClientMsg(raw: string): ClientMsg | null {
    try {
        const parsed = clientMsgSchema.safeParse(JSON.parse(raw))
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}

// ── Server → Client (typed) ──

export type ServerMsg =
    | { t: "ready" }
    | { t: "subscribed"; subscriptions: Array<{ referenceId: string; feature: string; referenceType: string }> }
    | { t: "result"; id: string; data: unknown }
    | { t: "error"; id?: string; message: string }
    | { t: "event"; room: string; data: UsageEventMessage }

export const encode = (msg: ServerMsg): string => JSON.stringify(msg)
