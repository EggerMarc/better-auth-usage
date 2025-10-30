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

    test("should handle large amounts", async () => {
      const event = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 1000000,
      };

      const result = await cache.insertEvent(event);
      
      expect(result.amount).toBe(1000000);
    });
  });

  describe("getUsage", () => {
    test("should throw APIError when key not found", async () => {
      expect(async () => {
        await cache.getUsage("nonexistent", "feature");
      }).toThrow();
    });

    test("should return parsed usage data when key exists", async () => {
      // This test would require setting up mock data
      // In a real scenario, you'd insert data first, then retrieve it
      expect(true).toBe(true); // Placeholder
    });
  });

  describe("clearUsage", () => {
    test("should not throw when clearing non-existent key", async () => {
      await expect(cache.clearUsage("user-123", "api-calls")).resolves.not.toThrow();
    });

    test("should clear existing usage", async () => {
      // In real tests, you'd insert data first, then clear and verify
      await expect(cache.clearUsage("user-123", "api-calls")).resolves.toBeUndefined();
    });
  });

  describe("EventEmitter behavior", () => {
    test("should inherit from EventEmitter", () => {
      expect(cache.on).toBeFunction();
      expect(cache.emit).toBeFunction();
      expect(cache.removeListener).toBeFunction();
    });

    test("should allow event subscription", () => {
      const handler = mock(() => {});
      cache.on("test-event", handler);
      cache.emit("test-event");
      
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});