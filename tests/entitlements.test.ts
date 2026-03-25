import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestInstance, signInWithTestUser, createCustomer, shutdownUsage } from "./test-helper";

describe("can-use endpoint", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        await shutdownUsage();
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));
    });
    afterAll(async () => { await shutdownUsage(); });

    test("returns allowed when under limit", async () => {
        const refId = "canuse-under-limit";
        await createCustomer(instance, headers, refId);

        // Seed initial usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        const res = await instance.client.$fetch("/usage/can-use", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        expect(res.error).toBeNull();
        expect(res.data.allowed).toBe(true);
        expect(res.data.status).toBe("in-limit");
        expect(res.data.current).toBe(0);
        expect(res.data.max).toBe(100);
        expect(res.data.remaining).toBe(100);
        expect(res.data.percent).toBe(0);
    });

    test("returns denied when over limit", async () => {
        const refId = "canuse-over-limit";
        await createCustomer(instance, headers, refId);

        // Seed initial usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Consume up to max
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 100, event: "use" },
            headers,
        });

        // can-use should now return denied (default amount=1 would push to 101)
        const res = await instance.client.$fetch("/usage/can-use", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        expect(res.error).toBeNull();
        expect(res.data.allowed).toBe(false);
        expect(res.data.status).toBe("above-max-limit");
    });

    test("with amount previews correctly", async () => {
        const refId = "canuse-preview-amount";
        await createCustomer(instance, headers, refId);

        // Seed initial usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Consume 95 of 100 max
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 95, event: "use" },
            headers,
        });

        // Preview adding 10 more (95 + 10 = 105 > 100 max)
        const res = await instance.client.$fetch("/usage/can-use", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 10 },
            headers,
        });

        expect(res.error).toBeNull();
        expect(res.data.allowed).toBe(false);
        expect(res.data.status).toBe("above-max-limit");
        expect(res.data.current).toBe(95);
        expect(res.data.remaining).toBe(5);
    });
});

describe("use-feature endpoint", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        await shutdownUsage();
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));
    });
    afterAll(async () => { await shutdownUsage(); });

    test("consumes when allowed", async () => {
        const refId = "usefeature-allowed";
        await createCustomer(instance, headers, refId);

        // Seed initial usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // use-feature with amount=5
        const res = await instance.client.$fetch("/usage/use-feature", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 5 },
            headers,
        });

        expect(res.error).toBeNull();
        expect(res.data.allowed).toBe(true);
        expect(res.data.current).toBe(5);

        // Verify with check
        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        expect(checkRes.data.currentAmount).toBe(5);
    });

    test("rejects when over limit", async () => {
        const refId = "usefeature-rejected";
        await createCustomer(instance, headers, refId);

        // Seed initial usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Consume up to max
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 100, event: "use" },
            headers,
        });

        // use-feature should consume but report over-limit status
        const res = await instance.client.$fetch("/usage/use-feature", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 1 },
            headers,
        });

        expect(res.error).toBeNull();
        expect(res.data.status).toBe("above-max-limit");
        expect(res.data.current).toBe(101);

        // Verify current increased
        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        expect(checkRes.data.currentAmount).toBe(101);
    });

    test("defaults amount to 1", async () => {
        const refId = "usefeature-default-amount";
        await createCustomer(instance, headers, refId);

        // Seed initial usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Call use-feature without specifying amount
        const res = await instance.client.$fetch("/usage/use-feature", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        expect(res.error).toBeNull();
        expect(res.data.allowed).toBe(true);
        expect(res.data.current).toBe(1);

        // Verify with check
        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        expect(checkRes.data.currentAmount).toBe(1);
    });
});
