import type { CachedUsage, CachedLimits, ConsumeArgs, ConsumeOutcome, Customer } from "../types"
import type { UsageDriver, UsageEventMessage } from "./types"

export interface MemoryDriverConfig {
    /**
     * Enable in-process realtime + the Node WebSocket server on this port.
     * Single process only (perfect for `bun` dev: every tab hits the same
     * driver, so consumes broadcast live). Omit for polling-only.
     */
    realtime?: { port: number }
}

/**
 * In-memory driver — `Map`-backed counters + limits + customers.
 *
 * The default when no driver/cache is configured, and the reference
 * implementation of the `UsageDriver` contract. Single-process only: state is
 * not shared across instances, so it is for local dev, tests, and single-node
 * setups where the database remains the durable source of truth (no WAL — the
 * consume pipeline writes through to the DB directly).
 *
 * `consume` is atomic by virtue of JavaScript's single-threaded execution.
 */
export function memoryDriver(config: MemoryDriverConfig = {}): UsageDriver {
    const counters = new Map<string, number>()
    const limits = new Map<string, CachedLimits>()
    const customers = new Map<string, Customer>()
    const subscribers = new Set<(e: UsageEventMessage) => void>()

    const key = (referenceId: string, feature: string) => `${feature}::${referenceId}`

    return {
        name: "memory",

        async consume(args: ConsumeArgs): Promise<ConsumeOutcome> {
            const k = key(args.referenceId, args.feature)

            // Self-prime meta from the args (limits + reset config) so consume
            // works without a prior hydrate. resetAt is seeded only when unset.
            // CachedLimits is a readonly Schema type — rebuild rather than mutate.
            const prev = limits.get(k)
            let meta: CachedLimits = {
                referenceId: args.referenceId,
                feature: args.feature,
                ...prev,
                ...(args.resetValue !== undefined ? { resetValue: args.resetValue } : {}),
                ...(args.maxLimit !== undefined ? { maxLimit: args.maxLimit } : {}),
                ...(args.minLimit !== undefined ? { minLimit: args.minLimit } : {}),
                ...(prev?.resetAt === undefined && args.resetAt !== undefined
                    ? { resetAt: new Date(args.resetAt) }
                    : {}),
            }
            const resetValue = meta.resetValue ?? 0

            let current = counters.has(k) ? counters.get(k)! : resetValue
            let resetOccurred = false
            let lastResetAt = meta.lastResetAt?.getTime() ?? args.nowMs

            // Reset boundary crossed — mirror drivers/lua/increment.lua
            if (meta.resetAt && args.nowMs >= meta.resetAt.getTime()) {
                current = resetValue
                lastResetAt = args.nowMs
                resetOccurred = true
                meta = {
                    ...meta,
                    lastResetAt: new Date(args.nowMs),
                    resetAt: args.resetAt !== undefined ? new Date(args.resetAt) : undefined,
                }
            }

            if (meta.lastResetAt === undefined) meta = { ...meta, lastResetAt: new Date(lastResetAt) }
            limits.set(k, meta)

            const newTotal = current + args.amount
            counters.set(k, newTotal)

            // Fan out to in-process subscribers (the Node ws server bridges them).
            if (subscribers.size > 0) {
                const evt: UsageEventMessage = {
                    refId: args.referenceId, feature: args.feature,
                    amount: args.amount, newTotal, event: args.event, ts: args.nowMs,
                }
                for (const cb of subscribers) cb(evt)
            }

            return { newTotal, resetOccurred, lastResetAt }
        },

        async getUsage(referenceId: string, feature: string): Promise<CachedUsage | null> {
            const k = key(referenceId, feature)
            if (!counters.has(k)) return null
            const meta = limits.get(k)
            return {
                referenceId,
                feature,
                current: counters.get(k)!,
                lastResetAt: meta?.lastResetAt ?? null,
                maxLimit: meta?.maxLimit,
                minLimit: meta?.minLimit,
            }
        },

        async hydrate(referenceId: string, feature: string, usage: CachedUsage, meta: CachedLimits): Promise<void> {
            const k = key(referenceId, feature)
            counters.set(k, usage.current)
            limits.set(k, meta)
        },

        async reset(referenceId: string, feature: string, value: number, meta: Partial<CachedLimits>): Promise<void> {
            const k = key(referenceId, feature)
            counters.set(k, value)
            const existing = limits.get(k) ?? { referenceId, feature }
            limits.set(k, { ...existing, ...meta })
        },

        async getCustomer(referenceId: string): Promise<Customer | null> {
            return customers.get(referenceId) ?? null
        },

        async setCustomer(customer: Customer): Promise<void> {
            customers.set(customer.referenceId, customer)
        },

        async delCustomer(referenceId: string): Promise<void> {
            customers.delete(referenceId)
        },

        realtime: config.realtime
            ? {
                onUsageEvent(cb: (event: UsageEventMessage) => void): () => void {
                    subscribers.add(cb)
                    return () => { subscribers.delete(cb) }
                },
                endpointInfo(baseURL: string): { enabled: boolean; url: string | null } {
                    const origin = new URL(baseURL).origin.replace(/^http/, "ws").replace(/:\d+$/, "")
                    return { enabled: true, url: `${origin}:${config.realtime!.port}` }
                },
                port: config.realtime.port,
            }
            : undefined,

        async close(): Promise<void> {
            subscribers.clear()
            counters.clear()
            limits.clear()
            customers.clear()
        },
    }
}
