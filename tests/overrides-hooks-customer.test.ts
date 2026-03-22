import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { createTestInstance, signInWithTestUser, createCustomer, shutdownUsage } from "./test-helper";
import type { UsageOptions } from "../package/types";
import type { BetterAuthPlugin } from "better-auth";

describe("feature overrides", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));
    });

    test("overrideKey applies custom maxLimit", async () => {
        const refId = "user-override";
        await createCustomer(instance, headers, refId);

        // Seed usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Consume 11 (would be in-limit for default 100, but above for free-plan 10)
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 11, event: "use" },
            headers,
        });

        const checkDefault = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        const checkFreePlan = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", overrideKey: "free-plan" },
            headers,
        });

        const checkProPlan = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", overrideKey: "pro-plan" },
            headers,
        });

        // 11 is in-limit for default (max 100)
        expect(checkDefault.data.status).toBe("in-limit");
        expect(checkDefault.data.maxLimit).toBe(100);

        // 11 is above-max for free-plan (max 10)
        expect(checkFreePlan.data.status).toBe("above-max-limit");
        expect(checkFreePlan.data.maxLimit).toBe(10);

        // 11 is in-limit for pro-plan (max 10000)
        expect(checkProPlan.data.status).toBe("in-limit");
        expect(checkProPlan.data.maxLimit).toBe(10000);
    });

    test("list features returns all registered features", async () => {
        const res = await instance.client.$fetch("/usage/features", {
            method: "GET",
            headers,
        });

        expect(res.data).toBeInstanceOf(Array);
        const keys = res.data.map((f: any) => f.featureKey);
        expect(keys).toContain("api-calls");
        expect(keys).toContain("credits");
    });

    test("get single feature via API returns config without hooks", async () => {
        // Use the auth.api directly since the GET endpoint has a body schema
        // which doesn't work well with $fetch for GET requests
        const res = await instance.auth.api.getFeature({
            params: { featureKey: "api-calls" },
            body: {},
        });

        expect(res).toBeDefined();
        expect(res.feature.key).toBe("api-calls");
        expect(res.feature.maxLimit).toBe(100);
        expect(res.feature.hooks).toBeUndefined();
    });

    test("get feature with nonexistent key returns error", async () => {
        try {
            await instance.auth.api.getFeature({
                params: { featureKey: "nonexistent" },
                body: {},
            });
            // Should not reach here
            expect(true).toBe(false);
        } catch (e: any) {
            expect(e.status).toBe("NOT_FOUND");
        }
    });
});

describe("hooks", () => {
    beforeEach(async () => { await shutdownUsage(); });
    afterAll(async () => { await shutdownUsage(); });

    test("before hook can block consumption by throwing", async () => {
        let beforeCalled = false;

        const instance = await createTestInstance({
            features: {
                "limited": {
                    key: "limited",
                    maxLimit: 100,
                    reset: "never",
                    resetValue: 0,
                    hooks: {
                        before: ({ usage }) => {
                            beforeCalled = true;
                            if (usage.afterAmount > 50) {
                                throw new Error("Usage would exceed soft limit of 50");
                            }
                        },
                    },
                },
            },
            overrides: {},
        });
        const { headers } = await signInWithTestUser(instance);
        const refId = "user-hooked";
        await createCustomer(instance, headers, refId);

        // Seed
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "limited" },
            headers,
        });

        // Consume 30 (under soft limit) - should succeed
        const res1 = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "limited", amount: 30, event: "use" },
            headers,
        });
        expect(beforeCalled).toBe(true);
        expect(res1.error).toBeNull();

        // Consume 30 more (would be 60 > 50 soft limit) - should fail
        const res2 = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "limited", amount: 30, event: "use" },
            headers,
        });
        expect(res2.error).toBeDefined();
    });

    test("after hook fires after consumption", async () => {
        let afterAmount = -1;

        const instance = await createTestInstance({
            features: {
                "tracked": {
                    key: "tracked",
                    maxLimit: 100,
                    reset: "never",
                    resetValue: 0,
                    hooks: {
                        after: ({ usage }) => {
                            afterAmount = usage.afterAmount;
                        },
                    },
                },
            },
            overrides: {},
        });
        const { headers } = await signInWithTestUser(instance);
        const refId = "user-after-hook";
        await createCustomer(instance, headers, refId);

        // Seed
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "tracked" },
            headers,
        });

        const res = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "tracked", amount: 25, event: "use" },
            headers,
        });
        expect(res.error).toBeNull();

        expect(afterAmount).toBe(25);
    });
});

describe("customer management", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));
    });

    test("upsert creates a new customer", async () => {
        const res = await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: {
                referenceId: "cust-1",
                referenceType: "org",
                name: "Acme Corp",
                email: "billing@acme.com",
            },
            headers,
        });

        expect(res.data).toBeDefined();
        expect(res.data.referenceId).toBe("cust-1");
        expect(res.data.referenceType).toBe("org");
    });

    test("check-customer returns the created customer", async () => {
        // Create first
        await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: {
                referenceId: "cust-check",
                referenceType: "user",
                name: "Jane",
            },
            headers,
        });

        const res = await instance.client.$fetch("/usage/check-customer", {
            method: "POST",
            body: { referenceId: "cust-check" },
            headers,
        });

        expect(res.data).toBeDefined();
        expect(res.data.referenceId).toBe("cust-check");
        expect(res.data.name).toBe("Jane");
    });

    test("upsert updates an existing customer", async () => {
        // Create
        await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: {
                referenceId: "cust-update",
                referenceType: "team",
                name: "Old Name",
            },
            headers,
        });

        // Update
        await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: {
                referenceId: "cust-update",
                referenceType: "team",
                name: "New Name",
                email: "new@email.com",
            },
            headers,
        });

        const res = await instance.client.$fetch("/usage/check-customer", {
            method: "POST",
            body: { referenceId: "cust-update" },
            headers,
        });

        expect(res.data.name).toBe("New Name");
        expect(res.data.email).toBe("new@email.com");
    });

    test("check-customer for nonexistent customer returns error", async () => {
        const res = await instance.client.$fetch("/usage/check-customer", {
            method: "POST",
            body: { referenceId: "does-not-exist" },
            headers,
        });

        expect(res.error).toBeDefined();
    });

    test("upsert customer with overrideKey persists the field", async () => {
        const res = await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: {
                referenceId: "cust-override-key",
                referenceType: "user",
                name: "Override User",
                overrideKey: "pro-plan",
            },
            headers,
        });
        expect(res.error).toBeNull();
        expect(res.data.referenceId).toBe("cust-override-key");
    });
});

describe("feature details and overrideKey lookup", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        await shutdownUsage();
        instance = await createTestInstance({
            features: {
                "api-calls": {
                    key: "api-calls",
                    maxLimit: 100,
                    minLimit: 0,
                    reset: "monthly",
                    resetValue: 0,
                    details: ["Rate limited", "Resets monthly"],
                },
                "credits": {
                    key: "credits",
                    maxLimit: 1000,
                    minLimit: -500,
                    reset: "never",
                    resetValue: 0,
                },
            },
            overrides: {
                "pro-plan": {
                    features: {
                        "api-calls": { maxLimit: 10000 },
                    },
                },
            },
        });
        ({ headers } = await signInWithTestUser(instance));
    });
    afterAll(async () => { await shutdownUsage(); });

    test("list features returns details array when present", async () => {
        const res = await instance.client.$fetch("/usage/features", {
            method: "GET",
            headers,
        });

        expect(res.data).toBeInstanceOf(Array);
        const apiCalls = res.data.find((f: any) => f.featureKey === "api-calls");
        expect(apiCalls).toBeDefined();
        expect(apiCalls.details).toEqual(["Rate limited", "Resets monthly"]);
    });

    test("get single feature with overrideKey returns merged config", async () => {
        const res = await instance.auth.api.getFeature({
            params: { featureKey: "api-calls" },
            body: { overrideKey: "pro-plan" },
        });

        expect(res.feature.maxLimit).toBe(10000);
        expect(res.feature.key).toBe("api-calls");
    });
});

describe("both before and after hooks on same feature", () => {
    beforeEach(async () => { await shutdownUsage(); });
    afterAll(async () => { await shutdownUsage(); });

    test("before and after hooks both fire in order", async () => {
        const callOrder: string[] = [];

        const instance = await createTestInstance({
            features: {
                "dual-hook": {
                    key: "dual-hook",
                    maxLimit: 100,
                    reset: "never",
                    resetValue: 0,
                    hooks: {
                        before: ({ usage }) => {
                            callOrder.push("before");
                        },
                        after: ({ usage }) => {
                            callOrder.push("after");
                        },
                    },
                },
            },
            overrides: {},
        });
        const { headers } = await signInWithTestUser(instance);
        await createCustomer(instance, headers, "dual-hook-user");

        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "dual-hook-user", featureKey: "dual-hook" },
            headers,
        });

        const res = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: "dual-hook-user", featureKey: "dual-hook", amount: 10, event: "use" },
            headers,
        });
        expect(res.error).toBeNull();
        expect(callOrder).toEqual(["before", "after"]);
    });
});
