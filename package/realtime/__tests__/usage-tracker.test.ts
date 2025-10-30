import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Server as SocketServer } from "socket.io";
import Redis from "ioredis";
import { UsageTracker, UsageUpdate } from "../usage-tracker";
import { UsageCache } from "../../adapters/cache";

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
            quit: mock(async () => { })
        };

        mockSubClient = {
            connect: mock(async () => { }),
            psubscribe: mock((pattern: string) => { }),
            on: mock((event: string, handler: Function) => { }),
            quit: mock(async () => { })
        };

        // Mock Redis constructor
        mock.module("ioredis", () => ({
            default: mock(() => mockPubClient) // alternate returning pub/sub clients as needed
        }));
        mockIo = {
            to: mock((room: string) => ({
                emit: mock((event: string, data: any) => { })
            }))
        } as any;

        mockCache = {
            getUsage: mock(async (referenceId: string, feature: string) => ({
                referenceId,
                feature,
                current: 100,
                lastResetAt: new Date(),
                updatedAt: new Date()
            }))
        } as any;

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
            expect(await tracker.connect()).resolves.not.toThrow();
        });

        it("should handle connection errors gracefully", async () => {
            const badTracker = new UsageTracker("invalid-url", mockIo, mockCache);
            expect(await badTracker.connect()).rejects.toThrow();
            await badTracker.disconnect();
        });
    });

    describe("publishUpdate", () => {
        it("should publish usage update to correct channel", async () => {
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            expect(await tracker.publishUpdate(update)).resolves.not.toThrow();
        });

        it("should format channel name correctly", async () => {
            const update: UsageUpdate = {
                referenceId: "org-456",
                feature: "storage",
                amount: 100,
                afterValue: 500,
                resetAt: new Date(),
                timestamp: Date.now(),
            };

            await tracker.publishUpdate(update);
            // Channel should be: usage:updates:storage:org-456
            expect(mockPubClient.publish).toHaveBeenCalledWith(
                "usage:updates:storage:org-456",
                expect.stringContaining('"feature":"storage"')
            );
        });

        it("should handle special characters in referenceId", async () => {
            const update: UsageUpdate = {
                referenceId: "user@test.com",
                feature: "api-calls",
                amount: 1,
                afterValue: 101,
                resetAt: new Date(),
                timestamp: Date.now(),
            };

            await expect(tracker.publishUpdate(update)).resolves.not.toThrow();
        });

        it("should handle negative amounts", async () => {
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: -10,
                afterValue: 90,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            await expect(tracker.publishUpdate(update)).resolves.not.toThrow();
        });

        it("should handle zero amount", async () => {
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 0,
                afterValue: 100,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            await expect(tracker.publishUpdate(update)).resolves.not.toThrow();
        });
    });

    describe("getUsage", () => {
        it("should delegate to cache.getUsage", async () => {
            const result = await tracker.getUsage("user-123", "api-calls");

            expect(result).toBeDefined();
            expect(mockCache.getUsage).toHaveBeenCalledWith("user-123", "api-calls");
        });

        it("should return cached usage data", async () => {
            const result = await tracker.getUsage("user-456", "storage");

            expect(result.referenceId).toBe("user-456");
            expect(result.feature).toBe("storage");
            expect(result.current).toBe(100);
        });

        it("should handle cache errors", async () => {
            mockCache.getUsage = mock(async () => {
                throw new Error("Cache error");
            });

            await expect(
                tracker.getUsage("user-123", "api-calls")
            ).rejects.toThrow("Cache error");
        });

        it("should work with different feature types", async () => {
            await tracker.getUsage("user-123", "api-calls");
            await tracker.getUsage("user-123", "storage");
            await tracker.getUsage("user-123", "bandwidth");

            expect(mockCache.getUsage).toHaveBeenCalledTimes(3);
        });
    });

    describe("broadcastUpdate", () => {
        it("should emit to correct room format", () => {
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            // Trigger internal broadcast by emitting to tracker
            tracker.emit("usage:update", update);

            // Room should be: usage:api-calls:user-123
            expect(mockIo.to).toHaveBeenCalledWith("usage:api-calls:user-123");
            const roomMock = mockIo.to.mock.results[0].value;
            expect(roomMock.emit).toHaveBeenCalledWith("usage:updated", update);
        });

        it("should broadcast with correct event name", () => {
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            tracker.emit("usage:update", update);
            // Should emit "usage:updated" event
            const roomMock = mockIo.to.mock.results[0].value;
            expect(roomMock.emit).toHaveBeenCalledWith("usage:updated", expect.any(Object));
        });

        it("should handle multiple features for same reference", () => {
            const update1: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            const update2: UsageUpdate = {
                referenceId: "user-123",
                feature: "storage",
                amount: 50,
                afterValue: 550,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            tracker.emit("usage:update", update1);
            tracker.emit("usage:update", update2);
        });
    });

    describe("event handling", () => {
        it("should emit usage:update event when update received", (done) => {
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            tracker.on("usage:update", (receivedUpdate) => {
                expect(receivedUpdate).toEqual(update);
                done();
            });

            tracker.emit("usage:update", update);
        });

        it("should support multiple listeners", (done) => {
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now()
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

            tracker.emit("usage:update", {} as UsageUpdate);
            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe("disconnect", () => {
        it("should disconnect both Redis clients", async () => {
            await expect(tracker.disconnect()).resolves.not.toThrow();
        });

        it("should handle multiple disconnect calls", async () => {
            await tracker.disconnect();
            await expect(tracker.disconnect()).resolves.not.toThrow();
        });

        it("should disconnect even if connection failed", async () => {
            const failedTracker = new UsageTracker("invalid", mockIo, mockCache);
            await expect(failedTracker.disconnect()).resolves.not.toThrow();
        });
    });

    describe("channel naming", () => {
        it("should create consistent channel names", async () => {
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now()
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
            const update1: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            const update2: UsageUpdate = {
                referenceId: "user-123",
                feature: "storage",
                amount: 100,
                afterValue: 600,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            await tracker.publishUpdate(update1);
            await tracker.publishUpdate(update2);
            // Different channels based on feature
        });

        it("should create different channels for different references", async () => {
            const update1: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            const update2: UsageUpdate = {
                referenceId: "user-456",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            await tracker.publishUpdate(update1);
            await tracker.publishUpdate(update2);
            // Different channels based on referenceId
        });
    });

    describe("edge cases", () => {
        it("should handle very large afterValue", async () => {
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 999999,
                afterValue: 999999999,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            await expect(tracker.publishUpdate(update)).resolves.not.toThrow();
        });

        it("should handle future resetAt dates", async () => {
            const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: futureDate,
                timestamp: Date.now()
            };

            await expect(tracker.publishUpdate(update)).resolves.not.toThrow();
        });

        it("should handle past timestamps", async () => {
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "api-calls",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now() - 10000
            };

            await expect(tracker.publishUpdate(update)).resolves.not.toThrow();
        });

        it("should handle empty feature names", async () => {
            const update: UsageUpdate = {
                referenceId: "user-123",
                feature: "",
                amount: 10,
                afterValue: 110,
                resetAt: new Date(),
                timestamp: Date.now()
            };

            await expect(tracker.publishUpdate(update)).resolves.not.toThrow();
        });
    });
});
