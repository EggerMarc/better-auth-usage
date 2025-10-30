import { describe, test, expect, mock } from "bun:test";
import { getUsageAdapter } from "../../adapters";
import type { AuthContext } from "better-auth/types";
import type { Customer, Usage } from "../../types";

describe("getUsageAdapter", () => {
  const createMockContext = (): AuthContext => ({
    adapter: {
      findOne: mock(async () => null),
      findMany: mock(async () => []),
      create: mock(async (params: any) => ({
        ...params.data,
        id: "mock-id",
      })),
      update: mock(async () => null),
      delete: mock(async () => null),
      transaction: mock(async (fn: any) => {
        const tx = createMockContext().adapter;
        return await fn(tx);
      }),
    },
  } as any);

  describe("findLatestUsage", () => {
    test("should find latest usage by referenceId and featureKey", async () => {
      const mockUsage: Usage = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 50,
        event: "use",
        lastResetAt: new Date(),
        createdAt: new Date(),
      };

      const context = createMockContext();
      context.adapter.findMany = mock(async () => [mockUsage]);
      
      const adapter = getUsageAdapter(context);
      const result = await adapter.findLatestUsage({
        referenceId: "user-123",
        featureKey: "api-calls",
      });

      expect(result).toEqual(mockUsage);
    });

    test("should include event filter when provided", async () => {
      const context = createMockContext();
      const adapter = getUsageAdapter(context);
      
      await adapter.findLatestUsage({
        referenceId: "user-123",
        featureKey: "api-calls",
        event: "reset",
      });

      expect(context.adapter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.arrayContaining([
            { field: "event", value: "reset" },
          ]),
        })
      );
    });
  });

  describe("getCustomer", () => {
    test("should retrieve customer by referenceId", async () => {
      const mockCustomer: Customer = {
        referenceId: "user-123",
        referenceType: "user",
        email: "test@example.com",
      };

      const context = createMockContext();
      context.adapter.findOne = mock(async () => mockCustomer);
      
      const adapter = getUsageAdapter(context);
      const result = await adapter.getCustomer({ referenceId: "user-123" });

      expect(result).toEqual(mockCustomer);
    });

    test("should return null for non-existent customer", async () => {
      const context = createMockContext();
      const adapter = getUsageAdapter(context);
      
      const result = await adapter.getCustomer({ referenceId: "nonexistent" });

      expect(result).toBeNull();
    });
  });

  describe("upsertCustomer", () => {
    test("should create new customer when not exists", async () => {
      const newCustomer: Customer = {
        referenceId: "user-new",
        referenceType: "user",
        email: "new@example.com",
      };

      const context = createMockContext();
      const adapter = getUsageAdapter(context);
      
      const result = await adapter.upsertCustomer(newCustomer);

      expect(context.adapter.transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    test("should update existing customer", async () => {
      const existingCustomer: Customer = {
        referenceId: "user-existing",
        referenceType: "user",
        email: "existing@example.com",
      };

      const context = createMockContext();
      context.adapter.transaction = mock(async (fn: any) => {
        const tx = {
          findOne: mock(async () => existingCustomer),
          update: mock(async () => ({
            ...existingCustomer,
            email: "updated@example.com",
          })),
          create: mock(async () => null),
        };
        return await fn(tx);
      });
      
      const adapter = getUsageAdapter(context);
      const result = await adapter.upsertCustomer({
        ...existingCustomer,
        email: "updated@example.com",
      });

      expect(context.adapter.transaction).toHaveBeenCalled();
    });
  });

  describe("insertUsage", () => {
    test("should insert usage with correct values", async () => {
      const context = createMockContext();
      const adapter = getUsageAdapter(context);
      
      const result = await adapter.insertUsage({
        amount: 10,
        referenceId: "user-123",
        event: "use",
        feature: {
          key: "api-calls",
          maxLimit: 1000,
        },
      });

      expect(context.adapter.transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    test("should handle usage insertion within transaction", async () => {
      const context = createMockContext();
      const adapter = getUsageAdapter(context);
      
      await adapter.insertUsage({
        amount: 5,
        referenceId: "user-123",
        event: "use",
        feature: {
          key: "api-calls",
          maxLimit: 1000,
          resetValue: 0,
        },
      });

      expect(context.adapter.transaction).toHaveBeenCalled();
    });
  });

  describe("syncUsage", () => {
    test("should sync usage for feature", async () => {
      const context = createMockContext();
      context.adapter.findMany = mock(async () => [{
        referenceId: "user-123",
        feature: "api-calls",
        amount: 50,
        event: "use",
        lastResetAt: new Date(),
        createdAt: new Date(),
      }]);
      
      const adapter = getUsageAdapter(context);
      const result = await adapter.syncUsage({
        referenceId: "user-123",
        feature: {
          key: "api-calls",
          reset: "daily",
          resetValue: 0,
        },
      });

      expect(result).toBeDefined();
    });
  });

  describe("getUsage", () => {
    test("should retrieve current usage", async () => {
      const mockUsage: Usage = {
        referenceId: "user-123",
        feature: "api-calls",
        amount: 100,
        event: "use",
        lastResetAt: new Date(),
        createdAt: new Date(),
      };

      const context = createMockContext();
      context.adapter.findMany = mock(async () => [mockUsage]);
      
      const adapter = getUsageAdapter(context);
      const result = await adapter.getUsage({
        referenceId: "user-123",
        feature: {
          key: "api-calls",
          maxLimit: 1000,
        },
      });

      expect(result).toBeDefined();
    });
  });

  describe("resetUsage", () => {
    test("should reset usage with current value", async () => {
      const context = createMockContext();
      const adapter = getUsageAdapter(context);
      
      const result = await adapter.resetUsage({
        referenceId: "user-123",
        curr: 500,
        feature: {
          key: "api-calls",
          resetValue: 1000,
        },
      });

      expect(result).toBeDefined();
    });

    test("should handle reset without current value", async () => {
      const context = createMockContext();
      const adapter = getUsageAdapter(context);
      
      const result = await adapter.resetUsage({
        referenceId: "user-123",
        feature: {
          key: "api-calls",
          resetValue: 1000,
        },
      });

      expect(result).toBeDefined();
    });
  });
});