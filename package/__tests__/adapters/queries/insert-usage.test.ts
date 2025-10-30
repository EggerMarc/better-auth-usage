import { describe, test, expect, mock } from "bun:test";
import { insertUsageQuery } from "../../../adapters/queries/insert-usage";
import type { Adapter } from "better-auth";

describe("insertUsageQuery", () => {
  const createMockAdapter = (): Adapter => ({
    create: mock(async (params: any) => ({
      ...params.data,
      id: "mock-id",
    })),
  } as any);

  test("should insert usage with all required fields", async () => {
    const adapter = createMockAdapter();
    const lastResetAt = new Date();

    const result = await insertUsageQuery({
      adapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt,
      amount: 10,
      event: "use",
    });

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "usage",
        data: expect.objectContaining({
          referenceId: "user-123",
          feature: "api-calls",
          amount: 10,
          event: "use",
          lastResetAt,
        }),
      })
    );
    expect(result).toHaveProperty("id");
  });

  test("should use default event value", async () => {
    const adapter = createMockAdapter();

    await insertUsageQuery({
      adapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 5,
      event: "use",
    });

    expect(adapter.create).toHaveBeenCalled();
  });

  test("should handle zero amount", async () => {
    const adapter = createMockAdapter();

    const result = await insertUsageQuery({
      adapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 0,
      event: "reset",
    });

    expect(result).toHaveProperty("amount", 0);
  });

  test("should handle negative amounts for decrements", async () => {
    const adapter = createMockAdapter();

    const result = await insertUsageQuery({
      adapter,
      referenceId: "user-123",
      featureKey: "credits",
      lastResetAt: new Date(),
      amount: -50,
      event: "refund",
    });

    expect(result).toHaveProperty("amount", -50);
  });

  test("should handle custom event types", async () => {
    const adapter = createMockAdapter();

    await insertUsageQuery({
      adapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 15,
      event: "custom-event",
    });

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: "custom-event",
        }),
      })
    );
  });

  test("should include createdAt timestamp", async () => {
    const adapter = createMockAdapter();
    const beforeCreate = Date.now();

    await insertUsageQuery({
      adapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 10,
      event: "use",
    });

    const afterCreate = Date.now();

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdAt: expect.any(Date),
        }),
      })
    );
  });

  test("should handle different feature keys", async () => {
    const adapter = createMockAdapter();

    await insertUsageQuery({
      adapter,
      referenceId: "org-456",
      featureKey: "storage-quota",
      lastResetAt: new Date(),
      amount: 1024,
      event: "use",
    });

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feature: "storage-quota",
        }),
      })
    );
  });

  test("should preserve lastResetAt value", async () => {
    const adapter = createMockAdapter();
    const specificResetDate = new Date("2024-01-01T00:00:00Z");

    await insertUsageQuery({
      adapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt: specificResetDate,
      amount: 10,
      event: "use",
    });

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastResetAt: specificResetDate,
        }),
      })
    );
  });

  test("should work with TransactionAdapter", async () => {
    const txAdapter = {
      create: mock(async (params: any) => ({
        ...params.data,
        id: "tx-mock-id",
      })),
    } as any;

    const result = await insertUsageQuery({
      adapter: txAdapter,
      referenceId: "user-123",
      featureKey: "api-calls",
      lastResetAt: new Date(),
      amount: 10,
      event: "use",
    });

    expect(txAdapter.create).toHaveBeenCalled();
    expect(result).toHaveProperty("id", "tx-mock-id");
  });
});