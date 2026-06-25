import { Effect, Schedule, Duration, Layer } from "effect"
import { DriverService, DbService, LoggerService, wrapDriver } from "../services"
import { applyWalEntries } from "./apply"

const BATCH_SIZE = 100
const BACKPRESSURE_THRESHOLD = 10_000

export type { WalEntry } from "../drivers/types"

/**
 * Single drain cycle — read from the driver's WAL, apply to DB, ACK, trim.
 * Shared by both the subscribe and poll strategies. No-op if the driver has
 * no WAL capability.
 */
export const drain = Effect.gen(function* () {
    const driver = yield* DriverService
    const db = yield* DbService
    const logger = yield* LoggerService

    const wal = driver.wal
    if (!wal) return 0

    // Read batch from the log
    const entries = yield* wrapDriver("walRead", () => wal.read(BATCH_SIZE))
    if (!entries || entries.length === 0) return 0

    // Apply to the database (events + coalesced usage upserts)
    yield* applyWalEntries(db, logger, entries)

    // ACK all processed entries
    const ids = entries.map((e) => e.id)
    yield* wrapDriver("walAck", () => wal.ack(ids))

    // Trim — only remove entries older than the oldest ACKed id (never drops pending)
    yield* wrapDriver("walTrim", () => wal.trim(ids[0]))

    logger.debug("WAL: drained", { count: entries.length })
    return entries.length
})

/**
 * Check backlog length and warn if it exceeds threshold.
 */
const checkBackpressure = Effect.gen(function* () {
    const driver = yield* DriverService
    const logger = yield* LoggerService

    if (!driver.wal) return
    const len = yield* wrapDriver("walLen", () => driver.wal!.len())
    if (len > BACKPRESSURE_THRESHOLD) {
        logger.warn("WAL: stream backpressure", { length: len, threshold: BACKPRESSURE_THRESHOLD })
    }
})

/**
 * Start the WAL worker with the "subscribe" strategy.
 * Drains whenever the driver signals new entries. Zero idle cost.
 *
 * Accepts a `layer` so the drain runs inside the callback with full services.
 */
export const startSubscribeWorker = (layer: Layer.Layer<DriverService | DbService | LoggerService>) =>
    Effect.gen(function* () {
        const driver = yield* DriverService
        const logger = yield* LoggerService

        if (!driver.wal) return

        logger.info("WAL: starting subscribe worker")

        // Serialize drains — only one in-flight at a time, queue pending triggers
        let draining = false
        let queued = false

        const runDrain = async () => {
            if (draining) {
                queued = true
                return
            }
            draining = true
            try {
                await Effect.runPromise(
                    drain.pipe(
                        Effect.catchAll((err) =>
                            Effect.sync(() => logger.error("WAL: drain failed", { error: err }))
                        ),
                        Effect.provide(layer),
                    )
                )
            } catch { /* already handled by catchAll */ }
            draining = false
            if (queued) {
                queued = false
                runDrain()
            }
        }

        yield* wrapDriver("walSubscribe", async () => driver.wal!.subscribe(() => runDrain()))
    })

/**
 * Start the WAL worker with the "poll" strategy.
 * Drains every `intervalMs` milliseconds.
 * ⚠️ Sends periodic commands when idle.
 */
export const startPollWorker = (intervalMs: number) =>
    Effect.gen(function* () {
        const logger = yield* LoggerService

        logger.info("WAL: starting poll worker", { intervalMs })

        const drainCycle = drain.pipe(
            Effect.tap(() => checkBackpressure),
            Effect.catchAll((err) =>
                Effect.sync(() => logger.error("WAL: drain cycle failed", { error: err }))
            )
        )

        yield* Effect.repeat(drainCycle, Schedule.spaced(Duration.millis(intervalMs)))
    })
