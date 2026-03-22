import { describe, test, expect, beforeEach, mock } from "bun:test";
import { resolveGetUsage } from "../get-usage";
import type { UsageAdapter } from "@/adapters";
import type { Feature, Usage, UsageOptionsWithCache } from "@/types";
import { APIError } from "better-auth";

describe("resolveGetUsage", () => {
    let mockAdapter: UsageAdapter;
    let mockCache: any;
    let options: UsageOptionsWithCache;
    let testFeature: Omit<Feature, "hooks">;
    let testUsage: Usage;

    beforeEach(() => {
        testUsage = {
            referenceId: "user-123",
            feature: "api-calls",
            amount: 50,
            event: "use",
            lastResetAt: new Date(),
            createdAt: new Date()
        };

        testFeature = {
            key: "api-calls",
            reset: "daily",
            resetValue: 100,
            maxLimit: 1000
        };

        mockAdapter = {
            getUsage: mock(async () => testUsage)
        } as any;

        mockCache = {
            getUsage: mock(async () => null),
            setLimit: mock(async () => ({})),
            insertEvent: mock(async () => ({}))
        };

        options = {
            features: {},
            cache: mockCache
        };
    });

    describe("with cache enabled", () => {
        test("should return usage from cache when available", async () => {
            const cachedUsage = {
                referenceId: "user-123",
                feature: "api-calls",
                current: 50,
                lastResetAt: new Date(),
                updatedAt: new Date()
            };
            mockCache.getUsage = mock(async () => cachedUsage);

            const result = await resolveGetUsage({
                referenceId: "user-123",
                feature: testFeature,
                options,
                adapter: mockAdapter
            });

            expect(result).toBeDefined();
            expect(mockCache.getUsage).toHaveBeenCalled();
            expect(mockAdapter.getUsage).not.toHaveBeenCalled();
        });

        test("should fall back to DB when cache returns null", async () => {
            mockCache.getUsage = mock(async () => null);

            const result = await resolveGetUsage({
                referenceId: "user-123",
                feature: testFeature,
                options,
                adapter: mockAdapter
            });

            expect(result).toBeDefined();
            expect(mockCache.getUsage).toHaveBeenCalled();
            expect(mockAdapter.getUsage).toHaveBeenCalled();
        });

        test("should throw INTERNAL_SERVER_ERROR when cache fails", async () => {
            mockCache.getUsage = mock(async () => {
                throw new Error("Cache connection failed");
            });

            await expect(
                resolveGetUsage({
                    referenceId: "user-123",
                    feature: testFeature,
                    options,
                    adapter: mockAdapter
                })
            ).rejects.toThrow(APIError);
        });

        test("should set limit in cache after DB retrieval", async () => {
            mockCache.getUsage = mock(async () => null);

            await resolveGetUsage({
                referenceId: "user-123",
                feature: testFeature,
                options,
                adapter: mockAdapter
            });

            expect(mockCache.setLimit).toHaveBeenCalled();
        });

        test("should insert event in cache after DB retrieval", async () => {
            mockCache.getUsage = mock(async () => null);

            await resolveGetUsage({
                referenceId: "user-123",
                feature: testFeature,
                options,
                adapter: mockAdapter
            });

            expect(mockCache.insertEvent).toHaveBeenCalled();
        });
    });

    describe("without cache", () => {
        beforeEach(() => {
            options = { features: {} };
        });

        test("should retrieve usage from DB", async () => {
            const result = await resolveGetUsage({
                referenceId: "user-123",
                feature: testFeature,
                options,
                adapter: mockAdapter
            });

            expect(result).toEqual(testUsage);
            expect(mockAdapter.getUsage).toHaveBeenCalled();
        });

        test("should throw NOT_FOUND when usage doesn't exist", async () => {
            mockAdapter.getUsage = mock(async () => null);

            await expect(
                resolveGetUsage({
                    referenceId: "user-123",
                    feature: testFeature,
                    options,
                    adapter: mockAdapter
                })
            ).rejects.toThrow(APIError);
        });

        test("should throw INTERNAL_SERVER_ERROR on DB error", async () => {
            mockAdapter.getUsage = mock(async () => {
                throw new Error("Database error");
            });

            await expect(
                resolveGetUsage({
                    referenceId: "user-123",
                    feature: testFeature,
                    options,
                    adapter: mockAdapter
                })
            ).rejects.toThrow(APIError);
        });
    });

    describe("reset logic", () => {
        test("should handle feature with reset enabled", async () => {
            const featureWithReset: Omit<Feature, "hooks"> = {
                key: "api-calls",
                reset: "daily",
                resetValue: 100
            };

            options = { features: {}, cache: mockCache };
            mockCache.getUsage = mock(async () => null);

            await resolveGetUsage({
                referenceId: "user-123",
                feature: featureWithReset,
                options,
                adapter: mockAdapter
            });

            expect(mockCache.setLimit).toHaveBeenCalled();
        });

        test("should handle feature without reset", async () => {
            const featureNoReset: Omit<Feature, "hooks"> = {
                key: "storage",
                reset: undefined
            };

            options = { features: {}, cache: mockCache };
            mockCache.getUsage = mock(async () => null);

            await resolveGetUsage({
                referenceId: "user-123",
                feature: featureNoReset,
                options,
                adapter: mockAdapter
            });

            expect(mockAdapter.getUsage).toHaveBeenCalled();
        });

        test("should handle various reset types", async () => {
            const resetTypes = ["hourly", "daily", "weekly", "monthly", "quarterly", "yearly"];

            for (const resetType of resetTypes) {
                mockAdapter.getUsage = mock(async () => testUsage);
                mockCache.getUsage = mock(async () => null);

                const feature: Omit<Feature, "hooks"> = {
                    key: "test-feature",
                    reset: resetType as any,
                    resetValue: 100
                };

                await resolveGetUsage({
                    referenceId: "user-123",
                    feature,
                    options: { features: {}, cache: mockCache },
                    adapter: mockAdapter
                });

                expect(mockAdapter.getUsage).toHaveBeenCalled();
            }
        });
    });

    describe("edge cases", () => {
        test("should handle empty referenceId", async () => {
            await expect(
                resolveGetUsage({
                    referenceId: "",
                    feature: testFeature,
                    options: { features: {} },
                    adapter: mockAdapter
                })
            ).resolves.toBeDefined();
        });

        test("should handle special characters in referenceId", async () => {
            const result = await resolveGetUsage({
                referenceId: "user@test.com:123",
                feature: testFeature,
                options: { features: {} },
                adapter: mockAdapter
            });

            expect(result).toBeDefined();
        });

        test("should handle usage with zero amount", async () => {
            mockAdapter.getUsage = mock(async () => ({
                ...testUsage,
                amount: 0
            }));

            const result = await resolveGetUsage({
                referenceId: "user-123",
                feature: testFeature,
                options: { features: {} },
                adapter: mockAdapter
            });

            expect(result.amount).toBe(0);
        });

        test("should handle usage with negative amount", async () => {
            mockAdapter.getUsage = mock(async () => ({
                ...testUsage,
                amount: -50
            }));

            const result = await resolveGetUsage({
                referenceId: "user-123",
                feature: testFeature,
                options: { features: {} },
                adapter: mockAdapter
            });

            expect(result.amount).toBe(-50);
        });

        test("should handle very large usage amounts", async () => {
            mockAdapter.getUsage = mock(async () => ({
                ...testUsage,
                amount: 999999999
            }));

            const result = await resolveGetUsage({
                referenceId: "user-123",
                feature: testFeature,
                options: { features: {} },
                adapter: mockAdapter
            });

            expect(result.amount).toBe(999999999);
        });
    });

    describe("cache behavior", () => {
        test("should handle cache insert event failures gracefully", async () => {
            options = { features: {}, cache: mockCache };
            mockCache.getUsage = mock(async () => null);
            mockCache.insertEvent = mock(async () => {
                throw new Error("Cache insert failed");
            });

            const result = await resolveGetUsage({
                referenceId: "user-123",
                feature: testFeature,
                options,
                adapter: mockAdapter
            });

            expect(result).toBeDefined();
        });

        test("should handle cache set limit failures gracefully", async () => {
            options = { features: {}, cache: mockCache };
            mockCache.getUsage = mock(async () => null);
            mockCache.setLimit = mock(async () => {
                throw new Error("Cache set limit failed");
            });

            const result = await resolveGetUsage({
                referenceId: "user-123",
                feature: testFeature,
                options,
                adapter: mockAdapter
            });

            expect(result).toBeDefined();
        });
    });
});