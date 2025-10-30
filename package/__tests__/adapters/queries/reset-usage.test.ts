import { describe, test, expect, mock, beforeEach } from "bun:test";
import { resetUsageQuery } from "../../../adapters/queries/reset-usage";
import type { Feature, Usage } from "../../../types";
import type { Adapter } from "better-auth";

describe("resetUsageQuery", () => {
  let mockAdapter: Adapter;
  const mockFeature: Omit<Feature, "hooks"> = {
    key: "api-calls",
    maxLimit: 1000,
    resetValue: 100,
  };

  beforeEach(() => {
    mockAdapter = {
      create: mock((params) => Promise.resolve({
        id: "reset-1",
        ...params.data,
      })),
      transaction: mock(async (callback) => {
        const tx = {
          findMany: mock(() => Promise.resolve([])),
          create: mock((params) => Promise.resolve({
            id: "reset-tx-1",
            ...params.data,
          })),
        };
        return callback(tx as any);
      }),
    } as unknown as Adapter;
  });

  test("returns undefined when feature has no resetValue", async () => {
    const featureNoReset: Omit<Feature, "hooks"> = {
      key: "api-calls",
      maxLimit: 1000,
    };

    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      feature: featureNoReset,
    });

    expect(result).toBeUndefined();
  });

  test("creates reset usage with current value when curr is provided", async () => {
    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      curr: 75,
      feature: mockFeature,
    });

    expect(mockAdapter.create).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result?.amount).toBe(25); // 100 - 75
    expect(result?.event).toBe("reset");
  });

  test("calculates correct reset amount from current usage", async () => {
    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      curr: 80,
      feature: { ...mockFeature, resetValue: 200 },
    });

    expect(result?.amount).toBe(120); // 200 - 80
  });

  test("creates initial reset when no current usage in transaction", async () => {
    const mockTx = {
      findMany: mock(() => Promise.resolve([])),
      create: mock((params) => Promise.resolve({
        id: "reset-1",
        ...params.data,
      })),
    };

    (mockAdapter.transaction as any).mockImplementation(async (callback: any) => {
      return callback(mockTx);
    });

    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      feature: mockFeature,
    });

    expect(result?.amount).toBe(100); // Full resetValue
    expect(result?.event).toBe("reset");
  });

  test("calculates reset from existing usage in transaction", async () => {
    const existingUsage: Usage[] = [
      {
        referenceId: "ref-123",
        amount: 30,
        feature: "api-calls",
        event: "use",
        lastResetAt: new Date(),
        createdAt: new Date(),
      },
      {
        referenceId: "ref-123",
        amount: 20,
        feature: "api-calls",
        event: "use",
        lastResetAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const mockTx = {
      findMany: mock(() => Promise.resolve(existingUsage)),
      create: mock((params) => Promise.resolve({
        id: "reset-1",
        ...params.data,
      })),
    };

    (mockAdapter.transaction as any).mockImplementation(async (callback: any) => {
      return callback(mockTx);
    });

    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      feature: mockFeature,
    });

    expect(result?.amount).toBe(50); // 100 - (30 + 20)
  });

  test("sets lastResetAt to current time", async () => {
    const beforeReset = Date.now();
    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      curr: 50,
      feature: mockFeature,
    });
    const afterReset = Date.now();

    expect(result?.lastResetAt).toBeInstanceOf(Date);
    expect(result!.lastResetAt.getTime()).toBeGreaterThanOrEqual(beforeReset);
    expect(result!.lastResetAt.getTime()).toBeLessThanOrEqual(afterReset);
  });

  test("sets createdAt to current time", async () => {
    const beforeReset = Date.now();
    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      curr: 50,
      feature: mockFeature,
    });
    const afterReset = Date.now();

    expect(result?.createdAt).toBeInstanceOf(Date);
    expect(result!.createdAt.getTime()).toBeGreaterThanOrEqual(beforeReset);
    expect(result!.createdAt.getTime()).toBeLessThanOrEqual(afterReset);
  });

  test("handles negative reset amounts correctly", async () => {
    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      curr: 150, // More than resetValue
      feature: mockFeature,
    });

    expect(result?.amount).toBe(-50); // 100 - 150
  });

  test("passes correct referenceId to created usage", async () => {
    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "unique-ref-id",
      curr: 50,
      feature: mockFeature,
    });

    expect(result?.referenceId).toBe("unique-ref-id");
  });

  test("passes correct feature key to created usage", async () => {
    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      curr: 50,
      feature: { ...mockFeature, key: "storage" },
    });

    expect(result?.feature).toBe("storage");
  });

  test("queries correct feature in transaction", async () => {
    const mockTx = {
      findMany: mock(() => Promise.resolve([])),
      create: mock((params) => Promise.resolve({
        id: "reset-1",
        ...params.data,
      })),
    };

    (mockAdapter.transaction as any).mockImplementation(async (callback: any) => {
      return callback(mockTx);
    });

    await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      feature: { ...mockFeature, key: "storage" },
    });

    const callArgs = mockTx.findMany.mock.calls[0][0];
    expect(callArgs.where).toContainEqual({
      field: "feature",
      value: "storage",
    });
  });
});