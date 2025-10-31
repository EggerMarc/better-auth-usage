import type { UsageAdapter } from "@/adapters"
import type { Feature, UsageOptionsWithCache } from "@/types"
import { resolveGetUsage } from "./get-usage"
import { resolveGetCustomer } from "./get-customer"
import { resolveResetUsage } from "./reset-usage"

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
    const [current, customer] = await Promise.all([
        resolveGetUsage({ referenceId, feature, adapter, options }),
        resolveGetCustomer({ referenceId, options, adapter })
    ])
    if (feature.hooks?.before) {
        await feature.hooks.before({
            usage: {
                beforeAmount: current.amount,
                afterAmount: current.amount + amount,
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
            lastResetAt: current.lastResetAt,
        }).catch(() => {
            console.log(`[ERROR][]`)
        })

        data = await options.cache.insertEvent({
            referenceId,
            amount,
            feature: feature.key,
            event
        })
    }

    if (!data) {
        data = await adapter.insertUsage({
            referenceId,
            amount,
            feature,
            event: "usage",
            lastResetAt: current.lastResetAt,
        })
    }

    if (feature.hooks?.after) {
        await feature.hooks.after({
            usage: {
                beforeAmount: current.amount,
                afterAmount: current.amount + amount,
                amount,
            },
            customer,
            feature
        })
    }

    resolveResetUsage({
        referenceId, feature, options, adapter
    }).catch(() => { })
    return data
}
