import { createHash } from "crypto";
import type { ConsumptionLimitType, ResetType } from "./types.ts";

// ── Legacy helpers (used by cache.ts, realtime, old query files) ──

type Success<T> = { data: T; error: null };
type Failure<E> = { data: null; error: E };
type Result<T, E = Error> = Success<T> | Failure<E>;

/** @deprecated Use Effect error channel instead. Kept for legacy adapter/cache code. */
export async function tryCatch<T, E = Error>(
    promise: Promise<T>,
): Promise<Result<T, E>> {
    try {
        const data = await promise;
        return { data, error: null };
    } catch (error) {
        return { data: null, error: error as E };
    }
}

/**
 * Return a short, deterministic hash of an identifier for safe logging.
 * Uses SHA-256 truncated to 8 hex chars — enough to correlate log entries
 * without exposing the original value.
 */
export function redactId(id: string): string {
    return createHash("sha256").update(id).digest("hex").slice(0, 8);
}

interface CheckLimitProps {
    maxLimit?: number,
    minLimit?: number,
    value: number
}

export function checkLimit({
    maxLimit,
    minLimit,
    value
}: CheckLimitProps): ConsumptionLimitType {
    if (maxLimit != null && value > maxLimit) return "above-max-limit"
    if (minLimit != null && value < minLimit) return "below-min-limit"
    return "in-limit"
}

export function shouldReset(
    lastReset: Date | null,
    reset: ResetType
): {
    shouldReset: boolean,
    nextReset?: Date
} {
    if (reset === "never") {
        return { shouldReset: false };
    }

    const now = new Date();
    const prevBoundary = computePreviousResetTime(now, reset);
    const nextBoundary = computeNextResetTime(now, reset);

    // Reset is needed if lastReset is before the most recent boundary
    if (!lastReset || lastReset < prevBoundary) {
        return { shouldReset: true, nextReset: nextBoundary };
    }

    return { shouldReset: false, nextReset: nextBoundary };
}

/**
 * Compute the next reset timestamp after a reference date for a given reset interval.
 *
 * @param base - The reference Date from which the next reset is calculated.
 * @param reset - The reset interval: "hourly", "6-hourly", "daily", "weekly", "monthly", "quarterly", "yearly", or "never".
 * @returns The Date of the next reset strictly after `base` for all intervals except `"never"`, which returns `base`.
 */
function computeNextResetTime(base: Date, reset: ResetType): Date {
    const next = new Date(base);

    switch (reset) {
        case "hourly":
            next.setHours(next.getHours() + 1, 0, 0, 0);
            break;
        case "6-hourly": {
            const hour = base.getHours();
            const nextBlock = Math.floor(hour / 6) * 6 + 6;
            if (nextBlock >= 24) {
                next.setDate(next.getDate() + 1);
                next.setHours(0, 0, 0, 0);
            } else {
                next.setHours(nextBlock, 0, 0, 0);
            }
            break;
        }
        case "daily":
            next.setDate(next.getDate() + 1);
            next.setHours(0, 0, 0, 0);
            break;
        case "weekly": {
            const day = base.getDay(); // 0 = Sunday
            const daysUntilNextMonday = (8 - day) % 7 || 7;
            next.setDate(next.getDate() + daysUntilNextMonday);
            next.setHours(0, 0, 0, 0);
            break;
        }
        case "monthly":
            next.setMonth(next.getMonth() + 1, 1);
            next.setHours(0, 0, 0, 0);
            break;
        case "quarterly": {
            const currentMonth = base.getMonth();
            const nextQuarterStartMonth = Math.floor(currentMonth / 3) * 3 + 3;
            if (nextQuarterStartMonth >= 12) {
                next.setFullYear(next.getFullYear() + 1);
                next.setMonth(0, 1);
            } else {
                next.setMonth(nextQuarterStartMonth, 1);
            }
            next.setHours(0, 0, 0, 0);
            break;
        }
        case "yearly":
            next.setFullYear(next.getFullYear() + 1, 0, 1);
            next.setHours(0, 0, 0, 0);
            break;
        case "never":
            return base; // "never" just returns the base (ignored in main fn)
    }

    return next;
}

/**
 * Compute the most recent reset boundary at or before a reference date.
 *
 * For "daily" at Tuesday 10am, returns Tuesday 00:00 (midnight today).
 * For "monthly" on March 15th, returns March 1st 00:00.
 */
function computePreviousResetTime(ref: Date, reset: ResetType): Date {
    const d = new Date(ref);

    switch (reset) {
        case "hourly":
            d.setMinutes(0, 0, 0);
            return d;
        case "6-hourly":
            d.setHours(Math.floor(d.getHours() / 6) * 6, 0, 0, 0);
            return d;
        case "daily":
            d.setHours(0, 0, 0, 0);
            return d;
        case "weekly": {
            const day = d.getDay(); // 0 = Sunday
            const diff = day === 0 ? 6 : day - 1; // Monday = start of week
            d.setDate(d.getDate() - diff);
            d.setHours(0, 0, 0, 0);
            return d;
        }
        case "monthly":
            d.setDate(1);
            d.setHours(0, 0, 0, 0);
            return d;
        case "quarterly":
            d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
            d.setHours(0, 0, 0, 0);
            return d;
        case "yearly":
            d.setMonth(0, 1);
            d.setHours(0, 0, 0, 0);
            return d;
        case "never":
            return ref;
    }
}


