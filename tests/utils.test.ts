import { describe, test, expect } from "bun:test";
import { checkLimit, shouldReset, tryCatch, normalizeData } from "../package/utils";

describe("checkLimit", () => {
    test("returns in-limit when value is within bounds", () => {
        expect(checkLimit({ maxLimit: 100, minLimit: 0, value: 50 })).toBe("in-limit");
    });

    test("returns above-max-limit when value exceeds maxLimit", () => {
        expect(checkLimit({ maxLimit: 100, minLimit: 0, value: 101 })).toBe("above-max-limit");
    });

    test("returns below-min-limit when value is below minLimit", () => {
        expect(checkLimit({ maxLimit: 100, minLimit: 10, value: 5 })).toBe("below-min-limit");
    });

    test("returns in-limit at exact maxLimit boundary", () => {
        expect(checkLimit({ maxLimit: 100, minLimit: 0, value: 100 })).toBe("in-limit");
    });

    test("returns in-limit when no limits are set", () => {
        expect(checkLimit({ value: 9999 })).toBe("in-limit");
    });

    test("returns in-limit when only maxLimit is set and value is under", () => {
        expect(checkLimit({ maxLimit: 50, value: 25 })).toBe("in-limit");
    });
});

describe("shouldReset", () => {
    test('returns shouldReset: false for reset type "never"', () => {
        const result = shouldReset(new Date(), "never");
        expect(result.shouldReset).toBe(false);
        expect(result.nextReset).toBeUndefined();
    });

    test("returns shouldReset: true when lastReset is null", () => {
        const result = shouldReset(null, "daily");
        expect(result.shouldReset).toBe(true);
        expect(result.nextReset).toBeInstanceOf(Date);
    });

    test("returns shouldReset: true when lastReset is old (daily)", () => {
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        const result = shouldReset(twoDaysAgo, "daily");
        expect(result.shouldReset).toBe(true);
    });

    test("returns shouldReset: false when recently reset (daily)", () => {
        // Set lastReset to the start of the current day's reset window
        // For daily reset, nextReset is tomorrow at 00:00
        // If lastReset is after tomorrow 00:00 minus 1 day (today 00:00), then no reset
        const now = new Date();
        const futureReset = new Date(now);
        futureReset.setDate(futureReset.getDate() + 1);
        futureReset.setHours(0, 0, 0, 0);

        // lastReset is in the future (after the next reset boundary) means no reset
        const result = shouldReset(futureReset, "daily");
        expect(result.shouldReset).toBe(false);
    });

    test("returns shouldReset: true for monthly when last reset was last month", () => {
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        lastMonth.setDate(1);
        const result = shouldReset(lastMonth, "monthly");
        expect(result.shouldReset).toBe(true);
    });

    test("returns correct nextReset for hourly", () => {
        const result = shouldReset(null, "hourly");
        expect(result.shouldReset).toBe(true);
        expect(result.nextReset!.getMinutes()).toBe(0);
        expect(result.nextReset!.getSeconds()).toBe(0);
    });

    test("returns correct nextReset for weekly (next Monday)", () => {
        const result = shouldReset(null, "weekly");
        expect(result.shouldReset).toBe(true);
        // nextReset should be a Monday (day 1)
        expect(result.nextReset!.getDay()).toBe(1);
    });
});

describe("tryCatch", () => {
    test("returns data on success", async () => {
        const result = await tryCatch(Promise.resolve("hello"));
        expect(result.data).toBe("hello");
        expect(result.error).toBeNull();
    });

    test("returns error on failure", async () => {
        const result = await tryCatch(Promise.reject(new Error("fail")));
        expect(result.data).toBeNull();
        expect(result.error).toBeInstanceOf(Error);
        expect((result.error as Error).message).toBe("fail");
    });
});

describe("normalizeData", () => {
    test('normalizes cache data to Usage shape', () => {
        const now = new Date();
        const cacheData = {
            referenceId: "ref-1",
            feature: "api-calls",
            current: 42,
            lastResetAt: now,
        };
        const result = normalizeData(cacheData, "cache");
        expect(result.referenceId).toBe("ref-1");
        expect(result.feature).toBe("api-calls");
        expect(result.amount).toBe(42);
        expect(result.lastResetAt).toBe(now);
    });

    test('passes through db data unchanged', () => {
        const now = new Date();
        const dbData = {
            referenceId: "ref-1",
            feature: "api-calls",
            amount: 42,
            event: "use",
            createdAt: now,
            lastResetAt: now,
        };
        const result = normalizeData(dbData, "db");
        expect(result).toEqual(dbData);
    });
});
