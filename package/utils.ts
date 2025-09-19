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

export function shouldReset(lastReset: Date | null, reset: ResetType): boolean {
    const now = new Date();
    let nextResetTime = new Date(now);

    switch (reset) {
        case "hourly":
            nextResetTime.setHours(nextResetTime.getHours() + 1, 0, 0, 0);
            break;
        case "6-hourly": {
            const hour = now.getHours();
            const nextBlock = Math.floor(hour / 6) * 6 + 6;
            if (nextBlock >= 24) {
                nextResetTime.setDate(nextResetTime.getDate() + 1);
                nextResetTime.setHours(0, 0, 0, 0);
            } else {
                nextResetTime.setHours(nextBlock, 0, 0, 0);
            }
            break;
        }
        case "daily":
            nextResetTime.setDate(nextResetTime.getDate() + 1);
            nextResetTime.setHours(0, 0, 0, 0);
            break;
        case "weekly": {
            const day = nextResetTime.getDay(); // 0 = Sunday
            const daysUntilNextMonday = (8 - day) % 7 || 7;
            nextResetTime.setDate(nextResetTime.getDate() + daysUntilNextMonday);
            nextResetTime.setHours(0, 0, 0, 0);
            break;
        }
        case "monthly":
            nextResetTime.setMonth(nextResetTime.getMonth() + 1, 1);
            nextResetTime.setHours(0, 0, 0, 0);
            break;
        case "quarterly": {
            const currentMonth = nextResetTime.getMonth();
            const nextQuarterStartMonth = Math.floor(currentMonth / 3) * 3 + 3;
            if (nextQuarterStartMonth >= 12) {
                nextResetTime.setFullYear(nextResetTime.getFullYear() + 1);
                nextResetTime.setMonth(0, 1);
            } else {
                nextResetTime.setMonth(nextQuarterStartMonth, 1);
            }
            nextResetTime.setHours(0, 0, 0, 0);
            break;
        }
        case "yearly":
            nextResetTime.setFullYear(nextResetTime.getFullYear() + 1, 0, 1);
            nextResetTime.setHours(0, 0, 0, 0);
            break;
        case "never":
            return false
    }

    return now >= nextResetTime || (lastReset ? lastReset < nextResetTime : true);
}

