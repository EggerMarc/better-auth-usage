import { Effect, Schedule, Duration } from "effect"
import { RedisService, DbService, LoggerService } from "@/services"
import type { RedisError } from "@/errors"

const STREAM = "wal:usage"
const GROUP = "wal-drain"
const CONSUMER = `consumer-${process.pid}`
const BATCH_SIZE = 100
const TRIM_MAX = 10_000
const BACKPRESSURE_THRESHOLD = 10_000

export interface WalEntry {
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
 * Single drain cycle — read from stream, write to DB, ACK.
 * Shared by both subscribe and poll strategies.
 */
export const drain = Effect.gen(function* () {
    const redis = yield* RedisService
    const db = yield* DbService
    const logger = yield* LoggerService

    // Read batch from stream
    const raw = yield* redis.xreadgroup(GROUP, CONSUMER, STREAM, ">", BATCH_SIZE)
    if (!raw || raw.length === 0) return 0

    const entries = parseEntries(raw)

    // 1. Insert each event into usageEvent (history)
    for (const entry of entries) {
        yield* db.create({
            model: "usageEvent",
            data: {
                referenceId: entry.refId,
                feature: entry.feature,
                amount: entry.amount,
                event: entry.event,
                lastResetAt: new Date(entry.lastResetAt),
                createdAt: new Date(entry.ts),
            },
        }).pipe(
            Effect.catchAll((err) =>
                Effect.sync(() =>
                    logger.warn("WAL: failed to insert usage event", { entry: entry.id, error: err })
                )
            )
        )
    }

    // 2. Coalesce by (refId, feature) — take the LAST entry's newTotal
    const coalesced = new Map<string, WalEntry>()
    for (const entry of entries) {
        const key = `${entry.refId}:${entry.feature}`
        coalesced.set(key, entry) // last one wins
    }

    // 3. Upsert usage for each coalesced entry
    for (const entry of coalesced.values()) {
        const now = new Date()
        const existing = yield* db.findOne<any>({
            model: "usage",
            where: [
                { field: "referenceId", value: entry.refId },
                { field: "feature", value: entry.feature },
            ],
        })

        if (existing) {
            yield* db.update({
                model: "usage",
                where: [
                    { field: "referenceId", value: entry.refId },
                    { field: "feature", value: entry.feature },
                ],
                update: {
                    amount: entry.newTotal,
                    event: entry.event,
                    lastResetAt: new Date(entry.lastResetAt),
                    updatedAt: now,
                },
            })
        } else {
            yield* db.create({
                model: "usage",
                data: {
                    referenceId: entry.refId,
                    feature: entry.feature,
                    amount: entry.newTotal,
                    event: entry.event,
                    lastResetAt: new Date(entry.lastResetAt),
                    createdAt: now,
                    updatedAt: now,
                },
            })
        }
    }

    // 4. ACK all processed entries
    const ids = entries.map((e) => e.id)
    yield* redis.xack(STREAM, GROUP, ...ids)

    // 5. Trim stream
    yield* redis.xtrim(STREAM, TRIM_MAX)

    logger.debug("WAL: drained", { count: entries.length, coalesced: coalesced.size })
    return entries.length
})

/**
 * Check stream length and warn if it exceeds threshold.
 */
const checkBackpressure = Effect.gen(function* () {
    const redis = yield* RedisService
    const logger = yield* LoggerService

    const len = yield* redis.xlen(STREAM)
    if (len > BACKPRESSURE_THRESHOLD) {
        logger.warn("WAL: stream backpressure", { length: len, threshold: BACKPRESSURE_THRESHOLD })
    }
})

/**
 * Start the WAL worker with the "subscribe" strategy.
 * Listens to pub/sub events and drains on each event.
 * Zero idle cost.
 */
export const startSubscribeWorker = Effect.gen(function* () {
    const redis = yield* RedisService
    const logger = yield* LoggerService

    logger.info("WAL: starting subscribe worker")

    yield* redis.psubscribe("usage:events:*", () => {
        // On each event, trigger a drain cycle
        // We run the drain as a fire-and-forget effect since we're in a callback
        Effect.runPromise(
            drain.pipe(
                Effect.catchAll((err) =>
                    Effect.sync(() => logger.error("WAL: drain failed", { error: err }))
                )
            )
        ).catch(() => {}) // last resort — should never reach here
    })
})

/**
 * Start the WAL worker with the "poll" strategy.
 * Drains every `intervalMs` milliseconds.
 * ⚠️ Sends ~4 Redis commands/sec when idle.
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
