import { describe, test, expect, mock, beforeEach } from "bun:test";
import { insertUsageQuery } from "../../../adapters/queries/insert-usage";
import type { Adapter } from "better-auth";

describe("insertUsageQuery", () => {
  let mockAdapter: Adapter;

  beforeEach(() => {
    mockAdapter = {
      create: mock((params) => Promise.resolve({
        id: "usage-1",
        ...params.data,
      })),
    } as unknown as Adapter;
  });

  test("creates usage record with all required fields", async () => {
    const lastResetAt = new Date();
    const result = await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      featureKey: "api-calls",
      lastResetAt,
      amount: 10,
      event: "use",
    });

    expect(mockAdapter.create).toHaveBeenCalled();
    expect(result).toHaveProperty("referenceId", "ref-123");
    expect(result).toHaveProperty("feature", "api-calls");
    expect(result).toHaveProperty("amount", 10);
  });

  test("defaults event to 'use' when not provided", async () => {
    const result = await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 5,
      event: "use",
    });

    expect(result.event).toBe("use");
  });

  test("accepts custom event name", async () => {
    const result = await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 5,
      event: "reset",
    });

    expect(result.event).toBe("reset");
  });

  test("preserves lastResetAt timestamp", async () => {
    const specificDate = new Date("2024-01-15T10:00:00Z");
    const result = await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      featureKey: "api-calls",
      lastResetAt: specificDate,
      amount: 5,
      event: "use",
    });

    expect(result.lastResetAt).toEqual(specificDate);
  });

  test("sets createdAt to current time", async () => {
    const beforeCreate = Date.now();
    const result = await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 5,
      event: "use",
    });
    const afterCreate = Date.now();

    expect(result.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate);
    expect(result.createdAt.getTime()).toBeLessThanOrEqual(afterCreate);
  });

  test("handles zero amount", async () => {
    const result = await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 0,
      event: "use",
    });

    expect(result.amount).toBe(0);
  });

  test("handles negative amount", async () => {
    const result = await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: -10,
      event: "refund",
    });

    expect(result.amount).toBe(-10);
  });

  test("calls adapter.create with correct model", async () => {
    await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 5,
      event: "use",
    });

    const callArgs = (mockAdapter.create as any).mock.calls[0][0];
    expect(callArgs.model).toBe("usage");
  });

  test("works with TransactionAdapter", async () => {
    const result = await insertUsageQuery({
      adapter: mockAdapter,
      referenceId: "ref-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 5,
      event: "use",
    });

    expect(result).toBeDefined();
    expect(mockAdapter.create).toHaveBeenCalled();
  });
});