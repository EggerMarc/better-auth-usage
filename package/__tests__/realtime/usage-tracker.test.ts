import { describe, test, expect, mock, beforeEach } from "bun:test";
import { UsageTracker } from "../../realtime/usage-tracker";
import type { UsageUpdate } from "../../realtime/usage-tracker";

describe("UsageTracker", () => {
  describe("constructor", () => {
    test("should create instance with required dependencies", () => {
      const mockIo = {
        to: mock(() => ({ emit: mock() }))
      } as any;
      
      const mockCache = {
        getUsage: mock()
      } as any;

      const tracker = new UsageTracker("redis://localhost:6379", mockIo, mockCache);
      expect(tracker).toBeInstanceOf(UsageTracker);
    });

    test("should extend EventEmitter", () => {
      const mockIo = { to: mock(() => ({ emit: mock() })) } as any;
      const mockCache = { getUsage: mock() } as any;

      const tracker = new UsageTracker("redis://localhost:6379", mockIo, mockCache);
      expect(typeof tracker.on).toBe("function");
      expect(typeof tracker.emit).toBe("function");
    });
  });

  describe("publishUpdate", () => {
    test("should publish update to correct channel", async () => {
      const mockIo = { to: mock(() => ({ emit: mock() })) } as any;
      const mockCache = { getUsage: mock() } as any;
      
      const tracker = new UsageTracker("redis://localhost:6379", mockIo, mockCache);
      
      const mockPublish = mock(async () => 1);
      (tracker as any).pubClient.publish = mockPublish;

      const update: UsageUpdate = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 5,
        afterValue: 105,
        resetAt: new Date(),
        timestamp: Date.now()
      };

      await tracker.publishUpdate(update);
      
      expect(mockPublish).toHaveBeenCalled();
      const callArgs = mockPublish.mock.calls[0];
      expect(callArgs[0]).toBe("usage:updates:api-calls:user-123");
      expect(typeof callArgs[1]).toBe("string");
    });

    test("should serialize update data as JSON", async () => {
      const mockIo = { to: mock(() => ({ emit: mock() })) } as any;
      const mockCache = { getUsage: mock() } as any;
      
      const tracker = new UsageTracker("redis://localhost:6379", mockIo, mockCache);
      
      const mockPublish = mock(async (channel: string, message: string) => {
        const parsed = JSON.parse(message);
        expect(parsed.referenceId).toBe("user-123");
        expect(parsed.feature).toBe("api-calls");
        expect(parsed.amount).toBe(5);
        return 1;
      });
      (tracker as any).pubClient.publish = mockPublish;

      const update: UsageUpdate = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 5,
        afterValue: 105,
        resetAt: new Date(),
        timestamp: Date.now()
      };

      await tracker.publishUpdate(update);
    });

    test("should handle different feature types", async () => {
      const mockIo = { to: mock(() => ({ emit: mock() })) } as any;
      const mockCache = { getUsage: mock() } as any;
      
      const tracker = new UsageTracker("redis://localhost:6379", mockIo, mockCache);
      
      const mockPublish = mock(async () => 1);
      (tracker as any).pubClient.publish = mockPublish;

      const features = ["api-calls", "storage", "users", "teams"];
      
      for (const feature of features) {
        const update: UsageUpdate = {
          referenceId: "user-123",
          feature,
          amount: 1,
          afterValue: 1,
          resetAt: new Date(),
          timestamp: Date.now()
        };
        
        await tracker.publishUpdate(update);
      }

      expect(mockPublish).toHaveBeenCalledTimes(4);
    });
  });

  describe("getUsage", () => {
    test("should delegate to cache.getUsage", async () => {
      const mockIo = { to: mock(() => ({ emit: mock() })) } as any;
      
      const mockUsage = {
        referenceId: "user-123",
        feature: "api-calls",
        current: 50,
        lastResetAt: new Date(),
        updatedAt: new Date()
      };
      
      const mockCache = {
        getUsage: mock(async () => mockUsage)
      } as any;
      
      const tracker = new UsageTracker("redis://localhost:6379", mockIo, mockCache);
      
      const result = await tracker.getUsage("user-123", "api-calls");
      
      expect(result).toEqual(mockUsage);
      expect(mockCache.getUsage).toHaveBeenCalledWith("user-123", "api-calls");
    });

    test("should propagate errors from cache", async () => {
      const mockIo = { to: mock(() => ({ emit: mock() })) } as any;
      const mockCache = {
        getUsage: mock(async () => {
          throw new Error("Cache error");
        })
      } as any;
      
      const tracker = new UsageTracker("redis://localhost:6379", mockIo, mockCache);
      
      await expect(
        tracker.getUsage("user-123", "api-calls")
      ).rejects.toThrow("Cache error");
    });
  });

  describe("disconnect", () => {
    test("should disconnect both Redis clients", async () => {
      const mockIo = { to: mock(() => ({ emit: mock() })) } as any;
      const mockCache = { getUsage: mock() } as any;
      
      const tracker = new UsageTracker("redis://localhost:6379", mockIo, mockCache);
      
      const mockPubQuit = mock(async () => "OK");
      const mockSubQuit = mock(async () => "OK");
      (tracker as any).pubClient.quit = mockPubQuit;
      (tracker as any).subClient.quit = mockSubQuit;

      await tracker.disconnect();
      
      expect(mockPubQuit).toHaveBeenCalledTimes(1);
      expect(mockSubQuit).toHaveBeenCalledTimes(1);
    });
  });
});