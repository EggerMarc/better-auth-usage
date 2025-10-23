import type { cached_Usage as Usage, cached_UsageEvent as UsageEvent, Customer } from "@/types";
import EventEmitter from "events";
import Redis from "ioredis";
import { Server as SocketServer } from "socket.io";
import { z } from "zod";
import increment from "./lua/increment.lua"

const cacheSchema = z.object({
    url: z.url(),
    secret: z.string().optional(),
})

class UsageCache extends EventEmitter {
    private cache: Redis;
    //private pubClientCache: Redis;
    //private subClientCache: Redis;
    //private io: SocketServer;

    constructor({
        url, secret, io
    }: z.infer<typeof cacheSchema> & {
        io: SocketServer
    }) {
        super()
        this.cache = new Redis(url)
        //this.pubClientCache = new Redis(url)
        //this.subClientCache = new Redis(url)

        //this.io = io
    }

    async insertEvent({
        referenceId,
        feature,
        amount,
    }: UsageEvent) {
        const { usageKey, limitKey } = this.resolveKeys(referenceId, feature)
        const res = await this.cache.eval(
            increment, // lua script
            2, // number of keys
            usageKey,
            limitKey,
            amount,
            Date.now().toString()
        ) as [number, number];
        const [newAmount, resetAt] = res;
        return {
            amount,
            afterValue: newAmount,
            resetAt: new Date(resetAt)
        }
    }

    async clearUsage(referenceId: string, featureKey: string) {
        const key = this.resolveUsageKey(referenceId, featureKey)
    }

    resolveKeys(referenceId: string, featureKey: string) {
        return {
            usageKey: this.resolveUsageKey(referenceId, featureKey),
            limitKey: this.resolveLimitKey(referenceId, featureKey)
        }
    }

    resolveUsageKey(referenceId: string, featureKey: string) {
        return `usage:${featureKey}:${referenceId}`
    }

    resolveLimitKey(referenceId: string, featureKey: string) {
        return `limit:${featureKey}:${referenceId}`
    }
}


class UsageTracker extends EventEmitter {
    private redis: Redis;
    private pubClient: Redis;
    private subClient: Redis;
    private io: SocketServer;

    constructor(redisUrl: string, io: SocketServer) {
        super();
        this.redis = new Redis(redisUrl);
        this.pubClient = new Redis(redisUrl);
        this.subClient = new Redis(redisUrl);
        this.io = io;

        this.setupPubSub();
    }

    private setupPubSub() {
        // Subscribe to usage events from other instances
        this.subClient.subscribe('usage:events');
        this.subClient.on('message', (channel, message) => {
            const event = JSON.parse(message) as UsageEvent;
            this.broadcastUsageUpdate(event);
        });
    }

    // Atomic usage tracking with Lua script to prevent race conditions
    async trackUsage(event: UsageEvent): Promise<{
        allowed: boolean;
        currentUsage: number;
        limit?: number;
        resetAt: Date;
    }> {
        const key = this.getUserResourceKey(
            event.referenceId,
            event.feature
        );
        const limitKey = `limit:${event.referenceId}:${event.feature}`;

        // Lua script for atomic check-and-increment
        const luaScript = `
      local key = KEYS[1]
      local limitKey = KEYS[2]
      local current = tonumber(ARGV[1])
      local now = tonumber(ARGV[2])
      
      -- Get current usage and limit info
      local current = tonumber(redis.call('GET', key) or '0')
      local limitData = redis.call('HGETALL', limitKey)
      
      -- Parse limit data
      local limit = {}
      for i = 1, #limitData, 2 do
        limit[limitData[i]] = limitData[i + 1]
      end
      
      local maxUsage = tonumber(limit.maxUsage)
      local minUsage = tonumber(limit.minUsage)
      local resetAt = tonumber(limit.resetAt or '0')
      
      -- Check if we need to reset
      if now > resetAt then
        current = 0
        redis.call('DEL', key)
      end
      
      local newUsage = current + current
      local allowed = true
      
      -- Check upper limit
      if maxUsage and newUsage > maxUsage then
        allowed = false
      end
      
      -- Check lower limit (for pay-as-you-go minimum)
      if minUsage and newUsage < minUsage then
        allowed = false
      end
      
      -- If allowed, increment
      if allowed then
        redis.call('INCRBY', key, current)
        redis.call('EXPIREAT', key, resetAt)
        current = newUsage
      end
      
      return {allowed and 1 or 0, current, maxUsage or -1, resetAt}
    `;

        const result = await this.redis.eval(
            luaScript,
            2,
            key,
            limitKey,
            event.current.toString(),
            Date.now().toString()
        ) as [number, number, number, number];

        const [allowed, currentUsage, limit, resetAt] = result;

        if (allowed) {
            // Publish event to other instances
            await this.pubClient.publish('usage:events', JSON.stringify(event));

            // Async write to DB (fire and forget with queue)
            this.queueDbWrite(event).catch(console.error);
        }

        return {
            allowed: allowed === 1,
            currentUsage,
            limit: limit === -1 ? undefined : limit,
            resetAt: new Date(resetAt)
        };
    }

    // Get current usage without incrementing
    async getCurrentUsage(referenceId: string, feature: string): Promise<{
        current: number;
        limit?: number;
        resetAt: Date;
    }> {
        const key = this.getUserResourceKey(referenceId, feature);
        const limitKey = `limit:${referenceId}:${feature}`;

        const [current, limitData] = await Promise.all([
            this.redis.get(key),
            this.redis.hgetall(limitKey)
        ]);

        return {
            current: parseInt(current || '0'),
            limit: limitData.maxUsage ? parseInt(limitData.maxUsage) : undefined,
            resetAt: new Date(parseInt(limitData.resetAt || '0'))
        };
    }

    // Set usage limit for a user
    async setLimit(limit: UsageLimit): Promise<void> {
        const limitKey = `limit:${limit.referenceId}:${limit.feature}`;

        await this.redis.hset(limitKey, {
            maxUsage: limit.maxUsage?.toString() || '',
            minUsage: limit.minUsage?.toString() || '',
            resetPeriod: limit.resetPeriod,
            resetAt: limit.resetAt.getTime().toString(),
            customResetCron: limit.customResetCron || ''
        });
    }

    // Broadcast usage updates to connected clients via WebSocket
    private broadcastUsageUpdate(event: UsageEvent) {
        this.io.to(`user:${event.referenceId}`).emit('usage:update', {
            feature: event.feature,
            current: event.current,
            updatedAt: event.updatedAt
        });
    }

    // Queue DB write for analytics (using Bull or similar)
    private async queueDbWrite(event: UsageEvent) {
        // This would use a job queue like Bull/BullMQ
        // For now, simplified direct write
        await this.writeToDb(event);
    }

    private async writeToDb(event: UsageEvent) {
        // Your PostgreSQL/MySQL write logic here
        // This runs async and doesn't block the tracking
    }

    private getUserResourceKey(referenceId: string, feature: string): string {
        return `usage:${referenceId}:${feature}`;
    }
}

// WebSocket setup for real-time updates
class UsageWebSocketServer {
    private io: SocketServer;
    private tracker: UsageTracker;

    constructor(io: SocketServer, tracker: UsageTracker) {
        this.io = io;
        this.tracker = tracker;
        this.setupSocketHandlers();
    }

    private setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            const referenceId = socket.handshake.auth.userId;

            // Join user-specific room
            socket.join(`user:${referenceId}`);

            // Subscribe to usage updates
            socket.on('usage:subscribe', async (feature: string) => {
                const usage = await this.tracker.getCurrentUsage(referenceId, feature);
                socket.emit('usage:current', usage);
            });

            // Track usage request
            socket.on('usage:track', async (data: {
                feature: string;
                current: number;
                metadata?: Record<string, any>;
            }) => {
                const result = await this.tracker.trackUsage({
                    referenceId,
                    feature: data.feature,
                    current: data.current,
                    updatedAt: new Date(),
                    metadata: data.metadata
                });

                socket.emit('usage:tracked', result);
            });

            socket.on('disconnect', () => {
                socket.leave(`user:${referenceId}`);
            });
        });
    }
}
