/// <reference types="@cloudflare/workers-types" />
import type { CachedUsage, CachedLimits, ConsumeArgs, ConsumeOutcome, Customer } from "../../types"
import type { UsageEventMessage } from "../types"

/** Per-(feature) record persisted in DO storage. */
interface Rec {
    current: number
    meta: {
        lastResetAt?: number
        resetAt?: number
        resetValue?: number
        maxLimit?: number
        minLimit?: number
    }
}

/** Minimal storage surface — lets the consume/reset logic be unit-tested. */
export interface DOStorageLike {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    delete(key: string): Promise<boolean>
}

const recKey = (feature: string) => `rec:${feature}`

/**
 * Pure store logic — shared by the live Durable Object and unit tests.
 * Atomic by construction: a Durable Object is single-threaded.
 */
export class UsageStore {
    constructor(private storage: DOStorageLike) {}

    async consume(args: ConsumeArgs): Promise<ConsumeOutcome> {
        const rec = (await this.storage.get<Rec>(recKey(args.feature))) ?? { current: 0, meta: {} }
        const resetValue = rec.meta.resetValue ?? 0
        let current = rec.current
        let lastResetAt = rec.meta.lastResetAt ?? args.nowMs
        let resetOccurred = false

        if (rec.meta.resetAt && args.nowMs >= rec.meta.resetAt) {
            current = resetValue
            lastResetAt = args.nowMs
            rec.meta.lastResetAt = args.nowMs
            rec.meta.resetAt = undefined
            resetOccurred = true
        }

        const newTotal = current + args.amount
        rec.current = newTotal
        await this.storage.put(recKey(args.feature), rec)
        return { newTotal, resetOccurred, lastResetAt }
    }

    async getUsage(referenceId: string, feature: string): Promise<CachedUsage | null> {
        const rec = await this.storage.get<Rec>(recKey(feature))
        if (!rec) return null
        return {
            referenceId,
            feature,
            current: rec.current,
            lastResetAt: rec.meta.lastResetAt != null ? new Date(rec.meta.lastResetAt) : null,
            maxLimit: rec.meta.maxLimit,
            minLimit: rec.meta.minLimit,
        }
    }

    async hydrate(feature: string, usage: CachedUsage, meta: CachedLimits): Promise<void> {
        // Prime the counter only when this DO has none yet — the DO is the
        // authoritative source for `current`, so a DB→cache hydrate must never
        // regress a live counter (e.g. a hydrate forked from a getUsage miss
        // landing after a concurrent consume). Only `reset()` forces the value.
        const existing = await this.storage.get<Rec>(recKey(feature))
        await this.storage.put(recKey(feature), {
            current: existing ? existing.current : usage.current,
            meta: {
                lastResetAt: meta.lastResetAt?.getTime(),
                resetAt: meta.resetAt?.getTime(),
                resetValue: meta.resetValue,
                maxLimit: meta.maxLimit,
                minLimit: meta.minLimit,
            },
        })
    }

    async reset(feature: string, value: number, meta: Partial<CachedLimits>): Promise<void> {
        const rec = (await this.storage.get<Rec>(recKey(feature))) ?? { current: 0, meta: {} }
        rec.current = value
        if (meta.lastResetAt) rec.meta.lastResetAt = meta.lastResetAt.getTime()
        rec.meta.resetAt = meta.resetAt?.getTime()
        if (meta.resetValue != null) rec.meta.resetValue = meta.resetValue
        if (meta.maxLimit != null) rec.meta.maxLimit = meta.maxLimit
        if (meta.minLimit != null) rec.meta.minLimit = meta.minLimit
        await this.storage.put(recKey(feature), rec)
    }

    getCustomer(): Promise<Customer | null> {
        return this.storage.get<Customer>("customer").then((c) => c ?? null)
    }
    async setCustomer(customer: Customer): Promise<void> {
        await this.storage.put("customer", customer)
    }
    async delCustomer(): Promise<void> {
        await this.storage.delete("customer")
    }
}

/**
 * The Durable Object — one instance per `referenceId`. Holds the authoritative
 * counter (atomic, single-threaded) AND the Hibernatable WebSocket connections
 * for that reference, so a consume broadcasts to subscribers with zero extra
 * hops (no Redis, no pub/sub). Export this from your Worker entrypoint.
 */
export class UsageDurableObject {
    private store: UsageStore
    constructor(private state: DurableObjectState, _env?: unknown) {
        this.store = new UsageStore(state.storage as unknown as DOStorageLike)
    }

    async fetch(request: Request): Promise<Response> {
        // WebSocket upgrade — the Worker has already authenticated the session.
        if (request.headers.get("Upgrade") === "websocket") {
            const pair = new WebSocketPair()
            const [client, server] = [pair[0], pair[1]]
            this.state.acceptWebSocket(server)
            server.serializeAttachment({ features: [] as string[] })
            server.send(JSON.stringify({ t: "ready" }))
            return new Response(null, { status: 101, webSocket: client })
        }

        const { pathname } = new URL(request.url)
        const body = (await request.json().catch(() => ({}))) as any
        // Preserve null — a cache miss (getUsage/getCustomer → null) must stay
        // null over the wire so the driver falls back to the DB. Coercing to `{}`
        // makes a miss look like a truthy hit (empty customer / usage), which
        // silently drops overrides and DB reads.
        const json = (data: unknown) => new Response(JSON.stringify(data ?? null), { headers: { "content-type": "application/json" } })

        switch (pathname) {
            case "/consume": {
                const out = await this.store.consume(body as ConsumeArgs)
                this.broadcast(body.referenceId, body.feature, {
                    refId: body.referenceId, feature: body.feature,
                    amount: body.amount, newTotal: out.newTotal, event: body.event, ts: body.nowMs,
                })
                return json(out)
            }
            case "/getUsage":
                return json(await this.store.getUsage(body.referenceId, body.feature))
            case "/hydrate":
                return json(await this.store.hydrate(body.feature, deReviveUsage(body.usage), deReviveMeta(body.meta)))
            case "/reset":
                return json(await this.store.reset(body.feature, body.value, deReviveMeta(body.meta)))
            case "/getCustomer":
                return json(await this.store.getCustomer())
            case "/setCustomer":
                return json(await this.store.setCustomer(body.customer))
            case "/delCustomer":
                return json(await this.store.delCustomer())
            default:
                return new Response("Not found", { status: 404 })
        }
    }

    // ── Hibernatable WebSocket handlers ──

    webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
        let msg: any
        try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) } catch { return }

        if (msg.t === "auth") { ws.send(JSON.stringify({ t: "ready" })); return }
        if (msg.t === "subscribe") {
            const features: string[] = (msg.subscriptions ?? []).map((s: any) => s.feature)
            ws.serializeAttachment({ features })
            ws.send(JSON.stringify({ t: "subscribed", subscriptions: msg.subscriptions ?? [] }))
        }
    }

    webSocketClose(ws: WebSocket) {
        try { ws.close() } catch { /* already closing */ }
    }

    private broadcast(referenceId: string, feature: string, evt: UsageEventMessage) {
        const room = `usage:${feature}:${referenceId}`
        const frame = JSON.stringify({ t: "event", room, data: evt })
        for (const ws of this.state.getWebSockets()) {
            const att = ws.deserializeAttachment() as { features?: string[] } | null
            if (att?.features?.includes(feature)) ws.send(frame)
        }
    }
}

// Internal RPC payloads serialize Dates to ms; revive them back.
function deReviveUsage(u: any): CachedUsage {
    return { ...u, lastResetAt: u.lastResetAt != null ? new Date(u.lastResetAt) : null }
}
function deReviveMeta(m: any): CachedLimits {
    return {
        ...m,
        lastResetAt: m?.lastResetAt != null ? new Date(m.lastResetAt) : undefined,
        resetAt: m?.resetAt != null ? new Date(m.resetAt) : undefined,
    }
}
