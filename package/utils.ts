import { createHash } from "crypto";
import type { cached_Usage, ConsumptionLimitType, ResetType, Usage } from "./types.ts";

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
    if (maxLimit && value > maxLimit) return "above-max-limit"
    if (minLimit && value < minLimit) return "below-min-limit"
    return "in-limit"
}

export function shouldReset(
    lastReset: Date | null,
    reset: ResetType
): {
    shouldReset: boolean,
    nextReset?: Date
} {

    const now = new Date();
    if (reset === "never") {
        return { shouldReset: false, }
    }
    let nextResetTime = computeNextResetTime(now, reset);
    while (nextResetTime <= now) {
        nextResetTime = computeNextResetTime(nextResetTime, reset);
    }
    if (!lastReset || lastReset < nextResetTime) {
        return { shouldReset: true, nextReset: nextResetTime };
    }
    return { shouldReset: false, nextReset: nextResetTime };
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


type Success<T> = {
    data: T;
    error: null;
};

type Failure<E> = {
    data: null;
    error: E;
};

type Result<T, E = Error> = Success<T> | Failure<E>;

/**
 * Normalizes an operation's outcome into a Result object indicating success or failure.
 *
 * @returns A `Result` where on success `data` is the resolved value and `error` is `null`, and on failure `data` is `null` and `error` contains the thrown error.
 */
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
 * Convert data from a storage-specific shape into the canonical `Usage` shape.
 *
 * When `source` is `"cache"`, the function maps a `cached_Usage` record into a `Usage` object.
 * When `source` is `"db"`, the function returns the supplied `Usage` value unchanged.
 *
 * @param data - Input record: a `cached_Usage` when `source` is `"cache"`, or a `Usage` when `source` is `"db"`.
 * @param source - The origin of `data`, either `"cache"` or `"db"`.
 * @returns A `Usage` object normalized to the canonical shape.
 */
export function normalizeData<
    TSource extends "cache" | "db"
>(
    data: TSource extends "cache" ? cached_Usage : Usage,
    source: TSource
): Usage {
    if (source === "cache") {
        const d = (data as cached_Usage)

        return {
            referenceId: d.referenceId,
            feature: d.feature,
            amount: d.current,
            event: "cache",
            createdAt: d.updatedAt,
            lastResetAt: d.lastResetAt
        } as Usage
    }

    return data as Usage
}