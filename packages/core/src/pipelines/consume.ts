import { Effect } from "effect"
import { DriverService, DbService, LoggerService } from "../services"
import { ValidationError } from "../errors"
import type { Feature, Customer } from "../types"
import { getUsage } from "./get-usage"
import { checkLimit, shouldReset } from "../utils"

/**
 * Lift a user-provided callback (sync or async) into an Effect.
 */
const liftCallback = <A>(fn: () => A | Promise<A>): Effect.Effect<A, unknown> =>
    Effect.tryPromise(() => Promise.resolve(fn()))

/**
 * Validate amount — reject Infinity, NaN, unsafe integers.
 */
const validateAmount = (amount: number) =>
    !Number.isFinite(amount)
        ? Effect.fail(new ValidationError({ message: `Invalid amount: ${amount}. Must be a finite number.` }))
        : Effect.succeed(amount)

interface ConsumeParams {
    referenceId: string
    amount: number
    event: string
    feature: Feature
    /** Pre-resolved customer (from the endpoint) — avoids a second lookup. */
    customer: Customer | null
}

interface ConsumeResult {
    allowed: boolean
    current: number
    afterAmount: number
    max: number | undefined
    min: number | undefined
    remaining: number | null
    status: "in-limit" | "above-max-limit" | "below-min-limit"
}

/**
 * Consume usage for a feature.
 *
 * Pipeline:
 *   1. Fetch current usage (customer is pre-resolved by the endpoint)
 *   2. Run before hook (if defined)
 *   3. Atomic increment via the driver (counter + reset + WAL + fan-out)
 *   4. Fallback: write to DB if the driver has no WAL (or the driver failed)
 *   5. Run after hook (if defined)
 *
 * Returns: Effect<ConsumeResult, DriverError | DbError, DriverService | DbService | LoggerService>
 */
export const consumeUsage = ({ referenceId, amount, event, feature, customer }: ConsumeParams) =>
    Effect.gen(function* () {
        yield* validateAmount(amount)

        const driver = yield* DriverService
        const db = yield* DbService
        const logger = yield* LoggerService

        // 1. Before hook — only this needs the pre-consume total, so only then do
        // we pay for a read. Without a before hook we skip getUsage entirely and
        // let driver.consume return the new total (one fewer round-trip).
        let beforeAmount: number | null = null
        let lastResetFromRead: Date | null = null
        if (feature.hooks?.before) {
            const currentUsage = yield* getUsage({ referenceId, feature })
            beforeAmount = currentUsage.amount
            lastResetFromRead = currentUsage.lastResetAt
            yield* liftCallback(() =>
                feature.hooks!.before!({
                    usage: { beforeAmount: beforeAmount!, afterAmount: beforeAmount! + amount, amount },
                    customer,
                    feature,
                })
            )
        }

        // Next reset boundary (from now) — passed to the driver so co-located
        // stores self-prime their meta and apply resets without a prior hydrate.
        const resetAt = feature.reset && feature.reset !== "never"
            ? shouldReset(null, feature.reset).nextReset?.getTime()
            : undefined

        // 2. Atomic increment via the driver. On driver failure, fall back to DB.
        const outcome = yield* driver.consume({
            referenceId,
            feature: feature.key,
            amount,
            nowMs: Date.now(),
            event,
            resetValue: feature.resetValue,
            maxLimit: feature.maxLimit,
            minLimit: feature.minLimit,
            resetAt,
        }).pipe(
            Effect.catchTag("DriverError", (err) => {
                logger.warn("Driver consume failed, falling back to DB", {
                    referenceId,
                    feature: feature.key,
                    error: err,
                })
                return Effect.succeed(null)
            })
        )

        let newTotal: number
        let effectiveLastResetAt: Date

        if (outcome) {
            newTotal = outcome.newTotal
            effectiveLastResetAt = new Date(outcome.lastResetAt)
        } else {
            // Driver failed → DB fallback. Fetch the current total if we don't
            // already have it from a before-hook read.
            const base = beforeAmount ?? (yield* getUsage({ referenceId, feature })).amount
            newTotal = base + amount
            effectiveLastResetAt = lastResetFromRead ?? new Date()
        }

        // 4. Write to DB. When the driver buffers via WAL, the drain worker
        // handles the DB sync; otherwise (no WAL, or driver failed) write here.
        if (outcome && driver.wal) {
            // WAL worker will drain stream → DB. No direct write needed.
        } else {
            const now = new Date()
            yield* writeToDb(db, logger, {
                referenceId,
                feature: feature.key,
                amount,
                newTotal,
                event,
                overrideKey: customer?.overrideKey,
                lastResetAt: effectiveLastResetAt,
                now,
            })
        }

        // 4. After hook (derive beforeAmount from the new total when we skipped
        // the pre-consume read).
        if (feature.hooks?.after) {
            const afterBefore = beforeAmount ?? newTotal - amount
            yield* liftCallback(() =>
                feature.hooks!.after!({
                    usage: { beforeAmount: afterBefore, afterAmount: newTotal, amount },
                    customer,
                    feature,
                })
            ).pipe(
                Effect.catchAll((err) =>
                    Effect.sync(() =>
                        logger.warn("After hook failed", { feature: feature.key, error: err })
                    )
                )
            )
        }

        const status = checkLimit({
            maxLimit: feature.maxLimit,
            minLimit: feature.minLimit,
            value: newTotal,
        })

        return {
            allowed: status === "in-limit",
            current: newTotal,
            afterAmount: newTotal,
            max: feature.maxLimit,
            min: feature.minLimit,
            remaining: feature.maxLimit != null ? feature.maxLimit - newTotal : null,
            status,
        } satisfies ConsumeResult
    })

/**
 * Write to DB: update usage row + append usage_events row.
 * Wrapped in a transaction for atomicity. No redundant findOne —
 * getUsage already ensures the usage row exists.
 *
 * 2 DB calls in 1 transaction instead of 3 sequential calls.
 */
const writeToDb = (
    db: DbService,
    logger: LoggerService,
    params: {
        referenceId: string
        feature: string
        amount: number
        newTotal: number
        event: string
        overrideKey?: string
        lastResetAt: Date
        now: Date
    }
) =>
    db.transaction((tx) =>
        Effect.gen(function* () {
            // 1. Upsert the usage snapshot row. The consume pipeline no longer
            // pre-reads via getUsage (that used to auto-create the row), so create
            // it if missing, otherwise update.
            const existing = yield* tx.findOne<{ referenceId: string }>({
                model: "usage",
                where: [
                    { field: "referenceId", value: params.referenceId },
                    { field: "feature", value: params.feature },
                ],
            })

            if (existing) {
                yield* tx.update({
                    model: "usage",
                    where: [
                        { field: "referenceId", value: params.referenceId },
                        { field: "feature", value: params.feature },
                    ],
                    update: {
                        amount: params.newTotal,
                        event: params.event,
                        lastResetAt: params.lastResetAt,
                        updatedAt: params.now,
                    },
                })
            } else {
                yield* tx.create({
                    model: "usage",
                    data: {
                        referenceId: params.referenceId,
                        feature: params.feature,
                        amount: params.newTotal,
                        event: params.event,
                        lastResetAt: params.lastResetAt,
                        createdAt: params.now,
                        updatedAt: params.now,
                    },
                })
            }

            // 2. Append to usage_events (history)
            yield* tx.create({
                model: "usageEvent",
                data: {
                    referenceId: params.referenceId,
                    feature: params.feature,
                    amount: params.amount,
                    event: params.event,
                    overrideKey: params.overrideKey,
                    lastResetAt: params.lastResetAt,
                    createdAt: params.now,
                },
            })
        })
    )

/**
 * Consume usage and return the result with status.
 *
 * Always consumes — does NOT block on over-limit by default.
 * To enforce limits, use a `before` hook that throws on over-limit.
 * Returns `status` so the caller can decide what to do.
 */
export const useFeature = (params: ConsumeParams) =>
    consumeUsage(params)
