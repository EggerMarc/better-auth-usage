import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { createTestInstance, signInWithTestUser, createCustomer, shutdownUsage } from "./test-helper";
import { validateConfig } from "../package/config";
import { shouldReset } from "../package/utils";
import type { UsageOptions } from "../package/types";

/**
 * Tests targeting coverage gaps in config.ts, utils.ts, and sync.ts.
 */

describe("config validation edge cases", () => {
    test("rejects feature where key doesn't match object key", () => {
        expect(() => validateConfig({
            features: {
                "api-calls": { key: "wrong-key", maxLimit: 100 },
            },
        })).toThrow("must match the object key");
    });

    test("rejects non-finite maxLimit", () => {
        expect(() => validateConfig({
            features: {
                "api-calls": { key: "api-calls", maxLimit: Infinity },
            },
        })).toThrow("finite non-negative");
    });

    test("rejects negative maxLimit", () => {
        expect(() => validateConfig({
            features: {
                "api-calls": { key: "api-calls", maxLimit: -10 },
            },
        })).toThrow("finite non-negative");
    });

    test("rejects non-finite minLimit", () => {
        expect(() => validateConfig({
            features: {
                "api-calls": { key: "api-calls", minLimit: NaN },
            },
        })).toThrow("finite number");
    });

    test("rejects non-finite resetValue", () => {
        expect(() => validateConfig({
            features: {
                "api-calls": { key: "api-calls", resetValue: Infinity },
            },
        })).toThrow("finite number");
    });

    test("rejects invalid onPlanChange value", () => {
        expect(() => validateConfig({
            features: {
                "api-calls": { key: "api-calls", onPlanChange: "invalid" as any },
            },
        })).toThrow("carry-over");
    });

    test("rejects missing redisUrl when cacheOptions provided", () => {
        expect(() => validateConfig({
            features: { "api-calls": { key: "api-calls" } },
            cacheOptions: { redisUrl: "" },
        })).toThrow("redisUrl");
    });

    test("rejects enableRealtime without port", () => {
        expect(() => validateConfig({
            features: { "api-calls": { key: "api-calls" } },
            cacheOptions: { redisUrl: "redis://localhost:6379", enableRealtime: true },
        })).toThrow("port is required");
    });

    test("rejects invalid drainStrategy", () => {
        expect(() => validateConfig({
            features: { "api-calls": { key: "api-calls" } },
            cacheOptions: {
                redisUrl: "redis://localhost:6379",
                wal: { drainStrategy: "invalid" as any },
            },
        })).toThrow("subscribe");
    });

    test("rejects pollInterval under 100ms", () => {
        expect(() => validateConfig({
            features: { "api-calls": { key: "api-calls" } },
            cacheOptions: {
                redisUrl: "redis://localhost:6379",
                wal: { pollInterval: 50 },
            },
        })).toThrow("100ms");
    });
});

describe("shouldReset — all reset types", () => {
    test("hourly: resets when last reset was 2 hours ago", () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const result = shouldReset(twoHoursAgo, "hourly");
        expect(result.shouldReset).toBe(true);
    });

    test("6-hourly: resets when last reset was 7 hours ago", () => {
        const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
        const result = shouldReset(sevenHoursAgo, "6-hourly");
        expect(result.shouldReset).toBe(true);
    });

    test("weekly: resets when last reset was 8 days ago", () => {
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
        const result = shouldReset(eightDaysAgo, "weekly");
        expect(result.shouldReset).toBe(true);
        expect(result.nextReset!.getUTCDay()).toBe(1); // Monday
    });

    test("quarterly: resets when last reset was 4 months ago", () => {
        const fourMonthsAgo = new Date();
        fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);
        const result = shouldReset(fourMonthsAgo, "quarterly");
        expect(result.shouldReset).toBe(true);
    });

    test("yearly: resets when last reset was last year", () => {
        const lastYear = new Date();
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        const result = shouldReset(lastYear, "yearly");
        expect(result.shouldReset).toBe(true);
    });

    test("6-hourly: does not reset within same block", () => {
        const result = shouldReset(new Date(), "6-hourly");
        expect(result.shouldReset).toBe(false);
    });

    test("weekly: does not reset within same week", () => {
        const result = shouldReset(new Date(), "weekly");
        expect(result.shouldReset).toBe(false);
    });

    test("quarterly: does not reset within same quarter", () => {
        const result = shouldReset(new Date(), "quarterly");
        expect(result.shouldReset).toBe(false);
    });

    test("yearly: does not reset within same year", () => {
        const result = shouldReset(new Date(), "yearly");
        expect(result.shouldReset).toBe(false);
    });
});

describe("sync endpoint — reset behavior", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeEach(async () => {
        await shutdownUsage();
    });
    afterAll(async () => {
        await shutdownUsage();
    });

    test("sync on feature with reset=never returns no reset needed", async () => {
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));
        await createCustomer(instance, headers, "sync-never");

        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "sync-never", featureKey: "credits" },
            headers,
        });

        const res = await instance.client.$fetch("/usage/sync", {
            method: "POST",
            body: { referenceId: "sync-never", featureKey: "credits" },
            headers,
        });

        expect(res.error).toBeNull();
        expect(res.data.reset).toBe(false);
    });

    // Note: sync reset path (lines 55-80 of sync.ts) requires a usage record with
    // lastResetAt before the current reset boundary. This can't be set through the API.
    // The reset path is covered by tests-infra/redis.test.ts (Lua reset test).

    test("sync on monthly feature does not reset when recently created", async () => {
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));
        await createCustomer(instance, headers, "sync-monthly");

        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "sync-monthly", featureKey: "api-calls" },
            headers,
        });

        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: "sync-monthly", featureKey: "api-calls", amount: 25, event: "use" },
            headers,
        });

        const res = await instance.client.$fetch("/usage/sync", {
            method: "POST",
            body: { referenceId: "sync-monthly", featureKey: "api-calls" },
            headers,
        });

        expect(res.error).toBeNull();
        // Should not reset — monthly boundary hasn't been crossed
        expect(res.data.reset).toBe(false);
    });
});
