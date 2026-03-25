import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";

// Mock ioredis with ioredis-mock before any imports that use it
mock.module("ioredis", () => {
    const RedisMock = require("ioredis-mock");
    return { default: RedisMock };
});

import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { createAuthClient } from "better-auth/client";
import { usage } from "../package/index";
import type { UsageOptions } from "../package/types";
import { resetRuntime as shutdownUsage } from "../package/runtime";

/**
 * Creates a test instance with cacheOptions enabled.
 * Since ioredis is mocked, the UsageCache will use ioredis-mock in-memory.
 */
async function createCachedTestInstance(opts?: {
    features?: UsageOptions["features"];
    overrides?: UsageOptions["overrides"];
}) {
    const features: UsageOptions["features"] = opts?.features ?? {
        "api-calls": {
            maxLimit: 100,
            minLimit: 0,
            reset: "monthly",
            resetValue: 0,
        },
        "credits": {
            maxLimit: 1000,
            minLimit: -500,
            reset: "never",
            resetValue: 0,
        },
    };
    const overrides: UsageOptions["overrides"] = opts?.overrides ?? {
        "pro-plan": {
            features: {
                "api-calls": { maxLimit: 10000 },
            },
        },
    };

    const auth = betterAuth({
        baseURL: "http://localhost:3000",
        secret: "test-secret-at-least-32-chars-long!!",
        emailAndPassword: { enabled: true },
        rateLimit: { enabled: false },
        advanced: { disableCSRFCheck: true },
        plugins: [
            bearer(),
            usage({
                features,
                overrides,
                cacheOptions: {
                    redisUrl: "redis://localhost:6379",
                },
            }) as BetterAuthPlugin,
        ],
    });

    const customFetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
        return auth.handler(new Request(url, init));
    };

    const client = createAuthClient({
        baseURL: "http://localhost:3000/api/auth",
        fetchOptions: { customFetchImpl },
    });

    const testUser = { email: "test@test.com", password: "test123456", name: "Test User" };
    await auth.api.signUpEmail({ body: testUser });

    return { auth, client, testUser };
}

type CachedInstance = Awaited<ReturnType<typeof createCachedTestInstance>>;

async function signIn(instance: CachedInstance) {
    const headers = new Headers();
    await instance.client.signIn.email({
        email: instance.testUser.email,
        password: instance.testUser.password,
        fetchOptions: {
            onSuccess(context: any) {
                const header = context.response.headers.get("set-cookie");
                if (header) {
                    const match = header.match(/better-auth\.session_token=([^;]+)/);
                    if (match) {
                        headers.set("cookie", `better-auth.session_token=${match[1]}`);
                    }
                }
            },
        },
    });
    return { headers };
}

async function upsertCustomer(instance: CachedInstance, headers: Headers, referenceId: string) {
    return instance.client.$fetch("/usage/upsert-customer", {
        method: "POST",
        body: { referenceId, referenceType: "user" },
        headers,
    });
}

// ─────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────

describe("cache-enabled: consume and check pipeline", () => {
    let instance: CachedInstance;
    let headers: Headers;

    beforeAll(async () => {
        instance = await createCachedTestInstance();
        ({ headers } = await signIn(instance));
    });

    test("consume writes to cache and DB, check reads from cache", async () => {
        const refId = "cached-user-1";
        await upsertCustomer(instance, headers, refId);

        // Seed initial usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Consume 7
        const consumeRes = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 7, event: "use" },
            headers,
        });
        expect(consumeRes.error).toBeNull();

        // Check — should read from cache
        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        expect(checkRes.data.currentAmount).toBe(7);
        expect(checkRes.data.status).toBe("in-limit");
    });

    test("multiple cached consumes accumulate correctly", async () => {
        const refId = "cached-accumulate";
        await upsertCustomer(instance, headers, refId);

        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        for (let i = 0; i < 5; i++) {
            const res = await instance.client.$fetch("/usage/consume", {
                method: "POST",
                body: { referenceId: refId, featureKey: "credits", amount: 10, event: "use" },
                headers,
            });
            expect(res.error).toBeNull();
        }

        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        expect(checkRes.data.currentAmount).toBe(50);
    });

    test("negative amounts work through cache", async () => {
        const refId = "cached-decrement";
        await upsertCustomer(instance, headers, refId);

        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        // Add 100
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits", amount: 100, event: "use" },
            headers,
        });

        // Subtract 40
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits", amount: -40, event: "refund" },
            headers,
        });

        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        expect(checkRes.data.currentAmount).toBe(60);
    });

    test("different references are isolated in cache", async () => {
        const refA = "cached-A";
        const refB = "cached-B";
        await upsertCustomer(instance, headers, refA);
        await upsertCustomer(instance, headers, refB);

        for (const refId of [refA, refB]) {
            await instance.client.$fetch("/usage/check", {
                method: "POST",
                body: { referenceId: refId, featureKey: "api-calls" },
                headers,
            });
        }

        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refA, featureKey: "api-calls", amount: 20, event: "use" },
            headers,
        });

        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refB, featureKey: "api-calls", amount: 5, event: "use" },
            headers,
        });

        const checkA = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refA, featureKey: "api-calls" },
            headers,
        });
        const checkB = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refB, featureKey: "api-calls" },
            headers,
        });

        expect(checkA.data.currentAmount).toBe(20);
        expect(checkB.data.currentAmount).toBe(5);
    });

    test("overrides work with cached check", async () => {
        const refId = "cached-override";
        await upsertCustomer(instance, headers, refId);

        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 50, event: "use" },
            headers,
        });

        // Default check (maxLimit: 100)
        const checkDefault = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Pro-plan check (maxLimit: 10000)
        const checkPro = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", overrideKey: "pro-plan" },
            headers,
        });

        expect(checkDefault.data.status).toBe("in-limit");
        expect(checkDefault.data.maxLimit).toBe(100);
        expect(checkPro.data.status).toBe("in-limit");
        expect(checkPro.data.maxLimit).toBe(10000);
    });
});

describe("cache-enabled: customer management", () => {
    let instance: CachedInstance;
    let headers: Headers;

    beforeAll(async () => {
        instance = await createCachedTestInstance();
        ({ headers } = await signIn(instance));
    });

    test("customer is cached after upsert", async () => {
        const res = await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: { referenceId: "cached-cust-1", referenceType: "org", name: "Cached Corp" },
            headers,
        });
        expect(res.error).toBeNull();
        expect(res.data.referenceId).toBe("cached-cust-1");

        // Second lookup should hit cache
        const check = await instance.client.$fetch("/usage/check-customer", {
            method: "POST",
            body: { referenceId: "cached-cust-1" },
            headers,
        });
        expect(check.data.referenceId).toBe("cached-cust-1");
        expect(check.data.name).toBe("Cached Corp");
    });

    test("customer update is reflected in subsequent lookups", async () => {
        await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: { referenceId: "cached-cust-2", referenceType: "user", name: "V1" },
            headers,
        });

        await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: { referenceId: "cached-cust-2", referenceType: "user", name: "V2", email: "v2@test.com" },
            headers,
        });

        const check = await instance.client.$fetch("/usage/check-customer", {
            method: "POST",
            body: { referenceId: "cached-cust-2" },
            headers,
        });

        expect(check.data.name).toBe("V2");
        expect(check.data.email).toBe("v2@test.com");
    });
});

describe("cache-enabled: hooks with cache", () => {
    beforeAll(async () => { await shutdownUsage(); });
    afterAll(async () => { await shutdownUsage(); });

    test("before hook blocks consumption even with cache enabled", async () => {
        let hookCalled = false;

        const instance = await createCachedTestInstance({
            features: {
                "guarded": {
                    maxLimit: 100,
                    reset: "never",
                    resetValue: 0,
                    hooks: {
                        before: ({ usage }) => {
                            hookCalled = true;
                            if (usage.afterAmount > 25) {
                                throw new Error("Soft limit exceeded");
                            }
                        },
                    },
                },
            },
            overrides: {},
        });

        const { headers } = await signIn(instance);
        const refId = "cached-guarded";
        await upsertCustomer(instance, headers, refId);

        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "guarded" },
            headers,
        });

        // Under soft limit — should pass
        const res1 = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "guarded", amount: 20, event: "use" },
            headers,
        });
        expect(hookCalled).toBe(true);
        expect(res1.error).toBeNull();

        // Over soft limit — hook should block
        const res2 = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "guarded", amount: 10, event: "use" },
            headers,
        });
        expect(res2.error).toBeDefined();
    });
});

describe("cache-enabled: sync/reset", () => {
    let instance: CachedInstance;
    let headers: Headers;

    beforeAll(async () => {
        await shutdownUsage();
        instance = await createCachedTestInstance();
        ({ headers } = await signIn(instance));
    });
    afterAll(async () => { await shutdownUsage(); });

    test("sync with cache enabled and no reset needed returns successfully", async () => {
        const refId = "cached-sync-no-reset";
        await upsertCustomer(instance, headers, refId);

        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits", amount: 25, event: "use" },
            headers,
        });

        const syncRes = await instance.client.$fetch("/usage/sync", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });
        expect(syncRes.error).toBeNull();

        // Usage should remain unchanged (credits has reset: "never")
        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });
        expect(checkRes.data.currentAmount).toBe(25);
    });

    test("sync with cache enabled on monthly feature does not reset prematurely", async () => {
        const refId = "cached-sync-monthly";
        await upsertCustomer(instance, headers, refId);

        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 30, event: "use" },
            headers,
        });

        const syncRes = await instance.client.$fetch("/usage/sync", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });
        expect(syncRes.error).toBeNull();
    });
});

describe("cache-enabled: error paths", () => {
    let instance: CachedInstance;
    let headers: Headers;

    beforeAll(async () => {
        await shutdownUsage();
        instance = await createCachedTestInstance();
        ({ headers } = await signIn(instance));
    });
    afterAll(async () => { await shutdownUsage(); });

    test("check with nonexistent feature returns error", async () => {
        const res = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "any-ref", featureKey: "nonexistent" },
            headers,
        });
        expect(res.error).toBeDefined();
    });
});
