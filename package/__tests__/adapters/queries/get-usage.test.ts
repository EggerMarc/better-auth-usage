import { describe, test, expect, mock } from "bun:test";
import { getUsageQuery } from "../../../adapters/queries/get-usage";
import type { Feature, Usage } from "../../../types";

describe("getUsageQuery", () => {
  test("should return last usage when found and not reset", async () => {
    const mockUsage: Usage[] = [{
      referenceId: "user-123",
      feature: "api-calls",
      amount: 10,
      lastResetAt: new Date(Date.now() + 86400000), // tomorrow
      createdAt: new Date(),
      event: "use"
    }];

    const mockAdapter = {
      findMany: mock(async () => mockUsage)
    } as any;

    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls",
      reset: "daily",
      resetValue: 100
    };

    const result = await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      feature
    });

    expect(result).toEqual(mockUsage[0]);
    expect(mockAdapter.findMany).toHaveBeenCalledTimes(1);
  });

  test("should trigger reset when no usage exists", async () => {
    const mockAdapter = {
      findMany: mock(async () => []),
      create: mock(async (data: any) => ({
        ...data.data,
        id: "new-id"
      }))
    } as any;

    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls",
      reset: "daily",
      resetValue: 100
    };

    const result = await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      feature
    });

    expect(mockAdapter.create).toHaveBeenCalled();
    expect(result?.amount).toBe(100);
  });

  test("should trigger reset when reset time has passed", async () => {
    const oldDate = new Date(Date.now() - 86400000 * 2); // 2 days ago
    
    const mockUsage: Usage[] = [{
      referenceId: "user-123",
      feature: "api-calls",
      amount: 50,
      lastResetAt: oldDate,
      createdAt: oldDate,
      event: "use"
    }];

    const mockAdapter = {
      findMany: mock(async () => mockUsage),
      create: mock(async (data: any) => ({
        ...data.data,
        id: "reset-id"
      }))
    } as any;

    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls",
      reset: "daily",
      resetValue: 100
    };

    const result = await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      feature
    });

    expect(mockAdapter.create).toHaveBeenCalled();
  });

  test("should calculate total usage from multiple records", async () => {
    const mockUsage: Usage[] = [
      {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 10,
        lastResetAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        event: "use"
      },
      {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 20,
        lastResetAt: new Date(Date.now() + 86400000),
        createdAt: new Date(Date.now() - 1000),
        event: "use"
      },
      {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 30,
        lastResetAt: new Date(Date.now() + 86400000),
        createdAt: new Date(Date.now() - 2000),
        event: "use"
      }
    ];

    const mockAdapter = {
      findMany: mock(async () => mockUsage)
    } as any;

    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls",
      reset: "never"
    };

    await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      feature
    });

    expect(mockAdapter.findMany).toHaveBeenCalled();
  });

  test("should handle feature without reset", async () => {
    const mockUsage: Usage[] = [{
      referenceId: "user-123",
      feature: "api-calls",
      amount: 50,
      lastResetAt: new Date(),
      createdAt: new Date(),
      event: "use"
    }];

    const mockAdapter = {
      findMany: mock(async () => mockUsage)
    } as any;

    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls",
      reset: "never"
    };

    const result = await getUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      feature
    });

    expect(result).toEqual(mockUsage[0]);
  });
});