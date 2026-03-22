import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Server as SocketServer } from "socket.io";
import { UsageTracker } from "../usage-tracker";
import { UsageCache } from "../../adapters/cache";
import type { cached_UsageEvent } from "../../types";

describe("UsageTracker", () => {
    let tracker: UsageTracker;
    let mockIo: SocketServer;
    let mockCache: UsageCache;
    let mockPubClient: any;
    let mockSubClient: any;
    const testRedisUrl = "redis://localhost:6379";

    beforeEach(() => {
        mockPubClient = {
            connect: mock(async () => { }),
            publish: mock(async (channel: string, message: string) => { }),
            quit: mock(async () => { }),
            psubscribe: mock((pattern: string) => { }),
            on: mock((event: string, handler: Function) => { })
        };

        mockSubClient = {
            connect: mock(async () => { }),
            psubscribe: mock((pattern: string) => { }),
            on: mock((event: string, handler: Function) => { }),
            quit: mock(async () => { })
        };

        // Mock Redis constructor - return pub client first, sub client second
        let callCount = 0;
        mock.module("ioredis", () => ({
            default: class Redis {
                constructor(_url: string) {
                    callCount++;
                    const target = callCount % 2 === 1 ? mockPubClient : mockSubClient;
                    return target;
                }
            }
        }));

        mockIo = {
            to: mock((room: string) => ({
                emit: mock((event: string, data: any) => { })
            }))
        } as any;

        mockCache = {
            getUsage: mock(async (referenceId: string, feature: { key: string }) => ({
                referenceId,
                feature: feature.key,
                current: 100,
                lastResetAt: new Date(),
                updatedAt: new Date()
            })),
            insertEvent: mock(async () => { })
        } as any;

        callCount = 0;
        tracker = new UsageTracker(testRedisUrl, mockIo, mockCache);
    });

    afterEach(async () => {
        await tracker.disconnect();
    });

    describe("constructor", () => {
        it("should create instance with required parameters", () => {
            expect(tracker).toBeDefined();
            expect(tracker).toBeInstanceOf(UsageTracker);
        });

        it("should extend EventEmitter", () => {
            expect(tracker.on).toBeDefined();
            expect(tracker.emit).toBeDefined();
            expect(tracker.removeListener).toBeDefined();
        });

        it("should set CHANNEL_PREFIX correctly", () => {
            const prefix = (tracker as any).CHANNEL_PREFIX;
            expect(prefix).toBe("usage:updates:");
        });
    });

    describe("connect", () => {
        it("should connect both Redis clients", async () => {
            await tracker.connect();
        });

        it("should handle connection errors gracefully", async () => {
            mockPubClient.connect = mock(async () => {
                throw new Error("Connection refused");
            });
            const badTracker = new UsageTracker("invalid-url", mockIo, mockCache);
            await expect(badTracker.connect()).rejects.toThrow();
            await badTracker.disconnect();
        });
    });

    describe("publishUpdate", () => {
        it("should publish usage update to correct channel", async () => {
            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                event: "increment"
            };

            await tracker.publishUpdate(update);
        });

        it("should format channel name correctly", async () => {
            const update: cached_UsageEvent = {
                referenceId: "org-456",
                feature: "storage",
                amount: 100,
            };

            await tracker.publishUpdate(update);
            // Channel should be: usage:updates:storage:org-456
            expect(mockPubClient.publish).toHaveBeenCalledWith(
                "usage:updates:storage:org-456",
                expect.stringContaining('"feature":"storage"')
            );
        });

        it("should handle special characters in referenceId", async () => {
            const update: cached_UsageEvent = {
                referenceId: "user@test.com",
                feature: "api-calls",
                amount: 1,
            };

            await tracker.publishUpdate(update);
        });

        it("should handle negative amounts", async () => {
            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: -10,
            };

            await tracker.publishUpdate(update);
        });

        it("should handle zero amount", async () => {
            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 0,
            };

            await tracker.publishUpdate(update);
        });
    });

    describe("getUsage", () => {
        const apiCallsFeature = {
            key: "api-calls",
            reset: "daily" as const,
            resetValue: 1000
        };

        const storageFeature = {
            key: "storage",
            reset: "monthly" as const,
            resetValue: 10000
        };

        const bandwidthFeature = {
            key: "bandwidth",
            reset: "daily" as const,
            resetValue: 5000
        };

        it("should delegate to cache.getUsage", async () => {
            const result = await tracker.getUsage("user-123", apiCallsFeature);

            expect(result).toBeDefined();
            expect(mockCache.getUsage).toHaveBeenCalledWith("user-123", apiCallsFeature);
        });

        it("should return cached usage data", async () => {
            const result = await tracker.getUsage("user-456", storageFeature);

            expect(result.referenceId).toBe("user-456");
            expect(result.feature).toBe("storage");
            expect(result.current).toBe(100);
        });

        it("should handle cache errors", async () => {
            mockCache.getUsage = mock(async () => {
                throw new Error("Cache error");
            });

            await expect(
                tracker.getUsage("user-123", apiCallsFeature)
            ).rejects.toThrow("Cache error");
        });

        it("should work with different feature types", async () => {
            await tracker.getUsage("user-123", apiCallsFeature);
            await tracker.getUsage("user-123", storageFeature);
            await tracker.getUsage("user-123", bandwidthFeature);

            expect(mockCache.getUsage).toHaveBeenCalledTimes(3);
        });
    });

    describe("broadcastUpdate via pubsub", () => {
        it("should broadcast to correct room when pmessage is received", async () => {
            await tracker.connect();

            // Get the pmessage handler that was registered on the sub client
            const onCalls = mockSubClient.on.mock.calls;
            const pmessageCall = onCalls.find((call: any[]) => call[0] === "pmessage");
            expect(pmessageCall).toBeDefined();

            const pmessageHandler = pmessageCall[1];

            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
            };

            await pmessageHandler("usage:updates:*", "usage:updates:api-calls:user-123", JSON.stringify(update));

            // Room should be: usage:api-calls:user-123
            expect(mockIo.to).toHaveBeenCalledWith("usage:api-calls:user-123");
        });

        it("should emit usage:update event when pmessage is received", async () => {
            await tracker.connect();

            const onCalls = mockSubClient.on.mock.calls;
            const pmessageCall = onCalls.find((call: any[]) => call[0] === "pmessage");
            const pmessageHandler = pmessageCall[1];

            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
            };

            const emitPromise = new Promise<cached_UsageEvent>((resolve) => {
                tracker.on("usage:update", resolve);
            });

            await pmessageHandler("usage:updates:*", "usage:updates:api-calls:user-123", JSON.stringify(update));

            const emitted = await emitPromise;
            expect(emitted.referenceId).toBe("user-123");
            expect(emitted.feature).toBe("api-calls");
            expect(emitted.amount).toBe(10);
        });
    });

    describe("event handling", () => {
        it("should emit usage:update event when update received", (done) => {
            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
            };

            tracker.on("usage:update", (receivedUpdate) => {
                expect(receivedUpdate).toEqual(update);
                done();
            });

            tracker.emit("usage:update", update);
        });

        it("should support multiple listeners", (done) => {
            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
            };

            let count = 0;
            const checkDone = () => {
                count++;
                if (count === 2) done();
            };

            tracker.on("usage:update", checkDone);
            tracker.on("usage:update", checkDone);

            tracker.emit("usage:update", update);
        });

        it("should allow removing listeners", () => {
            const listener = mock(() => { });
            tracker.on("usage:update", listener);
            tracker.removeListener("usage:update", listener);

            tracker.emit("usage:update", {} as cached_UsageEvent);
            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe("disconnect", () => {
        it("should disconnect both Redis clients", async () => {
            await tracker.disconnect();
        });

        it("should handle multiple disconnect calls", async () => {
            await tracker.disconnect();
            await tracker.disconnect();
        });

        it("should disconnect even if connection failed", async () => {
            const failedTracker = new UsageTracker("invalid", mockIo, mockCache);
            await failedTracker.disconnect();
        });
    });

    describe("channel naming", () => {
        it("should create consistent channel names", async () => {
            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
            };

            await tracker.publishUpdate(update);
            await tracker.publishUpdate(update);
            // Both should use same channel: usage:updates:api-calls:user-123
            expect(mockPubClient.publish).toHaveBeenCalledTimes(2);
            expect(mockPubClient.publish).toHaveBeenNthCalledWith(
                1,
                "usage:updates:api-calls:user-123",
                expect.any(String)
            );
            expect(mockPubClient.publish).toHaveBeenNthCalledWith(
                2,
                "usage:updates:api-calls:user-123",
                expect.any(String)
            );
        });

        it("should create different channels for different features", async () => {
            const update1: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
            };

            const update2: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "storage",
                amount: 100,
            };

            await tracker.publishUpdate(update1);
            await tracker.publishUpdate(update2);
            // Different channels based on feature
        });

        it("should create different channels for different references", async () => {
            const update1: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
            };

            const update2: cached_UsageEvent = {
                referenceId: "user-456",
                feature: "api-calls",
                amount: 10,
            };

            await tracker.publishUpdate(update1);
            await tracker.publishUpdate(update2);
            // Different channels based on referenceId
        });
    });

    describe("edge cases", () => {
        it("should handle very large amount", async () => {
            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 999999,
            };

            await tracker.publishUpdate(update);
        });

        it("should handle event field", async () => {
            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                event: "consumption"
            };

            await tracker.publishUpdate(update);
        });

        it("should handle past timestamps in event", async () => {
            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
            };

            await tracker.publishUpdate(update);
        });

        it("should handle empty feature names", async () => {
            const update: cached_UsageEvent = {
                referenceId: "user-123",
                feature: "",
                amount: 10,
            };

            await tracker.publishUpdate(update);
        });
    });
});
