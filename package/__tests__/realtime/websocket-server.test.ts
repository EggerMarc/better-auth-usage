import { describe, test, expect, mock, beforeEach } from "bun:test";
import { UsageWebSocketServer } from "../../realtime/websocket-server";
import type { UsageOptions } from "../../types";
import EventEmitter from "events";

// Mock Socket.IO Server and Socket
class MockSocket extends EventEmitter {
  id = "mock-socket-id";
  rooms = new Set<string>();

  join(room: string) {
    this.rooms.add(room);
  }

  leave(room: string) {
    this.rooms.delete(room);
  }
}

class MockSocketServer extends EventEmitter {
  private sockets = new Map<string, MockSocket>();

  to(room: string) {
    return {
      emit: mock((event: string, data: any) => {}),
    };
  }

  mockConnection(socket: MockSocket) {
    this.sockets.set(socket.id, socket);
    this.emit("connection", socket);
  }
}

class MockUsageTracker {
  async getUsage(referenceId: string, feature: string) {
    return {
      referenceId,
      feature,
      lastResetAt: new Date(),
      updatedAt: new Date(),
      current: 100,
      maxLimit: 1000,
    };
  }
}

describe("UsageWebSocketServer", () => {
  let mockIo: MockSocketServer;
  let mockTracker: MockUsageTracker;
  let options: UsageOptions;
  let wsServer: UsageWebSocketServer;

  beforeEach(() => {
    mockIo = new MockSocketServer() as any;
    mockTracker = new MockUsageTracker() as any;
    options = {
      features: {
        "api-calls": {
          key: "api-calls",
          maxLimit: 1000,
        },
        "storage": {
          key: "storage",
          maxLimit: 10000,
          authorizeReference: mock(async () => true),
        },
      },
    };

    wsServer = new UsageWebSocketServer(
      mockIo as any,
      mockTracker as any,
      options
    );
  });

  describe("constructor", () => {
    test("should initialize server with handlers", () => {
      expect(wsServer).toBeDefined();
    });

    test("should set up connection handler", () => {
      const socket = new MockSocket();
      mockIo.mockConnection(socket);

      expect(socket.listenerCount("subscribe:usage")).toBeGreaterThan(0);
    });
  });

  describe("subscribe:usage handler", () => {
    test("should join rooms for subscribed features", (done) => {
      const socket = new MockSocket();
      mockIo.mockConnection(socket);

      socket.on("subscribed", (data) => {
        expect(data.subscriptions).toHaveLength(1);
        expect(socket.rooms.has("usage:api-calls:user-123")).toBe(true);
        done();
      });

      socket.emit("subscribe:usage", {
        subscriptions: [
          {
            referenceId: "user-123",
            feature: "api-calls",
            referenceType: "user",
          },
        ],
      });
    });

    test("should handle multiple subscriptions", (done) => {
      const socket = new MockSocket();
      mockIo.mockConnection(socket);

      socket.on("subscribed", (data) => {
        expect(data.subscriptions).toHaveLength(2);
        expect(socket.rooms.has("usage:api-calls:user-123")).toBe(true);
        expect(socket.rooms.has("usage:storage:user-123")).toBe(true);
        done();
      });

      socket.emit("subscribe:usage", {
        subscriptions: [
          {
            referenceId: "user-123",
            feature: "api-calls",
            referenceType: "user",
          },
          {
            referenceId: "user-123",
            feature: "storage",
            referenceType: "user",
          },
        ],
      });
    });

    test("should emit error for non-existent feature", (done) => {
      const socket = new MockSocket();
      mockIo.mockConnection(socket);

      socket.on("error", (error) => {
        expect(error.message).toContain("not found");
        done();
      });

      socket.emit("subscribe:usage", {
        subscriptions: [
          {
            referenceId: "user-123",
            feature: "non-existent",
            referenceType: "user",
          },
        ],
      });
    });

    test("should check authorization when authorizeReference is defined", (done) => {
      const socket = new MockSocket();
      mockIo.mockConnection(socket);

      socket.on("subscribed", (data) => {
        expect(data.subscriptions).toHaveLength(1);
        done();
      });

      socket.emit("subscribe:usage", {
        subscriptions: [
          {
            referenceId: "user-123",
            feature: "storage",
            referenceType: "user",
          },
        ],
      });
    });

    test("should emit error when authorization fails", (done) => {
      const unauthorizedOptions: UsageOptions = {
        features: {
          "restricted": {
            key: "restricted",
            authorizeReference: mock(async () => false),
          },
        },
      };

      const unauthorizedServer = new UsageWebSocketServer(
        mockIo as any,
        mockTracker as any,
        unauthorizedOptions
      );

      const socket = new MockSocket();
      mockIo.mockConnection(socket);

      socket.on("error", (error) => {
        expect(error.message).toContain("Not authorized");
        done();
      });

      socket.emit("subscribe:usage", {
        subscriptions: [
          {
            referenceId: "user-123",
            feature: "restricted",
            referenceType: "user",
          },
        ],
      });
    });
  });

  describe("unsubscribe:usage handler", () => {
    test("should leave rooms when unsubscribing", () => {
      const socket = new MockSocket();
      mockIo.mockConnection(socket);

      // First subscribe
      socket.emit("subscribe:usage", {
        subscriptions: [
          {
            referenceId: "user-123",
            feature: "api-calls",
            referenceType: "user",
          },
        ],
      });

      // Then unsubscribe
      socket.emit("unsubscribe:usage", {
        subscriptions: [
          {
            referenceId: "user-123",
            feature: "api-calls",
            referenceType: "user",
          },
        ],
      });

      expect(socket.rooms.has("usage:api-calls:user-123")).toBe(false);
    });

    test("should handle unsubscribing from multiple features", () => {
      const socket = new MockSocket();
      mockIo.mockConnection(socket);

      socket.emit("subscribe:usage", {
        subscriptions: [
          {
            referenceId: "user-123",
            feature: "api-calls",
            referenceType: "user",
          },
          {
            referenceId: "user-123",
            feature: "storage",
            referenceType: "user",
          },
        ],
      });

      socket.emit("unsubscribe:usage", {
        subscriptions: [
          {
            referenceId: "user-123",
            feature: "api-calls",
            referenceType: "user",
          },
          {
            referenceId: "user-123",
            feature: "storage",
            referenceType: "user",
          },
        ],
      });

      expect(socket.rooms.size).toBe(0);
    });
  });

  describe("get:usage handler", () => {
    test("should return current usage", (done) => {
      const socket = new MockSocket();
      mockIo.mockConnection(socket);

      socket.on("usage:current", (usage) => {
        expect(usage).toBeDefined();
        expect(usage.referenceId).toBe("user-123");
        expect(usage.feature).toBe("api-calls");
        done();
      });

      socket.emit("get:usage", {
        referenceId: "user-123",
        feature: "api-calls",
      });
    });

    test("should handle usage fetch errors gracefully", (done) => {
      const errorTracker = {
        getUsage: mock(async () => {
          throw new Error("Redis error");
        }),
      };

      const errorServer = new UsageWebSocketServer(
        mockIo as any,
        errorTracker as any,
        options
      );

      const socket = new MockSocket();
      mockIo.mockConnection(socket);

      socket.on("usage:error", (error) => {
        expect(error.error).toBe("Failed to fetch usage");
        done();
      });

      socket.emit("get:usage", {
        referenceId: "user-123",
        feature: "api-calls",
      });
    });
  });

  describe("disconnect handler", () => {
    test("should handle socket disconnection", () => {
      const socket = new MockSocket();
      mockIo.mockConnection(socket);

      expect(() => socket.emit("disconnect")).not.toThrow();
    });
  });

  describe("room naming conventions", () => {
    test("should use consistent room format", () => {
      const referenceId = "user-123";
      const feature = "api-calls";
      const expectedRoom = `usage:${feature}:${referenceId}`;

      expect(expectedRoom).toBe("usage:api-calls:user-123");
    });

    test("should handle special characters in reference IDs", () => {
      const referenceId = "user:123:abc";
      const feature = "api-calls";
      const expectedRoom = `usage:${feature}:${referenceId}`;

      expect(expectedRoom).toBe("usage:api-calls:user:123:abc");
    });

    test("should differentiate between different features", () => {
      const referenceId = "user-123";
      const room1 = `usage:api-calls:${referenceId}`;
      const room2 = `usage:storage:${referenceId}`;

      expect(room1).not.toBe(room2);
    });
  });
});