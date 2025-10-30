import type { cached_Usage as Usage, cached_UsageEvent as UsageEvent, Customer } from "@/types";
import EventEmitter from "events";
import Redis from "ioredis";
import { z } from "zod";
import incrementScript from "./lua/increment.lua"
import { tryCatch } from "@/utils";
import { APIError } from "better-auth";

const cacheSchema = z.object({
    url: z.url(),
})

export class UsageCache extends EventEmitter {
    private cache: Redis;

    constructor({
        url,
    }: z.infer<typeof cacheSchema>) {
        super()
        this.cache = new Redis(url)
    }

    async insertEvent({
        referenceId,
        feature,
        amount,
    }: UsageEvent) {
        const { usageKey, limitKey } = this.resolveKeys(referenceId, feature)
        const res = await this.cache.eval(
            incrementScript, // lua script
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

    async getUsage(referenceId: string, feature: string): Promise<Usage> {
        const { usageKey } = this.resolveKeys(referenceId, feature)
        const { data, error } = await tryCatch(this.cache.get(usageKey));
        if (error) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: `[ERROR][USAGE] Internal error getting ${usageKey}, ${error.message}` })
        }

        if (!data) {
            throw new APIError("NOT_FOUND", { message: `[ERROR][USAGE] Failed to get cached usage, ${usageKey}` })
        }

        return JSON.parse(data) as Usage
    }

    async clearUsage(referenceId: string, feature: string): Promise<void> {
        const { usageKey } = this.resolveKeys(referenceId, feature);
        const { error } = await tryCatch(this.cache.del(usageKey));
        if (error) {
            throw new APIError("NOT_FOUND", { message: `[ERROR][USAGE] Failed to clear cached usage, ${usageKey}` })
        }
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

    async disconnect() {
        await this.cache.quit()
    }
}

