import { describe, test, expect, beforeAll } from "bun:test";
import { createTestInstance, signInWithTestUser, createCustomer, shutdownUsage } from "./test-helper";

describe("performance", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        await shutdownUsage();
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));

        // Create customer and seed initial usage
        await createCustomer(instance, headers, "perf-user");
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "perf-user", featureKey: "api-calls" },
            headers,
        });
    });

    test("consume endpoint responds in under 50ms (DB-only, no Redis)", async () => {
        const times: number[] = [];

        for (let i = 0; i < 20; i++) {
            const start = performance.now();
            const res = await instance.client.$fetch("/usage/consume", {
                method: "POST",
                body: {
                    referenceId: "perf-user",
                    featureKey: "api-calls",
                    amount: 1,
                    event: "use",
                },
                headers,
            });
            const elapsed = performance.now() - start;
            times.push(elapsed);
            expect(res.error).toBeNull();
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

        console.log(`[PERF] consume (DB-only, 20 calls): avg=${avg.toFixed(2)}ms, p95=${p95.toFixed(2)}ms`);

        // DB-only should be under 50ms per call
        expect(avg).toBeLessThan(50);
    });

    test("check endpoint responds in under 20ms (DB-only, no Redis)", async () => {
        const times: number[] = [];

        for (let i = 0; i < 20; i++) {
            const start = performance.now();
            const res = await instance.client.$fetch("/usage/check", {
                method: "POST",
                body: {
                    referenceId: "perf-user",
                    featureKey: "api-calls",
                },
                headers,
            });
            const elapsed = performance.now() - start;
            times.push(elapsed);
            expect(res.error).toBeNull();
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

        console.log(`[PERF] check (DB-only, 20 calls): avg=${avg.toFixed(2)}ms, p95=${p95.toFixed(2)}ms`);

        // Check should be fast — single findOne
        expect(avg).toBeLessThan(20);
    });

    test("can-use endpoint responds in under 20ms", async () => {
        const times: number[] = [];

        for (let i = 0; i < 20; i++) {
            const start = performance.now();
            const res = await instance.client.$fetch("/usage/can-use", {
                method: "POST",
                body: {
                    referenceId: "perf-user",
                    featureKey: "api-calls",
                },
                headers,
            });
            const elapsed = performance.now() - start;
            times.push(elapsed);
            expect(res.error).toBeNull();
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];

        console.log(`[PERF] can-use (DB-only, 20 calls): avg=${avg.toFixed(2)}ms, p95=${p95.toFixed(2)}ms`);

        expect(avg).toBeLessThan(20);
    });

    test("accumulated usage is correct after burst", async () => {
        const checkRes = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "perf-user", featureKey: "api-calls" },
            headers,
        });

        // 20 consumes of 1 each from the first test
        expect(checkRes.data.currentAmount).toBe(20);
    });
});
