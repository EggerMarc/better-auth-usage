import { Redis } from "@upstash/redis"
import { incrementSimpleScript as incrementSimple } from "./lua"
import type { CachedUsage, CachedLimits, ConsumeArgs, ConsumeOutcome, Customer } from "../types"
import type { UsageDriver } from "./types"

export interface UpstashDriverConfig {
    /** Upstash REST URL (or set UPSTASH_REDIS_REST_URL). */
    url?: string
    /** Upstash REST token (or set UPSTASH_REDIS_REST_TOKEN). */
    token?: string
    /** Pass a pre-built client instead of url/token. */
    client?: Redis
}

/**
 * Upstash Redis (REST) driver — the only Redis that runs *on* Cloudflare
 * Workers (HTTP, no TCP socket). Atomic counter via a Lua `EVAL`. No pub/sub
 * over REST → no realtime (the client auto-degrades to polling) and no WAL
 * stream → the consume pipeline writes through to the DB directly.
 */
export function upstashDriver(config: UpstashDriverConfig = {}): UsageDriver {
    const client = config.client
        ?? new Redis({
            url: config.url ?? process.env.UPSTASH_REDIS_REST_URL!,
            token: config.token ?? process.env.UPSTASH_REDIS_REST_TOKEN!,
        })

    const usageKey = (referenceId: string, feature: string) => `usage:${feature}:${referenceId}`
    const metaKey = (referenceId: string, feature: string) => `meta:${feature}:${referenceId}`
    const customerKey = (referenceId: string) => `customer:${referenceId}`

    const metaToHash = (referenceId: string, feature: string, meta: Partial<CachedLimits>): Record<string, string | number> => {
        const hash: Record<string, string | number> = { referenceId, feature }
        if (meta.lastResetAt) hash.lastResetAt = meta.lastResetAt.getTime()
        if (meta.resetAt) hash.resetAt = meta.resetAt.getTime()
        if (meta.maxLimit != null) hash.maxLimit = meta.maxLimit
        if (meta.minLimit != null) hash.minLimit = meta.minLimit
        if (meta.resetValue != null) hash.resetValue = meta.resetValue
        return hash
    }

    return {
        name: "upstash",

        async consume(args: ConsumeArgs): Promise<ConsumeOutcome> {
            const result = (await client.eval(
                incrementSimple,
                [usageKey(args.referenceId, args.feature), metaKey(args.referenceId, args.feature)],
                [args.amount, args.nowMs],
            )) as [number, number, number]
            return { newTotal: Number(result[0]), resetOccurred: Number(result[1]) === 1, lastResetAt: Number(result[2]) }
        },

        async getUsage(referenceId: string, feature: string): Promise<CachedUsage | null> {
            const raw = await client.get<number | string | null>(usageKey(referenceId, feature))
            if (raw === null || raw === undefined) return null
            const meta = (await client.hgetall<Record<string, string | number>>(metaKey(referenceId, feature))) ?? {}
            return {
                referenceId,
                feature,
                current: Number(raw),
                lastResetAt: meta.lastResetAt ? new Date(Number(meta.lastResetAt)) : null,
                maxLimit: meta.maxLimit != null ? Number(meta.maxLimit) : undefined,
                minLimit: meta.minLimit != null ? Number(meta.minLimit) : undefined,
            }
        },

        async hydrate(referenceId: string, feature: string, usage: CachedUsage, meta: CachedLimits): Promise<void> {
            await client.set(usageKey(referenceId, feature), usage.current)
            await client.hset(metaKey(referenceId, feature), metaToHash(referenceId, feature, meta))
        },

        async reset(referenceId: string, feature: string, value: number, meta: Partial<CachedLimits>): Promise<void> {
            await Promise.all([
                client.set(usageKey(referenceId, feature), value),
                client.hset(metaKey(referenceId, feature), metaToHash(referenceId, feature, meta)),
            ])
        },

        async getCustomer(referenceId: string): Promise<Customer | null> {
            const data = await client.hgetall<Record<string, string>>(customerKey(referenceId))
            if (!data || !data.referenceId) return null
            return {
                referenceId: String(data.referenceId),
                referenceType: String(data.referenceType),
                email: data.email ? String(data.email) : undefined,
                name: data.name ? String(data.name) : undefined,
                overrideKey: data.overrideKey ? String(data.overrideKey) : undefined,
            }
        },

        async setCustomer(customer: Customer): Promise<void> {
            const k = customerKey(customer.referenceId)
            await client.del(k)
            const hash: Record<string, string> = {
                referenceId: customer.referenceId,
                referenceType: customer.referenceType,
            }
            if (customer.email) hash.email = customer.email
            if (customer.name) hash.name = customer.name
            if (customer.overrideKey) hash.overrideKey = customer.overrideKey
            await client.hset(k, hash)
        },

        async delCustomer(referenceId: string): Promise<void> {
            await client.del(customerKey(referenceId))
        },

        async close(): Promise<void> {
            // REST client — no persistent connection to close.
        },
    }
}
