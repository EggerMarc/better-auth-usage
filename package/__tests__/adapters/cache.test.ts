import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { UsageCache } from "@/adapters/cache";
import { APIError } from "better-auth";
import Redis from "ioredis";

// Mock Redis
mock.module("ioredis", () => {
  return {
    default: class MockRedis {
      private store = new Map<string, string>();
      
      constructor(public url?: string) {}
      
      async eval(...args: any[]): Promise<any> {
        return [100, Date.now()];
      }
      
      async get(key: string): Promise<string | null> {
        return this.store.get(key) || null;
      }
      
      async del(key: string): Promise<number> {
        const existed = this.store.has(key);
        this.store.delete(key);
        return existed ? 1 : 0;
      }
      
      async quit(): Promise<void> {}
      
      setMockData(key: string, value: string) {
        this.store.set(key, value);
      }
      
      clearMockData() {
        this.store.clear();
      }
    }
  };
});

describe("UsageCache", () => {
  let cache: UsageCache;
  const testUrl = "redis://localhost:6379";

  beforeEach(() => {
    cache = new UsageCache({ url: testUrl });
  });

  afterEach(async () => {
    await cache.disconnect();
  });

  describe("constructor", () => {
    it("should create instance with valid URL", () => {
      expect(cache).toBeDefined();
      expect(cache).toBeInstanceOf(UsageCache);
    });

    it("should throw error with invalid URL", () => {
      expect(() => new UsageCache({ url: "not-a-url" })).toThrow();
    });
  });

  describe("insertEvent", () => {
    it("should insert usage event successfully", async () => {
      const event = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 10
      };

      const result = await cache.insertEvent(event);

      expect(result).toBeDefined();
      expect(result.amount).toBe(10);
      expect(result.afterValue).toBe(100);
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it("should handle negative amounts", async () => {
      const event = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: -5
      };

      const result = await cache.insertEvent(event);
      expect(result.amount).toBe(-5);
    });

    it("should handle zero amount", async () => {
      const event = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 0
      };

      const result = await cache.insertEvent(event);
      expect(result.amount).toBe(0);
    });

    it("should handle large amounts", async () => {
      const event = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 999999
      };

      const result = await cache.insertEvent(event);
      expect(result.amount).toBe(999999);
    });
  });

  describe("getUsage", () => {
    it("should retrieve cached usage successfully", async () => {
      const mockUsage = {
        referenceId: "user-123",
        feature: "api-calls",
        current: 50,
        lastResetAt: new Date(),
        updatedAt: new Date()
      };

      // Set mock data
      const redis = (cache as any).cache;
      redis.setMockData("usage:api-calls:user-123", JSON.stringify(mockUsage));

      const result = await cache.getUsage("user-123", "api-calls");
      expect(result).toBeDefined();
    });

    it("should throw APIError when cache data not found", async () => {
      await expect(
        cache.getUsage("nonexistent", "api-calls")
      ).rejects.toThrow(APIError);
    });

    it("should throw INTERNAL_SERVER_ERROR on Redis failure", async () => {
      const redis = (cache as any).cache;
      redis.get = async () => { throw new Error("Redis connection failed"); };

      await expect(
        cache.getUsage("user-123", "api-calls")
      ).rejects.toThrow(APIError);
    });

    it("should handle special characters in referenceId", async () => {
      const mockUsage = {
        referenceId: "user@test.com",
        feature: "api-calls",
        current: 10
      };

      const redis = (cache as any).cache;
      redis.setMockData("usage:api-calls:user@test.com", JSON.stringify(mockUsage));

      const result = await cache.getUsage("user@test.com", "api-calls");
      expect(result).toBeDefined();
    });
  });

  describe("clearUsage", () => {
    it("should clear cached usage successfully", async () => {
      await expect(
        cache.clearUsage("user-123", "api-calls")
      ).resolves.not.toThrow();
    });

    it("should handle clearing non-existent usage", async () => {
      await expect(
        cache.clearUsage("nonexistent", "api-calls")
      ).resolves.not.toThrow();
    });

    it("should throw APIError on Redis failure", async () => {
      const redis = (cache as any).cache;
      redis.del = async () => { throw new Error("Redis error"); };

      await expect(
        cache.clearUsage("user-123", "api-calls")
      ).rejects.toThrow(APIError);
    });
  });

  describe("resolveKeys", () => {
    it("should resolve usage and limit keys correctly", () => {
      const keys = cache.resolveKeys("user-123", "api-calls");
      
      expect(keys.usageKey).toBe("usage:api-calls:user-123");
      expect(keys.limitKey).toBe("limit:api-calls:user-123");
    });

    it("should handle empty strings", () => {
      const keys = cache.resolveKeys("", "");
      expect(keys.usageKey).toBe("usage::");
      expect(keys.limitKey).toBe("limit::");
    });

    it("should handle special characters", () => {
      const keys = cache.resolveKeys("user:123", "api-calls:v2");
      expect(keys.usageKey).toBe("usage:api-calls:v2:user:123");
      expect(keys.limitKey).toBe("limit:api-calls:v2:user:123");
    });
  });

  describe("resolveUsageKey", () => {
    it("should create correct usage key format", () => {
      const key = cache.resolveUsageKey("user-123", "api-calls");
      expect(key).toBe("usage:api-calls:user-123");
    });

    it("should be consistent with multiple calls", () => {
      const key1 = cache.resolveUsageKey("user-123", "api-calls");
      const key2 = cache.resolveUsageKey("user-123", "api-calls");
      expect(key1).toBe(key2);
    });
  });

  describe("resolveLimitKey", () => {
    it("should create correct limit key format", () => {
      const key = cache.resolveLimitKey("user-123", "api-calls");
      expect(key).toBe("limit:api-calls:user-123");
    });

    it("should differ from usage key", () => {
      const usageKey = cache.resolveUsageKey("user-123", "api-calls");
      const limitKey = cache.resolveLimitKey("user-123", "api-calls");
      expect(usageKey).not.toBe(limitKey);
    });
  });

  describe("disconnect", () => {
    it("should disconnect Redis client successfully", async () => {
      await expect(cache.disconnect()).resolves.not.toThrow();
    });

    it("should handle multiple disconnect calls", async () => {
      await cache.disconnect();
      await expect(cache.disconnect()).resolves.not.toThrow();
    });
  });
});