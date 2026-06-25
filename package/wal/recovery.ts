import { Effect } from "effect"
import { DriverService, LoggerService, wrapDriver } from "@/services"
import { drain } from "./worker"

/**
 * Initialize the driver's WAL and reclaim any pending entries from a previous
 * crashed run. No-op if the driver has no WAL capability.
 *
 * Safe to call multiple times — `recover()` is idempotent.
 */
export const recover = Effect.gen(function* () {
    const driver = yield* DriverService
    const logger = yield* LoggerService

    if (!driver.wal) return

    // 1. Prepare the log / consumer group (idempotent)
    yield* wrapDriver("walRecover", () => driver.wal!.recover())

    // 2. Drain any pending entries (from before a crash)
    logger.info("WAL: recovery — checking for pending entries")

    let total = 0
    let processed: number
    do {
        processed = yield* drain.pipe(
            Effect.catchAll((err) => {
                logger.warn("WAL: recovery drain failed", { error: err })
                return Effect.succeed(0)
            })
        )
        total += processed
    } while (processed > 0)

    if (total > 0) {
        logger.info("WAL: recovery complete", { entriesProcessed: total })
    } else {
        logger.debug("WAL: no pending entries to recover")
    }
})
