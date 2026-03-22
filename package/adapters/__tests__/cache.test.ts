import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { UsageCache } from "../cache";
import type { cached_UsageEvent } from "@/types";
import { APIError } from "better-auth";

// Mock Redis
const mockRedis = {
    eval: mock(() => Promise.resolve([100, Date.now()])),
    get: mock(() => Promise.resolve("50")),
    hgetall: mock(() => Promise.resolve({
        lastResetAt: new Date().toISOString(),
        maxLimit: "100",
    })),
    del: mock(() => Promise.resolve(1)),
    quit: mock(() => Promise.resolve("OK")),
    on: mock(() => {}),
};

// Mock ioredis
mock.module("ioredis", () => ({
    default: class Redis {
        constructor() {
            Object.assign(this, mockRedis);
        }
    }
}));

describe("UsageCache", () => {
    let cache: UsageCache;
    const testUrl = "redis://localhost:6379";

    beforeEach(() => {
        cache = new UsageCache({ url: testUrl });
        mockRedis.eval.mockClear();
        mockRedis.get.mockClear();
        mockRedis.hgetall.mockClear();
        mockRedis.del.mockClear();
        mockRedis.quit.mockClear();
    });

    afterEach(async () => {
        await cache.disconnect();
    });

    describe("insertEvent", () => {
        test("should insert usage event and return updated values", async () => {
            const event: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10
            };

            const nowMock = Date.now();
            mockRedis.eval.mockResolvedValueOnce([60, nowMock]);

            const result = await cache.insertEvent(event);

            expect(result).toEqual({
                amount: 10,
                afterValue: 60,
                resetAt: new Date(nowMock)
            });
            expect(mockRedis.eval).toHaveBeenCalledTimes(1);
        });

        test("should handle large usage amounts", async () => {
            const event: cached_UsageEvent = {
                referenceId: "user-456",
                feature: "storage",
                amount: 1000000
            };

            const nowMock = Date.now();
            mockRedis.eval.mockResolvedValueOnce([1000000, nowMock]);

            const result = await cache.insertEvent(event);

            expect(result.afterValue).toBe(1000000);
            expect(result.amount).toBe(1000000);
        });

        test("should handle negative amounts (refunds)", async () => {
            const event: cached_UsageEvent = {
                referenceId: "user-789",
                feature: "credits",
                amount: -50
            };

            const nowMock = Date.now();
            mockRedis.eval.mockResolvedValueOnce([50, nowMock]);

            const result = await cache.insertEvent(event);

            expect(result.amount).toBe(-50);
            expect(result.afterValue).toBe(50);
        });
    });

    describe("getUsage", () => {
        test("should retrieve cached usage successfully", async () => {
            const referenceId = "user-123";
            const feature = { key: "api-calls" };

            mockRedis.get.mockResolvedValueOnce("50");
            mockRedis.hgetall.mockResolvedValueOnce({
                maxLimit: "100",
            });

            const result = await cache.getUsage(referenceId, feature);

            expect(result).not.toBeNull();
            expect(result!.referenceId).toBe(referenceId);
            expect(result!.feature).toBe("api-calls");
            expect(result!.current).toBe(50);
        });

        test("should return null when usage doesn't exist", async () => {
            mockRedis.get.mockResolvedValueOnce(null);

            const result = await cache.getUsage("user-999", { key: "api-calls" });

            expect(result).toBeNull();
        });

        test("should throw INTERNAL_SERVER_ERROR on Redis error", async () => {
            mockRedis.get.mockRejectedValueOnce(new Error("Redis connection failed"));

            await expect(cache.getUsage("user-123", { key: "api-calls" })).rejects.toThrow(APIError);
        });

        test("should parse JSON correctly with all optional fields", async () => {
            mockRedis.get.mockResolvedValueOnce("75");
            mockRedis.hgetall.mockResolvedValueOnce({
                maxLimit: "100",
                minLimit: "10",
                lastResetAt: new Date().toISOString(),
            });

            const result = await cache.getUsage("user-123", { key: "api-calls" });

            expect(result).not.toBeNull();
            expect(result!.minLimit).toBe(10);
            expect(result!.maxLimit).toBe(100);
        });
    });

    describe("clearUsage", () => {
        test("should clear usage successfully", async () => {
            mockRedis.del.mockResolvedValueOnce(1);

            await cache.clearUsage("user-123", "api-calls");
            expect(mockRedis.del).toHaveBeenCalledTimes(1);
        });

        test("should throw NOT_FOUND on deletion error", async () => {
            mockRedis.del.mockRejectedValueOnce(new Error("Deletion failed"));

            await expect(cache.clearUsage("user-123", "api-calls")).rejects.toThrow(APIError);
        });

        test("should handle non-existent keys gracefully", async () => {
            mockRedis.del.mockResolvedValueOnce(0);

            await cache.clearUsage("user-nonexistent", "api-calls");
        });
    });

    describe("resolveKeys", () => {
        test("should generate correct key patterns", () => {
            const result = cache.resolveKeys("user-123", "api-calls");

            expect(result.usageKey).toBe("usage:api-calls:user-123");
            expect(result.limitKey).toBe("limit:api-calls:user-123");
        });

        test("should handle special characters in IDs", () => {
            const result = cache.resolveKeys("user:with:colons", "feature-with-dash");

            expect(result.usageKey).toBe("usage:feature-with-dash:user:with:colons");
            expect(result.limitKey).toBe("limit:feature-with-dash:user:with:colons");
        });

        test("should handle empty strings", () => {
            const result = cache.resolveKeys("", "");

            expect(result.usageKey).toBe("usage::");
            expect(result.limitKey).toBe("limit::");
        });
    });

    describe("resolveUsageKey", () => {
        test("should generate correct usage key format", () => {
            const key = cache.resolveUsageKey("org-456", "storage");

            expect(key).toBe("usage:storage:org-456");
        });

        test("should be consistent with resolveKeys", () => {
            const keys = cache.resolveKeys("user-123", "api-calls");
            const directKey = cache.resolveUsageKey("user-123", "api-calls");

            expect(keys.usageKey).toBe(directKey);
        });
    });

    describe("resolveLimitKey", () => {
        test("should generate correct limit key format", () => {
            const key = cache.resolveLimitKey("org-789", "bandwidth");

            expect(key).toBe("limit:bandwidth:org-789");
        });

        test("should be consistent with resolveKeys", () => {
            const keys = cache.resolveKeys("user-123", "api-calls");
            const directKey = cache.resolveLimitKey("user-123", "api-calls");

            expect(keys.limitKey).toBe(directKey);
        });
    });

    describe("disconnect", () => {
        test("should disconnect from Redis", async () => {
            mockRedis.quit.mockResolvedValueOnce("OK");

            await cache.disconnect();

            expect(mockRedis.quit).toHaveBeenCalledTimes(1);
        });

        test("should handle disconnection errors gracefully", async () => {
            mockRedis.quit.mockRejectedValueOnce(new Error("Already disconnected"));

            await expect(cache.disconnect()).rejects.toThrow();
        });
    });

    describe("EventEmitter functionality", () => {
        test("should extend EventEmitter", () => {
            expect(cache.on).toBeDefined();
            expect(cache.emit).toBeDefined();
            expect(cache.once).toBeDefined();
        });

        test("should allow event subscription", () => {
            const handler = mock(() => {});
            cache.on("test-event", handler);
            cache.emit("test-event", { data: "test" });

            expect(handler).toHaveBeenCalledWith({ data: "test" });
        });
    });
});
