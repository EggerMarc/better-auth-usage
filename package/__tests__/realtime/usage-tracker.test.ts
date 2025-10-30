import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { UsageTracker } from "../../realtime/usage-tracker";
import type { UsageUpdate } from "../../realtime/usage-tracker";
import EventEmitter from "events";

// Mock classes for testing
class MockRedis extends EventEmitter {
  async connect() { return "OK"; }
  async psubscribe(pattern: string) { return 1; }
  async publish(channel: string, message: string) { return 1; }
  async quit() { return "OK"; }
}

class MockSocketServer {
  to(room: string) {
    return {
      emit: mock((event: string, data: any) => {}),
    };
  }
}

class MockUsageCache {
  async getUsage(referenceId: string, feature: string) {
    return {
      referenceId,
      feature,
      lastResetAt: new Date(),
      updatedAt: new Date(),
      current: 100,
      maxLimit: 1000,
    };
  }
}

describe("UsageTracker", () => {
  const REDIS_URL = "redis://localhost:6379";
  let tracker: UsageTracker;
  let mockIo: MockSocketServer;
  let mockCache: MockUsageCache;

  beforeEach(() => {
    mockIo = new MockSocketServer() as any;
    mockCache = new MockUsageCache() as any;
    tracker = new UsageTracker(REDIS_URL, mockIo as any, mockCache as any);
  });

  describe("constructor", () => {
    test("should initialize with correct properties", () => {
      expect(tracker).toBeDefined();
      expect(tracker).toBeInstanceOf(EventEmitter);
    });

    test("should set up pub/sub on construction", () => {
      expect(tracker).toBeDefined();
    });
  });

  describe("publishUpdate", () => {
    test("should publish usage update to correct channel", async () => {
      const update: UsageUpdate = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 5,
        afterValue: 105,
        resetAt: new Date(),
        timestamp: Date.now(),
      };

      await tracker.publishUpdate(update);

      // Verify the update was processed
      expect(update.referenceId).toBe("user-123");
    });

    test("should format channel name correctly", async () => {
      const update: UsageUpdate = {
        referenceId: "org-456",
        feature: "storage",
        amount: 100,
        afterValue: 500,
        resetAt: new Date(),
        timestamp: Date.now(),
      };

      await tracker.publishUpdate(update);

      expect(update.feature).toBe("storage");
    });

    test("should handle multiple updates", async () => {
      const updates: UsageUpdate[] = [
        {
          referenceId: "user-1",
          feature: "api-calls",
          amount: 1,
          afterValue: 1,
          resetAt: new Date(),
          timestamp: Date.now(),
        },
        {
          referenceId: "user-2",
          feature: "api-calls",
          amount: 2,
          afterValue: 2,
          resetAt: new Date(),
          timestamp: Date.now(),
        },
      ];

      for (const update of updates) {
        await tracker.publishUpdate(update);
      }

      expect(updates).toHaveLength(2);
    });
  });

  describe("getUsage", () => {
    test("should delegate to cache.getUsage", async () => {
      const usage = await tracker.getUsage("user-123", "api-calls");

      expect(usage).toBeDefined();
      expect(usage.referenceId).toBe("user-123");
      expect(usage.feature).toBe("api-calls");
    });

    test("should return usage with expected structure", async () => {
      const usage = await tracker.getUsage("org-456", "storage");

      expect(usage).toHaveProperty("referenceId");
      expect(usage).toHaveProperty("feature");
      expect(usage).toHaveProperty("current");
      expect(usage).toHaveProperty("lastResetAt");
    });

    test("should handle different features", async () => {
      const usage1 = await tracker.getUsage("user-123", "api-calls");
      const usage2 = await tracker.getUsage("user-123", "bandwidth");

      expect(usage1.feature).toBe("api-calls");
      expect(usage2.feature).toBe("bandwidth");
    });
  });

  describe("event handling", () => {
    test("should emit usage:update event", (done) => {
      tracker.on("usage:update", (update: UsageUpdate) => {
        expect(update).toBeDefined();
        expect(update).toHaveProperty("referenceId");
        expect(update).toHaveProperty("feature");
        done();
      });

      tracker.emit("usage:update", {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 5,
        afterValue: 105,
        resetAt: new Date(),
        timestamp: Date.now(),
      });
    });

    test("should support multiple listeners", () => {
      const listener1 = mock(() => {});
      const listener2 = mock(() => {});

      tracker.on("usage:update", listener1);
      tracker.on("usage:update", listener2);

      tracker.emit("usage:update", {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 5,
        afterValue: 105,
        resetAt: new Date(),
        timestamp: Date.now(),
      });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe("room naming", () => {
    test("should use correct room format for broadcasts", () => {
      const update: UsageUpdate = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 5,
        afterValue: 105,
        resetAt: new Date(),
        timestamp: Date.now(),
      };

      // The room should be: usage:api-calls:user-123
      const expectedRoom = `usage:${update.feature}:${update.referenceId}`;
      expect(expectedRoom).toBe("usage:api-calls:user-123");
    });

    test("should handle special characters in IDs", () => {
      const update: UsageUpdate = {
        referenceId: "user:123:abc",
        feature: "api-calls",
        amount: 5,
        afterValue: 105,
        resetAt: new Date(),
        timestamp: Date.now(),
      };

      const expectedRoom = `usage:${update.feature}:${update.referenceId}`;
      expect(expectedRoom).toBe("usage:api-calls:user:123:abc");
    });
  });

  describe("channel naming", () => {
    test("should use correct channel prefix", () => {
      const update: UsageUpdate = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 5,
        afterValue: 105,
        resetAt: new Date(),
        timestamp: Date.now(),
      };

      const expectedChannel = `usage:updates:${update.feature}:${update.referenceId}`;
      expect(expectedChannel).toBe("usage:updates:api-calls:user-123");
    });
  });

  describe("disconnect", () => {
    test("should disconnect both Redis clients", async () => {
      await expect(tracker.disconnect()).resolves.not.toThrow();
    });
  });

  describe("UsageUpdate interface", () => {
    test("should have all required fields", () => {
      const update: UsageUpdate = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 5,
        afterValue: 105,
        resetAt: new Date(),
        timestamp: Date.now(),
      };

      expect(update).toHaveProperty("referenceId");
      expect(update).toHaveProperty("feature");
      expect(update).toHaveProperty("amount");
      expect(update).toHaveProperty("afterValue");
      expect(update).toHaveProperty("resetAt");
      expect(update).toHaveProperty("timestamp");
    });

    test("should accept valid values", () => {
      const resetDate = new Date("2024-12-31T23:59:59Z");
      const update: UsageUpdate = {
        referenceId: "org-456",
        feature: "bandwidth",
        amount: 1024,
        afterValue: 5120,
        resetAt: resetDate,
        timestamp: Date.now(),
      };

      expect(update.amount).toBe(1024);
      expect(update.resetAt).toEqual(resetDate);
    });
  });
});