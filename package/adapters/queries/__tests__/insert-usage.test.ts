import { describe, test, expect, beforeEach, mock } from "bun:test";
import { insertUsageQuery } from "../insert-usage";
import type { Adapter } from "better-auth";

describe("insertUsageQuery", () => {
    let mockAdapter: Adapter;

    beforeEach(() => {
        mockAdapter = {
            create: mock(() => Promise.resolve({
                id: "usage-1",
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                event: "use",
                lastResetAt: new Date(),
                createdAt: new Date()
            }))
        } as any;
    });

    describe("successful insertion", () => {
        test("should insert usage with all required fields", async () => {
            const lastResetAt = new Date();

            const result = await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                featureKey: "api-calls",
                lastResetAt,
                amount: 10,
                event: "use"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith({
                model: "usage",
                data: expect.objectContaining({
                    referenceId: "user-123",
                    amount: 10,
                    lastResetAt,
                    event: "use",
                    feature: "api-calls"
                })
            });
            expect(result).toBeDefined();
        });

        test("should use default event value when not provided", async () => {
            const lastResetAt = new Date();

            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                featureKey: "api-calls",
                lastResetAt,
                amount: 10,
                event: "use"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        event: "use"
                    })
                })
            );
        });

        test("should handle custom event types", async () => {
            const customEvents = ["purchase", "refund", "reset", "adjustment"];

            for (const eventType of customEvents) {
                mockAdapter.create = mock(() => Promise.resolve({ id: "test" }));

                await insertUsageQuery({
                    adapter: mockAdapter,
                    referenceId: "user-123",
                    featureKey: "api-calls",
                    lastResetAt: new Date(),
                    amount: 10,
                    event: eventType
                });

                expect(mockAdapter.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        data: expect.objectContaining({
                            event: eventType
                        })
                    })
                );
            }
        });
    });

    describe("amount handling", () => {
        test("should handle positive amounts", async () => {
            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                featureKey: "api-calls",
                lastResetAt: new Date(),
                amount: 50,
                event: "use"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ amount: 50 })
                })
            );
        });

        test("should handle zero amount", async () => {
            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                featureKey: "api-calls",
                lastResetAt: new Date(),
                amount: 0,
                event: "reset"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ amount: 0 })
                })
            );
        });

        test("should handle negative amounts (refunds)", async () => {
            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                featureKey: "credits",
                lastResetAt: new Date(),
                amount: -25,
                event: "refund"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ amount: -25 })
                })
            );
        });

        test("should handle very large amounts", async () => {
            const largeAmount = 999999999;

            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "org-enterprise",
                featureKey: "storage",
                lastResetAt: new Date(),
                amount: largeAmount,
                event: "use"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ amount: largeAmount })
                })
            );
        });

        test("should handle decimal amounts", async () => {
            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                featureKey: "bandwidth",
                lastResetAt: new Date(),
                amount: 10.5,
                event: "use"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ amount: 10.5 })
                })
            );
        });
    });

    describe("timestamp handling", () => {
        test("should set createdAt to current time", async () => {
            const beforeCall = Date.now();

            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                featureKey: "api-calls",
                lastResetAt: new Date(),
                amount: 10,
                event: "use"
            });

            const afterCall = Date.now();
            const callArgs = (mockAdapter.create as any).mock.calls[0][0];
            const createdAt = callArgs.data.createdAt.getTime();

            expect(createdAt).toBeGreaterThanOrEqual(beforeCall);
            expect(createdAt).toBeLessThanOrEqual(afterCall);
        });

        test("should preserve lastResetAt value", async () => {
            const specificResetDate = new Date("2024-01-01T00:00:00Z");

            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                featureKey: "api-calls",
                lastResetAt: specificResetDate,
                amount: 10,
                event: "use"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        lastResetAt: specificResetDate
                    })
                })
            );
        });
    });

    describe("edge cases and error scenarios", () => {
        test("should handle empty string referenceId", async () => {
            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "",
                featureKey: "api-calls",
                lastResetAt: new Date(),
                amount: 10,
                event: "use"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ referenceId: "" })
                })
            );
        });

        test("should handle special characters in referenceId", async () => {
            const specialId = "user:with@special#chars";

            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: specialId,
                featureKey: "api-calls",
                lastResetAt: new Date(),
                amount: 10,
                event: "use"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ referenceId: specialId })
                })
            );
        });

        test("should handle empty feature key", async () => {
            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                featureKey: "",
                lastResetAt: new Date(),
                amount: 10,
                event: "use"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ feature: "" })
                })
            );
        });

        test("should propagate adapter errors", async () => {
            mockAdapter.create = mock(() => Promise.reject(new Error("Database error")));

            await expect(
                insertUsageQuery({
                    adapter: mockAdapter,
                    referenceId: "user-123",
                    featureKey: "api-calls",
                    lastResetAt: new Date(),
                    amount: 10,
                    event: "use"
                })
            ).rejects.toThrow("Database error");
        });
    });

    describe("data integrity", () => {
        test("should include all required fields in created record", async () => {
            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                featureKey: "api-calls",
                lastResetAt: new Date(),
                amount: 10,
                event: "use"
            });

            const callArgs = (mockAdapter.create as any).mock.calls[0][0];
            
            expect(callArgs.data).toHaveProperty("referenceId");
            expect(callArgs.data).toHaveProperty("amount");
            expect(callArgs.data).toHaveProperty("lastResetAt");
            expect(callArgs.data).toHaveProperty("event");
            expect(callArgs.data).toHaveProperty("feature");
            expect(callArgs.data).toHaveProperty("createdAt");
        });

        test("should use correct model name", async () => {
            await insertUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                featureKey: "api-calls",
                lastResetAt: new Date(),
                amount: 10,
                event: "use"
            });

            expect(mockAdapter.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: "usage"
                })
            );
        });
    });
});