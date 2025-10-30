import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { UsageCache } from "../../adapters/cache";
import type { cached_UsageEvent } from "../../types";

describe("UsageCache", () => {
  describe("constructor", () => {
    test("should create instance with valid URL", () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      expect(cache).toBeInstanceOf(UsageCache);
    });

    test("should extend EventEmitter", () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      expect(typeof cache.on).toBe("function");
      expect(typeof cache.emit).toBe("function");
    });
  });

  describe("resolveKeys", () => {
    test("should generate correct usage key", () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      const usageKey = cache.resolveUsageKey("user-123", "api-calls");
      expect(usageKey).toBe("usage:api-calls:user-123");
    });

    test("should generate correct limit key", () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      const limitKey = cache.resolveLimitKey("user-123", "api-calls");
      expect(limitKey).toBe("limit:api-calls:user-123");
    });

    test("should generate both keys correctly", () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      const keys = cache.resolveKeys("org-456", "storage");
      expect(keys.usageKey).toBe("usage:storage:org-456");
      expect(keys.limitKey).toBe("limit:storage:org-456");
    });

    test("should handle special characters in IDs", () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      const keys = cache.resolveKeys("user:123:sub", "feature-a");
      expect(keys.usageKey).toBe("usage:feature-a:user:123:sub");
      expect(keys.limitKey).toBe("limit:feature-a:user:123:sub");
    });

    test("should handle empty strings", () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      const keys = cache.resolveKeys("", "");
      expect(keys.usageKey).toBe("usage::");
      expect(keys.limitKey).toBe("limit::");
    });

    test("should handle unicode characters", () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      const keys = cache.resolveKeys("用户-123", "功能-1");
      expect(keys.usageKey).toBe("usage:功能-1:用户-123");
      expect(keys.limitKey).toBe("limit:功能-1:用户-123");
    });
  });

  describe("insertEvent", () => {
    test("should return correct structure on success", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      // Mock the Redis eval method
      const mockEval = mock(async () => [100, Date.now() + 3600000]);
      (cache as any).cache.eval = mockEval;

      const event: cached_UsageEvent = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 5
      };

      const result = await cache.insertEvent(event);
      
      expect(result.amount).toBe(5);
      expect(result.afterValue).toBe(100);
      expect(result.resetAt).toBeInstanceOf(Date);
      expect(mockEval).toHaveBeenCalledTimes(1);
    });

    test("should handle zero amount", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      const mockEval = mock(async () => [50, Date.now()]);
      (cache as any).cache.eval = mockEval;

      const event: cached_UsageEvent = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 0
      };

      const result = await cache.insertEvent(event);
      expect(result.amount).toBe(0);
      expect(result.afterValue).toBe(50);
    });

    test("should handle negative amount", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      const mockEval = mock(async () => [45, Date.now()]);
      (cache as any).cache.eval = mockEval;

      const event: cached_UsageEvent = {
        referenceId: "user-123",
        feature: "credits",
        amount: -5
      };

      const result = await cache.insertEvent(event);
      expect(result.amount).toBe(-5);
      expect(result.afterValue).toBe(45);
    });

    test("should pass correct parameters to Redis eval", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      const mockEval = mock(async (...args: any[]) => {
        // Verify arguments passed to eval
        expect(args[1]).toBe(2); // number of keys
        expect(args[2]).toBe("usage:api-calls:user-123"); // usage key
        expect(args[3]).toBe("limit:api-calls:user-123"); // limit key
        expect(args[4]).toBe(10); // amount
        return [60, Date.now()];
      });
      (cache as any).cache.eval = mockEval;

      const event: cached_UsageEvent = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 10
      };

      await cache.insertEvent(event);
      expect(mockEval).toHaveBeenCalled();
    });
  });

  describe("getUsage", () => {
    test("should parse and return cached usage", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      const mockUsage = {
        referenceId: "user-123",
        feature: "api-calls",
        current: 50,
        lastResetAt: new Date(),
        updatedAt: new Date()
      };
      
      const mockGet = mock(async () => JSON.stringify(mockUsage));
      (cache as any).cache.get = mockGet;

      const result = await cache.getUsage("user-123", "api-calls");
      
      expect(result.referenceId).toBe("user-123");
      expect(result.feature).toBe("api-calls");
      expect(result.current).toBe(50);
      expect(mockGet).toHaveBeenCalledWith("usage:api-calls:user-123");
    });

    test("should throw APIError when usage not found", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      const mockGet = mock(async () => null);
      (cache as any).cache.get = mockGet;

      await expect(
        cache.getUsage("user-123", "api-calls")
      ).rejects.toThrow();
    });

    test("should throw APIError on Redis error", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      const mockGet = mock(async () => {
        throw new Error("Redis connection error");
      });
      (cache as any).cache.get = mockGet;

      await expect(
        cache.getUsage("user-123", "api-calls")
      ).rejects.toThrow();
    });

    test("should handle malformed JSON gracefully", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      const mockGet = mock(async () => "invalid json{");
      (cache as any).cache.get = mockGet;

      await expect(
        cache.getUsage("user-123", "api-calls")
      ).rejects.toThrow();
    });
  });

  describe("clearUsage", () => {
    test("should delete usage key successfully", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      const mockDel = mock(async () => 1);
      (cache as any).cache.del = mockDel;

      await cache.clearUsage("user-123", "api-calls");
      expect(mockDel).toHaveBeenCalledWith("usage:api-calls:user-123");
    });

    test("should throw APIError on deletion failure", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      const mockDel = mock(async () => {
        throw new Error("Deletion failed");
      });
      (cache as any).cache.del = mockDel;

      await expect(
        cache.clearUsage("user-123", "api-calls")
      ).rejects.toThrow();
    });

    test("should handle multiple feature clears", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      const mockDel = mock(async () => 1);
      (cache as any).cache.del = mockDel;

      await cache.clearUsage("user-123", "feature-1");
      await cache.clearUsage("user-123", "feature-2");
      await cache.clearUsage("user-123", "feature-3");

      expect(mockDel).toHaveBeenCalledTimes(3);
    });
  });

  describe("disconnect", () => {
    test("should call quit on Redis client", async () => {
      const cache = new UsageCache({ url: "redis://localhost:6379" });
      
      const mockQuit = mock(async () => "OK");
      (cache as any).cache.quit = mockQuit;

      await cache.disconnect();
      expect(mockQuit).toHaveBeenCalledTimes(1);
    });
  });
});