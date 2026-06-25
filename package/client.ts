import type { usage } from "./index.ts";
import type { BetterAuthClientPlugin } from "better-auth/types";

// ── BetterAuth Client Plugin ──

/**
 * Client plugin for better-auth-usage.
 *
 * Pass feature keys as a type parameter for autocomplete:
 * ```ts
 * import type { UsageOptions } from "@eggermarc/better-auth-usage"
 * // Option 1: from your config type
 * usageClient<"api-calls" | "storage" | "credits">()
 *
 * // Option 2: from InferFeatureKeys
 * import type { InferFeatureKeys } from "@eggermarc/better-auth-usage"
 * usageClient<InferFeatureKeys<typeof myUsageConfig>>()
 * ```
 */
/**
 * Extract feature key union type from a `typeof auth` instance.
 *
 * ```ts
 * import type { auth } from "./auth"
 * type F = InferFeatures<typeof auth>  // "api-calls" | "storage" | "credits"
 * ```
 */
export type InferFeatures<Auth> =
    Auth extends { options: { plugins: readonly (infer P)[] } }
        ? Extract<P, { id: "usage"; _featureKeys: any }> extends { _featureKeys: infer K }
            ? K & string
            : string
        : string

export const usageClient = () => {
    return {
        id: "usage",
        $InferServerPlugin: {} as ReturnType<typeof usage>,
        pathMethods: {
            "/usage/features": "GET",
            "/usage/features/:featureKey": "GET",
            "/usage/upsert-customer": "POST",
            "/usage/consume": "POST",
            "/usage/check": "POST",
            "/usage/sync": "POST",
            "/usage/check-customer": "POST",
            "/usage/can-use": "POST",
            "/usage/use-feature": "POST",
            "/usage/ws": "GET",
        },
    } satisfies BetterAuthClientPlugin;
};

// ── Types ──

export interface UsageState {
    current: number
    max: number | null
    min: number | null
    remaining: number | null
    percent: number | null
    status: "in-limit" | "above-max-limit" | "below-min-limit"
}

export interface ConsumeResult {
    allowed: boolean
    current: number
    afterAmount: number
    max: number | undefined
    min: number | undefined
    remaining: number | null
    status: string
}

export interface UsageEventData {
    current: number
    max: number | null
    min: number | null
    remaining: number | null
    status: string
    amount?: number
}

export interface UsageEvent {
    type: "consume" | "update"
    feature: string
    data: UsageEventData
    /** When the event was recorded on the client */
    ts: number
    /** Round-trip duration in ms (only on "consume" events) */
    duration?: number
}

type UpdateHandler = (state: Record<string, UsageState>) => void

export interface TrackerOptions {
    /** Base URL of the BetterAuth server (e.g. "http://localhost:3000/api/auth") */
    baseURL: string
    /** Enable websocket connection. Default: true. Falls back to polling if unavailable. */
    websocket?: boolean
    /** Polling interval in ms. Only used if websocket is false or unavailable. Default: 5000 */
    pollInterval?: number
    /** Custom fetch implementation (for SSR, testing, etc.) */
    fetchImpl?: typeof fetch
    /** Headers to send with REST requests (e.g. auth cookies) */
    headers?: Record<string, string> | (() => Record<string, string>)
}

interface TrackParams {
    referenceId: string
    features: string[]
    referenceType?: string
}

// ── Factory ──

export function createUsageTracker(options: TrackerOptions) {
    const {
        baseURL,
        websocket = true,
        pollInterval = 5000,
        fetchImpl = fetch.bind(globalThis),
        headers,
    } = options

    return {
        track(params: TrackParams): UsageTrackerHandle {
            return new UsageTrackerHandle(
                baseURL, params, { websocket, pollInterval, fetchImpl, headers }
            )
        }
    }
}

// ── Handle ──

interface Snapshot {
    state: Record<string, UsageState>
    events: Record<string, UsageEvent[]>
}

let reqCounter = 0
function nextRequestId(): string {
    return `${Date.now()}-${++reqCounter}`
}

export class UsageTrackerHandle {
    private snapshot: Snapshot = { state: {}, events: {} }
    private updateHandlers: UpdateHandler[] = []
    private pollHandle: ReturnType<typeof setInterval> | null = null
    private ws: WebSocket | null = null
    private wsReady = false
    private disposed = false
    /** In-flight RPCs, keyed by request id → resolver/rejecter. */
    private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>()
    /** Request IDs currently in flight — skip matching broadcast events. */
    private pendingRequests: Set<string> = new Set()
    // Reconnect state
    private wsUrl: string | null = null
    private token: string | undefined
    private reconnectAttempts = 0
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null

    constructor(
        private baseURL: string,
        private params: TrackParams,
        private options: {
            websocket: boolean
            pollInterval: number
            fetchImpl: typeof fetch
            headers?: Record<string, string> | (() => Record<string, string>)
        }
    ) {
        for (const feature of params.features) {
            this.snapshot.events[feature] = []
        }

        this.fetchAll()

        if (options.websocket) {
            this.discoverAndConnect()
        } else {
            this.startPolling()
        }
    }

    // ── Sync reads ──

    getUsage(feature: string): UsageState | null {
        return this.snapshot.state[feature] ?? null
    }

    getAll(): Record<string, UsageState> {
        return this.snapshot.state
    }

    getEvents(feature: string): UsageEvent[] {
        return this.snapshot.events[feature] ?? []
    }

    getAllEvents(): UsageEvent[] {
        return Object.values(this.snapshot.events).flat().sort((a, b) => a.ts - b.ts)
    }

    // ── useSyncExternalStore compat ──

    subscribe(callback: () => void): () => void {
        const handler: UpdateHandler = () => callback()
        this.updateHandlers.push(handler)
        return () => {
            this.updateHandlers = this.updateHandlers.filter(h => h !== handler)
        }
    }

    getSnapshot(): Snapshot {
        return this.snapshot
    }

    // ── Operations ──

    /**
     * Atomic check + consume. Only consumes if in-limit.
     * Routes through WS when connected, REST fallback.
     */
    async consume(featureKey: string, amount = 1, event = "use"): Promise<ConsumeResult> {
        const start = performance.now()
        const requestId = nextRequestId()
        this.pendingRequests.add(requestId)

        let result: ConsumeResult

        if (this.wsReady && this.ws?.readyState === WebSocket.OPEN) {
            result = await this.rpc<ConsumeResult>(requestId, "use-feature", {
                referenceId: this.params.referenceId, featureKey, amount, event,
            })
        } else {
            result = await this.restPost<ConsumeResult>("/usage/use-feature", {
                referenceId: this.params.referenceId, featureKey, amount, event,
            })
        }

        this.pendingRequests.delete(requestId)
        const duration = Math.round((performance.now() - start) * 100) / 100
        this.addEvent(featureKey, "consume", result, duration)
        this.updateFeature(featureKey, result)
        return result
    }

    // ── Events ──

    on(event: "update", handler: UpdateHandler): void
    on(event: string, handler: any): void {
        if (event === "update") this.updateHandlers.push(handler)
    }

    off(event: "update", handler: UpdateHandler): void
    off(event: string, handler: any): void {
        if (event === "update") this.updateHandlers = this.updateHandlers.filter(h => h !== handler)
    }

    dispose(): void {
        this.disposed = true
        if (this.pollHandle) {
            clearInterval(this.pollHandle)
            this.pollHandle = null
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        for (const { reject, timer } of this.pending.values()) {
            clearTimeout(timer)
            reject(new Error("disposed"))
        }
        this.pending.clear()
        if (this.ws) {
            this.ws.onclose = null
            this.ws.close()
            this.ws = null
        }
        this.wsReady = false
        this.updateHandlers = []
    }

    // ── Internal: REST ──

    private getHeaders(): Record<string, string> {
        if (!this.options.headers) return {}
        if (typeof this.options.headers === "function") return this.options.headers()
        return this.options.headers
    }

    private async restPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
        const res = await this.options.fetchImpl(`${this.baseURL}${path}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", ...this.getHeaders() },
            body: JSON.stringify(body),
        })
        if (!res.ok) {
            const text = await res.text().catch(() => res.statusText)
            throw new Error(`${path} failed: ${text}`)
        }
        const json = await res.json()
        return json?.data ?? json
    }

    private async fetchAll() {
        for (const feature of this.params.features) {
            await this.fetchOne(feature)
        }
    }

    private async fetchOne(feature: string) {
        try {
            const data = await this.restPost<any>("/usage/check", {
                referenceId: this.params.referenceId, featureKey: feature,
            })
            this.updateFeature(feature, data)
        } catch {
            // Will retry on next poll or WS event
        }
    }

    // ── Internal: WS ──

    private async discoverAndConnect() {
        try {
            const [wsRes, sessionRes] = await Promise.all([
                this.options.fetchImpl(`${this.baseURL}/usage/ws`, {
                    method: "GET",
                    credentials: "include",
                    headers: this.getHeaders(),
                }),
                this.options.fetchImpl(`${this.baseURL}/get-session`, {
                    method: "GET",
                    credentials: "include",
                    headers: this.getHeaders(),
                }),
            ])

            if (!wsRes.ok) {
                this.startPolling()
                return
            }

            const wsJson = await wsRes.json()
            const wsInfo = wsJson?.data ?? wsJson
            if (!wsInfo?.enabled || !wsInfo?.url) {
                this.startPolling()
                return
            }

            let token: string | undefined
            if (sessionRes.ok) {
                const sessionJson = await sessionRes.json()
                const session = sessionJson?.data ?? sessionJson
                token = session?.session?.token
            }

            this.connectWebSocket(wsInfo.url, token)
        } catch {
            this.startPolling()
        }
    }

    /** Send an RPC over the socket and await the id-correlated reply. */
    private rpc<T>(requestId: string, method: string, data: Record<string, unknown>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const ws = this.ws
            if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error("WebSocket not connected"))

            const timer = setTimeout(() => {
                this.pending.delete(requestId)
                reject(new Error(`${method} timed out`))
            }, 10000)

            this.pending.set(requestId, { resolve, reject, timer })
            ws.send(JSON.stringify({ t: "rpc", id: requestId, method, data }))
        })
    }

    private connectWebSocket(wsUrl: string, token?: string) {
        this.wsUrl = wsUrl
        this.token = token
        try {
            const ws = new WebSocket(wsUrl)
            this.ws = ws
            this.wsReady = false

            ws.onopen = () => {
                // Authenticate first; the server replies with { t: "ready" }.
                ws.send(JSON.stringify({ t: "auth", token: token ?? "" }))
            }
            ws.onmessage = (ev: MessageEvent) => this.onWsMessage(typeof ev.data === "string" ? ev.data : String(ev.data))
            ws.onclose = () => this.onWsClosed()
            ws.onerror = () => { /* close fires next; handled there */ }
        } catch {
            this.startPolling()
        }
    }

    private onWsMessage(raw: string) {
        let msg: any
        try { msg = JSON.parse(raw) } catch { return }

        switch (msg.t) {
            case "ready": {
                this.wsReady = true
                this.reconnectAttempts = 0
                if (this.pollHandle) {
                    clearInterval(this.pollHandle)
                    this.pollHandle = null
                }
                this.ws?.send(JSON.stringify({
                    t: "subscribe",
                    subscriptions: this.params.features.map(feature => ({
                        referenceId: this.params.referenceId,
                        feature,
                        referenceType: this.params.referenceType ?? "user",
                    })),
                }))
                return
            }
            case "subscribed": {
                this.fetchAll()
                return
            }
            case "result": {
                const entry = this.pending.get(msg.id)
                if (entry) {
                    clearTimeout(entry.timer)
                    this.pending.delete(msg.id)
                    entry.resolve(msg.data)
                }
                return
            }
            case "error": {
                if (msg.id) {
                    const entry = this.pending.get(msg.id)
                    if (entry) {
                        clearTimeout(entry.timer)
                        this.pending.delete(msg.id)
                        entry.reject(new Error(msg.message))
                    }
                }
                return
            }
            case "event": {
                const data = msg.data ?? {}
                const feature = data.feature
                if (!feature || !this.params.features.includes(feature)) return

                // Skip the redundant broadcast while our own consume is in flight —
                // the rpc result already updated state.
                if (this.pendingRequests.size > 0) return

                this.addEvent(feature, "update", data)
                if (data.current !== undefined && data.status !== undefined) {
                    this.updateFeature(feature, data)
                } else {
                    this.fetchOne(feature)
                }
                return
            }
        }
    }

    private onWsClosed() {
        this.wsReady = false
        this.ws = null
        if (this.disposed) return
        // Fall back to polling immediately, then try to reconnect with backoff.
        if (!this.pollHandle) this.startPolling()
        this.scheduleReconnect()
    }

    private scheduleReconnect() {
        if (this.disposed || this.reconnectTimer || !this.wsUrl) return
        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000)
        this.reconnectAttempts++
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            if (this.disposed) return
            this.connectWebSocket(this.wsUrl!, this.token)
        }, delay)
    }

    // ── Internal: State ──

    private startPolling() {
        this.pollHandle = setInterval(() => {
            if (!this.disposed) this.fetchAll()
        }, this.options.pollInterval)
    }

    private addEvent(feature: string, type: UsageEvent["type"], raw: any, duration?: number) {
        const existing = this.snapshot.state[feature]
        const max = raw.max ?? raw.maxLimit ?? existing?.max ?? null
        const min = raw.min ?? raw.minLimit ?? existing?.min ?? null
        const current = raw.current ?? raw.newTotal ?? raw.currentAmount ?? 0
        const normalized: UsageEventData = {
            current,
            max,
            min,
            remaining: max != null ? max - current : null,
            status: raw.status ?? (max != null && current > max ? "above-max-limit" : "in-limit"),
            amount: raw.amount,
        }
        const prev = this.snapshot.events[feature] ?? []
        this.snapshot = {
            ...this.snapshot,
            events: { ...this.snapshot.events, [feature]: [...prev, { type, feature, data: normalized, ts: Date.now(), duration }] },
        }
        this.updateHandlers.forEach(h => h(this.snapshot.state))
    }

    private updateFeature(feature: string, data: any) {
        const max = data.max ?? data.maxLimit ?? null
        const min = data.min ?? data.minLimit ?? null
        const current = data.current ?? data.currentAmount ?? 0
        const status = data.status ?? "in-limit"

        const next: UsageState = {
            current,
            max,
            min,
            remaining: max != null ? max - current : null,
            percent: max != null && max > 0 ? Math.round((current / max) * 100) : null,
            status,
        }

        this.snapshot = {
            ...this.snapshot,
            state: { ...this.snapshot.state, [feature]: next },
        }
        this.updateHandlers.forEach(h => h(this.snapshot.state))
    }
}
