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
        url,
    }: z.infer<typeof cacheSchema> & {
        //io: SocketServer
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

export const createUsageCache = ({
    url
}: z.infer<typeof cacheSchema>) => new UsageCache({ url, }) 
