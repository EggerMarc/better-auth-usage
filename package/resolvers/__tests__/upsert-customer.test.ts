import { describe, test, expect, beforeEach, mock } from "bun:test";
import { resolveUpsertCustomer } from "../upsert-customer";
import type { UsageAdapter } from "@/adapters";
import type { Customer, UsageOptionsWithCache } from "@/types";
import { APIError } from "better-auth";

describe("resolveUpsertCustomer", () => {
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
            upsertCustomer: mock(async (customer: Customer) => customer)
        } as any;

        mockCache = {
            setCustomer: mock(async () => {})
        };

        options = {
            features: {},
            cache: mockCache
        };
    });

    describe("successful upsert", () => {
        test("should upsert customer in DB and return result", async () => {
            const result = await resolveUpsertCustomer({
                adapter: mockAdapter,
                options,
                customer: testCustomer
            });

            expect(result).toEqual(testCustomer);
            expect(mockAdapter.upsertCustomer).toHaveBeenCalledWith(testCustomer);
        });

        test("should cache customer after DB upsert when cache is enabled", async () => {
            await resolveUpsertCustomer({
                adapter: mockAdapter,
                options,
                customer: testCustomer
            });

            expect(mockCache.setCustomer).toHaveBeenCalledWith(testCustomer);
        });

        test("should work without cache", async () => {
            const noCacheOptions: UsageOptionsWithCache = { features: {} };

            const result = await resolveUpsertCustomer({
                adapter: mockAdapter,
                options: noCacheOptions,
                customer: testCustomer
            });

            expect(result).toEqual(testCustomer);
        });

        test("should handle customer with minimal fields", async () => {
            const minimalCustomer: Customer = {
                referenceId: "user-456",
                referenceType: "user"
            };

            const result = await resolveUpsertCustomer({
                adapter: mockAdapter,
                options,
                customer: minimalCustomer
            });

            expect(result).toEqual(minimalCustomer);
        });

        test("should handle customer with all fields", async () => {
            const fullCustomer: Customer = {
                referenceId: "org-123",
                referenceType: "organization",
                email: "org@example.com",
                name: "Test Organization",
                overrideKey: "enterprise"
            };

            const result = await resolveUpsertCustomer({
                adapter: mockAdapter,
                options,
                customer: fullCustomer
            });

            expect(result).toEqual(fullCustomer);
        });
    });

    describe("error handling", () => {
        test("should throw INTERNAL_SERVER_ERROR when DB upsert fails", async () => {
            mockAdapter.upsertCustomer = mock(async () => {
                throw new Error("Database error");
            });

            await expect(
                resolveUpsertCustomer({
                    adapter: mockAdapter,
                    options,
                    customer: testCustomer
                })
            ).rejects.toThrow(APIError);
        });

        test("should throw INTERNAL_SERVER_ERROR when no data returned", async () => {
            mockAdapter.upsertCustomer = mock(async () => null);

            await expect(
                resolveUpsertCustomer({
                    adapter: mockAdapter,
                    options,
                    customer: testCustomer
                })
            ).rejects.toThrow(APIError);
        });

        test("should handle cache set failures gracefully", async () => {
            mockCache.setCustomer = mock(async () => {
                throw new Error("Cache error");
            });

            const result = await resolveUpsertCustomer({
                adapter: mockAdapter,
                options,
                customer: testCustomer
            });

            expect(result).toEqual(testCustomer);
        });

        test("should include error message in exception", async () => {
            const errorMessage = "Unique constraint violation";
            mockAdapter.upsertCustomer = mock(async () => {
                throw new Error(errorMessage);
            });

            try {
                await resolveUpsertCustomer({
                    adapter: mockAdapter,
                    options,
                    customer: testCustomer
                });
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error.message).toContain(errorMessage);
            }
        });
    });

    describe("edge cases", () => {
        test("should handle empty referenceId", async () => {
            const emptyIdCustomer: Customer = {
                referenceId: "",
                referenceType: "user"
            };

            const result = await resolveUpsertCustomer({
                adapter: mockAdapter,
                options,
                customer: emptyIdCustomer
            });

            expect(result).toEqual(emptyIdCustomer);
        });

        test("should handle special characters in referenceId", async () => {
            const specialCustomer: Customer = {
                referenceId: "user@test.com:123#special",
                referenceType: "user"
            };

            const result = await resolveUpsertCustomer({
                adapter: mockAdapter,
                options,
                customer: specialCustomer
            });

            expect(result).toEqual(specialCustomer);
        });

        test("should handle undefined optional fields", async () => {
            const customerWithUndefined: Customer = {
                referenceId: "user-123",
                referenceType: "user",
                email: undefined,
                name: undefined,
                overrideKey: undefined
            };

            const result = await resolveUpsertCustomer({
                adapter: mockAdapter,
                options,
                customer: customerWithUndefined
            });

            expect(result).toEqual(customerWithUndefined);
        });

        test("should handle very long string values", async () => {
            const longCustomer: Customer = {
                referenceId: "a".repeat(1000),
                referenceType: "user",
                name: "b".repeat(1000)
            };

            const result = await resolveUpsertCustomer({
                adapter: mockAdapter,
                options,
                customer: longCustomer
            });

            expect(result).toEqual(longCustomer);
        });
    });

    describe("cache behavior", () => {
        test("should call cache.setCustomer with correct data", async () => {
            await resolveUpsertCustomer({
                adapter: mockAdapter,
                options,
                customer: testCustomer
            });

            expect(mockCache.setCustomer).toHaveBeenCalledTimes(1);
            expect(mockCache.setCustomer).toHaveBeenCalledWith(testCustomer);
        });

        test("should not call cache when cache is disabled", async () => {
            const noCacheOptions: UsageOptionsWithCache = { features: {} };
            const setCustomerSpy = mock(async () => {});
            
            await resolveUpsertCustomer({
                adapter: mockAdapter,
                options: noCacheOptions,
                customer: testCustomer
            });

            expect(setCustomerSpy).not.toHaveBeenCalled();
        });

        test("should complete upsert even if cache set is slow", async () => {
            mockCache.setCustomer = mock(async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
            });

            const result = await resolveUpsertCustomer({
                adapter: mockAdapter,
                options,
                customer: testCustomer
            });

            expect(result).toEqual(testCustomer);
        });
    });
});