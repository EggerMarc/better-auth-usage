import { describe, test, expect, beforeAll } from "bun:test";
import { createTestInstance, signInWithTestUser, createCustomer } from "./test-helper";

describe("consume and check pipeline", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));
    });

    test("first check auto-creates usage at resetValue (0)", async () => {
        const res = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: {
                referenceId: "user-auto-create",
                featureKey: "api-calls",
            },
            headers,
        });

        expect(res.data).toBeDefined();
        expect(res.data.currentAmount).toBe(0);
        expect(res.data.status).toBe("in-limit");
    });

    test("consume increments usage", async () => {
        const refId = "user-consume-1";

        // Create customer first (consume requires it)
        await createCustomer(instance, headers, refId);

        // Seed initial usage with a check
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Consume 5
        const consumeRes = await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: {
                referenceId: refId,
                featureKey: "api-calls",
                amount: 5,
                event: "use",
            },
            headers,
        });

        expect(consumeRes.error).toBeNull();

        // Check should now show 5
        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        expect(checkRes.data.currentAmount).toBe(5);
        expect(checkRes.data.status).toBe("in-limit");
    });

    test("multiple consumes accumulate", async () => {
        const refId = "user-accumulate";
        await createCustomer(instance, headers, refId);

        // Seed
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        // Consume 3 times
        for (let i = 0; i < 3; i++) {
            const res = await instance.client.$fetch("/usage/consume", {
                method: "POST",
                body: {
                    referenceId: refId,
                    featureKey: "credits",
                    amount: 10,
                    event: "use",
                },
                headers,
            });
            expect(res.error).toBeNull();
        }

        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        expect(checkRes.data.currentAmount).toBe(30);
    });

    test("negative amounts decrement usage", async () => {
        const refId = "user-decrement";
        await createCustomer(instance, headers, refId);

        // Seed
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        // Add 50
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits", amount: 50, event: "use" },
            headers,
        });

        // Subtract 20
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits", amount: -20, event: "refund" },
            headers,
        });

        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        expect(checkRes.data.currentAmount).toBe(30);
    });

    test("features are tracked independently per referenceId", async () => {
        const refA = "user-A";
        const refB = "user-B";
        await createCustomer(instance, headers, refA);
        await createCustomer(instance, headers, refB);

        // Seed both
        for (const refId of [refA, refB]) {
            await instance.client.$fetch("/usage/check", {
                method: "POST",
                body: { referenceId: refId, featureKey: "api-calls" },
                headers,
            });
        }

        // A consumes 10
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refA, featureKey: "api-calls", amount: 10, event: "use" },
            headers,
        });

        // B consumes 3
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refB, featureKey: "api-calls", amount: 3, event: "use" },
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

        expect(checkA.data.currentAmount).toBe(10);
        expect(checkB.data.currentAmount).toBe(3);
    });

    test("different features are independent for same referenceId", async () => {
        const refId = "user-multi-feature";
        await createCustomer(instance, headers, refId);

        // Seed both features
        for (const featureKey of ["api-calls", "credits"]) {
            await instance.client.$fetch("/usage/check", {
                method: "POST",
                body: { referenceId: refId, featureKey },
                headers,
            });
        }

        // Consume api-calls
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 7, event: "use" },
            headers,
        });

        // Consume credits
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits", amount: 200, event: "use" },
            headers,
        });

        const apiCheck = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });
        const creditsCheck = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        expect(apiCheck.data.currentAmount).toBe(7);
        expect(creditsCheck.data.currentAmount).toBe(200);
    });

    test("check with amount param previews limit status without consuming", async () => {
        const refId = "user-preview";
        await createCustomer(instance, headers, refId);

        // Seed
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

        // Preview adding 10 more (would be 105 > 100 max)
        const preview = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 10 },
            headers,
        });

        expect(preview.data.status).toBe("above-max-limit");
        // But current amount should still be 95 (not actually consumed)
        expect(preview.data.currentAmount).toBe(95);
    });

    test("check returns limit metadata", async () => {
        const refId = "user-meta";

        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        expect(checkRes.data.maxLimit).toBe(100);
        expect(checkRes.data.minLimit).toBe(0);
    });
});
