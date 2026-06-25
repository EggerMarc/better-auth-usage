import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { createTestInstance, signInWithTestUser, createCustomer, shutdownUsage } from "./test-helper";
import type { UsageOptions } from "../src/types";

const planFeatures: UsageOptions["features"] = {
    "api-calls": {
        maxLimit: 100,
        reset: "monthly",
        resetValue: 0,
        onPlanChange: "carry-over",
    },
    "credits": {
        maxLimit: 1000,
        reset: "never",
        resetValue: 0,
        onPlanChange: "reset",
    },
};

const planOverrides: UsageOptions["overrides"] = {
    "free-plan": {
        features: {
            "api-calls": { maxLimit: 10 },
        },
    },
    "pro-plan": {
        features: {
            "api-calls": { maxLimit: 10000 },
            "credits": { maxLimit: 50000 },
        },
    },
};

describe("plan transitions", () => {
    beforeEach(async () => {
        await shutdownUsage();
    });
    afterAll(async () => {
        await shutdownUsage();
    });

    test("carry-over: usage preserved on plan upgrade", async () => {
        const instance = await createTestInstance({
            features: planFeatures,
            overrides: planOverrides,
        });
        const { headers } = await signInWithTestUser(instance);
        const refId = "user-carry-over";

        // Create customer on free-plan
        await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: { referenceId: refId, referenceType: "user", overrideKey: "free-plan" },
            headers,
        });

        // Seed usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Consume 50 api-calls (above free-plan limit of 10, but that's fine — consume records it)
        for (let i = 0; i < 5; i++) {
            await instance.client.$fetch("/usage/consume", {
                method: "POST",
                body: { referenceId: refId, featureKey: "api-calls", amount: 10, event: "use" },
                headers,
            });
        }

        // Verify 50 consumed on free-plan
        const beforeUpgrade = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", overrideKey: "free-plan" },
            headers,
        });
        expect(beforeUpgrade.data.currentAmount).toBe(50);
        expect(beforeUpgrade.data.maxLimit).toBe(10);

        // Upgrade to pro-plan (triggers plan change — carry-over keeps usage)
        await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: { referenceId: refId, referenceType: "user", overrideKey: "pro-plan" },
            headers,
        });

        // Check usage with pro-plan override — usage carried over (50), maxLimit now 10000
        const afterUpgrade = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", overrideKey: "pro-plan" },
            headers,
        });
        expect(afterUpgrade.data.currentAmount).toBe(50);
        expect(afterUpgrade.data.maxLimit).toBe(10000);
        expect(afterUpgrade.data.status).toBe("in-limit");
    });

    test("reset: credits reset on plan change", async () => {
        const instance = await createTestInstance({
            features: planFeatures,
            overrides: planOverrides,
        });
        const { headers } = await signInWithTestUser(instance);
        const refId = "user-reset-credits";

        // Create customer on free-plan
        await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: { referenceId: refId, referenceType: "user", overrideKey: "free-plan" },
            headers,
        });

        // Seed usage for credits
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        // Consume 500 credits
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits", amount: 500, event: "use" },
            headers,
        });

        // Verify 500 consumed
        const beforeChange = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });
        expect(beforeChange.data.currentAmount).toBe(500);

        // Change to pro-plan — credits has onPlanChange: "reset"
        await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: { referenceId: refId, referenceType: "user", overrideKey: "pro-plan" },
            headers,
        });

        // Credits should be reset to resetValue (0)
        const afterChange = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });
        expect(afterChange.data.currentAmount).toBe(0);
        expect(afterChange.data.maxLimit).toBe(50000);
    });

    test("plan change logs events (verified via correct usage state)", async () => {
        const instance = await createTestInstance({
            features: planFeatures,
            overrides: planOverrides,
        });
        const { headers } = await signInWithTestUser(instance);
        const refId = "user-plan-events";

        // Create on free-plan
        await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: { referenceId: refId, referenceType: "user", overrideKey: "free-plan" },
            headers,
        });

        // Seed both features
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });

        // Consume some of each
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls", amount: 5, event: "use" },
            headers,
        });
        await instance.client.$fetch("/usage/consume", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits", amount: 200, event: "use" },
            headers,
        });

        // Trigger plan change
        const upsertRes = await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: { referenceId: refId, referenceType: "user", overrideKey: "pro-plan" },
            headers,
        });
        expect(upsertRes.error).toBeNull();

        // Verify carry-over feature kept its value
        const apiCheck = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });
        expect(apiCheck.data.currentAmount).toBe(5);
        expect(apiCheck.data.maxLimit).toBe(10000);

        // Verify reset feature was zeroed out
        const creditsCheck = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "credits" },
            headers,
        });
        expect(creditsCheck.data.currentAmount).toBe(0);
        expect(creditsCheck.data.maxLimit).toBe(50000);
    });

    test("overrideKey auto-resolves from customer", async () => {
        const instance = await createTestInstance({
            features: planFeatures,
            overrides: planOverrides,
        });
        const { headers } = await signInWithTestUser(instance);
        const refId = "user-auto-resolve";

        // Create customer with pro-plan overrideKey
        await instance.client.$fetch("/usage/upsert-customer", {
            method: "POST",
            body: { referenceId: refId, referenceType: "user", overrideKey: "pro-plan" },
            headers,
        });

        // Seed usage
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // Check WITHOUT passing overrideKey — should auto-resolve from customer record
        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: refId, featureKey: "api-calls" },
            headers,
        });

        // maxLimit should be pro-plan's 10000, not the base 100
        expect(checkRes.data.maxLimit).toBe(10000);
        expect(checkRes.data.status).toBe("in-limit");
    });
});
