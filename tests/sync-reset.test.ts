import { describe, test, expect, beforeAll } from "bun:test";
import { createTestInstance, signInWithTestUser, createCustomer } from "./test-helper";

describe("sync and reset logic", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));
    });

    test("sync on feature with reset=never does not reset", async () => {
        const refId = "user-no-reset";
        await createCustomer(instance, headers, refId);

        // Seed
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        // Consume some
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits", amount: 42, event: "use" },
            headers,
        });

        // Sync - should not reset since credits has reset: "never"
        const syncRes = await instance.client.$fetch("/usage/sync", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        // Usage should remain at 42
        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        expect(checkRes.data.currentAmount).toBe(42);
    });

    test("sync on recently-created usage does not reset (not due yet)", async () => {
        const refId = "user-monthly-recent";
        await createCustomer(instance, headers, refId);

        // Seed
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Consume 50
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 50, event: "use" },
            headers,
        });

        // Sync - monthly reset hasn't passed since we just created usage
        const syncRes = await instance.client.$fetch("/usage/sync", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Should still be 50 since reset isn't due yet
        expect(checkRes.data.currentAmount).toBe(50);
    });
});

describe("resolveFeature edge cases", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));
    });

    test("consume with nonexistent feature returns error", async () => {
        await createCustomer(instance, headers, "user-bad-feature");

        const res = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: {
                referenceId: "user-bad-feature",
                featureKey: "nonexistent",
                amount: 1,
                event: "use",
            },
            headers,
        });

        expect(res.error).toBeDefined();
    });

    test("consume with nonexistent overrideKey still uses base feature", async () => {
        const refId = "user-bad-override";
        await createCustomer(instance, headers, refId);

        // Seed
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Consume with a nonexistent override - should fall through to base feature
        const res = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: {
                referenceId: refId,
                featureKey: "api-calls",
                amount: 5,
                event: "use",
                overrideKey: "nonexistent-plan",
            },
            headers,
        });

        expect(res.error).toBeNull();

        const check = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        expect(check.data.currentAmount).toBe(5);
        expect(check.data.maxLimit).toBe(100); // base limit, not overridden
    });
});
