import { createHash } from "crypto";
import type { ConsumptionLimitType, ResetType } from "./types.ts";


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
 * Compute the next reset timestamp (UTC) after a reference date.
 * All boundaries are computed in UTC to ensure consistent behavior across timezones.
 */
function computeNextResetTime(base: Date, reset: ResetType): Date {
    const next = new Date(base);

    switch (reset) {
        case "hourly":
            next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0);
            break;
        case "6-hourly": {
            const hour = base.getUTCHours();
            const nextBlock = Math.floor(hour / 6) * 6 + 6;
            if (nextBlock >= 24) {
                next.setUTCDate(next.getUTCDate() + 1);
                next.setUTCHours(0, 0, 0, 0);
            } else {
                next.setUTCHours(nextBlock, 0, 0, 0);
            }
            break;
        }
        case "daily":
            next.setUTCDate(next.getUTCDate() + 1);
            next.setUTCHours(0, 0, 0, 0);
            break;
        case "weekly": {
            const day = base.getUTCDay(); // 0 = Sunday
            const daysUntilNextMonday = (8 - day) % 7 || 7;
            next.setUTCDate(next.getUTCDate() + daysUntilNextMonday);
            next.setUTCHours(0, 0, 0, 0);
            break;
        }
        case "monthly":
            next.setUTCMonth(next.getUTCMonth() + 1, 1);
            next.setUTCHours(0, 0, 0, 0);
            break;
        case "quarterly": {
            const currentMonth = base.getUTCMonth();
            const nextQuarterStartMonth = Math.floor(currentMonth / 3) * 3 + 3;
            if (nextQuarterStartMonth >= 12) {
                next.setUTCFullYear(next.getUTCFullYear() + 1);
                next.setUTCMonth(0, 1);
            } else {
                next.setUTCMonth(nextQuarterStartMonth, 1);
            }
            next.setUTCHours(0, 0, 0, 0);
            break;
        }
        case "yearly":
            next.setUTCFullYear(next.getUTCFullYear() + 1, 0, 1);
            next.setUTCHours(0, 0, 0, 0);
            break;
        case "never":
            return base;
    }

    return next;
}

/**
 * Compute the most recent reset boundary (UTC) at or before a reference date.
 *
 * For "daily" at Tuesday 10am UTC, returns Tuesday 00:00 UTC.
 * For "monthly" on March 15th, returns March 1st 00:00 UTC.
 */
function computePreviousResetTime(ref: Date, reset: ResetType): Date {
    const d = new Date(ref);

    switch (reset) {
        case "hourly":
            d.setUTCMinutes(0, 0, 0);
            return d;
        case "6-hourly":
            d.setUTCHours(Math.floor(d.getUTCHours() / 6) * 6, 0, 0, 0);
            return d;
        case "daily":
            d.setUTCHours(0, 0, 0, 0);
            return d;
        case "weekly": {
            const day = d.getUTCDay(); // 0 = Sunday
            const diff = day === 0 ? 6 : day - 1; // Monday = start of week
            d.setUTCDate(d.getUTCDate() - diff);
            d.setUTCHours(0, 0, 0, 0);
            return d;
        }
        case "monthly":
            d.setUTCDate(1);
            d.setUTCHours(0, 0, 0, 0);
            return d;
        case "quarterly":
            d.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3, 1);
            d.setUTCHours(0, 0, 0, 0);
            return d;
        case "yearly":
            d.setUTCMonth(0, 1);
            d.setUTCHours(0, 0, 0, 0);
            return d;
        case "never":
            return ref;
    }
}


