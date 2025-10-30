import EventEmitter from "events";
import Redis from "ioredis";
import { Server as SocketServer } from "socket.io";
import { UsageCache } from "../adapters/cache";

export interface UsageUpdate {
    referenceId: string;
    feature: string;
    amount: number;
    afterValue: number;
    resetAt: Date;
    timestamp: number;
}

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

        this.setupPubSub();
    }

    async connect() {
        await Promise.all([
            this.pubClient.connect(),
            this.subClient.connect()
        ]);
    }

    private setupPubSub() {
        // Subscribe to all usage update channels
        this.subClient.psubscribe(`${this.CHANNEL_PREFIX}*`);

        this.subClient.on("pmessage", (_pattern, _channel, message) => {
            try {
                const update: UsageUpdate = JSON.parse(message);
                this.emit("usage:update", update);
                this.broadcastUpdate(update);
            } catch (err) {
                console.error("[UsageTracker] Error processing pub/sub message:", err);
            }
        });
    }

    /**
     * Broadcast usage update to WebSocket clients subscribed to this SPECIFIC feature.
     * Room naming: "usage:{feature}:{referenceId}"
     * This matches the Redis key pattern: usage:api-calls:org-123
     */
    private broadcastUpdate(update: UsageUpdate) {
        // ✅ CORRECT: Feature-specific room
        const room = `usage:${update.feature}:${update.referenceId}`;

        this.io.to(room).emit("usage:updated", update);

        console.log(`[UsageTracker] Broadcasted update to room: ${room}`);
    }

    /**
     * Publish a usage update to Redis pub/sub.
     * Channel naming: "usage:updates:{feature}:{referenceId}"
     */
    async publishUpdate(update: UsageUpdate) {
        // ✅ CORRECT: Feature-specific channel
        const channel = `${this.CHANNEL_PREFIX}${update.feature}:${update.referenceId}`;
        await this.pubClient.publish(channel, JSON.stringify(update));
        console.log(`[UsageTracker] Published update to channel: ${channel}`);
    }

    /**
     * Get current usage (delegates to cache)
     */
    async getUsage(referenceId: string, feature: string) {
        return this.cache.getUsage(referenceId, feature);
    }

    async disconnect() {
        await Promise.all([
            this.pubClient.quit(),
            this.subClient.quit()
        ]);
    }
}
