import { describe, test, expect, mock } from "bun:test";
import { getUsageQuery } from "../../../adapters/queries/get-usage";
import type { Adapter } from "better-auth";
import type { Feature, Usage } from "../../../types";

describe("getUsageQuery", () => {
  const mockFeature: Omit<Feature, "hooks"> = {
    key: "api-calls",
    maxLimit: 1000,
    reset: "daily",
    resetValue: 0,
  };

  const createMockAdapter = (usageData: Usage[] = []): Adapter => ({
    findMany: mock(async () => usageData),
    findOne: mock(async () => null),
    create: mock(async (data: any) => ({
      ...data.data,
      id: "mock-id",
    })),
    update: mock(async () => null),
    delete: mock(async () => null),
    transaction: mock(async (fn: any) => {
      const tx = createMockAdapter(usageData);
      return await fn(tx);
    }),
  } as any);

  test("should create reset usage when no usage exists", async () => {
    const adapter = createMockAdapter([]);
    
    const result = await getUsageQuery({
      adapter,
      referenceId: "user-123",
      feature: mockFeature,
    });

    expect(adapter.findMany).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test("should return last usage when no reset needed", async () => {
    const mockUsage: Usage = {
      referenceId: "user-123",
      feature: "api-calls",
      amount: 50,
      event: "use",
      lastResetAt: new Date(Date.now() + 86400000), // Tomorrow
      createdAt: new Date(),
    };

    const adapter = createMockAdapter([mockUsage]);
    
    const result = await getUsageQuery({
      adapter,
      referenceId: "user-123",
      feature: mockFeature,
    });

    expect(result).toEqual(mockUsage);
  });

  test("should trigger reset when reset is due", async () => {
    const mockUsage: Usage = {
      referenceId: "user-123",
      feature: "api-calls",
      amount: 50,
      event: "use",
      lastResetAt: new Date(Date.now() - 172800000), // 2 days ago
      createdAt: new Date(Date.now() - 172800000),
    };

    const adapter = createMockAdapter([mockUsage]);
    
    const result = await getUsageQuery({
      adapter,
      referenceId: "user-123",
      feature: mockFeature,
    });

    expect(adapter.findMany).toHaveBeenCalled();
  });

  test("should calculate current usage from multiple records", async () => {
    const mockUsages: Usage[] = [
      {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 30,
        event: "use",
        lastResetAt: new Date(),
        createdAt: new Date(),
      },
      {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 20,
        event: "use",
        lastResetAt: new Date(),
        createdAt: new Date(Date.now() - 3600000),
      },
    ];

    const adapter = createMockAdapter(mockUsages);
    
    await getUsageQuery({
      adapter,
      referenceId: "user-123",
      feature: mockFeature,
    });

    expect(adapter.findMany).toHaveBeenCalled();
  });

  test("should handle feature without reset type", async () => {
    const noResetFeature: Omit<Feature, "hooks"> = {
      key: "permanent-feature",
      maxLimit: 1000,
    };

    const mockUsage: Usage = {
      referenceId: "user-123",
      feature: "permanent-feature",
      amount: 50,
      event: "use",
      lastResetAt: new Date(),
      createdAt: new Date(),
    };

    const adapter = createMockAdapter([mockUsage]);
    
    const result = await getUsageQuery({
      adapter,
      referenceId: "user-123",
      feature: noResetFeature,
    });

    expect(result).toBeDefined();
  });

  test("should handle feature with resetValue", async () => {
    const featureWithResetValue: Omit<Feature, "hooks"> = {
      key: "credits",
      maxLimit: 1000,
      reset: "monthly",
      resetValue: 500,
    };

    const adapter = createMockAdapter([]);
    
    const result = await getUsageQuery({
      adapter,
      referenceId: "user-123",
      feature: featureWithResetValue,
    });

    expect(result).toBeDefined();
  });

  test("should handle different reference IDs correctly", async () => {
    const mockUsage: Usage = {
      referenceId: "user-456",
      feature: "api-calls",
      amount: 100,
      event: "use",
      lastResetAt: new Date(),
      createdAt: new Date(),
    };

    const adapter = createMockAdapter([mockUsage]);
    
    await getUsageQuery({
      adapter,
      referenceId: "user-456",
      feature: mockFeature,
    });

    expect(adapter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.arrayContaining([
          { field: "referenceId", value: "user-456" },
        ]),
      })
    );
  });
});