import { describe, it, expect, beforeEach, mock } from "bun:test";
import { UsageWebSocketServer } from "../websocket-server";
import { UsageTracker } from "../usage-tracker";
import type { UsageOptions } from "../../types";

describe("UsageWebSocketServer", () => {
    let wsServer: UsageWebSocketServer;
    let mockIo: any;
    let mockTracker: UsageTracker;
    let mockOptions: UsageOptions;
    let mockSocket: any;

    beforeEach(() => {
        mockSocket = {
            id: "socket-123",
            on: mock((event: string, handler: Function) => {
                (mockSocket as any)[`_${event}`] = handler;
            }),
            join: mock((room: string) => { }),
            leave: mock((room: string) => { }),
            emit: mock((event: string, data: any) => { })
        };

        mockIo = {
            on: mock((event: string, handler: Function) => {
                if (event === "connection") {
                    (mockIo as any)._connectionHandler = handler;
                }
            }),
            to: mock((room: string) => ({
                emit: mock((event: string, data: any) => { })
            }))
        };

        mockTracker = {
            getUsage: mock(async (referenceId: string, feature: string) => ({
                referenceId,
                feature,
                current: 100,
                lastResetAt: new Date(),
                updatedAt: new Date()
            }))
        } as any;

        mockOptions = {
            features: {
                "api-calls": {
                    key: "api-calls",
                    reset: "daily",
                    resetValue: 1000
                },
                "storage": {
                    key: "storage",
                    reset: "monthly",
                    resetValue: 10000,
                    authorizeReference: mock(async () => true)
                }
            }
        };

        wsServer = new UsageWebSocketServer(mockIo, mockTracker, mockOptions);
    });

    describe("constructor", () => {
        it("should create instance with required parameters", () => {
            expect(wsServer).toBeDefined();
            expect(mockIo.on).toHaveBeenCalledWith("connection", expect.any(Function));
        });

        it("should setup socket handlers on construction", () => {
            expect(mockIo.on).toHaveBeenCalled();
        });
    });

    describe("subscribe:usage event", () => {
        it("should handle subscription to single feature", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const subscribeData = {
                subscriptions: [
                    {
                        referenceId: "user-123",
                        feature: "api-calls",
                        referenceType: "user"
                    }
                ]
            };

            await mockSocket._["subscribe:usage"](subscribeData);

            expect(mockSocket.join).toHaveBeenCalledWith("usage:api-calls:user-123");
            expect(mockSocket.emit).toHaveBeenCalledWith("subscribed", {
                subscriptions: subscribeData.subscriptions
            });
        });

        it("should handle subscription to multiple features", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const subscribeData = {
                subscriptions: [
                    {
                        referenceId: "user-123",
                        feature: "api-calls",
                        referenceType: "user"
                    },
                    {
                        referenceId: "user-123",
                        feature: "storage",
                        referenceType: "user"
                    }
                ]
            };

            await mockSocket._["subscribe:usage"](subscribeData);

            expect(mockSocket.join).toHaveBeenCalledWith("usage:api-calls:user-123");
            expect(mockSocket.join).toHaveBeenCalledWith("usage:storage:user-123");
        });

        it("should emit error when feature not found", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const subscribeData = {
                subscriptions: [
                    {
                        referenceId: "user-123",
                        feature: "nonexistent",
                        referenceType: "user"
                    }
                ]
            };

            await mockSocket._["subscribe:usage"](subscribeData);

            expect(mockSocket.emit).toHaveBeenCalledWith("error", {
                message: "Feature nonexistent not found"
            });
            expect(mockSocket.join).not.toHaveBeenCalled();
        });

        it("should check authorization when authorizeReference is defined", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const subscribeData = {
                subscriptions: [
                    {
                        referenceId: "user-123",
                        feature: "storage",
                        referenceType: "user"
                    }
                ]
            };

            await mockSocket._["subscribe:usage"](subscribeData);

            expect(mockOptions.features["storage"].authorizeReference).toHaveBeenCalled();
        });

        it("should emit error when authorization fails", async () => {
            mockOptions.features["storage"].authorizeReference = mock(async () => false);
            wsServer = new UsageWebSocketServer(mockIo, mockTracker, mockOptions);

            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const subscribeData = {
                subscriptions: [
                    {
                        referenceId: "user-123",
                        feature: "storage",
                        referenceType: "user"
                    }
                ]
            };

            await mockSocket._["subscribe:usage"](subscribeData);

            expect(mockSocket.emit).toHaveBeenCalledWith("error", {
                message: "Not authorized for storage:user-123"
            });
            expect(mockSocket.join).not.toHaveBeenCalled();
        });

        it("should skip authorization when not defined", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const subscribeData = {
                subscriptions: [
                    {
                        referenceId: "user-123",
                        feature: "api-calls",
                        referenceType: "user"
                    }
                ]
            };

            await mockSocket._["subscribe:usage"](subscribeData);

            expect(mockSocket.join).toHaveBeenCalledWith("usage:api-calls:user-123");
        });
    });

    describe("unsubscribe:usage event", () => {
        it("should leave room on unsubscribe", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const unsubscribeData = {
                subscriptions: [
                    {
                        referenceId: "user-123",
                        feature: "api-calls",
                        referenceType: "user"
                    }
                ]
            };

            mockSocket._["unsubscribe:usage"](unsubscribeData);

            expect(mockSocket.leave).toHaveBeenCalledWith("usage:api-calls:user-123");
        });

        it("should handle multiple unsubscriptions", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const unsubscribeData = {
                subscriptions: [
                    {
                        referenceId: "user-123",
                        feature: "api-calls",
                        referenceType: "user"
                    },
                    {
                        referenceId: "user-123",
                        feature: "storage",
                        referenceType: "user"
                    }
                ]
            };

            mockSocket._["unsubscribe:usage"](unsubscribeData);

            expect(mockSocket.leave).toHaveBeenCalledTimes(2);
        });

        it("should handle unsubscribe from non-joined room", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const unsubscribeData = {
                subscriptions: [
                    {
                        referenceId: "user-999",
                        feature: "api-calls",
                        referenceType: "user"
                    }
                ]
            };

            expect(() => mockSocket._["unsubscribe:usage"](unsubscribeData)).not.toThrow();
        });
    });

    describe("get:usage event", () => {
        it("should return current usage", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const getData = {
                referenceId: "user-123",
                feature: "api-calls"
            };

            await mockSocket._["get:usage"](getData);

            expect(mockTracker.getUsage).toHaveBeenCalledWith("user-123", "api-calls");
            expect(mockSocket.emit).toHaveBeenCalledWith("usage:current", expect.any(Object));
        });

        it("should emit error when tracker fails", async () => {
            mockTracker.getUsage = mock(async () => {
                throw new Error("Tracker error");
            });

            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const getData = {
                referenceId: "user-123",
                feature: "api-calls"
            };

            await mockSocket._["get:usage"](getData);

            expect(mockSocket.emit).toHaveBeenCalledWith("usage:error", {
                error: "Failed to fetch usage"
            });
        });

        it("should handle requests for different features", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            await mockSocket._["get:usage"]({ referenceId: "user-123", feature: "api-calls" });
            await mockSocket._["get:usage"]({ referenceId: "user-123", feature: "storage" });

            expect(mockTracker.getUsage).toHaveBeenCalledTimes(2);
        });
    });

    describe("disconnect event", () => {
        it("should log disconnection", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            expect(() => mockSocket._disconnect()).not.toThrow();
        });

        it("should handle disconnect without prior subscription", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            expect(() => mockSocket._disconnect()).not.toThrow();
        });
    });

    describe("room naming", () => {
        it("should create correct room format", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const subscribeData = {
                subscriptions: [
                    {
                        referenceId: "org-456",
                        feature: "storage",
                        referenceType: "organization"
                    }
                ]
            };

            await mockSocket._["subscribe:usage"](subscribeData);

            expect(mockSocket.join).toHaveBeenCalledWith("usage:storage:org-456");
        });

        it("should handle special characters in referenceId", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const subscribeData = {
                subscriptions: [
                    {
                        referenceId: "user@test.com",
                        feature: "api-calls",
                        referenceType: "user"
                    }
                ]
            };

            await mockSocket._["subscribe:usage"](subscribeData);

            expect(mockSocket.join).toHaveBeenCalledWith("usage:api-calls:user@test.com");
        });
    });

    describe("edge cases", () => {
        it("should handle empty subscriptions array", async () => {
            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const subscribeData = {
                subscriptions: []
            };

            await mockSocket._["subscribe:usage"](subscribeData);

            expect(mockSocket.emit).toHaveBeenCalledWith("subscribed", {
                subscriptions: []
            });
        });

        it("should handle mixed authorized and unauthorized subscriptions", async () => {
            mockOptions.features["api-calls"].authorizeReference = mock(async () => true);
            mockOptions.features["storage"].authorizeReference = mock(async () => false);
            wsServer = new UsageWebSocketServer(mockIo, mockTracker, mockOptions);

            const handler = (mockIo as any)._connectionHandler;
            handler(mockSocket);

            const subscribeData = {
                subscriptions: [
                    {
                        referenceId: "user-123",
                        feature: "api-calls",
                        referenceType: "user"
                    },
                    {
                        referenceId: "user-123",
                        feature: "storage",
                        referenceType: "user"
                    }
                ]
            };

            await mockSocket._["subscribe:usage"](subscribeData);

            expect(mockSocket.join).toHaveBeenCalledTimes(1);
            expect(mockSocket.join).toHaveBeenCalledWith("usage:api-calls:user-123");
        });
    });

    it("should handle concurrent subscriptions", async () => {
        const handler = (mockIo as any)._connectionHandler;
        handler(mockSocket);

        const subscribeData1 = {
            subscriptions: [
                { referenceId: "user-123", feature: "api-calls", referenceType: "user" }
            ]
        };

        const subscribeData2 = {
            subscriptions: [
                { referenceId: "user-456", feature: "storage", referenceType: "user" }
            ]
        };

        await Promise.all([
            mockSocket._["subscribe:usage"](subscribeData1),
            mockSocket._["subscribe:usage"](subscribeData2)
        ]);

        expect(mockSocket.join).toHaveBeenCalledTimes(2);
    });
});
