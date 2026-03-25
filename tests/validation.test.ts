import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestInstance, signInWithTestUser, createCustomer, shutdownUsage } from "./test-helper";

describe("config validation", () => {
    afterAll(async () => { await shutdownUsage(); });

    test("rejects empty features", async () => {
        await shutdownUsage();
        try {
            await createTestInstance({ features: {} });
            // Should not reach here
            expect(true).toBe(false);
        } catch (err: any) {
            expect(err.message).toContain("Invalid plugin configuration");
        }
    });

    test("rejects maxLimit < minLimit", async () => {
        await shutdownUsage();
        try {
            await createTestInstance({
                features: {
                    "bad-feature": {
                        maxLimit: 5,
                        minLimit: 10,
                        reset: "never",
                        resetValue: 0,
                    },
                },
            });
            // Should not reach here
            expect(true).toBe(false);
        } catch (err: any) {
            expect(err.message).toContain("Invalid plugin configuration");
        }
    });

    test("rejects override referencing unknown feature", async () => {
        await shutdownUsage();
        try {
            await createTestInstance({
                features: {
                    "api-calls": {
                        maxLimit: 100,
                        minLimit: 0,
                        reset: "monthly",
                        resetValue: 0,
                    },
                },
                overrides: {
                    "bad-override": {
                        features: {
                            "nonexistent": { maxLimit: 500 },
                        },
                    },
                },
            });
            // Should not reach here
            expect(true).toBe(false);
        } catch (err: any) {
            expect(err.message).toContain("Invalid plugin configuration");
        }
    });

    test("accepts valid config", async () => {
        await shutdownUsage();
        const instance = await createTestInstance();
        expect(instance).toBeDefined();
        expect(instance.auth).toBeDefined();
        expect(instance.client).toBeDefined();
    });
});

describe("amount validation", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        await shutdownUsage();
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));
    });
    afterAll(async () => { await shutdownUsage(); });

    test("rejects Infinity amount", async () => {
        const refId = "val-infinity";
        await createCustomer(instance, headers, refId);

        // Seed initial usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        const res = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: Infinity, event: "use" },
            headers,
        });

        expect(res.error).toBeDefined();
    });

    test("rejects NaN amount", async () => {
        const refId = "val-nan";
        await createCustomer(instance, headers, refId);

        // Seed initial usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        const res = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: NaN, event: "use" },
            headers,
        });

        expect(res.error).toBeDefined();
    });
});
