import { describe, it, expect, beforeEach, mock } from "bun:test";
import { insertUsageQuery } from "@/adapters/queries/insert-usage";
import type { Adapter } from "better-auth";

describe("insertUsageQuery", () => {
  let mockAdapter: Adapter;

  beforeEach(() => {
    mockAdapter = {
      create: mock(async (params) => ({
        id: "usage-1",
        ...params.data
      }))
    } as unknown as Adapter;
  });

  describe("successful insertions", () => {
    it("should insert usage with all required fields", async () => {
      const lastResetAt = new Date("2024-01-01");
      
      const result = await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt,
        amount: 10,
        event: "consume"
      });

      expect(result).toBeDefined();
      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          referenceId: "user-123",
          amount: 10,
          lastResetAt,
          event: "consume",
          feature: "api-calls",
          createdAt: expect.any(Date)
        })
      });
    });

    it("should use default event value 'use'", async () => {
      const result = await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt: new Date(),
        amount: 5,
        event: "use"
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          event: "use"
        })
      });
    });

    it("should handle positive amounts", async () => {
      await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt: new Date(),
        amount: 100,
        event: "use"
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          amount: 100
        })
      });
    });

    it("should handle zero amount", async () => {
      await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt: new Date(),
        amount: 0,
        event: "use"
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          amount: 0
        })
      });
    });

    it("should handle negative amounts (refunds)", async () => {
      await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt: new Date(),
        amount: -10,
        event: "refund"
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          amount: -10,
          event: "refund"
        })
      });
    });
  });

  describe("event types", () => {
    it("should handle 'consume' event", async () => {
      await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt: new Date(),
        amount: 1,
        event: "consume"
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          event: "consume"
        })
      });
    });

    it("should handle 'reset' event", async () => {
      await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt: new Date(),
        amount: 100,
        event: "reset"
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          event: "reset"
        })
      });
    });

    it("should handle custom event types", async () => {
      await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt: new Date(),
        amount: 5,
        event: "custom-event"
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          event: "custom-event"
        })
      });
    });
  });

  describe("edge cases", () => {
    it("should handle special characters in referenceId", async () => {
      await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user@test.com",
        featureKey: "api-calls",
        lastResetAt: new Date(),
        amount: 1,
        event: "use"
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          referenceId: "user@test.com"
        })
      });
    });

    it("should handle special characters in featureKey", async () => {
      await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls:v2",
        lastResetAt: new Date(),
        amount: 1,
        event: "use"
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          feature: "api-calls:v2"
        })
      });
    });

    it("should handle very large amounts", async () => {
      await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt: new Date(),
        amount: 999999999,
        event: "use"
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          amount: 999999999
        })
      });
    });

    it("should create new Date for createdAt on each call", async () => {
      const before = Date.now();
      
      await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt: new Date(),
        amount: 1,
        event: "use"
      });

      const after = Date.now();

      const callArgs = (mockAdapter.create as any).mock.calls[0][0];
      const createdAt = callArgs.data.createdAt.getTime();
      
      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect(createdAt).toBeLessThanOrEqual(after);
    });

    it("should preserve lastResetAt timestamp", async () => {
      const specificDate = new Date("2024-06-15T12:00:00Z");
      
      await insertUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt: specificDate,
        amount: 1,
        event: "use"
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          lastResetAt: specificDate
        })
      });
    });
  });

  describe("with TransactionAdapter", () => {
    it("should work with transaction adapter", async () => {
      const txAdapter = {
        create: mock(async (params) => ({
          id: "usage-tx-1",
          ...params.data
        }))
      } as any;

      const result = await insertUsageQuery({
        adapter: txAdapter,
        referenceId: "user-123",
        featureKey: "api-calls",
        lastResetAt: new Date(),
        amount: 10,
        event: "use"
      });

      expect(result).toBeDefined();
      expect(txAdapter.create).toHaveBeenCalled();
    });
  });
});