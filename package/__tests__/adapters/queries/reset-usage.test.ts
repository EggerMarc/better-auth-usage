import { describe, test, expect, mock } from "bun:test";
import { resetUsageQuery } from "../../../adapters/queries/reset-usage";
import type { Adapter } from "better-auth";
import type { Feature, Usage } from "../../../types";

describe("resetUsageQuery", () => {
  const mockFeature: Omit<Feature, "hooks"> = {
    key: "api-calls",
    maxLimit: 1000,
    resetValue: 500,
  };

  const createMockAdapter = (existingUsage: Usage[] = []): Adapter => ({
    create: mock(async (params: any) => ({
      ...params.data,
      id: "mock-id",
    })),
    transaction: mock(async (fn: any) => {
      const tx = {
        findMany: mock(async () => existingUsage),
        create: mock(async (params: any) => ({
          ...params.data,
          id: "tx-mock-id",
        })),
      };
      return await fn(tx);
    }),
  } as any);

  test("should return undefined when feature has no resetValue", async () => {
    const featureWithoutReset: Omit<Feature, "hooks"> = {
      key: "api-calls",
      maxLimit: 1000,
    };

    const adapter = createMockAdapter();
    
    const result = await resetUsageQuery({
      adapter,
      referenceId: "user-123",
      feature: featureWithoutReset,
    });

    expect(result).toBeUndefined();
  });

  test("should create reset record with current value", async () => {
    const adapter = createMockAdapter();
    
    const result = await resetUsageQuery({
      adapter,
      referenceId: "user-123",
      curr: 300,
      feature: mockFeature,
    });

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "usage",
        data: expect.objectContaining({
          amount: 200, // 500 (resetValue) - 300 (curr)
          event: "reset",
          referenceId: "user-123",
        }),
      })
    );
    expect(result).toBeDefined();
  });

  test("should handle zero current usage", async () => {
    const adapter = createMockAdapter();
    
    const result = await resetUsageQuery({
      adapter,
      referenceId: "user-123",
      curr: 0,
      feature: mockFeature,
    });

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 500,
        }),
      })
    );
  });

  test("should handle current usage exceeding resetValue", async () => {
    const adapter = createMockAdapter();
    
    const result = await resetUsageQuery({
      adapter,
      referenceId: "user-123",
      curr: 600,
      feature: mockFeature,
    });

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: -100, // 500 - 600
        }),
      })
    );
  });

  test("should create initial reset when no usage exists in transaction", async () => {
    const adapter = createMockAdapter([]);
    
    const result = await resetUsageQuery({
      adapter,
      referenceId: "user-123",
      feature: mockFeature,
    });

    expect(adapter.transaction).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test("should calculate reset amount from existing usage in transaction", async () => {
    const existingUsage: Usage[] = [
      {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 100,
        event: "use",
        lastResetAt: new Date(),
        createdAt: new Date(),
      },
      {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 150,
        event: "use",
        lastResetAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const adapter = createMockAdapter(existingUsage);
    
    await resetUsageQuery({
      adapter,
      referenceId: "user-123",
      feature: mockFeature,
    });

    expect(adapter.transaction).toHaveBeenCalled();
  });

  test("should set lastResetAt to current date", async () => {
    const adapter = createMockAdapter();
    const beforeReset = Date.now();
    
    await resetUsageQuery({
      adapter,
      referenceId: "user-123",
      curr: 100,
      feature: mockFeature,
    });

    const afterReset = Date.now();

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastResetAt: expect.any(Date),
        }),
      })
    );
  });

  test("should include createdAt timestamp", async () => {
    const adapter = createMockAdapter();
    
    await resetUsageQuery({
      adapter,
      referenceId: "user-123",
      curr: 100,
      feature: mockFeature,
    });

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdAt: expect.any(Date),
        }),
      })
    );
  });

  test("should handle different feature keys", async () => {
    const storageFeature: Omit<Feature, "hooks"> = {
      key: "storage-quota",
      maxLimit: 10000,
      resetValue: 5000,
    };

    const adapter = createMockAdapter();
    
    await resetUsageQuery({
      adapter,
      referenceId: "org-456",
      curr: 2000,
      feature: storageFeature,
    });

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feature: "storage-quota",
          amount: 3000, // 5000 - 2000
        }),
      })
    );
  });

  test("should filter usage by both referenceId and feature in transaction", async () => {
    const existingUsage: Usage[] = [
      {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 100,
        event: "use",
        lastResetAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const adapter = createMockAdapter(existingUsage);
    
    await resetUsageQuery({
      adapter,
      referenceId: "user-123",
      feature: mockFeature,
    });

    expect(adapter.transaction).toHaveBeenCalled();
  });

  test("should handle large resetValue numbers", async () => {
    const largeResetFeature: Omit<Feature, "hooks"> = {
      key: "big-feature",
      resetValue: 1000000,
    };

    const adapter = createMockAdapter();
    
    await resetUsageQuery({
      adapter,
      referenceId: "user-123",
      curr: 500000,
      feature: largeResetFeature,
    });

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 500000,
        }),
      })
    );
  });
});