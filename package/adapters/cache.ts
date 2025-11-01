import type {
    cached_Limits,
    Customer,
    Feature,
    cached_Usage as Usage,
    cached_UsageEvent as UsageEvent
} from "@/types";

import {
    customerSchema,
    cached_usageEventSchema as usageEventSchema,
    cached_usageSchema as usageSchema
} from "@/schema"
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
        cacheSchema.parse({ url });
        this.cache = new Redis(url)
        this.cache.on('error', (err) => {
            throw new APIError("INTERNAL_SERVER_ERROR", {
                message: `Failed to initialize cache with error: ${err}`
            })
        });
    }

    async insertEvent({
        referenceId,
        feature,
        amount,
        event,
    }: UsageEvent) {
        const { usageKey, limitKey } = this.resolveKeys(referenceId, feature)

        const { data, error } = await tryCatch(
            this
                .cache
                .eval(
                    incrementScript, // lua script
                    2, // number of keys
                    usageKey,
                    limitKey,
                    amount,
                    Date.now().toString()
                )
        )

        if (error) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
                message: `[ERROR][USAGE] Failed to increment usage to cache on ${usageKey}: ${error.message}`
            })
        }

        try {
            const [newAmount, resetAt] = data as [number, number];
            return usageEventSchema.parse({
                amount, afterValue: newAmount, resetAt: new Date(resetAt), event
            }) as UsageEvent
        } catch (err) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
                message: `[ERROR][USAGE] Corrupted cache insert data for ${usageKey}`
            });
        }

    }

    async getUsage(referenceId: string, feature: Omit<Feature, "hooks">): Promise<Usage> {
        const { usageKey } = this.resolveKeys(referenceId, feature.key)
        const { data, error } = await tryCatch(this.cache.get(usageKey));

        if (error) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: `[ERROR][USAGE] Internal error getting ${usageKey}, ${error.message}` })
        }

        if (!data) {
            throw new APIError("NOT_FOUND", { message: `[ERROR][USAGE] Failed to get cached usage, ${usageKey}` })
        }

        try {
            const parsed = JSON.parse(data);
            const validated = usageSchema.parse(parsed);
            return validated as Usage;
        } catch (err) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
                message: `[ERROR][USAGE] Corrupted cache data for ${usageKey}`
            });
        }
    }

    async clearUsage(referenceId: string, feature: string): Promise<void> {
        const { usageKey } = this.resolveKeys(referenceId, feature);
        const { error } = await tryCatch(this.cache.del(usageKey));
        if (error) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: `[ERROR][USAGE] Failed to clear cached usage for ${usageKey}: ${error.message}` })
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

    async getCustomer(referenceId: string): Promise<Customer> {
        const { data, error } = await tryCatch(this.cache.get(`customer:${referenceId}`))

        if (error) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: `[ERROR][USAGE] Failed to get customer from cache for ${referenceId}` })
        }

        return customerSchema.parse(data)
    }

    async setCustomer(customer: Customer) {
        await this.cache.set(`customer:${customer.referenceId}`, JSON.stringify(customer))
    }

    async setLimit(referenceId: string, featureKey: string, limits: cached_Limits) {
        const { limitKey } = this.resolveKeys(referenceId, featureKey);
        const { error } = await tryCatch(this.cache.set(limitKey, JSON.stringify(limits)));
        if (error) {
            throw new APIError("INTERNAL_SERVER_ERROR", { message: `[ERROR][USAGE] Failed to insert limits for ${limitKey}, ${error.message}` })
        }
        return limits
    }
}

