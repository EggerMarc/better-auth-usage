import { Context, Effect, Layer } from "effect"
import { DriverError } from "@/errors"
import type { CachedUsage, CachedLimits, ConsumeArgs, ConsumeOutcome, Customer } from "@/types"
import type { UsageDriver, RealtimeCapability, WalCapability } from "@/drivers/types"

/**
 * DriverService — the Effect-facing view of a plain-async `UsageDriver`.
 *
 * Mirrors the pattern in `services/redis.ts`/`services/db.ts`: an interface of
 * Effect-returning methods plus a `Context.GenericTag` for dependency injection.
 * Store ops are wrapped (thrown errors → `DriverError`) so pipelines stay in
 * `Effect.gen`. The optional `wal`/`realtime` capabilities are exposed raw —
 * the WAL worker and realtime transport wrap them where they orchestrate.
 */
export interface DriverService {
    consume(args: ConsumeArgs): Effect.Effect<ConsumeOutcome, DriverError>
    getUsage(referenceId: string, feature: string): Effect.Effect<CachedUsage | null, DriverError>
    hydrate(referenceId: string, feature: string, usage: CachedUsage, meta: CachedLimits): Effect.Effect<void, DriverError>
    reset(referenceId: string, feature: string, value: number, meta: Partial<CachedLimits>): Effect.Effect<void, DriverError>
    getCustomer(referenceId: string): Effect.Effect<Customer | null, DriverError>
    setCustomer(customer: Customer): Effect.Effect<void, DriverError>
    delCustomer(referenceId: string): Effect.Effect<void, DriverError>
    readonly wal?: WalCapability
    readonly realtime?: RealtimeCapability
}

export const DriverService = Context.GenericTag<DriverService>("DriverService")

/**
 * Wrap a plain-async driver call in a typed Effect.
 */
export const wrapDriver = <T>(operation: string, fn: () => Promise<T>): Effect.Effect<T, DriverError> =>
    Effect.tryPromise({
        try: fn,
        catch: (cause) => new DriverError({ cause, operation }),
    })

/**
 * Lift a `UsageDriver` into a `DriverService` layer.
 *
 * Uses `Layer.succeed` (not `Layer.scoped`): the driver instance is created
 * once at plugin-config time and owns its own lifecycle — it is closed
 * explicitly via `driver.close()` in `resetRuntime`, NOT per request.
 */
export const makeDriverServiceLive = (driver: UsageDriver): Layer.Layer<DriverService> =>
    Layer.succeed(DriverService, {
        consume: (args) => wrapDriver("consume", () => driver.consume(args)),
        getUsage: (referenceId, feature) => wrapDriver("getUsage", () => driver.getUsage(referenceId, feature)),
        hydrate: (referenceId, feature, usage, meta) =>
            wrapDriver("hydrate", () => driver.hydrate(referenceId, feature, usage, meta)),
        reset: (referenceId, feature, value, meta) =>
            wrapDriver("reset", () => driver.reset(referenceId, feature, value, meta)),
        getCustomer: (referenceId) => wrapDriver("getCustomer", () => driver.getCustomer(referenceId)),
        setCustomer: (customer) => wrapDriver("setCustomer", () => driver.setCustomer(customer)),
        delCustomer: (referenceId) => wrapDriver("delCustomer", () => driver.delCustomer(referenceId)),
        wal: driver.wal,
        realtime: driver.realtime,
    } satisfies DriverService)
