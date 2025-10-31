import type { UsageAdapter } from "@/adapters"
import type { Feature, UsageOptionsWithCache } from "@/types"
import { resolveGetUsage } from "./get-usage"
import { resolveGetCustomer } from "./get-customer"
import { tryCatch } from "@/utils"
import { APIError } from "better-auth"
import { resolveSyncUsage } from "./sync-usage"

interface ResolveInsertUsageParams {
    referenceId: string,
    amount: number,
    event: string,
    feature: Feature
    adapter: UsageAdapter,
    options: UsageOptionsWithCache
}

export const resolveInsertUsage = async ({
    referenceId, amount, event, feature, adapter, options
}: ResolveInsertUsageParams) => {
    const { data: usageAndCustomer, error } = await tryCatch(Promise.all([
        resolveGetUsage({ referenceId, feature, adapter, options }),
        resolveGetCustomer({ referenceId, options, adapter })
    ]))

    if (error) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
            message: `Failed to resolve either usage or customer\n${error.message}`
        })
    }
    const [currentUsage, customer] = usageAndCustomer;


    if (feature.hooks?.before) {
        await feature.hooks.before({
            usage: {
                beforeAmount: currentUsage.amount,
                afterAmount: currentUsage.amount + amount,
                amount,
            },
            customer,
            feature
        })
    }

    // resolve the insert
    let data = null

    if (options.cache) {
        adapter.insertUsage({
            referenceId,
            amount,
            feature,
            event,
            lastResetAt: currentUsage.lastResetAt,
        }).catch(() => {
            console.log(`[ERROR][]`)
        })

        let { data, error } = await tryCatch(options.cache.insertEvent({
            referenceId,
            amount,
            feature: feature.key,
            event
        })
        )

        if (error || !data) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
                message: `Failed to insert usage on cache \n${error ? error.message : "No data returned"}`
            })
        }

    }

    if (!data) {
        let { data, error } = await tryCatch(adapter.insertUsage({
            referenceId,
            amount,
            feature,
            event: "usage",
            lastResetAt: currentUsage.lastResetAt,
        }))


        if (error || !data) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
                message: `Failed to insert usage on db \n${error ? error.message : "No data returned"}`
            })
        }
    }

    if (feature.hooks?.after) {
        await feature.hooks.after({
            usage: {
                beforeAmount: currentUsage.amount,
                afterAmount: currentUsage.amount + amount,
                amount,
            },
            customer,
            feature
        })
    }

    resolveSyncUsage({
        referenceId, feature, options, adapter
    }).catch(() => { })
    return data
}
