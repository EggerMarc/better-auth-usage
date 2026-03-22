import { describe, test, expect, beforeEach, mock } from "bun:test";
import { getUsageAdapter } from "../index";
import type { AuthContext } from "better-auth/types";
import type { Customer, Feature } from "@/types";

describe("getUsageAdapter", () => {
    let mockContext: AuthContext;
    let mockAdapter: any;

    beforeEach(() => {
        mockAdapter = {
            findMany: mock(async () => []),
            findOne: mock(async () => null),
            create: mock(async (params: any) => params.data),
            update: mock(async (params: any) => params.update),
            transaction: mock(async (callback: Function) => await callback(mockAdapter))
        };

        mockContext = {
            adapter: mockAdapter
        } as any;
    });

    describe("getLatestUsage", () => {
        test("should retrieve latest usage for a feature", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const testFeature: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "daily"
            };

            const mockUsage = {
                id: "usage-1",
                referenceId: "user-123",
                feature: "api-calls",
                amount: 50,
                lastResetAt: new Date(),
                createdAt: new Date()
            };

            mockAdapter.findMany = mock(async () => [mockUsage]);

            const result = await usageAdapter.getLatestUsage({
                referenceId: "user-123",
                feature: testFeature
            });

            expect(result).toBeDefined();
            expect(mockAdapter.findMany).toHaveBeenCalled();
        });

        test("should handle optional event parameter", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const testFeature: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "daily"
            };

            await usageAdapter.getLatestUsage({
                referenceId: "user-123",
                feature: testFeature,
                event: "purchase"
            });

            expect(mockAdapter.findMany).toHaveBeenCalled();
        });
    });

    describe("resetUsage", () => {
        test("should reset usage for a feature", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const testFeature: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "daily",
                resetValue: 100
            };

            mockAdapter.findMany = mock(async () => [
                { amount: 50, feature: "api-calls" }
            ]);

            const result = await usageAdapter.resetUsage({
                referenceId: "user-123",
                feature: testFeature,
                curr: 50
            });

            expect(mockAdapter.create).toHaveBeenCalled();
        });

        test("should handle reset without current amount", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const testFeature: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "daily",
                resetValue: 100
            };

            mockAdapter.findMany = mock(async () => []);

            await usageAdapter.resetUsage({
                referenceId: "user-123",
                feature: testFeature
            });

            expect(mockAdapter.transaction).toHaveBeenCalled();
        });
    });

    describe("insertUsage", () => {
        test("should insert usage record", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const testFeature: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "daily"
            };

            mockAdapter.findMany = mock(async () => [
                {
                    amount: 50,
                    lastResetAt: new Date(),
                    feature: "api-calls"
                }
            ]);

            const result = await usageAdapter.insertUsage({
                referenceId: "user-123",
                feature: testFeature,
                amount: 10,
                event: "use",
                lastResetAt: new Date()
            });

            expect(mockAdapter.create).toHaveBeenCalled();
        });

        test("should handle insert with lastResetAt", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const testFeature: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "daily"
            };

            const lastResetAt = new Date();
            mockAdapter.findMany = mock(async () => []);

            await usageAdapter.insertUsage({
                referenceId: "user-123",
                feature: testFeature,
                amount: 10,
                event: "use",
                lastResetAt
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        lastResetAt
                    })
                })
            );
        });
    });

    describe("getCustomer", () => {
        test("should retrieve customer by referenceId", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const testCustomer: Customer = {
                referenceId: "user-123",
                referenceType: "user",
                email: "test@example.com"
            };

            mockAdapter.findOne = mock(async () => testCustomer);

            const result = await usageAdapter.getCustomer({
                referenceId: "user-123"
            });

            expect(result).toEqual(testCustomer);
            expect(mockAdapter.findOne).toHaveBeenCalledWith({
                model: "customer",
                where: [{ field: "referenceId", value: "user-123" }]
            });
        });

        test("should return null when customer not found", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            mockAdapter.findOne = mock(async () => null);

            const result = await usageAdapter.getCustomer({
                referenceId: "nonexistent"
            });

            expect(result).toBeNull();
        });
    });

    describe("upsertCustomer", () => {
        test("should create new customer when not exists", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const testCustomer: Customer = {
                referenceId: "user-123",
                referenceType: "user"
            };

            mockAdapter.transaction = mock(async (callback: Function) => {
                let callCount = 0;
                const txAdapter = {
                    findOne: mock(async () => {
                        callCount++;
                        // First call: check if exists (null), second call: return persisted
                        return callCount === 1 ? null : testCustomer;
                    }),
                    create: mock(async (params: any) => params.data)
                };
                return await callback(txAdapter);
            });

            const result = await usageAdapter.upsertCustomer(testCustomer);

            expect(result).toEqual(testCustomer);
        });

        test("should update existing customer", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const existingCustomer: Customer = {
                referenceId: "user-123",
                referenceType: "user",
                email: "old@example.com"
            };
            const updatedCustomer: Customer = {
                ...existingCustomer,
                email: "new@example.com"
            };

            mockAdapter.transaction = mock(async (callback: Function) => {
                let callCount = 0;
                const txAdapter = {
                    findOne: mock(async () => {
                        callCount++;
                        // First call: find existing, second call: return updated
                        return callCount === 1 ? existingCustomer : updatedCustomer;
                    }),
                    update: mock(async () => updatedCustomer)
                };
                return await callback(txAdapter);
            });

            const result = await usageAdapter.upsertCustomer(updatedCustomer);

            expect(result).toEqual(updatedCustomer);
        });
    });

    describe("getUsage", () => {
        test("should retrieve usage for feature", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const testFeature: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "daily"
            };

            const mockUsages = [
                { amount: 30, feature: "api-calls" },
                { amount: 20, feature: "api-calls" }
            ];

            mockAdapter.findMany = mock(async () => mockUsages);

            const result = await usageAdapter.getUsage({
                referenceId: "user-123",
                feature: testFeature
            });

            expect(result).toBeDefined();
            expect(mockAdapter.findMany).toHaveBeenCalled();
        });

        test("should calculate total usage amount", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const testFeature: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "daily"
            };

            const mockUsages = [
                { amount: 30, feature: "api-calls", lastResetAt: new Date() },
                { amount: 20, feature: "api-calls", lastResetAt: new Date() },
                { amount: 10, feature: "api-calls", lastResetAt: new Date() }
            ];

            mockAdapter.findMany = mock(async () => mockUsages);

            const result = await usageAdapter.getUsage({
                referenceId: "user-123",
                feature: testFeature
            });

            expect(result.amount).toBe(60);
        });
    });

    describe("edge cases", () => {
        test("should handle adapter with no data", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            mockAdapter.findMany = mock(async () => []);

            const result = await usageAdapter.getLatestUsage({
                referenceId: "user-123",
                feature: { key: "api-calls", reset: "daily" }
            });

            expect(result).toBeUndefined();
        });

        test("should handle transaction rollback", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            mockAdapter.transaction = mock(async () => {
                throw new Error("Transaction failed");
            });

            await expect(
                usageAdapter.resetUsage({
                    referenceId: "user-123",
                    feature: { key: "api-calls", reset: "daily", resetValue: 100 }
                })
            ).rejects.toThrow();
        });

        test("should handle concurrent operations", async () => {
            const usageAdapter = getUsageAdapter(mockContext);
            const testFeature: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "daily"
            };

            mockAdapter.findMany = mock(async () => [
                { amount: 50, lastResetAt: new Date() }
            ]);

            const operations = [
                usageAdapter.getLatestUsage({ referenceId: "user-123", feature: testFeature }),
                usageAdapter.getLatestUsage({ referenceId: "user-456", feature: testFeature }),
                usageAdapter.getLatestUsage({ referenceId: "user-789", feature: testFeature })
            ];

            const results = await Promise.all(operations);
            expect(results).toHaveLength(3);
        });
    });
});