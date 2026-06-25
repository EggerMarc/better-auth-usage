import { Effect } from "effect"
import { DbService, LoggerService } from "@/services"
import type { WalEntry } from "@/drivers/types"

/**
 * Apply a batch of WAL entries to the database.
 *
 * Backend-agnostic: the driver owns how entries are read from the log (Redis
 * stream, Durable Object storage list); this owns turning them into rows.
 *
 * 1. Insert every entry into `usageEvent` (history) — concurrent, order-free.
 * 2. Coalesce by (refId, feature) — keep the LAST entry's newTotal.
 * 3. Upsert the `usage` row per coalesced entry with a monotonic guard.
 */
export const applyWalEntries = (db: DbService, logger: LoggerService, entries: WalEntry[]) =>
    Effect.gen(function* () {
        // 1. Insert all events into usageEvent (history)
        yield* Effect.all(
            entries.map((entry) =>
                db.create({
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
                    // Log but DO NOT swallow — a failed history insert must fail the
                    // batch so `drain` skips ACK/trim and the entries are retried
                    // (at-least-once; usageEvent is append-only with no dedup key).
                    Effect.tapError((err) =>
                        Effect.sync(() =>
                            logger.warn("WAL: usage event insert failed — batch will retry", { entry: entry.id, error: err })
                        )
                    )
                )
            ),
            { concurrency: "unbounded" }
        )

        // 2. Coalesce by (refId, feature) — take the LAST entry's newTotal
        const coalesced = new Map<string, WalEntry>()
        for (const entry of entries) {
            coalesced.set(`${entry.refId}:${entry.feature}`, entry)
        }

        // 3. Upsert usage for each coalesced entry — concurrent, independent
        yield* Effect.all(
            Array.from(coalesced.values()).map((entry) => upsertUsageRow(db, entry)),
            { concurrency: "unbounded" }
        )

        return coalesced.size
    })

/**
 * Upsert a single usage row from a WAL entry.
 *
 * Uses the entry's monotonic id (Redis stream id / DO sequence) as a guard —
 * only updates if the incoming id is newer than the last applied one. Prevents
 * stale writes from out-of-order replays or recovery. Ids sort lexicographically.
 */
const upsertUsageRow = (db: DbService, entry: WalEntry) =>
    Effect.gen(function* () {
        const now = new Date()
        const existing = yield* db.findOne<any>({
            model: "usage",
            where: [
                { field: "referenceId", value: entry.refId },
                { field: "feature", value: entry.feature },
            ],
        })

        if (existing) {
            // Monotonic guard: skip if this entry is older than what's applied
            if (existing.walStreamId && existing.walStreamId >= entry.id) {
                return
            }

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
                    walStreamId: entry.id,
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
                    walStreamId: entry.id,
                },
            })
        }
    })
