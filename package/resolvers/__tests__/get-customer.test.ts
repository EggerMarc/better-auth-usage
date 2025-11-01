import { describe, test, expect, beforeEach, mock } from "bun:test";
import { resolveGetCustomer } from "../get-customer";
import type { UsageAdapter } from "@/adapters";
import type { Customer, UsageOptionsWithCache } from "@/types";
import { APIError } from "better-auth";

describe("resolveGetCustomer", () => {
    let mockAdapter: UsageAdapter;
    let mockCache: any;
    let options: UsageOptionsWithCache;
    const testCustomer: Customer = {
        referenceId: "user-123",
        referenceType: "user",
        email: "test@example.com",
        name: "Test User"
    };

    beforeEach(() => {
        mockAdapter = {
            getCustomer: mock(async () => testCustomer)
        } as any;

        mockCache = {
            getCustomer: mock(async () => null),
            setCustomer: mock(async () => {})
        };

        options = {
            features: {},
            cache: mockCache
        };
    });

    describe("with cache enabled", () => {
        test("should return customer from cache when available", async () => {
            mockCache.getCustomer = mock(async () => testCustomer);

            const result = await resolveGetCustomer({
                referenceId: "user-123",
                adapter: mockAdapter,
                options
            });

            expect(result).toEqual(testCustomer);
            expect(mockCache.getCustomer).toHaveBeenCalledWith("user-123");
            expect(mockAdapter.getCustomer).not.toHaveBeenCalled();
        });

        test("should fall back to DB when cache returns null", async () => {
            mockCache.getCustomer = mock(async () => null);

            const result = await resolveGetCustomer({
                referenceId: "user-123",
                adapter: mockAdapter,
                options
            });

            expect(result).toEqual(testCustomer);
            expect(mockCache.getCustomer).toHaveBeenCalled();
            expect(mockAdapter.getCustomer).toHaveBeenCalled();
            expect(mockCache.setCustomer).toHaveBeenCalledWith(testCustomer);
        });

        test("should throw INTERNAL_SERVER_ERROR when cache fails", async () => {
            mockCache.getCustomer = mock(async () => {
                throw new Error("Cache connection failed");
            });

            await expect(
                resolveGetCustomer({
                    referenceId: "user-123",
                    adapter: mockAdapter,
                    options
                })
            ).rejects.toThrow(APIError);
        });

        test("should cache customer after DB retrieval", async () => {
            mockCache.getCustomer = mock(async () => null);

            await resolveGetCustomer({
                referenceId: "user-123",
                adapter: mockAdapter,
                options
            });

            expect(mockCache.setCustomer).toHaveBeenCalledWith(testCustomer);
        });

        test("should handle cache set failures gracefully", async () => {
            mockCache.getCustomer = mock(async () => null);
            mockCache.setCustomer = mock(async () => {
                throw new Error("Cache write failed");
            });

            const result = await resolveGetCustomer({
                referenceId: "user-123",
                adapter: mockAdapter,
                options
            });

            expect(result).toEqual(testCustomer);
        });
    });

    describe("without cache", () => {
        beforeEach(() => {
            options = { features: {} };
        });

        test("should retrieve customer from DB", async () => {
            const result = await resolveGetCustomer({
                referenceId: "user-456",
                adapter: mockAdapter,
                options
            });

            expect(result).toEqual(testCustomer);
            expect(mockAdapter.getCustomer).toHaveBeenCalledWith({
                referenceId: "user-456"
            });
        });

        test("should throw NOT_FOUND when customer doesn't exist", async () => {
            mockAdapter.getCustomer = mock(async () => null);

            await expect(
                resolveGetCustomer({
                    referenceId: "nonexistent",
                    adapter: mockAdapter,
                    options
                })
            ).rejects.toThrow(APIError);
        });

        test("should throw INTERNAL_SERVER_ERROR on DB error", async () => {
            mockAdapter.getCustomer = mock(async () => {
                throw new Error("DB connection failed");
            });

            await expect(
                resolveGetCustomer({
                    referenceId: "user-123",
                    adapter: mockAdapter,
                    options
                })
            ).rejects.toThrow(APIError);
        });
    });

    describe("edge cases", () => {
        test("should handle empty referenceId", async () => {
            await expect(
                resolveGetCustomer({
                    referenceId: "",
                    adapter: mockAdapter,
                    options
                })
            ).resolves.toBeDefined();
        });

        test("should handle special characters in referenceId", async () => {
            const specialId = "user@test.com:123#special";
            
            const result = await resolveGetCustomer({
                referenceId: specialId,
                adapter: mockAdapter,
                options
            });

            expect(mockAdapter.getCustomer).toHaveBeenCalledWith({
                referenceId: specialId
            });
        });

        test("should handle customer with minimal data", async () => {
            const minimalCustomer: Customer = {
                referenceId: "user-123",
                referenceType: "user"
            };
            mockAdapter.getCustomer = mock(async () => minimalCustomer);

            const result = await resolveGetCustomer({
                referenceId: "user-123",
                adapter: mockAdapter,
                options: { features: {} }
            });

            expect(result).toEqual(minimalCustomer);
        });

        test("should handle customer with all optional fields", async () => {
            const fullCustomer: Customer = {
                referenceId: "org-123",
                referenceType: "organization",
                email: "org@example.com",
                name: "Test Org",
                overrideKey: "premium"
            };
            mockAdapter.getCustomer = mock(async () => fullCustomer);

            const result = await resolveGetCustomer({
                referenceId: "org-123",
                adapter: mockAdapter,
                options: { features: {} }
            });

            expect(result).toEqual(fullCustomer);
        });
    });
});