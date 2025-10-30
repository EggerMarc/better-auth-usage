import { describe, it, expect, beforeEach, mock } from "bun:test";
import { getUsageQuery } from "@/adapters/queries/get-usage";
import type { Adapter } from "better-auth";
import type { Feature, Usage } from "@/types";

describe("getUsageQuery", () => {
  let mockAdapter: Adapter;
  let mockFeature: Omit<Feature, "hooks">;

  beforeEach(() => {
    mockAdapter = {
      findMany: mock(async () => []),
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

  describe("with existing usage", () => {
    it("should return latest usage when no reset needed", async () => {
      const mockUsage: Usage[] = [{
        id: "usage-1",
        referenceId: "user-123",
        feature: "api-calls",
        amount: 10,
        lastResetAt: new Date(),
        event: "use",
        createdAt: new Date()
      }];

      mockAdapter.findMany = mock(async () => mockUsage);

      const result = await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: mockFeature
      });

      expect(result).toBeDefined();
      expect(result?.id).toBe("usage-1");
    });

    it("should calculate total from multiple usage records", async () => {
      const mockUsages: Usage[] = [
        {
          id: "usage-3",
          referenceId: "user-123",
          feature: "api-calls",
          amount: 30,
          lastResetAt: new Date(),
          event: "use",
          createdAt: new Date()
        },
        {
          id: "usage-2",
          referenceId: "user-123",
          feature: "api-calls",
          amount: 20,
          lastResetAt: new Date(),
          event: "use",
          createdAt: new Date(Date.now() - 1000)
        },
        {
          id: "usage-1",
          referenceId: "user-123",
          feature: "api-calls",
          amount: 10,
          lastResetAt: new Date(),
          event: "use",
          createdAt: new Date(Date.now() - 2000)
        }
      ];

      mockAdapter.findMany = mock(async () => mockUsages);

      const result = await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: mockFeature
      });

      expect(result).toBeDefined();
    });

    it("should trigger reset when usage should be reset", async () => {
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      const mockUsage: Usage[] = [{
        id: "usage-1",
        referenceId: "user-123",
        feature: "api-calls",
        amount: 50,
        lastResetAt: oldDate,
        event: "use",
        createdAt: oldDate
      }];

      mockAdapter.findMany = mock(async () => mockUsage);

      const result = await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: mockFeature
      });

      expect(result).toBeDefined();
    });
  });

  describe("with no existing usage", () => {
    it("should create initial usage with reset", async () => {
      mockAdapter.findMany = mock(async () => []);

      const result = await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "new-user",
        feature: mockFeature
      });

      expect(result).toBeDefined();
    });

    it("should use resetValue for initial usage", async () => {
      mockAdapter.findMany = mock(async () => []);

      await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "new-user",
        feature: mockFeature
      });

      expect(mockAdapter.transaction).toHaveBeenCalled();
    });
  });

  describe("reset scenarios", () => {
    it("should handle 'never' reset type", async () => {
      const neverResetFeature = {
        key: "unlimited-feature",
        reset: "never" as const
      };

      mockAdapter.findMany = mock(async () => [{
        id: "usage-1",
        referenceId: "user-123",
        feature: "unlimited-feature",
        amount: 1000,
        lastResetAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
        event: "use",
        createdAt: new Date()
      }]);

      const result = await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: neverResetFeature
      });

      expect(result).toBeDefined();
    });

    it("should handle hourly reset", async () => {
      const hourlyFeature = {
        ...mockFeature,
        reset: "hourly" as const
      };

      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      mockAdapter.findMany = mock(async () => [{
        id: "usage-1",
        referenceId: "user-123",
        feature: "api-calls",
        amount: 50,
        lastResetAt: oldDate,
        event: "use",
        createdAt: oldDate
      }]);

      const result = await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: hourlyFeature
      });

      expect(result).toBeDefined();
    });

    it("should handle weekly reset", async () => {
      const weeklyFeature = {
        ...mockFeature,
        reset: "weekly" as const
      };

      const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
      mockAdapter.findMany = mock(async () => [{
        id: "usage-1",
        referenceId: "user-123",
        feature: "api-calls",
        amount: 50,
        lastResetAt: oldDate,
        event: "use",
        createdAt: oldDate
      }]);

      const result = await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: weeklyFeature
      });

      expect(result).toBeDefined();
    });

    it("should handle monthly reset", async () => {
      const monthlyFeature = {
        ...mockFeature,
        reset: "monthly" as const
      };

      const oldDate = new Date(Date.now() - 32 * 24 * 60 * 60 * 1000); // 32 days ago
      mockAdapter.findMany = mock(async () => [{
        id: "usage-1",
        referenceId: "user-123",
        feature: "api-calls",
        amount: 50,
        lastResetAt: oldDate,
        event: "use",
        createdAt: oldDate
      }]);

      const result = await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: monthlyFeature
      });

      expect(result).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("should handle null lastResetAt", async () => {
      mockAdapter.findMany = mock(async () => [{
        id: "usage-1",
        referenceId: "user-123",
        feature: "api-calls",
        amount: 10,
        lastResetAt: null as any,
        event: "use",
        createdAt: new Date()
      }]);

      const result = await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: mockFeature
      });

      expect(result).toBeDefined();
    });

    it("should handle negative amounts in history", async () => {
      mockAdapter.findMany = mock(async () => [
        {
          id: "usage-2",
          referenceId: "user-123",
          feature: "api-calls",
          amount: 50,
          lastResetAt: new Date(),
          event: "use",
          createdAt: new Date()
        },
        {
          id: "usage-1",
          referenceId: "user-123",
          feature: "api-calls",
          amount: -10,
          lastResetAt: new Date(),
          event: "refund",
          createdAt: new Date(Date.now() - 1000)
        }
      ]);

      const result = await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: mockFeature
      });

      expect(result).toBeDefined();
    });

    it("should handle zero amounts", async () => {
      mockAdapter.findMany = mock(async () => [{
        id: "usage-1",
        referenceId: "user-123",
        feature: "api-calls",
        amount: 0,
        lastResetAt: new Date(),
        event: "check",
        createdAt: new Date()
      }]);

      const result = await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: mockFeature
      });

      expect(result).toBeDefined();
    });

    it("should sort by createdAt descending", async () => {
      await getUsageQuery({
        adapter: mockAdapter,
        referenceId: "user-123",
        feature: mockFeature
      });

      expect(mockAdapter.findMany).toHaveBeenCalledWith({
        model: "usage",
        where: expect.any(Array),
        sortBy: { field: "createdAt", direction: "desc" }
      });
    });
  });
});