import { describe, test, expect, beforeEach, mock } from "bun:test";
import { getUsageQuery } from "../get-usage";
import type { Adapter } from "better-auth";
import type { Feature, Usage } from "@/types";

describe("getUsageQuery", () => {
    let mockAdapter: Adapter;
    let mockFeature: Omit<Feature, "hooks">;

    beforeEach(() => {
        mockAdapter = {
            findMany: mock(() => Promise.resolve([])),
            create: mock(() => Promise.resolve({})),
        } as any;

        mockFeature = {
            key: "api-calls",
            reset: "daily",
            resetValue: 100,
            maxLimit: 1000
        };
    });

    describe("when no usage exists", () => {
        test("should create initial usage record with resetValue", async () => {
            const mockUsage = {
                id: "usage-1",
                referenceId: "user-123",
                feature: "api-calls",
                amount: 100,
                event: "reset",
                lastResetAt: new Date(),
                createdAt: new Date()
            };

            mockAdapter.findMany = mock(() => Promise.resolve([]));
            mockAdapter.create = mock(() => Promise.resolve(mockUsage));

            const result = await getUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: mockFeature
            });

            expect(mockAdapter.create).toHaveBeenCalled();
            expect(result).toBeDefined();
        });

        test("should handle feature without resetValue", async () => {
            const featureWithoutReset: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "never"
            };

            mockAdapter.findMany = mock(() => Promise.resolve([]));

            const result = await getUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: featureWithoutReset
            });

            expect(result).toBeUndefined();
        });
    });

    describe("when usage exists", () => {
        test("should return latest usage record", async () => {
            const mockUsageRecords: Usage[] = [
                {
                    id: "usage-1",
                    referenceId: "user-123",
                    feature: "api-calls",
                    amount: 50,
                    event: "use",
                    lastResetAt: new Date(),
                    createdAt: new Date()
                }
            ];

            mockAdapter.findMany = mock(() => Promise.resolve(mockUsageRecords));

            const result = await getUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: mockFeature
            });

            expect(result).toBe(mockUsageRecords[0]);
        });

        test("should calculate total usage from multiple records", async () => {
            const mockUsageRecords: Usage[] = [
                {
                    id: "usage-3",
                    referenceId: "user-123",
                    feature: "api-calls",
                    amount: 30,
                    event: "use",
                    lastResetAt: new Date(),
                    createdAt: new Date()
                },
                {
                    id: "usage-2",
                    referenceId: "user-123",
                    feature: "api-calls",
                    amount: 20,
                    event: "use",
                    lastResetAt: new Date(),
                    createdAt: new Date()
                },
                {
                    id: "usage-1",
                    referenceId: "user-123",
                    feature: "api-calls",
                    amount: 50,
                    event: "use",
                    lastResetAt: new Date(),
                    createdAt: new Date()
                }
            ];

            mockAdapter.findMany = mock(() => Promise.resolve(mockUsageRecords));

            const result = await getUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: mockFeature
            });

            expect(result).toBeDefined();
        });
    });

    describe("reset logic", () => {
        test("should trigger reset when reset period has passed", async () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 2); // 2 days ago

            const mockUsageRecords: Usage[] = [
                {
                    id: "usage-1",
                    referenceId: "user-123",
                    feature: "api-calls",
                    amount: 50,
                    event: "use",
                    lastResetAt: pastDate,
                    createdAt: pastDate
                }
            ];

            mockAdapter.findMany = mock(() => Promise.resolve(mockUsageRecords));
            mockAdapter.create = mock(() => Promise.resolve({
                id: "usage-reset",
                referenceId: "user-123",
                feature: "api-calls",
                amount: 50,
                event: "reset",
                lastResetAt: new Date(),
                createdAt: new Date()
            }));

            await getUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: mockFeature
            });

            expect(mockAdapter.create).toHaveBeenCalled();
        });

        test("should not trigger reset when within reset period", async () => {
            const recentDate = new Date();

            const mockUsageRecords: Usage[] = [
                {
                    id: "usage-1",
                    referenceId: "user-123",
                    feature: "api-calls",
                    amount: 50,
                    event: "use",
                    lastResetAt: recentDate,
                    createdAt: recentDate
                }
            ];

            mockAdapter.findMany = mock(() => Promise.resolve(mockUsageRecords));

            const result = await getUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: mockFeature
            });

            expect(result).toBe(mockUsageRecords[0]);
        });

        test("should handle null lastResetAt", async () => {
            const mockUsageRecords: Usage[] = [
                {
                    id: "usage-1",
                    referenceId: "user-123",
                    feature: "api-calls",
                    amount: 50,
                    event: "use",
                    lastResetAt: null as any,
                    createdAt: new Date()
                }
            ];

            mockAdapter.findMany = mock(() => Promise.resolve(mockUsageRecords));

            await getUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: mockFeature
            });

            expect(mockAdapter.findMany).toHaveBeenCalled();
        });
    });

    describe("edge cases", () => {
        test("should handle empty referenceId", async () => {
            mockAdapter.findMany = mock(() => Promise.resolve([]));

            await getUsageQuery({
                adapter: mockAdapter,
                referenceId: "",
                feature: mockFeature
            });

            expect(mockAdapter.findMany).toHaveBeenCalled();
        });

        test("should handle special characters in referenceId", async () => {
            const specialId = "user:with:colons@domain.com";
            mockAdapter.findMany = mock(() => Promise.resolve([]));

            await getUsageQuery({
                adapter: mockAdapter,
                referenceId: specialId,
                feature: mockFeature
            });

            expect(mockAdapter.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.arrayContaining([
                        { field: "referenceId", value: specialId }
                    ])
                })
            );
        });

        test("should handle quarterly reset type", async () => {
            const quarterlyFeature: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "quarterly",
                resetValue: 1000
            };

            mockAdapter.findMany = mock(() => Promise.resolve([]));

            await getUsageQuery({
                adapter: mockAdapter,
                referenceId: "user-123",
                feature: quarterlyFeature
            });

            expect(mockAdapter.findMany).toHaveBeenCalled();
        });

        test("should handle yearly reset type", async () => {
            const yearlyFeature: Omit<Feature, "hooks"> = {
                key: "storage",
                reset: "yearly",
                resetValue: 10000
            };

            mockAdapter.findMany = mock(() => Promise.resolve([]));

            await getUsageQuery({
                adapter: mockAdapter,
                referenceId: "org-456",
                feature: yearlyFeature
            });

            expect(mockAdapter.findMany).toHaveBeenCalled();
        });
    });
});