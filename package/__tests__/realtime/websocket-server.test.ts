import { describe, test, expect, mock } from "bun:test";
import { UsageWebSocketServer } from "../../realtime/websocket-server";
import type { UsageOptions } from "../../types";

describe("UsageWebSocketServer", () => {
  describe("constructor", () => {
    test("should create instance and setup handlers", () => {
      const mockIo = {
        on: mock()
      } as any;
      
      const mockTracker = {
        getUsage: mock()
      } as any;
      
      const mockOptions: UsageOptions = {
        features: {
          "api-calls": {
            key: "api-calls",
            maxLimit: 1000
          }
        }
      };

      const server = new UsageWebSocketServer(mockIo, mockTracker, mockOptions);
      expect(server).toBeInstanceOf(UsageWebSocketServer);
      expect(mockIo.on).toHaveBeenCalledWith("connection", expect.any(Function));
    });
  });

  describe("socket handlers", () => {
    test("should handle subscribe:usage event", async () => {
      const mockEmit = mock();
      const mockJoin = mock();
      
      const mockSocket = {
        on: mock((event: string, handler: Function) => {
          if (event === "subscribe:usage") {
            // Simulate subscription
            handler({
              subscriptions: [{
                referenceId: "user-123",
                feature: "api-calls",
                referenceType: "user"
              }]
            });
          }
        }),
        emit: mockEmit,
        join: mockJoin
      };
      
      const mockIo = {
        on: mock((event: string, handler: Function) => {
          if (event === "connection") {
            handler(mockSocket);
          }
        })
      } as any;
      
      const mockTracker = { getUsage: mock() } as any;
      
      const mockOptions: UsageOptions = {
        features: {
          "api-calls": {
            key: "api-calls",
            maxLimit: 1000
          }
        }
      };

      new UsageWebSocketServer(mockIo, mockTracker, mockOptions);
      
      expect(mockSocket.join).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith("subscribed", expect.any(Object));
    });

    test("should handle unsubscribe:usage event", () => {
      const mockLeave = mock();
      
      const mockSocket = {
        on: mock((event: string, handler: Function) => {
          if (event === "unsubscribe:usage") {
            handler({
              subscriptions: [{
                referenceId: "user-123",
                feature: "api-calls",
                referenceType: "user"
              }]
            });
          }
        }),
        emit: mock(),
        leave: mockLeave
      };
      
      const mockIo = {
        on: mock((event: string, handler: Function) => {
          if (event === "connection") {
            handler(mockSocket);
          }
        })
      } as any;
      
      const mockTracker = { getUsage: mock() } as any;
      
      const mockOptions: UsageOptions = {
        features: {
          "api-calls": {
            key: "api-calls",
            maxLimit: 1000
          }
        }
      };

      new UsageWebSocketServer(mockIo, mockTracker, mockOptions);
      
      expect(mockSocket.leave).toHaveBeenCalled();
    });

    test("should reject subscription for non-existent feature", () => {
      const mockEmit = mock();
      
      const mockSocket = {
        on: mock((event: string, handler: Function) => {
          if (event === "subscribe:usage") {
            handler({
              subscriptions: [{
                referenceId: "user-123",
                feature: "non-existent",
                referenceType: "user"
              }]
            });
          }
        }),
        emit: mockEmit,
        join: mock()
      };
      
      const mockIo = {
        on: mock((event: string, handler: Function) => {
          if (event === "connection") {
            handler(mockSocket);
          }
        })
      } as any;
      
      const mockTracker = { getUsage: mock() } as any;
      
      const mockOptions: UsageOptions = {
        features: {
          "api-calls": {
            key: "api-calls",
            maxLimit: 1000
          }
        }
      };

      new UsageWebSocketServer(mockIo, mockTracker, mockOptions);
      
      const errorCall = mockEmit.mock.calls.find(
        (call: any[]) => call[0] === "error"
      );
      expect(errorCall).toBeDefined();
      expect(errorCall[1].message).toContain("not found");
    });

    test("should handle get:usage event", async () => {
      const mockEmit = mock();
      const mockUsage = {
        referenceId: "user-123",
        feature: "api-calls",
        current: 50,
        lastResetAt: new Date(),
        updatedAt: new Date()
      };
      
      const mockSocket = {
        on: mock((event: string, handler: Function) => {
          if (event === "get:usage") {
            handler({
              referenceId: "user-123",
              feature: "api-calls"
            });
          }
        }),
        emit: mockEmit
      };
      
      const mockIo = {
        on: mock((event: string, handler: Function) => {
          if (event === "connection") {
            handler(mockSocket);
          }
        })
      } as any;
      
      const mockTracker = {
        getUsage: mock(async () => mockUsage)
      } as any;
      
      const mockOptions: UsageOptions = {
        features: {
          "api-calls": {
            key: "api-calls",
            maxLimit: 1000
          }
        }
      };

      new UsageWebSocketServer(mockIo, mockTracker, mockOptions);
      
      // Give async operations time to complete
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const usageCall = mockEmit.mock.calls.find(
        (call: any[]) => call[0] === "usage:current"
      );
      expect(usageCall).toBeDefined();
    });
  });

  describe("authorization", () => {
    test("should call authorizeReference when defined", async () => {
      const mockAuthorize = mock(async () => true);
      const mockEmit = mock();
      const mockJoin = mock();
      
      const mockSocket = {
        on: mock((event: string, handler: Function) => {
          if (event === "subscribe:usage") {
            handler({
              subscriptions: [{
                referenceId: "user-123",
                feature: "api-calls",
                referenceType: "user"
              }]
            });
          }
        }),
        emit: mockEmit,
        join: mockJoin
      };
      
      const mockIo = {
        on: mock((event: string, handler: Function) => {
          if (event === "connection") {
            handler(mockSocket);
          }
        })
      } as any;
      
      const mockTracker = { getUsage: mock() } as any;
      
      const mockOptions: UsageOptions = {
        features: {
          "api-calls": {
            key: "api-calls",
            maxLimit: 1000,
            authorizeReference: mockAuthorize
          }
        }
      };

      new UsageWebSocketServer(mockIo, mockTracker, mockOptions);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(mockAuthorize).toHaveBeenCalled();
      expect(mockSocket.join).toHaveBeenCalled();
    });

    test("should reject unauthorized subscriptions", async () => {
      const mockAuthorize = mock(async () => false);
      const mockEmit = mock();
      const mockJoin = mock();
      
      const mockSocket = {
        on: mock((event: string, handler: Function) => {
          if (event === "subscribe:usage") {
            handler({
              subscriptions: [{
                referenceId: "user-123",
                feature: "api-calls",
                referenceType: "user"
              }]
            });
          }
        }),
        emit: mockEmit,
        join: mockJoin
      };
      
      const mockIo = {
        on: mock((event: string, handler: Function) => {
          if (event === "connection") {
            handler(mockSocket);
          }
        })
      } as any;
      
      const mockTracker = { getUsage: mock() } as any;
      
      const mockOptions: UsageOptions = {
        features: {
          "api-calls": {
            key: "api-calls",
            maxLimit: 1000,
            authorizeReference: mockAuthorize
          }
        }
      };

      new UsageWebSocketServer(mockIo, mockTracker, mockOptions);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const errorCall = mockEmit.mock.calls.find(
        (call: any[]) => call[0] === "error"
      );
      expect(errorCall).toBeDefined();
      expect(errorCall[1].message).toContain("Not authorized");
    });
  });
});