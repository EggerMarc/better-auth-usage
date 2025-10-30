import { Server as SocketServer } from "socket.io";
import { UsageTracker } from "./usage-tracker";
import type { Feature, UsageOptions } from "@/types";
import { tryCatch } from "@/utils";

interface SubscribeRequest {
    subscriptions: Array<{
        referenceId: string;
        feature: string;
        referenceType: string;
    }>;
}

export class UsageWebSocketServer {
    private io: SocketServer;
    private tracker: UsageTracker;
    private options: UsageOptions;

    constructor(
        io: SocketServer,
        tracker: UsageTracker,
        options: UsageOptions
    ) {
        this.io = io;
        this.tracker = tracker;
        this.options = options;
        this.setupSocketHandlers();
    }

    private setupSocketHandlers() {
        this.io.on("connection", async (socket) => {
            socket.on("subscribe:usage", async (data: SubscribeRequest) => {
                for (const sub of data.subscriptions) {
                    const feature = this.options.features[sub.feature];
                    if (!feature) {
                        socket.emit("error", {
                            message: `Feature ${sub.feature} not found`
                        });
                        continue;
                    }

                    if (feature.authorizeReference) {
                        const authorized = await feature.authorizeReference({
                            referenceId: sub.referenceId,
                            referenceType: sub.referenceType,
                            feature: feature.key,
                            incomingId: "" // TODO handle authorization
                        });

                        if (!authorized) {
                            socket.emit("error", {
                                message: `Not authorized for ${sub.feature}:${sub.referenceId}`
                            });
                            continue;
                        }
                    }

                    const room = `usage:${sub.feature}:${sub.referenceId}`;
                    socket.join(room);
                    console.log(`[WebSocket] ${socket.id} joined room: ${room}`);
                }

                socket.emit("subscribed", {
                    subscriptions: data.subscriptions
                });
            });

            socket.on("unsubscribe:usage", (data: SubscribeRequest) => {
                data.subscriptions.forEach(sub => {
                    const room = `usage:${sub.feature}:${sub.referenceId}`;
                    socket.leave(room);
                    console.log(`[WebSocket] ${socket.id} left room: ${room}`);
                });
            });

            socket.on("get:usage", async (data: {
                referenceId: string,
                feature: Omit<Feature, "hooks">
            }) => {
                const { data: usage, error } = await tryCatch(
                    this.tracker.getUsage(data.referenceId, data.feature)
                )
                if (error) {
                    socket.emit("usage:error", {
                        error: "Failed to fetch usage"
                    });
                    return;
                }
                socket.emit("usage:current", usage);
            });

            socket.on("disconnect", () => {
                console.log(`[WebSocket] ${socket.id} disconnected`);
            });
        });
    }
}
