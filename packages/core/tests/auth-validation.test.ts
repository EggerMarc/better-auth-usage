import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestInstance, signInWithTestUser, shutdownUsage } from "./test-helper";

describe("auth enforcement", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;

    beforeAll(async () => {
        await shutdownUsage();
        instance = await createTestInstance();
    });
    afterAll(async () => { await shutdownUsage(); });

    test("consume without session returns error", async () => {
        const res = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: {
                referenceId: "no-auth",
                featureKey: "api-calls",
                amount: 1,
                event: "use",
            },
        });
        expect(res.error).toBeDefined();
    });

    test("check without session returns error", async () => {
        const res = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "no-auth", featureKey: "api-calls" },
        });
        expect(res.error).toBeDefined();
    });

    test("check-customer without session returns error", async () => {
        const res = await instance.client.$fetch("/usage/check-customer", {
            method: "POST",
            body: { referenceId: "no-auth" },
        });
        expect(res.error).toBeDefined();
    });

    test("upsert-customer without session returns error", async () => {
        const res = await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: { referenceId: "no-auth", referenceType: "user" },
        });
        expect(res.error).toBeDefined();
    });
});

describe("validation errors", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        await shutdownUsage();
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));
    });
    afterAll(async () => { await shutdownUsage(); });

    test("consume with missing featureKey returns error", async () => {
        const res = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: "val-test", amount: 1, event: "use" },
            headers,
        });
        expect(res.error).toBeDefined();
    });

    test("consume with missing amount returns error", async () => {
        const res = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: "val-test", featureKey: "api-calls", event: "use" },
            headers,
        });
        expect(res.error).toBeDefined();
    });

    test("check with missing referenceId returns error", async () => {
        const res = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { featureKey: "api-calls" },
            headers,
        });
        expect(res.error).toBeDefined();
    });
});
