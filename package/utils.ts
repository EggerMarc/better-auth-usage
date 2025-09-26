import type { ConsumptionLimitType, ResetType } from "./types.ts";

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

