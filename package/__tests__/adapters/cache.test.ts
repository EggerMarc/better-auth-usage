import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { UsageCache } from "../../adapters/cache";
import type { cached_UsageEvent } from "../../types";

// Mock Redis to avoid actual Redis connections in tests
const mockRedis = {
  eval: mock(() => Promise.resolve([100, Date.now()])),
  get: mock(() => Promise.resolve(JSON.stringify({
    referenceId: "ref-123",
    lastResetAt: new Date(),
    updatedAt: new Date(),
    feature: "api-calls",
    current: 50,
    maxLimit: 100,
    minLimit: 0,
  }))),
  del: mock(() => Promise.resolve(1)),
  quit: mock(() => Promise.resolve("OK")),
};

// Mock ioredis module
mock.module("ioredis", () => {
  return {
    default: class Redis {
      constructor() {
        Object.assign(this, mockRedis);
      }
    }
  };
});

describe("UsageCache", () => {
  let cache: UsageCache;

  beforeEach(() => {
    cache = new UsageCache({ url: "redis://localhost:6379" });
    mockRedis.eval.mockClear();
    mockRedis.get.mockClear();
    mockRedis.del.mockClear();
  });

  afterEach(async () => {
    await cache.disconnect();
  });

  describe("constructor", () => {
    test("creates instance with valid Redis URL", () => {
      const instance = new UsageCache({ url: "redis://localhost:6379" });
      expect(instance).toBeInstanceOf(UsageCache);
    });

    test("extends EventEmitter", () => {
      expect(cache.on).toBeDefined();
      expect(cache.emit).toBeDefined();
      expect(cache.removeListener).toBeDefined();
    });
  });

  describe("insertEvent", () => {
    test("inserts event and returns updated usage data", async () => {
      const event: cached_UsageEvent = {
        referenceId: "ref-123",
        feature: "api-calls",
        amount: 5,
      };

      const result = await cache.insertEvent(event);

      expect(result).toHaveProperty("amount");
      expect(result).toHaveProperty("afterValue");
      expect(result).toHaveProperty("resetAt");
      expect(result.amount).toBe(5);
      expect(result.afterValue).toBe(100);
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    test("calls Redis eval with correct parameters", async () => {
      const event: cached_UsageEvent = {
        referenceId: "ref-123",
        feature: "api-calls",
        amount: 10,
      };

      await cache.insertEvent(event);

      expect(mockRedis.eval).toHaveBeenCalled();
      const callArgs = mockRedis.eval.mock.calls[0];
      expect(callArgs[0]).toBeDefined(); // Lua script
      expect(callArgs[1]).toBe(2); // Number of keys
    });

    test("handles zero amount", async () => {
      const event: cached_UsageEvent = {
        referenceId: "ref-123",
        feature: "api-calls",
        amount: 0,
      };

      const result = await cache.insertEvent(event);

      expect(result.amount).toBe(0);
      expect(result.afterValue).toBeDefined();
    });

    test("handles negative amount", async () => {
      const event: cached_UsageEvent = {
        referenceId: "ref-123",
        feature: "api-calls",
        amount: -5,
      };

      const result = await cache.insertEvent(event);

      expect(result.amount).toBe(-5);
    });
  });

  describe("getUsage", () => {
    test("retrieves usage data for valid key", async () => {
      const usage = await cache.getUsage("ref-123", "api-calls");

      expect(usage).toBeDefined();
      expect(usage.referenceId).toBe("ref-123");
      expect(usage.feature).toBe("api-calls");
      expect(usage.current).toBeDefined();
    });

    test("throws APIError when cache get fails", async () => {
      mockRedis.get.mockRejectedValueOnce(new Error("Redis connection error"));

      await expect(cache.getUsage("ref-123", "api-calls"))
        .rejects.toThrow("INTERNAL_SERVER_ERROR");
    });

    test("throws APIError when data is not found", async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      await expect(cache.getUsage("ref-123", "api-calls"))
        .rejects.toThrow("NOT_FOUND");
    });

    test("parses JSON response correctly", async () => {
      const mockData = {
        referenceId: "ref-456",
        feature: "storage",
        current: 250,
        maxLimit: 1000,
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockData));

      const usage = await cache.getUsage("ref-456", "storage");

      expect(usage.referenceId).toBe("ref-456");
      expect(usage.feature).toBe("storage");
      expect(usage.current).toBe(250);
    });
  });

  describe("clearUsage", () => {
    test("successfully clears usage for valid key", async () => {
      await expect(cache.clearUsage("ref-123", "api-calls"))
        .resolves.toBeUndefined();

      expect(mockRedis.del).toHaveBeenCalled();
    });

    test("throws APIError when deletion fails", async () => {
      mockRedis.del.mockRejectedValueOnce(new Error("Deletion failed"));

      await expect(cache.clearUsage("ref-123", "api-calls"))
        .rejects.toThrow("NOT_FOUND");
    });

    test("constructs correct usage key for deletion", async () => {
      await cache.clearUsage("ref-789", "storage");

      const usageKey = cache.resolveUsageKey("ref-789", "storage");
      expect(usageKey).toBe("usage:storage:ref-789");
    });
  });

  describe("resolveKeys", () => {
    test("returns both usage and limit keys", () => {
      const keys = cache.resolveKeys("ref-123", "api-calls");

      expect(keys).toHaveProperty("usageKey");
      expect(keys).toHaveProperty("limitKey");
    });

    test("generates correct usage key format", () => {
      const keys = cache.resolveKeys("ref-123", "api-calls");

      expect(keys.usageKey).toBe("usage:api-calls:ref-123");
    });

    test("generates correct limit key format", () => {
      const keys = cache.resolveKeys("ref-123", "api-calls");

      expect(keys.limitKey).toBe("limit:api-calls:ref-123");
    });

    test("handles special characters in keys", () => {
      const keys = cache.resolveKeys("ref:123:abc", "api-calls:v2");

      expect(keys.usageKey).toContain("ref:123:abc");
      expect(keys.limitKey).toContain("api-calls:v2");
    });
  });

  describe("resolveUsageKey", () => {
    test("constructs usage key with correct format", () => {
      const key = cache.resolveUsageKey("ref-123", "api-calls");

      expect(key).toBe("usage:api-calls:ref-123");
    });

    test("maintains order: feature before referenceId", () => {
      const key = cache.resolveUsageKey("user-456", "storage");

      expect(key).toBe("usage:storage:user-456");
    });
  });

  describe("resolveLimitKey", () => {
    test("constructs limit key with correct format", () => {
      const key = cache.resolveLimitKey("ref-123", "api-calls");

      expect(key).toBe("limit:api-calls:ref-123");
    });

    test("differentiates from usage key", () => {
      const usageKey = cache.resolveUsageKey("ref-123", "api-calls");
      const limitKey = cache.resolveLimitKey("ref-123", "api-calls");

      expect(usageKey).not.toBe(limitKey);
      expect(limitKey.startsWith("limit:")).toBe(true);
      expect(usageKey.startsWith("usage:")).toBe(true);
    });
  });

  describe("disconnect", () => {
    test("successfully disconnects from Redis", async () => {
      await expect(cache.disconnect()).resolves.toBeUndefined();
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});