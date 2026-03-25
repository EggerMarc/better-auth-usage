import type { usage } from "./index.ts";
import type { BetterAuthClientPlugin } from "better-auth/types";
import { io, type Socket } from "socket.io-client";

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
    private socket: Socket | null = null
    private disposed = false
    /** Pending request IDs per feature — skip matching usage:updated events */
    private pendingRequests: Set<string> = new Set()

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

        if (this.socket?.connected) {
            result = await this.emitAndWait("use-feature", "use-feature:result", {
                referenceId: this.params.referenceId, featureKey, amount, event, requestId,
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
        if (this.socket) {
            this.socket.disconnect()
            this.socket = null
        }
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

    private emitAndWait<T>(emitEvent: string, resultEvent: string, data: Record<string, unknown>): Promise<T> {
        const requestId = data.requestId as string | undefined

        return new Promise<T>((resolve, reject) => {
            const socket = this.socket
            if (!socket) return reject(new Error("WebSocket not connected"))

            const timeout = setTimeout(() => {
                socket.off(resultEvent, onResult)
                socket.off("error", onError)
                reject(new Error(`${emitEvent} timed out`))
            }, 10000)

            const onResult = (result: any) => {
                // If requestId was sent, only resolve on matching response
                if (requestId && result?.requestId !== requestId) return

                clearTimeout(timeout)
                socket.off(resultEvent, onResult)
                socket.off("error", onError)
                resolve(result as T)
            }

            const onError = (err: { message: string; event?: string; requestId?: string }) => {
                if (requestId && err.requestId !== requestId) return
                if (err.event === resultEvent || err.event === emitEvent) {
                    clearTimeout(timeout)
                    socket.off(resultEvent, onResult)
                    socket.off("error", onError)
                    reject(new Error(err.message))
                }
            }

            socket.on(resultEvent, onResult)
            socket.on("error", onError)
            socket.emit(emitEvent, data)
        })
    }

    private connectWebSocket(wsUrl: string, token?: string) {
        try {
            const socket = io(wsUrl, {
                transports: ["websocket"],
                auth: token ? { token } : undefined,
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 10000,
                reconnectionAttempts: Infinity,
            })
            this.socket = socket

            socket.on("connect", () => {
                if (this.pollHandle) {
                    clearInterval(this.pollHandle)
                    this.pollHandle = null
                }
                socket.emit("subscribe:usage", {
                    subscriptions: this.params.features.map(feature => ({
                        referenceId: this.params.referenceId,
                        feature,
                        referenceType: this.params.referenceType ?? "user",
                    }))
                })
            })

            socket.on("subscribed", () => {
                this.fetchAll()
            })

            socket.on("usage:updated", (data: any) => {
                const feature = data.feature
                if (!feature || !this.params.features.includes(feature)) return

                // Skip duplicate from Lua PUBLISH while we have a pending consume for this feature
                // The consume:result already updated state — the Lua broadcast is redundant
                if (this.pendingRequests.size > 0) {
                    return
                }

                this.addEvent(feature, "update", data)
                if (data.current !== undefined && data.status !== undefined) {
                    this.updateFeature(feature, data)
                } else {
                    this.fetchOne(feature)
                }
            })

            socket.on("disconnect", () => {
                if (!this.disposed && !this.pollHandle) this.startPolling()
            })

            socket.on("connect_error", () => {
                if (!this.disposed && !this.pollHandle) this.startPolling()
            })
        } catch {
            this.startPolling()
        }
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
