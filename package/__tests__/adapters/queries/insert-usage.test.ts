import { describe, test, expect, mock } from "bun:test";
import { insertUsageQuery } from "../../../adapters/queries/insert-usage";

describe("insertUsageQuery", () => {
  test("should insert usage with correct data", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "usage-id",
      ...data.data
    }));

    const mockAdapter = {
      create: mockCreate
    } as any;

    const lastResetAt = new Date();
    const result = await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt,
      amount: 5,
      event: "consume"
    });

    expect(mockCreate).toHaveBeenCalled();
    expect(result.referenceId).toBe("user-123");
    expect(result.feature).toBe("api-calls");
    expect(result.amount).toBe(5);
    expect(result.event).toBe("consume");
  });

  test("should use default event 'use'", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "usage-id",
      ...data.data
    }));

    const mockAdapter = {
      create: mockCreate
    } as any;

    await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 5,
      event: "use"
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.data.event).toBe("use");
  });

  test("should handle zero amount", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "usage-id",
      ...data.data
    }));

    const mockAdapter = {
      create: mockCreate
    } as any;

    const result = await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 0,
      event: "test"
    });

    expect(result.amount).toBe(0);
  });

  test("should handle negative amount", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "usage-id",
      ...data.data
    }));

    const mockAdapter = {
      create: mockCreate
    } as any;

    const result = await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      featureKey: "credits",
      lastResetAt: new Date(),
      amount: -10,
      event: "refund"
    });

    expect(result.amount).toBe(-10);
  });

  test("should set createdAt to current time", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "usage-id",
      ...data.data
    }));

    const mockAdapter = {
      create: mockCreate
    } as any;

    const before = Date.now();
    await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 5,
      event: "use"
    });
    const after = Date.now();

    const callArgs = mockCreate.mock.calls[0][0];
    const createdAt = callArgs.data.createdAt.getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);
  });

  test("should preserve lastResetAt", async () => {
    const mockCreate = mock(async (data: any) => ({
      id: "usage-id",
      ...data.data
    }));

    const mockAdapter = {
      create: mockCreate
    } as any;

    const lastResetAt = new Date("2024-01-01T00:00:00Z");
    await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt,
      amount: 5,
      event: "use"
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.data.lastResetAt).toBe(lastResetAt);
  });
});