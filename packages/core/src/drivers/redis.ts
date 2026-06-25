import type RedisType from "ioredis"
import { incrementScript } from "./lua"
import type { CachedUsage, CachedLimits, ConsumeArgs, ConsumeOutcome, Customer } from "../types"
import type { UsageDriver, WalEntry, UsageEventMessage } from "./types"

const STREAM = "wal:usage"
const GROUP = "wal-drain"
const CONSUMER = `consumer-${process.pid}-${Math.random().toString(36).slice(2, 10)}`

export interface RedisDriverConfig {
    redisUrl: string
    /** Advertise a realtime WS endpoint via `/usage/ws`. */
    enableRealtime?: boolean
    /** Port the standalone realtime server listens on (paired with `enableRealtime`). */
    port?: number
    /** Disable the write-ahead log (durable Redis→DB sync). Default: enabled. */
    walEnabled?: boolean
}

/** CachedLimits → flat Redis hash fields (skip undefined). */
function metaToHash(referenceId: string, feature: string, meta: Partial<CachedLimits>): Record<string, string> {
    const hash: Record<string, string> = { referenceId, feature }
    if (meta.lastResetAt) hash.lastResetAt = String(meta.lastResetAt.getTime())
    if (meta.resetAt) hash.resetAt = String(meta.resetAt.getTime())
    if (meta.maxLimit != null) hash.maxLimit = String(meta.maxLimit)
    if (meta.minLimit != null) hash.minLimit = String(meta.minLimit)
    if (meta.resetValue != null) hash.resetValue = String(meta.resetValue)
    return hash
}

function customerToHash(customer: Customer): Record<string, string> {
    const hash: Record<string, string> = {
        referenceId: customer.referenceId,
        referenceType: customer.referenceType,
    }
    if (customer.email) hash.email = customer.email
    if (customer.name) hash.name = customer.name
    if (customer.overrideKey) hash.overrideKey = customer.overrideKey
    return hash
}

/**
 * Parse raw Redis stream entries into typed WalEntries.
 * ioredis returns: [[entryId, [field1, value1, field2, value2, ...]]]
 */
function parseEntries(raw: Array<[string, string[]]>): WalEntry[] {
    return raw.map(([id, fields]) => {
        const obj: Record<string, string> = {}
        for (let i = 0; i < fields.length; i += 2) {
            obj[fields[i]] = fields[i + 1]
        }
        return {
            id,
            refId: obj.refId,
            feature: obj.feature,
            amount: Number(obj.amount),
            event: obj.event ?? "use",
            ts: Number(obj.ts),
            resetOccurred: Number(obj.resetOccurred ?? 0),
            newTotal: Number(obj.newTotal),
            lastResetAt: Number(obj.lastResetAt),
        }
    })
}

/**
 * Redis driver — wraps the existing ioredis + Lua + WAL stream + pub/sub path
 * behind the `UsageDriver` contract. Owns a single ioredis client (plus
 * dedicated subscriber clients for pub/sub) created at construction and torn
 * down via `close()`.
 *
 * - `consume` runs `drivers/lua/increment.lua` atomically (increment + reset +
 *   WAL append + publish).
 * - `wal` exposes the `wal:usage` stream for the drain worker.
 * - `realtime` bridges the `usage:events:*` pub/sub channel.
 */
export function redisDriver(config: RedisDriverConfig): UsageDriver {
    // Lazy-load `ioredis` (Node TCP) on first use so importing this driver stays
    // safe in non-Node bundles; the client is only created when a method runs.
    let clientP: Promise<RedisType> | null = null
    const C = (): Promise<RedisType> =>
        (clientP ??= import("ioredis").then(({ default: Redis }) => {
            const c = new Redis(config.redisUrl, {
                maxRetriesPerRequest: 3,
                enableReadyCheck: false, // managed Redis (Upstash, etc.) may not allow INFO
                retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 200, 2000)),
                lazyConnect: false,
            })
            c.on("error", () => {}) // errors surface per-operation
            return c
        }))

    const subscribers: RedisType[] = []

    const usageKey = (referenceId: string, feature: string) => `usage:${feature}:${referenceId}`
    const metaKey = (referenceId: string, feature: string) => `meta:${feature}:${referenceId}`
    const customerKey = (referenceId: string) => `customer:${referenceId}`

    const walEnabled = config.walEnabled !== false

    return {
        name: "redis",

        async consume(args: ConsumeArgs): Promise<ConsumeOutcome> {
            const client = await C()
            const result = (await client.eval(
                incrementScript,
                3,
                usageKey(args.referenceId, args.feature),
                metaKey(args.referenceId, args.feature),
                STREAM,
                args.amount,
                args.nowMs,
                args.referenceId,
                args.feature,
                args.event,
            )) as [number, number, number]
            return { newTotal: result[0], resetOccurred: result[1] === 1, lastResetAt: result[2] }
        },

        async getUsage(referenceId: string, feature: string): Promise<CachedUsage | null> {
            const client = await C()
            const raw = await client.get(usageKey(referenceId, feature))
            if (raw === null) return null
            const meta = await client.hgetall(metaKey(referenceId, feature))
            return {
                referenceId,
                feature,
                current: Number(raw),
                lastResetAt: meta.lastResetAt ? new Date(Number(meta.lastResetAt)) : null,
                maxLimit: meta.maxLimit ? Number(meta.maxLimit) : undefined,
                minLimit: meta.minLimit ? Number(meta.minLimit) : undefined,
            }
        },

        async hydrate(referenceId: string, feature: string, usage: CachedUsage, meta: CachedLimits): Promise<void> {
            const client = await C()
            await client.set(usageKey(referenceId, feature), String(usage.current))
            await client.hset(metaKey(referenceId, feature), metaToHash(referenceId, feature, meta))
        },

        async reset(referenceId: string, feature: string, value: number, meta: Partial<CachedLimits>): Promise<void> {
            const client = await C()
            await Promise.all([
                client.set(usageKey(referenceId, feature), String(value)),
                client.hset(metaKey(referenceId, feature), metaToHash(referenceId, feature, meta)),
            ])
        },

        async getCustomer(referenceId: string): Promise<Customer | null> {
            const client = await C()
            const data = await client.hgetall(customerKey(referenceId))
            if (!data.referenceId) return null
            return {
                referenceId: data.referenceId,
                referenceType: data.referenceType,
                email: data.email || undefined,
                name: data.name || undefined,
                overrideKey: data.overrideKey || undefined,
            }
        },

        async setCustomer(customer: Customer): Promise<void> {
            const client = await C()
            const k = customerKey(customer.referenceId)
            // Delete first to clear stale optional fields, then re-set.
            await client.del(k)
            await client.hset(k, customerToHash(customer))
        },

        async delCustomer(referenceId: string): Promise<void> {
            const client = await C()
            await client.del(customerKey(referenceId))
        },

        wal: walEnabled
            ? {
                async recover(): Promise<void> {
                    const client = await C()
                    try {
                        await client.xgroup("CREATE", STREAM, GROUP, "0", "MKSTREAM")
                    } catch (err) {
                        // BUSYGROUP = already exists — idempotent
                        if (!String(err).includes("BUSYGROUP")) throw err
                    }
                },
                async read(count: number): Promise<WalEntry[] | null> {
                    const client = await C()
                    const result = (await client.xreadgroup(
                        "GROUP", GROUP, CONSUMER,
                        "COUNT", count,
                        "STREAMS", STREAM, ">",
                    )) as Array<[string, Array<[string, string[]]>]> | null
                    if (!result) return null
                    return parseEntries(result[0]?.[1] ?? [])
                },
                async ack(ids: string[]): Promise<void> {
                    if (ids.length === 0) return
                    const client = await C()
                    await client.xack(STREAM, GROUP, ...ids)
                },
                async trim(minId: string): Promise<void> {
                    const client = await C()
                    await client.xtrim(STREAM, "MINID", "~", minId)
                },
                async len(): Promise<number> {
                    const client = await C()
                    return await client.xlen(STREAM)
                },
                async subscribe(cb: () => void): Promise<() => void> {
                    const client = await C()
                    const sub = client.duplicate()
                    sub.on("error", () => {})
                    subscribers.push(sub)
                    void sub.psubscribe("usage:events:*")
                    sub.on("pmessage", () => cb())
                    return () => { void sub.punsubscribe() }
                },
            }
            : undefined,

        realtime: {
            async onUsageEvent(cb: (event: UsageEventMessage) => void): Promise<() => void> {
                const client = await C()
                const sub = client.duplicate()
                sub.on("error", () => {})
                subscribers.push(sub)
                void sub.psubscribe("usage:events:*")
                sub.on("pmessage", (_pattern, _channel, message) => {
                    try {
                        cb(JSON.parse(message) as UsageEventMessage)
                    } catch {
                        // ignore malformed payloads
                    }
                })
                return () => { void sub.punsubscribe() }
            },
            endpointInfo(baseURL: string): { enabled: boolean; url: string | null } {
                if (!config.enableRealtime || !config.port) return { enabled: false, url: null }
                const origin = new URL(baseURL).origin
                const wsOrigin = origin.replace(/:\d+$/, "") + ":" + config.port
                return { enabled: true, url: wsOrigin }
            },
        },

        async close(): Promise<void> {
            await Promise.allSettled(subscribers.map((s) => s.quit()))
            if (clientP) await (await clientP).quit()
        },
    }
}
