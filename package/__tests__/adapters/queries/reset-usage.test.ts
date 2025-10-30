import { describe, it, expect, beforeEach, mock } from "bun:test";
import { resetUsageQuery } from "@/adapters/queries/reset-usage";
import type { Adapter } from "better-auth";
import type { Feature } from "@/types";

describe("resetUsageQuery", () => {
  let mockAdapter: Adapter;
  let mockFeature: Omit<Feature, "hooks">;

  beforeEach(() => {
    mockAdapter = {
      create: mock(async (params) => ({
        id: "usage-1",
        ...params.data
      })),
      transaction: mock(async (callback) => {
        const tx = {
          findMany: mock(async () => []),
          create: mock(async (params) => ({
            id: "usage-1",
            ...params.data
          }))
        };
        return callback(tx as any);
      })
    } as unknown as Adapter;

    mockFeature = {
      key: "api-calls",
      reset: "daily",
      resetValue: 100
    };
  });

  describe("with resetValue defined", () => {
    it("should reset usage with current value provided", async () => {
      const result = await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        curr: 50,
        feature: mockFeature
      });

      expect(result).toBeDefined();
      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          amount: 50, // resetValue (100) - curr (50)
          feature: "api-calls",
          referenceId: "user-123",
          event: "reset"
        })
      });
    });

    it("should handle zero current usage", async () => {
      const result = await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        curr: 0,
        feature: mockFeature
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          amount: 100 // full resetValue
        })
      });
    });

    it("should handle usage exceeding resetValue", async () => {
      const result = await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        curr: 150,
        feature: mockFeature
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          amount: -50 // negative adjustment
        })
      });
    });
  });

  describe("without current value (transaction)", () => {
    it("should create initial usage when no previous usage exists", async () => {
      const result = await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: mockFeature
      });

      expect(result).toBeDefined();
      expect(mockAdapter.transaction).toHaveBeenCalled();
    });

    it("should calculate total from existing usage records", async () => {
      mockAdapter.transaction = mock(async (callback) => {
        const tx = {
          findMany: mock(async () => [
            { amount: 10, feature: "api-calls" },
            { amount: 20, feature: "api-calls" },
            { amount: 30, feature: "api-calls" }
          ]),
          create: mock(async (params) => ({
            id: "usage-1",
            ...params.data
          }))
        };
        return callback(tx as any);
      });

      const result = await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: mockFeature
      });

      expect(result).toBeDefined();
    });

    it("should handle empty usage history", async () => {
      const result = await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "new-user",
        feature: mockFeature
      });

      expect(result).toBeDefined();
    });
  });

  describe("without resetValue", () => {
    it("should return undefined when resetValue is not set", async () => {
      const featureWithoutReset = {
        key: "unlimited-feature",
        reset: "never" as const
      };

      const result = await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: featureWithoutReset
      });

      expect(result).toBeUndefined();
      expect(mockAdapter.create).not.toHaveBeenCalled();
    });

    it("should return undefined when resetValue is zero", async () => {
      const featureWithZeroReset = {
        ...mockFeature,
        resetValue: 0
      };

      const result = await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: featureWithZeroReset
      });

      expect(result).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("should handle very large resetValue", async () => {
      const largeResetFeature = {
        ...mockFeature,
        resetValue: 999999999
      };

      const result = await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        curr: 100,
        feature: largeResetFeature
      });

      expect(result).toBeDefined();
    });

    it("should handle negative current usage", async () => {
      const result = await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        curr: -10,
        feature: mockFeature
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          amount: 110 // resetValue + abs(negative)
        })
      });
    });

    it("should set correct timestamps", async () => {
      const beforeCall = new Date();
      
      await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        curr: 50,
        feature: mockFeature
      });

      const afterCall = new Date();

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          lastResetAt: expect.any(Date),
          createdAt: expect.any(Date)
        })
      });
    });

    it("should use correct event type", async () => {
      await resetUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        curr: 50,
        feature: mockFeature
      });

      expect(mockAdapter.create).toHaveBeenCalledWith({
        model: "usage",
        data: expect.objectContaining({
          event: "reset"
        })
      });
    });
  });
});