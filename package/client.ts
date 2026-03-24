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
        },
    } satisfies BetterAuthClientPlugin;
};

// ── Reactive Usage Tracker ──

export interface UsageState {
    current: number
    max: number | null
    min: number | null
    remaining: number | null
    percent: number | null
    status: "in-limit" | "above-max-limit" | "below-min-limit"
    allowed: boolean
}

export interface ThresholdEvent {
    feature: string
    percent: number
    threshold: number
    current: number
    max: number
}

export interface BlockedEvent {
    feature: string
    current: number
    max: number
}

type UpdateHandler = (state: Record<string, UsageState>) => void
type ThresholdHandler = (event: ThresholdEvent) => void
type BlockedHandler = (event: BlockedEvent) => void

interface TrackerOptions {
    /** Base URL of the BetterAuth server (e.g. "http://localhost:3000/api/auth") */
    baseURL: string
    /** Enable websocket connection. Default: true. Falls back to polling if unavailable. */
    websocket?: boolean
    /** Polling interval in ms. Only used if websocket is false or unavailable. Default: 5000 */
    pollInterval?: number
    /** Percentage thresholds that trigger "threshold" events. E.g. [0.5, 0.8, 0.9, 1.0] */
    thresholds?: number[]
    /** WebSocket server URL (e.g. "http://localhost:3001"). If not set, derived from baseURL. */
    wsUrl?: string
    /** Custom fetch implementation (for SSR, testing, etc.) */
    fetchImpl?: typeof fetch
    /** Headers to send with REST requests (e.g. auth cookies) */
    headers?: Record<string, string> | (() => Record<string, string>)
}

interface TrackParams {
    referenceId: string
    features: string[]
}

/**
 * Create a reactive usage tracker.
 *
 * Connects to the server via REST (initial fetch) and optionally
 * WebSocket (live updates). Maintains local state that can be read
 * synchronously via `isAllowed()` and `getUsage()`.
 *
 * Usage:
 * ```ts
 * const tracker = createUsageTracker({ baseURL: "http://localhost:3000/api/auth" })
 * const handle = tracker.track({ referenceId: "team-123", features: ["api-calls", "credits"] })
 *
 * handle.isAllowed("api-calls")  // true — sync, zero latency
 * handle.getUsage("api-calls")   // { current: 74, max: 100, ... }
 * handle.on("threshold", (e) => console.log("Warning!", e))
 * handle.on("blocked", (e) => showUpgradeModal(e))
 *
 * // Cleanup
 * handle.dispose()
 * ```
 */
export function createUsageTracker(options: TrackerOptions) {
    const {
        baseURL,
        websocket = true,
        wsUrl,
        pollInterval = 5000,
        thresholds = [],
        fetchImpl = fetch,
        headers,
    } = options

    return {
        track(params: TrackParams): UsageTrackerHandle {
            return new UsageTrackerHandle(
                baseURL, params, { websocket, wsUrl, pollInterval, thresholds, fetchImpl, headers }
            )
        }
    }
}

class UsageTrackerHandle {
    private state: Record<string, UsageState> = {}
    private updateHandlers: UpdateHandler[] = []
    private thresholdHandlers: ThresholdHandler[] = []
    private blockedHandlers: BlockedHandler[] = []
    private crossedThresholds: Record<string, Set<number>> = {}
    private pollHandle: ReturnType<typeof setInterval> | null = null
    private socket: Socket | null = null
    private disposed = false

    constructor(
        private baseURL: string,
        private params: TrackParams,
        private options: {
            websocket: boolean
            wsUrl?: string
            pollInterval: number
            thresholds: number[]
            fetchImpl: typeof fetch
            headers?: Record<string, string> | (() => Record<string, string>)
        }
    ) {
        // Initialize threshold tracking
        for (const feature of params.features) {
            this.crossedThresholds[feature] = new Set()
        }

        // Fetch initial state
        this.fetchAll()

        // Start live updates
        if (options.websocket) {
            this.connectWebSocket()
        } else {
            this.startPolling()
        }
    }

    /** Check if a feature is within its limits. Sync, zero latency. */
    isAllowed(feature: string): boolean {
        return this.state[feature]?.allowed ?? true
    }

    /** Get current usage state for a feature. Sync, zero latency. */
    getUsage(feature: string): UsageState | null {
        return this.state[feature] ?? null
    }

    /** Get all tracked feature states. */
    getAll(): Record<string, UsageState> {
        return { ...this.state }
    }

    /** Subscribe to state updates. */
    on(event: "update", handler: UpdateHandler): void
    on(event: "threshold", handler: ThresholdHandler): void
    on(event: "blocked", handler: BlockedHandler): void
    on(event: string, handler: any): void {
        switch (event) {
            case "update": this.updateHandlers.push(handler); break
            case "threshold": this.thresholdHandlers.push(handler); break
            case "blocked": this.blockedHandlers.push(handler); break
        }
    }

    /** Unsubscribe from events. */
    off(event: "update", handler: UpdateHandler): void
    off(event: "threshold", handler: ThresholdHandler): void
    off(event: "blocked", handler: BlockedHandler): void
    off(event: string, handler: any): void {
        switch (event) {
            case "update": this.updateHandlers = this.updateHandlers.filter(h => h !== handler); break
            case "threshold": this.thresholdHandlers = this.thresholdHandlers.filter(h => h !== handler); break
            case "blocked": this.blockedHandlers = this.blockedHandlers.filter(h => h !== handler); break
        }
    }

    /** Clean up connections and timers. */
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
        this.thresholdHandlers = []
        this.blockedHandlers = []
    }

    // ── Internal ──

    private getHeaders(): Record<string, string> {
        if (!this.options.headers) return {}
        if (typeof this.options.headers === "function") return this.options.headers()
        return this.options.headers
    }

    private async fetchAll() {
        for (const feature of this.params.features) {
            await this.fetchOne(feature)
        }
    }

    private async fetchOne(feature: string) {
        try {
            const res = await this.options.fetchImpl(`${this.baseURL}/usage/check`, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    ...this.getHeaders(),
                },
                body: JSON.stringify({
                    referenceId: this.params.referenceId,
                    featureKey: feature,
                }),
            })

            if (!res.ok) return

            const json = await res.json()
            // BetterAuth may wrap response as { data: ... } or return directly
            const data = json?.data ?? json
            this.updateFeature(feature, data)
        } catch {
            // Silently fail — will retry on next poll or websocket event
        }
    }

    private updateFeature(feature: string, data: any) {
        const max = data.max ?? data.maxLimit ?? null
        const min = data.min ?? data.minLimit ?? null
        const current = data.current ?? data.currentAmount ?? 0
        const status = data.status ?? "in-limit"

        const prev = this.state[feature]
        const next: UsageState = {
            current,
            max,
            min,
            remaining: max != null ? max - current : null,
            percent: max != null && max > 0 ? Math.round((current / max) * 100) : null,
            status,
            allowed: status === "in-limit",
        }

        this.state[feature] = next

        // Emit update
        this.updateHandlers.forEach(h => h({ ...this.state }))

        // Check thresholds
        if (max != null && max > 0) {
            const pct = current / max
            for (const threshold of this.options.thresholds) {
                if (pct >= threshold && !this.crossedThresholds[feature]?.has(threshold)) {
                    this.crossedThresholds[feature]?.add(threshold)
                    this.thresholdHandlers.forEach(h => h({
                        feature, percent: pct, threshold, current, max,
                    }))
                }
            }
            // Reset crossed thresholds if usage drops below them
            for (const threshold of this.options.thresholds) {
                if (pct < threshold && this.crossedThresholds[feature]?.has(threshold)) {
                    this.crossedThresholds[feature]?.delete(threshold)
                }
            }
        }

        // Check blocked transition
        if (prev?.allowed && !next.allowed) {
            this.blockedHandlers.forEach(h => h({
                feature, current, max: max ?? 0,
            }))
        }
    }

    private startPolling() {
        this.pollHandle = setInterval(() => {
            if (!this.disposed) this.fetchAll()
        }, this.options.pollInterval)
    }

    private async connectWebSocket() {
        try {
            const url = this.options.wsUrl ?? this.baseURL.replace(/\/api\/auth$/, "")
            console.debug("[usage-tracker] Connecting WebSocket to", url)
            const socket = io(url, { transports: ["websocket"] })
            this.socket = socket

            socket.on("connect", () => {
                console.debug("[usage-tracker] WebSocket connected, subscribing to", this.params.features)
                socket.emit("subscribe:usage", {
                    subscriptions: this.params.features.map(feature => ({
                        referenceId: this.params.referenceId,
                        feature,
                        referenceType: "user",
                    }))
                })
            })

            socket.on("subscribed", (data: any) => {
                console.debug("[usage-tracker] Subscribed to rooms", data)
            })

            socket.on("usage:updated", (data: any) => {
                console.debug("[usage-tracker] Received usage:updated", data)
                const feature = data.feature
                if (feature && this.params.features.includes(feature)) {
                    this.fetchOne(feature)
                }
            })

            socket.on("disconnect", (reason: string) => {
                console.debug("[usage-tracker] WebSocket disconnected:", reason)
                if (!this.disposed && !this.pollHandle) {
                    this.startPolling()
                }
            })

            socket.on("connect_error", (err: Error) => {
                console.debug("[usage-tracker] WebSocket connect error:", err.message)
                if (!this.disposed && !this.pollHandle) {
                    this.startPolling()
                }
            })

            socket.on("error", (data: any) => {
                console.debug("[usage-tracker] WebSocket error event:", data)
            })
        } catch (err) {
            console.debug("[usage-tracker] WebSocket setup failed:", err)
            this.startPolling()
        }
    }
}
