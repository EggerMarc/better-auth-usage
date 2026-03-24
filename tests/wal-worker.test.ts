import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Layer } from "effect";
import { RedisService, DbService, LoggerService, makeLoggerServiceLive } from "../package/services";
import { drain } from "../package/wal/worker";

/**
 * In-memory stream mock for testing WAL drain logic without real Redis.
 * Simulates XADD/XREADGROUP/XACK/XLEN/XTRIM behavior.
 */
function createMockStream() {
    const entries: Array<{ id: string; fields: Record<string, string> }> = [];
    const acked = new Set<string>();
    let idCounter = 0;

    return {
        entries,
        acked,

        add(fields: Record<string, string>) {
            const id = `${Date.now()}-${idCounter++}`;
            entries.push({ id, fields });
            return id;
        },

        /** Get unacknowledged entries (simulates XREADGROUP with ">") */
        readPending(count: number) {
            const pending = entries.filter(e => !acked.has(e.id)).slice(0, count);
            if (pending.length === 0) return null;
            return pending.map(e => {
                const flat: string[] = [];
                for (const [k, v] of Object.entries(e.fields)) {
                    flat.push(k, v);
                }
                return [e.id, flat] as [string, string[]];
            });
        },

        ack(...ids: string[]) {
            for (const id of ids) acked.add(id);
        },
    };
}

/**
 * Create a mock RedisService backed by the in-memory stream.
 */
function createMockRedisLayer(stream: ReturnType<typeof createMockStream>) {
    return Layer.succeed(RedisService, {
        eval: () => Effect.succeed(null),
        get: () => Effect.succeed(null),
        set: () => Effect.void,
        del: () => Effect.void,
        hset: () => Effect.void,
        hgetall: () => Effect.succeed({}),
        publish: () => Effect.void,
        psubscribe: () => Effect.void,
        quit: () => Effect.void,
        xgroupCreate: () => Effect.void,
        xreadgroup: (_group, _consumer, _stream, _id, count) =>
            Effect.succeed(stream.readPending(count)),
        xack: (_stream, _group, ...ids) =>
            Effect.sync(() => stream.ack(...ids)),
        xlen: () => Effect.succeed(stream.entries.length),
        xtrim: () => Effect.void,
    });
}

/**
 * Create a mock DbService that records all writes.
 */
function createMockDbLayer() {
    const created: Array<{ model: string; data: Record<string, unknown> }> = [];
    const updated: Array<{ model: string; where: any[]; update: Record<string, unknown> }> = [];
    const rows = new Map<string, Record<string, unknown>>();

    const service: DbService = {
        findOne: (params) =>
            Effect.succeed(rows.get(`${params.where[0]?.value}:${params.where[1]?.value}`) ?? null),
        findMany: () => Effect.succeed([]),
        create: (params) => {
            created.push(params);
            const key = `${(params.data as any).referenceId}:${(params.data as any).feature}`;
            rows.set(key, params.data);
            return Effect.succeed(params.data);
        },
        update: (params) => {
            updated.push(params);
            const key = `${params.where[0]?.value}:${params.where[1]?.value}`;
            const existing = rows.get(key) ?? {};
            const merged = { ...existing, ...params.update };
            rows.set(key, merged);
            return Effect.succeed(merged);
        },
    };

    return {
        layer: Layer.succeed(DbService, service),
        created,
        updated,
        rows,
    };
}

describe("WAL worker drain logic", () => {
    let stream: ReturnType<typeof createMockStream>;
    let db: ReturnType<typeof createMockDbLayer>;

    beforeEach(() => {
        stream = createMockStream();
        db = createMockDbLayer();
    });

    function runDrain() {
        const layer = Layer.merge(
            Layer.merge(createMockRedisLayer(stream), db.layer),
            makeLoggerServiceLive()
        );
        return Effect.runPromise(drain.pipe(Effect.provide(layer)));
    }

    test("drains entries and writes to DB", async () => {
        stream.add({ refId: "user-1", feature: "api-calls", amount: "5", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "5", lastResetAt: "0" });
        stream.add({ refId: "user-1", feature: "api-calls", amount: "3", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "8", lastResetAt: "0" });

        const processed = await runDrain();

        expect(processed).toBe(2);
        // 2 usageEvent inserts (one per entry)
        const eventInserts = db.created.filter(c => c.model === "usageEvent");
        expect(eventInserts.length).toBe(2);
    });

    test("coalesces entries by ref+feature for usage upsert", async () => {
        // 3 entries for same ref+feature — only 1 usage upsert needed
        stream.add({ refId: "user-2", feature: "credits", amount: "10", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "10", lastResetAt: "0" });
        stream.add({ refId: "user-2", feature: "credits", amount: "20", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "30", lastResetAt: "0" });
        stream.add({ refId: "user-2", feature: "credits", amount: "5", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "35", lastResetAt: "0" });

        await runDrain();

        // 3 event inserts
        const eventInserts = db.created.filter(c => c.model === "usageEvent");
        expect(eventInserts.length).toBe(3);

        // 1 usage row (coalesced) with the LAST entry's newTotal
        const usageRow = db.rows.get("user-2:credits");
        expect(usageRow).toBeDefined();
        expect(usageRow!.amount).toBe(35);
    });

    test("handles multiple ref+feature pairs independently", async () => {
        stream.add({ refId: "user-3", feature: "api-calls", amount: "1", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "1", lastResetAt: "0" });
        stream.add({ refId: "user-3", feature: "credits", amount: "100", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "100", lastResetAt: "0" });
        stream.add({ refId: "user-4", feature: "api-calls", amount: "5", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "5", lastResetAt: "0" });

        await runDrain();

        // 3 event inserts
        expect(db.created.filter(c => c.model === "usageEvent").length).toBe(3);

        // 3 separate usage rows
        expect(db.rows.get("user-3:api-calls")!.amount).toBe(1);
        expect(db.rows.get("user-3:credits")!.amount).toBe(100);
        expect(db.rows.get("user-4:api-calls")!.amount).toBe(5);
    });

    test("ACKs all processed entries", async () => {
        const id1 = stream.add({ refId: "user-5", feature: "api-calls", amount: "1", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "1", lastResetAt: "0" });
        const id2 = stream.add({ refId: "user-5", feature: "api-calls", amount: "2", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "3", lastResetAt: "0" });

        await runDrain();

        expect(stream.acked.has(id1)).toBe(true);
        expect(stream.acked.has(id2)).toBe(true);
    });

    test("returns 0 when stream is empty", async () => {
        const processed = await runDrain();
        expect(processed).toBe(0);
    });

    test("second drain returns 0 after first drain ACKed everything", async () => {
        stream.add({ refId: "user-6", feature: "api-calls", amount: "1", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "1", lastResetAt: "0" });

        const first = await runDrain();
        expect(first).toBe(1);

        const second = await runDrain();
        expect(second).toBe(0);
    });

    test("upsert updates existing usage row", async () => {
        // First drain creates the row
        stream.add({ refId: "user-7", feature: "api-calls", amount: "10", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "10", lastResetAt: "0" });
        await runDrain();

        expect(db.rows.get("user-7:api-calls")!.amount).toBe(10);

        // Second drain updates it
        stream.add({ refId: "user-7", feature: "api-calls", amount: "5", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "15", lastResetAt: "0" });
        await runDrain();

        expect(db.rows.get("user-7:api-calls")!.amount).toBe(15);
        // Should have at least 1 update for usage model
        expect(db.updated.filter(u => u.model === "usage").length).toBeGreaterThanOrEqual(1);
    });

    test("handles reset events correctly", async () => {
        stream.add({ refId: "user-8", feature: "api-calls", amount: "50", event: "use", ts: String(Date.now()), resetOccurred: "0", newTotal: "50", lastResetAt: "0" });
        await runDrain();

        // Reset event — newTotal reflects post-reset value
        stream.add({ refId: "user-8", feature: "api-calls", amount: "5", event: "use", ts: String(Date.now()), resetOccurred: "1", newTotal: "5", lastResetAt: String(Date.now()) });
        await runDrain();

        expect(db.rows.get("user-8:api-calls")!.amount).toBe(5);

        // Event log should have both entries
        const events = db.created.filter(c => c.model === "usageEvent" && (c.data as any).referenceId === "user-8");
        expect(events.length).toBe(2);
    });
});
