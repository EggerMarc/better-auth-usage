import { Pool, Client } from "pg"
import type { CachedUsage, CachedLimits, ConsumeArgs, ConsumeOutcome, Customer } from "@/types"
import type { UsageDriver, UsageEventMessage } from "./types"

const CHANNEL = "bau_usage_events"

export interface PostgresDriverConfig {
    connectionString: string
    /** Advertise a realtime WS endpoint via `/usage/ws` (fan-out via LISTEN/NOTIFY). */
    enableRealtime?: boolean
    /** Port the Node realtime server listens on (paired with `enableRealtime`). */
    port?: number
}

/**
 * Postgres driver — counter + realtime from a single Postgres, no Redis/DO.
 *
 * - `consume` is atomic via `SELECT … FOR UPDATE` inside a transaction (row
 *   lock serializes concurrent consumes on the same counter).
 * - realtime fan-out via `LISTEN/NOTIFY` (a `pg_notify` fires on each consume).
 * - own cache tables (`bau_usage_cache`, `bau_customer_cache`); the better-auth
 *   tables stay the durable source of truth (no WAL — pipeline writes through).
 */
export function postgresDriver(config: PostgresDriverConfig): UsageDriver {
    const pool = new Pool({ connectionString: config.connectionString })
    let listenClient: Client | null = null
    const subscribers = new Set<(e: UsageEventMessage) => void>()

    let schemaReady: Promise<void> | null = null
    const ensureSchema = () => (schemaReady ??= pool.query(`
        CREATE TABLE IF NOT EXISTS bau_usage_cache (
            reference_id text NOT NULL,
            feature text NOT NULL,
            current double precision NOT NULL,
            last_reset_at bigint,
            reset_at bigint,
            reset_value double precision,
            max_limit double precision,
            min_limit double precision,
            PRIMARY KEY (reference_id, feature)
        );
        CREATE TABLE IF NOT EXISTS bau_customer_cache (
            reference_id text PRIMARY KEY,
            reference_type text NOT NULL,
            email text,
            name text,
            override_key text
        );
    `).then(() => undefined))

    const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v))

    return {
        name: "postgres",

        async consume(args: ConsumeArgs): Promise<ConsumeOutcome> {
            await ensureSchema()
            const c = await pool.connect()
            try {
                await c.query("BEGIN")
                const r = await c.query(
                    `SELECT current, reset_at, reset_value, last_reset_at FROM bau_usage_cache
                     WHERE reference_id = $1 AND feature = $2 FOR UPDATE`,
                    [args.referenceId, args.feature],
                )
                const row = r.rows[0]
                const resetValue = num(row?.reset_value) ?? 0
                let current = row ? Number(row.current) : resetValue
                let resetAt = row?.reset_at != null ? Number(row.reset_at) : null
                let lastResetAt = row?.last_reset_at != null ? Number(row.last_reset_at) : args.nowMs
                let resetOccurred = false

                if (resetAt && args.nowMs >= resetAt) {
                    current = resetValue
                    lastResetAt = args.nowMs
                    resetAt = null
                    resetOccurred = true
                }

                const newTotal = current + args.amount
                await c.query(
                    `INSERT INTO bau_usage_cache (reference_id, feature, current, last_reset_at, reset_at, reset_value)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (reference_id, feature)
                     DO UPDATE SET current = $3, last_reset_at = $4, reset_at = $5`,
                    [args.referenceId, args.feature, newTotal, lastResetAt, resetAt, resetValue],
                )
                const evt: UsageEventMessage = {
                    refId: args.referenceId, feature: args.feature,
                    amount: args.amount, newTotal, event: args.event, ts: args.nowMs,
                }
                await c.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(evt)])
                await c.query("COMMIT")
                return { newTotal, resetOccurred, lastResetAt }
            } catch (err) {
                await c.query("ROLLBACK").catch(() => {})
                throw err
            } finally {
                c.release()
            }
        },

        async getUsage(referenceId: string, feature: string): Promise<CachedUsage | null> {
            await ensureSchema()
            const r = await pool.query(
                `SELECT current, last_reset_at, max_limit, min_limit FROM bau_usage_cache
                 WHERE reference_id = $1 AND feature = $2`,
                [referenceId, feature],
            )
            const row = r.rows[0]
            if (!row) return null
            return {
                referenceId,
                feature,
                current: Number(row.current),
                lastResetAt: row.last_reset_at != null ? new Date(Number(row.last_reset_at)) : null,
                maxLimit: num(row.max_limit),
                minLimit: num(row.min_limit),
            }
        },

        async hydrate(referenceId: string, feature: string, usage: CachedUsage, meta: CachedLimits): Promise<void> {
            await ensureSchema()
            await pool.query(
                `INSERT INTO bau_usage_cache (reference_id, feature, current, last_reset_at, reset_at, reset_value, max_limit, min_limit)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (reference_id, feature)
                 DO UPDATE SET current = $3, last_reset_at = $4, reset_at = $5, reset_value = $6, max_limit = $7, min_limit = $8`,
                [
                    referenceId, feature, usage.current,
                    meta.lastResetAt?.getTime() ?? null,
                    meta.resetAt?.getTime() ?? null,
                    meta.resetValue ?? null,
                    meta.maxLimit ?? null,
                    meta.minLimit ?? null,
                ],
            )
        },

        async reset(referenceId: string, feature: string, value: number, meta: Partial<CachedLimits>): Promise<void> {
            await ensureSchema()
            await pool.query(
                `INSERT INTO bau_usage_cache (reference_id, feature, current, last_reset_at, reset_at, reset_value, max_limit, min_limit)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (reference_id, feature)
                 DO UPDATE SET current = $3, last_reset_at = COALESCE($4, bau_usage_cache.last_reset_at),
                               reset_at = $5, reset_value = COALESCE($6, bau_usage_cache.reset_value)`,
                [
                    referenceId, feature, value,
                    meta.lastResetAt?.getTime() ?? null,
                    meta.resetAt?.getTime() ?? null,
                    meta.resetValue ?? null,
                    meta.maxLimit ?? null,
                    meta.minLimit ?? null,
                ],
            )
        },

        async getCustomer(referenceId: string): Promise<Customer | null> {
            await ensureSchema()
            const r = await pool.query(
                `SELECT reference_id, reference_type, email, name, override_key FROM bau_customer_cache WHERE reference_id = $1`,
                [referenceId],
            )
            const row = r.rows[0]
            if (!row) return null
            return {
                referenceId: row.reference_id,
                referenceType: row.reference_type,
                email: row.email ?? undefined,
                name: row.name ?? undefined,
                overrideKey: row.override_key ?? undefined,
            }
        },

        async setCustomer(customer: Customer): Promise<void> {
            await ensureSchema()
            await pool.query(
                `INSERT INTO bau_customer_cache (reference_id, reference_type, email, name, override_key)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (reference_id)
                 DO UPDATE SET reference_type = $2, email = $3, name = $4, override_key = $5`,
                [customer.referenceId, customer.referenceType, customer.email ?? null, customer.name ?? null, customer.overrideKey ?? null],
            )
        },

        async delCustomer(referenceId: string): Promise<void> {
            await ensureSchema()
            await pool.query(`DELETE FROM bau_customer_cache WHERE reference_id = $1`, [referenceId])
        },

        realtime: {
            async onUsageEvent(cb: (event: UsageEventMessage) => void): Promise<() => void> {
                subscribers.add(cb)
                if (!listenClient) {
                    listenClient = new Client({ connectionString: config.connectionString })
                    await listenClient.connect()
                    listenClient.on("notification", (msg) => {
                        if (msg.channel !== CHANNEL || !msg.payload) return
                        try {
                            const evt = JSON.parse(msg.payload) as UsageEventMessage
                            for (const sub of subscribers) sub(evt)
                        } catch { /* ignore malformed */ }
                    })
                    await listenClient.query(`LISTEN ${CHANNEL}`)
                }
                return () => { subscribers.delete(cb) }
            },
            endpointInfo(baseURL: string): { enabled: boolean; url: string | null } {
                if (!config.enableRealtime || !config.port) return { enabled: false, url: null }
                const origin = new URL(baseURL).origin
                const wsOrigin = origin.replace(/:\d+$/, "") + ":" + config.port
                return { enabled: true, url: wsOrigin }
            },
        },

        async close(): Promise<void> {
            subscribers.clear()
            if (listenClient) { await listenClient.end().catch(() => {}); listenClient = null }
            await pool.end().catch(() => {})
        },
    }
}
