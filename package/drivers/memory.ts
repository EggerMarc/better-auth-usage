import type { CachedUsage, CachedLimits, ConsumeArgs, ConsumeOutcome, Customer } from "@/types"
import type { UsageDriver } from "./types"

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
export function memoryDriver(): UsageDriver {
    const counters = new Map<string, number>()
    const limits = new Map<string, CachedLimits>()
    const customers = new Map<string, Customer>()

    const key = (referenceId: string, feature: string) => `${feature}::${referenceId}`

    return {
        name: "memory",

        async consume(args: ConsumeArgs): Promise<ConsumeOutcome> {
            const k = key(args.referenceId, args.feature)
            const meta = limits.get(k)
            const resetValue = meta?.resetValue ?? 0

            let current = counters.has(k) ? counters.get(k)! : resetValue
            let resetOccurred = false
            let lastResetAt = meta?.lastResetAt?.getTime() ?? args.nowMs

            // Reset boundary crossed — mirror adapters/lua/increment.lua
            if (meta?.resetAt && args.nowMs >= meta.resetAt.getTime()) {
                current = resetValue
                lastResetAt = args.nowMs
                limits.set(k, { ...meta, lastResetAt: new Date(args.nowMs), resetAt: undefined })
                resetOccurred = true
            }

            const newTotal = current + args.amount
            counters.set(k, newTotal)

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

        async close(): Promise<void> {
            counters.clear()
            limits.clear()
            customers.clear()
        },
    }
}
