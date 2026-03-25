import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import Redis from "ioredis";
import incrementScript from "../package/adapters/lua/increment.lua";

/**
 * Integration tests with real Redis.
 * Tests Lua script execution, WAL stream (XADD/XREADGROUP), and pub/sub.
 *
 * Requires Redis running on port 6399:
 *   docker run -d --name redis-test -p 6399:6379 redis:7-alpine
 */

let redis: Redis;
const redisUrl = "redis://localhost:6399";

beforeAll(async () => {
    redis = new Redis(redisUrl, { lazyConnect: true });
    await redis.connect();
    await redis.flushdb();
});

afterAll(async () => {
    await redis.flushdb();
    await redis.quit();
});

describe("Lua increment script", () => {
    test("increments counter and returns newTotal", async () => {
        const result = await redis.eval(
            incrementScript,
            3,
            "usage:test-feat:user-1",   // KEYS[1] counter
            "meta:test-feat:user-1",     // KEYS[2] metadata
            "wal:usage",                 // KEYS[3] WAL stream
            5,                           // ARGV[1] amount
            Date.now(),                  // ARGV[2] now_ms
            "user-1",                    // ARGV[3] refId
            "test-feat",                 // ARGV[4] feature
            "use",                       // ARGV[5] event
        ) as [number, number, number];

        expect(result[0]).toBe(5);       // newTotal
        expect(result[1]).toBe(0);       // resetOccurred = false
    });

    test("accumulates across multiple calls", async () => {
        // Clear previous state
        await redis.del("usage:accum:user-2");
        await redis.del("meta:accum:user-2");

        for (let i = 0; i < 10; i++) {
            await redis.eval(
                incrementScript, 3,
                "usage:accum:user-2", "meta:accum:user-2", "wal:usage",
                3, Date.now(), "user-2", "accum", "use",
            );
        }

        const counter = await redis.get("usage:accum:user-2");
        expect(Number(counter)).toBe(30); // 10 * 3
    });

    test("handles negative amounts (refunds)", async () => {
        await redis.del("usage:refund:user-3");
        await redis.del("meta:refund:user-3");

        // Add 100
        await redis.eval(
            incrementScript, 3,
            "usage:refund:user-3", "meta:refund:user-3", "wal:usage",
            100, Date.now(), "user-3", "refund", "use",
        );

        // Refund 30
        const result = await redis.eval(
            incrementScript, 3,
            "usage:refund:user-3", "meta:refund:user-3", "wal:usage",
            -30, Date.now(), "user-3", "refund", "refund",
        ) as [number, number, number];

        expect(result[0]).toBe(70); // 100 - 30
    });

    test("resets counter when reset boundary crossed", async () => {
        const counterKey = "usage:reset-test:user-4";
        const metaKey = "meta:reset-test:user-4";

        await redis.del(counterKey);
        await redis.del(metaKey);

        // Set metadata with a resetAt in the past
        const pastMs = Date.now() - 60000; // 1 minute ago
        await redis.hset(metaKey, {
            resetValue: "0",
            resetAt: String(pastMs),
            lastResetAt: String(pastMs - 120000),
        });

        // Set counter to 50
        await redis.set(counterKey, "50");

        // Increment — should trigger reset first, then apply amount
        const result = await redis.eval(
            incrementScript, 3,
            counterKey, metaKey, "wal:usage",
            5, Date.now(), "user-4", "reset-test", "use",
        ) as [number, number, number];

        expect(result[0]).toBe(5);  // resetValue (0) + amount (5)
        expect(result[1]).toBe(1);  // resetOccurred = true
    });

    test("does not reset when resetAt is in the future", async () => {
        const counterKey = "usage:no-reset:user-5";
        const metaKey = "meta:no-reset:user-5";

        await redis.del(counterKey);
        await redis.del(metaKey);

        // Set metadata with resetAt in the future
        const futureMs = Date.now() + 3600000; // 1 hour from now
        await redis.hset(metaKey, {
            resetValue: "0",
            resetAt: String(futureMs),
            lastResetAt: String(Date.now()),
        });

        await redis.set(counterKey, "50");

        const result = await redis.eval(
            incrementScript, 3,
            counterKey, metaKey, "wal:usage",
            10, Date.now(), "user-5", "no-reset", "use",
        ) as [number, number, number];

        expect(result[0]).toBe(60); // 50 + 10, no reset
        expect(result[1]).toBe(0);  // resetOccurred = false
    });
});

describe("WAL stream (XADD/XREADGROUP)", () => {
    test("Lua script appends entries to WAL stream", async () => {
        // Clear stream
        await redis.del("wal:test-stream");

        await redis.eval(
            incrementScript, 3,
            "usage:wal-test:user-6", "meta:wal-test:user-6", "wal:test-stream",
            7, Date.now(), "user-6", "wal-test", "use",
        );

        const len = await redis.xlen("wal:test-stream");
        expect(len).toBeGreaterThanOrEqual(1);
    });

    test("WAL entries contain correct fields", async () => {
        await redis.del("wal:fields-test");
        await redis.del("usage:fields:user-7");
        await redis.del("meta:fields:user-7");

        await redis.eval(
            incrementScript, 3,
            "usage:fields:user-7", "meta:fields:user-7", "wal:fields-test",
            42, Date.now(), "user-7", "fields-feat", "purchase",
        );

        // Read from stream
        const entries = await redis.xrange("wal:fields-test", "-", "+");
        expect(entries.length).toBe(1);

        const fields = entries[0][1];
        // Fields come as [key, value, key, value, ...]
        const obj: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
            obj[fields[i]] = fields[i + 1];
        }

        expect(obj.refId).toBe("user-7");
        expect(obj.feature).toBe("fields-feat");
        expect(Number(obj.amount)).toBe(42);
        expect(obj.event).toBe("purchase");
        expect(Number(obj.newTotal)).toBe(42);
    });

    test("consumer group can read and ACK entries", async () => {
        const stream = `wal:cg-test-${Date.now()}`;
        const group = `test-group-${Date.now()}`;

        // Write 3 entries using the Lua script
        for (let i = 0; i < 3; i++) {
            await redis.eval(
                incrementScript, 3,
                `usage:cg:user-8-${Date.now()}`, `meta:cg:user-8-${Date.now()}`, stream,
                1, Date.now(), "user-8", "cg-feat", "use",
            );
        }

        // Create consumer group
        await redis.xgroup("CREATE", stream, group, "0", "MKSTREAM");

        // Read entries
        const result = await redis.xreadgroup(
            "GROUP", group, "consumer-1",
            "COUNT", 10,
            "STREAMS", stream, ">"
        );

        expect(result).not.toBeNull();
        const entries = result![0][1];
        expect(entries.length).toBe(3);

        // ACK all
        const ids = entries.map((e: any) => e[0]);
        const acked = await redis.xack(stream, group, ...ids);
        expect(acked).toBe(3);

        // Reading again should return nothing
        const result2 = await redis.xreadgroup(
            "GROUP", group, "consumer-1",
            "COUNT", 10,
            "STREAMS", stream, ">"
        );
        expect(result2).toBeNull();
    });
});

describe("pub/sub", () => {
    test("Lua script publishes events on consume", async () => {
        const key = `usage:pubsub:user-9-${Date.now()}`;
        const metaKey = `meta:pubsub:user-9-${Date.now()}`;

        // Subscribe on a separate connection
        const sub = new Redis(redisUrl);
        const received: any[] = [];

        // Register message handler BEFORE subscribing
        sub.on("pmessage", (_pattern, _channel, message) => {
            received.push(JSON.parse(message));
        });

        // Subscribe and wait for confirmation
        await sub.psubscribe("usage:events:*");

        // Small delay to ensure subscription is active
        await new Promise((r) => setTimeout(r, 50));

        // Now trigger a consume
        await redis.eval(
            incrementScript, 3,
            key, metaKey, "wal:usage",
            1, Date.now(), "user-9", "pubsub-feat", "use",
        );

        // Wait for message to arrive
        await new Promise((r) => setTimeout(r, 100));

        await sub.quit();

        expect(received.length).toBeGreaterThanOrEqual(1);
        const msg = received.find((r) => r.refId === "user-9");
        expect(msg).toBeDefined();
        expect(msg.feature).toBe("pubsub-feat");
        expect(msg.newTotal).toBe(1);
    });
});

describe("concurrent writes", () => {
    test("100 parallel increments produce correct total", async () => {
        const counterKey = "usage:concurrent:user-10";
        const metaKey = "meta:concurrent:user-10";
        await redis.del(counterKey);
        await redis.del(metaKey);

        // 100 parallel increments of 1
        await Promise.all(
            Array.from({ length: 100 }, () =>
                redis.eval(
                    incrementScript, 3,
                    counterKey, metaKey, "wal:usage",
                    1, Date.now(), "user-10", "concurrent", "use",
                )
            )
        );

        const counter = await redis.get(counterKey);
        expect(Number(counter)).toBe(100); // Lua is atomic — no lost writes
    });

    test("mixed increments and decrements produce correct total", async () => {
        const counterKey = "usage:mixed-concurrent:user-11";
        const metaKey = "meta:mixed-concurrent:user-11";
        await redis.del(counterKey);
        await redis.del(metaKey);

        // 50 increments of +2, 50 decrements of -1 = net 50
        const ops = [
            ...Array.from({ length: 50 }, () =>
                redis.eval(incrementScript, 3, counterKey, metaKey, "wal:usage", 2, Date.now(), "user-11", "mixed", "use")
            ),
            ...Array.from({ length: 50 }, () =>
                redis.eval(incrementScript, 3, counterKey, metaKey, "wal:usage", -1, Date.now(), "user-11", "mixed", "refund")
            ),
        ];

        await Promise.all(ops);

        const counter = await redis.get(counterKey);
        expect(Number(counter)).toBe(50); // (50 * 2) + (50 * -1) = 50
    });
});
