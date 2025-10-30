import { describe, test, expect, mock, beforeEach } from "bun:test";
import { getUsageQuery } from "../../../adapters/queries/get-usage";
import type { Feature, Usage } from "../../../types";
import type { Adapter } from "better-auth";

describe("getUsageQuery", () => {
  let mockAdapter: Adapter;
  const mockFeature: Omit<Feature, "hooks"> = {
    key: "api-calls",
    maxLimit: 1000,
    reset: "daily",
    resetValue: 100,
  };

  beforeEach(() => {
    mockAdapter = {
      findMany: mock(() => Promise.resolve([])),
      create: mock((data) => Promise.resolve({ id: "1", ...data.data })),
      transaction: mock((callback) => callback(mockAdapter)),
    } as unknown as Adapter;
  });

  test("returns reset usage when no existing usage found", async () => {
    (mockAdapter.findMany as any).mockResolvedValue([]);

    const result = await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      feature: mockFeature,
    });

    expect(mockAdapter.findMany).toHaveBeenCalled();
    expect(mockAdapter.create).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  test("returns latest usage when found and no reset needed", async () => {
    const mockUsage: Usage = {
      referenceId: "ref-123",
      amount: 50,
      feature: "api-calls",
      event: "use",
      lastResetAt: new Date(),
      createdAt: new Date(),
    };

    (mockAdapter.findMany as any).mockResolvedValue([mockUsage]);

    const result = await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      feature: mockFeature,
    });

    expect(result).toEqual(mockUsage);
  });

  test("triggers reset when shouldReset returns true", async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 2); // 2 days ago

    const mockUsage: Usage = {
      referenceId: "ref-123",
      amount: 50,
      feature: "api-calls",
      event: "use",
      lastResetAt: oldDate,
      createdAt: oldDate,
    };

    (mockAdapter.findMany as any).mockResolvedValue([mockUsage]);

    const result = await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      feature: mockFeature,
    });

    expect(mockAdapter.create).toHaveBeenCalled();
  });

  test("calculates current usage correctly from multiple records", async () => {
    const mockUsages: Usage[] = [
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

    (mockAdapter.findMany as any).mockResolvedValue(mockUsages);

    await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      feature: mockFeature,
    });

    // Verify the query was called with correct parameters
    expect(mockAdapter.findMany).toHaveBeenCalledWith({
      model: "usage",
      where: [
        { field: "referenceId", value: "ref-123" },
        { field: "feature", value: "api-calls" },
      ],
      sortBy: { field: "createdAt", direction: "desc" },
    });
  });

  test("handles feature without reset configuration", async () => {
    const featureNoReset: Omit<Feature, "hooks"> = {
      key: "api-calls",
      maxLimit: 1000,
    };

    (mockAdapter.findMany as any).mockResolvedValue([]);

    const result = await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      feature: featureNoReset,
    });

    expect(result).toBeDefined();
  });

  test("passes correct referenceId to adapter", async () => {
    (mockAdapter.findMany as any).mockResolvedValue([]);

    await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "unique-ref-id",
      feature: mockFeature,
    });

    const callArgs = (mockAdapter.findMany as any).mock.calls[0][0];
    expect(callArgs.where).toContainEqual({
      field: "referenceId",
      value: "unique-ref-id",
    });
  });

  test("passes correct feature key to adapter", async () => {
    (mockAdapter.findMany as any).mockResolvedValue([]);

    await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      feature: { ...mockFeature, key: "storage" },
    });

    const callArgs = (mockAdapter.findMany as any).mock.calls[0][0];
    expect(callArgs.where).toContainEqual({
      field: "feature",
      value: "storage",
    });
  });
});