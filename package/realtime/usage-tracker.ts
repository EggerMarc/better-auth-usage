import EventEmitter from "events";
import Redis from "ioredis";
import { Server as SocketServer } from "socket.io";
import { UsageCache } from "../adapters/cache";
import type { Feature, cached_UsageEvent } from "@/types";
import { cached_usageEventSchema } from "@/schema";
import { tryCatch } from "@/utils";


export class UsageTracker extends EventEmitter {
    private pubClient: Redis;
    private subClient: Redis;
    private io: SocketServer;
    private cache: UsageCache;
    private readonly CHANNEL_PREFIX = "usage:updates:";

    constructor(
        redisUrl: string,
        io: SocketServer,
        cache: UsageCache
    ) {
        super();

        this.pubClient = new Redis(redisUrl);
        this.subClient = new Redis(redisUrl);
        this.io = io;
        this.cache = cache;

    }

    async connect() {
        await Promise.all([
            this.pubClient.connect(),
            this.subClient.connect()
        ]);

        this.setupPubSub();
    }

    private setupPubSub() {
        // Subscribe to all usage update channels
        this.subClient.psubscribe(`${this.CHANNEL_PREFIX}*`);
        this.subClient.on("pmessage", async (_pattern, _channel, message) => {
            try {
                const parsed = JSON.parse(message);
                const update = cached_usageEventSchema.parse(parsed);
                // Do NOT call cache.insertEvent here — the original write already happened.
                // This handler only broadcasts to WebSocket clients.
                this.emit("usage:update", update);
                this.broadcastUpdate(update);
            } catch (err) {
                console.error("[ERROR][UsageTracker] Failed to process pmessage", { message, err });
            }
        });
    }

    /**
     * Broadcast usage update to WebSocket clients subscribed to this SPECIFIC feature.
     * Room naming: "usage:{feature}:{referenceId}"
     * This matches the Redis key pattern: usage:api-calls:org-123
     */
    private broadcastUpdate(update: cached_UsageEvent) {
        const room = `usage:${update.feature}:${update.referenceId}`;
        this.io.to(room).emit("usage:updated", update);
        console.log(`[UsageTracker] Broadcasted update to room: ${room}`);
    }

    /**
     * Publish a usage update to Redis pub/sub.
     * Channel naming: "usage:updates:{feature}:{referenceId}"
     */
    async publishUpdate(update: cached_UsageEvent) {
        const channel = `${this.CHANNEL_PREFIX}${update.feature}:${update.referenceId}`;
        const { error } = await tryCatch(this.pubClient.publish(channel, JSON.stringify(update)));

        if (error) {
            // TODO map to APIError
            throw new Error(error.message)
        }

        console.log(`[UsageTracker] Published update to channel: ${channel}`);
    }

    async getUsage(referenceId: string, feature: Omit<Feature, "hooks">) {
        return this.cache.getUsage(referenceId, feature);
    }

    async disconnect() {
        await Promise.all([
            this.pubClient.quit(),
            this.subClient.quit()
        ]);
    }
}
