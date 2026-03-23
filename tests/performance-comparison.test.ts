import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestInstance, signInWithTestUser, createCustomer, shutdownUsage } from "./test-helper";

describe("performance comparison (DB-only)", () => {
    let instance: Awaited<ReturnType<typeof createTestInstance>>;
    let headers: Headers;

    beforeAll(async () => {
        await shutdownUsage();
        instance = await createTestInstance();
        ({ headers } = await signInWithTestUser(instance));

        // Create customer and seed both features
        await createCustomer(instance, headers, "perf-cmp");
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "perf-cmp", featureKey: "api-calls" },
            headers,
        });
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "perf-cmp", featureKey: "credits" },
            headers,
        });
    });

    afterAll(async () => {
        await shutdownUsage();
    });

    test("consume throughput: sequential (100 calls)", async () => {
        const start = performance.now();

        for (let i = 0; i < 100; i++) {
            const res = await instance.client.$fetch("/usage/consume", {
                method: "POST",
                body: {
                    referenceId: "perf-cmp",
                    featureKey: "api-calls",
                    amount: 1,
                    event: "use",
                },
                headers,
            });
            expect(res.error).toBeNull();
        }

        const elapsed = performance.now() - start;
        const opsPerSec = (100 / elapsed) * 1000;

        console.log(`[PERF] sequential consume (100 calls): total=${elapsed.toFixed(2)}ms, ops/sec=${opsPerSec.toFixed(0)}`);

        // Average should be under 50ms per call
        expect(elapsed / 100).toBeLessThan(50);
    });

    test("consume throughput: burst (50 parallel calls)", async () => {
        const start = performance.now();

        const promises = Array.from({ length: 50 }, () =>
            instance.client.$fetch("/usage/consume", {
                method: "POST",
                body: {
                    referenceId: "perf-cmp",
                    featureKey: "credits",
                    amount: 1,
                    event: "use",
                },
                headers,
            })
        );

        const results = await Promise.all(promises);
        const elapsed = performance.now() - start;

        for (const res of results) {
            expect(res.error).toBeNull();
        }

        console.log(`[PERF] burst consume (50 parallel): total=${elapsed.toFixed(2)}ms, avg=${(elapsed / 50).toFixed(2)}ms`);

        // Total time for 50 parallel calls should be reasonable
        expect(elapsed).toBeLessThan(5000);
    });

    test("check latency after high write volume (200 consumes)", async () => {
        await createCustomer(instance, headers, "perf-high-vol");
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "perf-high-vol", featureKey: "api-calls" },
            headers,
        });

        // Perform 200 sequential consumes
        for (let i = 0; i < 200; i++) {
            await instance.client.$fetch("/usage/consume", {
                method: "POST",
                body: {
                    referenceId: "perf-high-vol",
                    featureKey: "api-calls",
                    amount: 1,
                    event: "use",
                },
                headers,
            });
        }

        // Now measure check latency — should still be fast (single findOne)
        const times: number[] = [];
        for (let i = 0; i < 20; i++) {
            const start = performance.now();
            const res = await instance.client.$fetch("/usage/check", {
                method: "POST",
                body: { referenceId: "perf-high-vol", featureKey: "api-calls" },
                headers,
            });
            times.push(performance.now() - start);
            expect(res.error).toBeNull();
            expect(res.data.currentAmount).toBe(200);
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const sorted = [...times].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(times.length * 0.95)];

        console.log(`[PERF] check after 200 writes (20 calls): avg=${avg.toFixed(2)}ms, p95=${p95.toFixed(2)}ms`);

        expect(avg).toBeLessThan(50);
    });

    test("mixed workload: alternating consume + check (100 iterations)", async () => {
        await createCustomer(instance, headers, "perf-mixed");
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "perf-mixed", featureKey: "api-calls" },
            headers,
        });

        const times: number[] = [];

        for (let i = 0; i < 100; i++) {
            const iterStart = performance.now();

            // Consume
            const consumeRes = await instance.client.$fetch("/usage/consume", {
                method: "POST",
                body: {
                    referenceId: "perf-mixed",
                    featureKey: "api-calls",
                    amount: 1,
                    event: "use",
                },
                headers,
            });
            expect(consumeRes.error).toBeNull();

            // Check
            const checkRes = await instance.client.$fetch("/usage/check", {
                method: "POST",
                body: { referenceId: "perf-mixed", featureKey: "api-calls" },
                headers,
            });
            expect(checkRes.error).toBeNull();

            times.push(performance.now() - iterStart);
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const sorted = [...times].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(times.length * 0.95)];

        console.log(`[PERF] mixed consume+check (100 iterations): avg=${avg.toFixed(2)}ms, p95=${p95.toFixed(2)}ms`);

        // Each iteration is a consume + check pair, should be under 50ms avg
        expect(avg).toBeLessThan(50);
    });

    test("multiple features: alternating consume on two features (100 iterations)", async () => {
        await createCustomer(instance, headers, "perf-multi-feat");
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "perf-multi-feat", featureKey: "api-calls" },
            headers,
        });
        await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "perf-multi-feat", featureKey: "credits" },
            headers,
        });

        const features = ["api-calls", "credits"];
        const times: number[] = [];

        for (let i = 0; i < 100; i++) {
            const featureKey = features[i % 2];
            const start = performance.now();

            const res = await instance.client.$fetch("/usage/consume", {
                method: "POST",
                body: {
                    referenceId: "perf-multi-feat",
                    featureKey,
                    amount: 1,
                    event: "use",
                },
                headers,
            });
            expect(res.error).toBeNull();

            times.push(performance.now() - start);
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const sorted = [...times].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(times.length * 0.95)];

        console.log(`[PERF] multi-feature consume (100 calls, alternating): avg=${avg.toFixed(2)}ms, p95=${p95.toFixed(2)}ms`);

        expect(avg).toBeLessThan(50);

        // Verify both features tracked correctly (50 each)
        const apiCheck = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "perf-multi-feat", featureKey: "api-calls" },
            headers,
        });
        const creditsCheck = await instance.client.$fetch("/usage/check", {
            method: "POST",
            body: { referenceId: "perf-multi-feat", featureKey: "credits" },
            headers,
        });
        expect(apiCheck.data.currentAmount).toBe(50);
        expect(creditsCheck.data.currentAmount).toBe(50);
    });
});
