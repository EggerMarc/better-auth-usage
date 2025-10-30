import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { UsageCache } from "../../adapters/cache";
import { APIError } from "better-auth";

// Mock Redis
class MockRedis {
  private data: Map<string, any> = new Map();
  
  async get(key: string) {
    return this.data.get(key) || null;
  }
  
  async set(key: string, value: any) {
    this.data.set(key, value);
  }
  
  async eval(...args: any[]) {
    // Mock eval response for increment script
    const newAmount = 100;
    const resetAt = Date.now() + 86400000;
    return [newAmount, resetAt];
  }
  
  async quit() {
    return "OK";
  }
  
  clear() {
    this.data.clear();
  }
}

describe("UsageCache", () => {
  let cache: UsageCache;
  let mockRedis: MockRedis;

  beforeEach(() => {
    mockRedis = new MockRedis();
    // Note: In real tests, you'd use a test Redis instance or redis-mock
    cache = new UsageCache({ url: "redis://localhost:6379" });
  });

  afterEach(async () => {
    await cache.disconnect();
  });

  describe("resolveKeys", () => {
    test("should generate correct usage and limit keys", () => {
      const keys = cache.resolveKeys("user-123", "api-calls");
      
      expect(keys.usageKey).toBe("usage:api-calls:user-123");
      expect(keys.limitKey).toBe("limit:api-calls:user-123");
    });

    test("should handle different reference IDs", () => {
      const keys1 = cache.resolveKeys("org-456", "storage");
      const keys2 = cache.resolveKeys("org-789", "storage");
      
      expect(keys1.usageKey).not.toBe(keys2.usageKey);
      expect(keys1.usageKey).toBe("usage:storage:org-456");
      expect(keys2.usageKey).toBe("usage:storage:org-789");
    });

    test("should handle special characters in IDs", () => {
      const keys = cache.resolveKeys("user:123:abc", "feature-name");
      
      expect(keys.usageKey).toBe("usage:feature-name:user:123:abc");
    });
  });

  describe("resolveUsageKey", () => {
    test("should generate correct usage key format", () => {
      const key = cache.resolveUsageKey("customer-1", "bandwidth");
      
      expect(key).toBe("usage:bandwidth:customer-1");
    });

    test("should be consistent across multiple calls", () => {
      const key1 = cache.resolveUsageKey("customer-1", "bandwidth");
      const key2 = cache.resolveUsageKey("customer-1", "bandwidth");
      
      expect(key1).toBe(key2);
    });
  });

  describe("resolveLimitKey", () => {
    test("should generate correct limit key format", () => {
      const key = cache.resolveLimitKey("customer-1", "bandwidth");
      
      expect(key).toBe("limit:bandwidth:customer-1");
    });

    test("should differentiate from usage key", () => {
      const usageKey = cache.resolveUsageKey("customer-1", "bandwidth");
      const limitKey = cache.resolveLimitKey("customer-1", "bandwidth");
      
      expect(usageKey).not.toBe(limitKey);
    });
  });

  describe("insertEvent", () => {
    test("should insert event and return proper response structure", async () => {
      const event = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 5,
      };

      const result = await cache.insertEvent(event);
      
      expect(result).toHaveProperty("amount");
      expect(result).toHaveProperty("afterValue");
      expect(result).toHaveProperty("resetAt");
      expect(result.amount).toBe(5);
      expect(result.afterValue).toBeNumber();
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    test("should handle zero amount", async () => {
      const event = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 0,
      };

      const result = await cache.insertEvent(event);
      
      expect(result.amount).toBe(0);
    });

    test("should handle negative amounts", async () => {
      const event = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: -10,
      };

      const result = await cache.insertEvent(event);
      
      expect(result.amount).toBe(-10);
    });

  describe("getUsage", () => {
    it("should retrieve cached usage successfully", async () => {
      const mockUsage = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 1000000,
      };

      // Set mock data
      const redis = (cache as any).cache;
      redis.setMockData("usage:api-calls:user-123", JSON.stringify(mockUsage));

      const result = await cache.getUsage("user-123", "api-calls");
      expect(result).toBeDefined();
    });
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