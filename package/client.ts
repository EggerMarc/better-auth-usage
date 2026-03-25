import type { usage } from "./index.ts";
import type { BetterAuthClientPlugin } from "better-auth/types";
import { io, type Socket } from "socket.io-client";

// ── BetterAuth Client Plugin ──

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
    allowed: boolean
}

export interface CheckResult {
    allowed: boolean
    status: string
    current: number
    max: number | undefined
    min: number | undefined
    remaining: number | null
    percent: number | null
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
    /** Reference type passed to authorizeUser on the server. Default: "user" */
    referenceType?: string
}

// ── Factory ──

/**
 * Create a reactive usage tracker.
 *
 * WS URL is auto-discovered from the server via `/usage/ws`.
 *
 * ```ts
 * const tracker = createUsageTracker({ baseURL: "/api/auth", token: sessionToken })
 * const handle = tracker.track({ referenceId: "org-123", features: ["api-calls"] })
 *
 * handle.isAllowed("api-calls")
 * await handle.consume("api-calls", 1)
 * handle.subscribe(() => console.log(handle.getSnapshot()))
 * handle.dispose()
 * ```
 */
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

export class UsageTrackerHandle {
    private state: Record<string, UsageState> = {}
    private updateHandlers: UpdateHandler[] = []
    private pollHandle: ReturnType<typeof setInterval> | null = null
    private socket: Socket | null = null
    private disposed = false

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
        this.fetchAll()

        if (options.websocket) {
            this.discoverAndConnect()
        } else {
            this.startPolling()
        }
    }

    // ── Sync reads ──

    isAllowed(feature: string): boolean {
        return this.state[feature]?.allowed ?? true
    }

    getUsage(feature: string): UsageState | null {
        return this.state[feature] ?? null
    }

    getAll(): Record<string, UsageState> {
        return this.state
    }

    // ── useSyncExternalStore compat ──

    subscribe(callback: () => void): () => void {
        const handler: UpdateHandler = () => callback()
        this.updateHandlers.push(handler)
        return () => {
            this.updateHandlers = this.updateHandlers.filter(h => h !== handler)
        }
    }

    getSnapshot(): Record<string, UsageState> {
        return this.state
    }

    // ── Operations (WS → REST fallback) ──

    async consume(featureKey: string, amount: number, event = "use"): Promise<ConsumeResult> {
        if (this.socket?.connected) {
            return this.emitAndWait("consume", "consume:result", {
                referenceId: this.params.referenceId, featureKey, amount, event,
            })
        }
        return this.restPost<ConsumeResult>("/usage/consume", {
            referenceId: this.params.referenceId, featureKey, amount, event,
        })
    }

    async check(featureKey: string, amount?: number): Promise<CheckResult> {
        if (this.socket?.connected) {
            return this.emitAndWait("check", "check:result", {
                referenceId: this.params.referenceId, featureKey, amount,
            })
        }
        return this.restPost<CheckResult>("/usage/check", {
            referenceId: this.params.referenceId, featureKey, amount,
        })
    }

    async canUse(featureKey: string, amount?: number): Promise<CheckResult> {
        if (this.socket?.connected) {
            return this.emitAndWait("can-use", "can-use:result", {
                referenceId: this.params.referenceId, featureKey, amount,
            })
        }
        return this.restPost<CheckResult>("/usage/can-use", {
            referenceId: this.params.referenceId, featureKey, amount,
        })
    }

    async useFeature(featureKey: string, amount = 1, event = "use"): Promise<ConsumeResult> {
        if (this.socket?.connected) {
            return this.emitAndWait("use-feature", "use-feature:result", {
                referenceId: this.params.referenceId, featureKey, amount, event,
            })
        }
        return this.restPost<ConsumeResult>("/usage/use-feature", {
            referenceId: this.params.referenceId, featureKey, amount, event,
        })
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

    /** Auto-discover WS URL and session token from server, then connect. */
    private async discoverAndConnect() {
        try {
            // Fetch WS info and session in parallel
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
        return new Promise<T>((resolve, reject) => {
            const socket = this.socket
            if (!socket) return reject(new Error("WebSocket not connected"))

            const timeout = setTimeout(() => {
                socket.off(resultEvent, onResult)
                socket.off("error", onError)
                reject(new Error(`${emitEvent} timed out`))
            }, 10000)

            const onResult = (result: T) => {
                clearTimeout(timeout)
                socket.off(resultEvent, onResult)
                socket.off("error", onError)
                resolve(result)
            }

            const onError = (err: { message: string; event?: string }) => {
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
            allowed: status === "in-limit",
        }

        this.state = { ...this.state, [feature]: next }
        this.updateHandlers.forEach(h => h(this.state))
    }
}
