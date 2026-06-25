import type { CachedUsage, CachedLimits, ConsumeArgs, ConsumeOutcome, Customer } from "../types"

/**
 * A single write-ahead-log entry — one consume operation captured durably for
 * async sync to the database. Drivers that buffer writes (Redis stream, DO
 * storage list) materialize these; drivers without a WAL omit the capability.
 */
export interface WalEntry {
    /** Opaque, monotonic, lexicographically-sortable id (e.g. Redis stream id). */
    id: string
    refId: string
    feature: string
    amount: number
    event: string
    ts: number
    resetOccurred: number
    newTotal: number
    lastResetAt: number
}

/**
 * Realtime usage event — emitted by a remote driver (Redis pub/sub, in-memory
 * emitter) whenever a counter changes, so a transport (socket.io / native WS)
 * can fan it out to subscribed clients. Co-located drivers (Durable Object)
 * broadcast directly inside `consume` and need not emit these.
 */
export interface UsageEventMessage {
    refId: string
    feature: string
    amount: number
    newTotal: number
    event: string
    ts: number
}

/**
 * Optional realtime fan-out capability. Present ⇒ the server advertises a WS
 * endpoint; absent ⇒ the client auto-degrades to polling.
 */
export interface RealtimeCapability {
    /**
     * Subscribe to usage events from the store. Returns an unsubscribe fn.
     * Redis implements this via `psubscribe`; in-memory via an EventEmitter.
     */
    onUsageEvent(cb: (event: UsageEventMessage) => void): Promise<() => void> | (() => void)

    /** What the `/usage/ws` discovery endpoint returns for this driver. */
    endpointInfo(baseURL: string): { enabled: boolean; url: string | null }
}

/**
 * Optional write-ahead-log capability — durable Redis→DB sync. The driver owns
 * the log transport (read/ack/trim/len/recover/subscribe); the shared
 * `wal/apply.ts` owns turning entries into DB rows.
 */
export interface WalCapability {
    /** Create the consumer group / prepare the log (idempotent). */
    recover(): Promise<void>
    /** Read up to `count` pending entries. `null`/empty ⇒ nothing to drain. */
    read(count: number): Promise<WalEntry[] | null>
    /** Acknowledge processed entry ids. */
    ack(ids: string[]): Promise<void>
    /** Trim entries up to (and including) the oldest acked id. */
    trim(minId: string): Promise<void>
    /** Current backlog length (for backpressure logging). */
    len(): Promise<number>
    /** Fire `cb` when new entries may be available (zero-idle drain trigger). */
    subscribe(cb: () => void): Promise<() => void> | (() => void)
}

/**
 * The pluggable usage backend. "Bring your own": Redis, Durable Object,
 * in-memory, or a custom implementation. Plain-async on purpose — a low barrier
 * for third-party authors. Internally the runtime lifts this into an Effect
 * `DriverService` (see `package/services/driver.ts`); pipelines orchestrate in
 * Effect and only the edges are async.
 *
 * Invariants:
 * - `consume` MUST be atomic per (referenceId, feature): load meta → apply
 *   reset-boundary → increment → persist → (if realtime) broadcast → (if wal)
 *   append. It mirrors `drivers/lua/increment.lua` and returns its contract.
 * - `getUsage` returns counter + limits in ONE read, or `null` on a cache miss
 *   (the caller then falls back to the database).
 */
export interface UsageDriver {
    readonly name: string

    /** Atomic increment with reset-boundary handling + fan-out + WAL append. */
    consume(args: ConsumeArgs): Promise<ConsumeOutcome>

    /** Cache-first read of counter + limits. `null` ⇒ miss. */
    getUsage(referenceId: string, feature: string): Promise<CachedUsage | null>

    /** Prime/overwrite counter + limits (DB→cache hydrate, sync metadata refresh). */
    hydrate(referenceId: string, feature: string, usage: CachedUsage, meta: CachedLimits): Promise<void>

    /** Force the counter to `value` and update limits (reset / plan-change). */
    reset(referenceId: string, feature: string, value: number, meta: Partial<CachedLimits>): Promise<void>

    /** Customer cache. Drivers MAY no-op these (return null / do nothing → DB-only). */
    getCustomer(referenceId: string): Promise<Customer | null>
    setCustomer(customer: Customer): Promise<void>
    delCustomer(referenceId: string): Promise<void>

    readonly realtime?: RealtimeCapability
    readonly wal?: WalCapability

    /** Release resources (connections, timers, emitters). */
    close(): Promise<void>
}
