import { describe, test, expect, mock } from "bun:test";
import { resetUsageQuery } from "../../../adapters/queries/reset-usage";
import type { Feature } from "../../../types";

describe("resetUsageQuery", () => {
  test("should return undefined when resetValue not defined", async () => {
    const mockAdapter = {} as any;
    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls"
    };

    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      feature
    });

    expect(result).toBeUndefined();
  });

  test("should reset with current value", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "reset-id",
      ...data.data
    }));

    const mockAdapter = {
      create: mockCreate
    } as any;

    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls",
      resetValue: 100
    };

    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      curr: 50,
      feature
    });

    expect(mockCreate).toHaveBeenCalled();
    expect(result?.amount).toBe(50); // 100 - 50
    expect(result?.event).toBe("reset");
  });

  test("should reset to full value when curr is 0", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "reset-id",
      ...data.data
    }));

    const mockAdapter = {
      create: mockCreate
    } as any;

    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls",
      resetValue: 100
    };

    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      curr: 0,
      feature
    });

    expect(result?.amount).toBe(100);
  });

  test("should handle transaction when curr not provided", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "reset-id",
      ...data.data
    }));

    const mockFindMany = mock(async () => []);

    const mockTx = {
      create: mockCreate,
      findMany: mockFindMany
    };

    const mockAdapter = {
      transaction: mock(async (callback: Function) => {
        return callback(mockTx);
      })
    } as any;

    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls",
      resetValue: 100
    };

    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      feature
    });

    expect(mockAdapter.transaction).toHaveBeenCalled();
    expect(mockFindMany).toHaveBeenCalled();
  });

  test("should calculate reset amount from existing usage", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "reset-id",
      ...data.data
    }));

    const mockFindMany = mock(async () => [
      { amount: 10, referenceId: "user-123", feature: "api-calls" },
      { amount: 20, referenceId: "user-123", feature: "api-calls" },
      { amount: 15, referenceId: "user-123", feature: "api-calls" }
    ]);

    const mockTx = {
      create: mockCreate,
      findMany: mockFindMany
    };

    const mockAdapter = {
      transaction: mock(async (callback: Function) => {
        return callback(mockTx);
      })
    } as any;

    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls",
      resetValue: 100
    };

    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      feature
    });

    // 100 - (10 + 20 + 15) = 55
    expect(result?.amount).toBe(55);
  });

  test("should set event to 'reset'", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "reset-id",
      ...data.data
    }));

    const mockAdapter = {
      create: mockCreate
    } as any;

    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls",
      resetValue: 100
    };

    await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      curr: 50,
      feature
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.data.event).toBe("reset");
  });

  test("should handle negative reset amounts", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "reset-id",
      ...data.data
    }));

    const mockAdapter = {
      create: mockCreate
    } as any;

    const feature: Omit<Feature, "hooks"> = {
      key: "api-calls",
      resetValue: 50
    };

    const result = await resetUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      curr: 100,
      feature
    });

    // 50 - 100 = -50 (overage)
    expect(result?.amount).toBe(-50);
  });
});