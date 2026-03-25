import { Effect } from "effect"
import { RedisService, LoggerService } from "@/services"
import { drain } from "./worker"

const STREAM = "wal:usage"
const GROUP = "wal-drain"

/**
 * Initialize the consumer group and reclaim any pending entries
 * from a previous crashed consumer.
 *
 * Safe to call multiple times — XGROUP CREATE is idempotent.
 */
export const recover = Effect.gen(function* () {
    const redis = yield* RedisService
    const logger = yield* LoggerService

    // 1. Create consumer group (idempotent)
    yield* redis.xgroupCreate(STREAM, GROUP, "0")

    // 2. Drain any pending entries (from before crash)
    //    Using "0" as ID reads pending entries instead of ">" (new only)
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
