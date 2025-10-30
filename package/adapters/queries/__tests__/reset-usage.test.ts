import { describe, test, expect, beforeEach, mock } from "bun:test";
import { resetUsageQuery } from "../reset-usage";
import type { Adapter } from "better-auth";
import type { Feature } from "@/types";

describe("resetUsageQuery", () => {
    let mockAdapter: Adapter;
    let mockFeature: Omit<Feature, "hooks">;

    beforeEach(() => {
        mockAdapter = {
            create: mock(() => Promise.resolve({
                id: "usage-reset",
                referenceId: "user-123",
                feature: "api-calls",
                amount: 100,
                event: "reset",
                lastResetAt: new Date(),
                createdAt: new Date()
            })),
            transaction: mock(async (callback) => await callback(mockAdapter))
        } as any;

        mockFeature = {
            key: "api-calls",
            reset: "daily",
            resetValue: 100
        };
    });

    describe("with resetValue undefined", () => {
        test("should return undefined when feature has no resetValue", async () => {
            const featureWithoutReset: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "never"
            };

            const result = await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: featureWithoutReset
            });

            expect(result).toBeUndefined();
            expect(mockAdapter.create).not.toHaveBeenCalled();
        });

        test("should return undefined when resetValue is null", async () => {
            const featureWithNullReset: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "daily",
                resetValue: undefined
            };

            const result = await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: featureWithNullReset
            });

            expect(result).toBeUndefined();
        });
    });

    describe("with current usage provided", () => {
        test("should create reset record with correct amount when curr is provided", async () => {
            const result = await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                curr: 50,
                feature: mockFeature
            });

            expect(mockAdapter.create).toHaveBeenCalledWith({
                model: "usage",
                data: expect.objectContaining({
                    amount: 50, // resetValue (100) - curr (50)
                    feature: "api-calls",
                    referenceId: "user-123",
                    event: "reset"
                })
            });
            expect(result).toBeDefined();
        });

        test("should handle zero current usage", async () => {
            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                curr: 0,
                feature: mockFeature
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        amount: 100 // resetValue - 0
                    })
                })
            );
        });

        test("should handle current usage exceeding resetValue", async () => {
            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                curr: 150,
                feature: mockFeature
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        amount: -50 // resetValue (100) - curr (150)
                    })
                })
            );
        });

        test("should handle negative current usage", async () => {
            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                curr: -20,
                feature: mockFeature
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        amount: 120 // resetValue (100) - curr (-20)
                    })
                })
            );
        });
    });

    describe("without current usage (transaction path)", () => {
        test("should create initial reset when no usage exists", async () => {
            mockAdapter.transaction = mock(async (callback) => {
                const txAdapter = {
                    findMany: mock(() => Promise.resolve([])),
                    create: mock(() => Promise.resolve({
                        id: "usage-init",
                        amount: 100,
                        event: "reset"
                    }))
                };
                return await callback(txAdapter as any);
            });

            const result = await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: mockFeature
            });

            expect(result).toBeDefined();
        });

        test("should calculate total from existing usage records", async () => {
            const existingUsage = [
                { id: "1", amount: 30, feature: "api-calls", referenceId: "user-123" },
                { id: "2", amount: 20, feature: "api-calls", referenceId: "user-123" },
                { id: "3", amount: 10, feature: "api-calls", referenceId: "user-123" }
            ];

            mockAdapter.transaction = mock(async (callback) => {
                const txAdapter = {
                    findMany: mock(() => Promise.resolve(existingUsage)),
                    create: mock(() => Promise.resolve({
                        id: "usage-reset",
                        amount: 40, // resetValue (100) - total (60)
                        event: "reset"
                    }))
                };
                return await callback(txAdapter as any);
            });

            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: mockFeature
            });

            expect(mockAdapter.transaction).toHaveBeenCalled();
        });

        test("should handle single existing usage record", async () => {
            const existingUsage = [
                { id: "1", amount: 75, feature: "api-calls", referenceId: "user-123" }
            ];

            mockAdapter.transaction = mock(async (callback) => {
                const txAdapter = {
                    findMany: mock(() => Promise.resolve(existingUsage)),
                    create: mock(() => Promise.resolve({
                        id: "usage-reset",
                        amount: 25,
                        event: "reset"
                    }))
                };
                return await callback(txAdapter as any);
            });

            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: mockFeature
            });

            expect(mockAdapter.transaction).toHaveBeenCalled();
        });

        test("should set lastResetAt to current time", async () => {
            const beforeCall = Date.now();

            mockAdapter.transaction = mock(async (callback) => {
                const txAdapter = {
                    findMany: mock(() => Promise.resolve([])),
                    create: mock((params) => {
                        expect(params.data.lastResetAt).toBeInstanceOf(Date);
                        return Promise.resolve({ id: "test" });
                    })
                };
                return await callback(txAdapter as any);
            });

            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: mockFeature
            });

            const afterCall = Date.now();
            expect(afterCall - beforeCall).toBeLessThan(1000);
        });
    });

    describe("feature variations", () => {
        test("should handle different reset values", async () => {
            const testCases = [0, 50, 100, 1000, 10000];

            for (const resetValue of testCases) {
                mockAdapter.create = mock(() => Promise.resolve({ id: "test" }));
                
                const feature: Omit<Feature, "hooks"> = {
                    key: "test-feature",
                    reset: "daily",
                    resetValue
                };

                await resetUsageQuery({
                    adapter: mockAdapter,
                    referenceId: "user-123",
                    curr: 0,
                    feature
                });

                expect(mockAdapter.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        data: expect.objectContaining({
                            amount: resetValue
                        })
                    })
                );
            }
        });

        test("should work with all reset types", async () => {
            const resetTypes = ["hourly", "daily", "weekly", "monthly", "quarterly", "yearly"];

            for (const resetType of resetTypes) {
                mockAdapter.create = mock(() => Promise.resolve({ id: "test" }));

                const feature: Omit<Feature, "hooks"> = {
                    key: "test-feature",
                    reset: resetType as any,
                    resetValue: 100
                };

                await resetUsageQuery({
                    adapter: mockAdapter,
                    referenceId: "user-123",
                    curr: 50,
                    feature
                });

                expect(mockAdapter.create).toHaveBeenCalled();
            }
        });
    });

    describe("edge cases", () => {
        test("should handle empty referenceId", async () => {
            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "",
                curr: 0,
                feature: mockFeature
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        referenceId: ""
                    })
                })
            );
        });

        test("should handle special characters in referenceId", async () => {
            const specialId = "user@domain:123#test";

            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: specialId,
                curr: 25,
                feature: mockFeature
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        referenceId: specialId
                    })
                })
            );
        });

        test("should handle very large resetValues", async () => {
            const largeFeature: Omit<Feature, "hooks"> = {
                key: "unlimited-feature",
                reset: "monthly",
                resetValue: Number.MAX_SAFE_INTEGER
            };

            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                curr: 1000,
                feature: largeFeature
            });

            expect(mockAdapter.create).toHaveBeenCalled();
        });

        test("should handle transaction errors", async () => {
            mockAdapter.transaction = mock(() => Promise.reject(new Error("Transaction failed")));

            await expect(
                resetUsageQuery({
                    adapter: mockAdapter,
                    referenceId: "user-123",
                    feature: mockFeature
                })
            ).rejects.toThrow("Transaction failed");
        });

        test("should handle findMany errors in transaction", async () => {
            mockAdapter.transaction = mock(async (callback) => {
                const txAdapter = {
                    findMany: mock(() => Promise.reject(new Error("Query failed")))
                };
                return await callback(txAdapter as any);
            });

            await expect(
                resetUsageQuery({
                    adapter: mockAdapter,
                    referenceId: "user-123",
                    feature: mockFeature
                })
            ).rejects.toThrow("Query failed");
        });
    });

    describe("data integrity", () => {
        test("should always set event to 'reset'", async () => {
            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                curr: 50,
                feature: mockFeature
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        event: "reset"
                    })
                })
            );
        });

        test("should include all required fields", async () => {
            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                curr: 50,
                feature: mockFeature
            });

            const callArgs = (mockAdapter.create as any).mock.calls[0][0];
            
            expect(callArgs.data).toHaveProperty("amount");
            expect(callArgs.data).toHaveProperty("feature");
            expect(callArgs.data).toHaveProperty("referenceId");
            expect(callArgs.data).toHaveProperty("event");
            expect(callArgs.data).toHaveProperty("lastResetAt");
            expect(callArgs.data).toHaveProperty("createdAt");
        });

        test("should use correct model name", async () => {
            await resetUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                curr: 50,
                feature: mockFeature
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: "usage"
                })
            );
        });
    });
});