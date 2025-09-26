import type { UsageAdapter } from "package/adapter"
import type { Feature, Customer } from "package/types"

/**
 * Syncs feature reset usage for a customer when the feature's `reset` flag is set.
 *
 * @param adapter - Usage adapter used to perform the sync (calls `syncUsage`)
 * @param feature - Feature data; `key`, `reset`, and `resetValue` are used for the payload
 * @param customer - Customer identity; `referenceId` and `referenceType` are used for the payload
 * @returns The result of `adapter.syncUsage` when `feature.reset` is truthy, otherwise `undefined`
 */
export async function resolveSyncUsage({
    adapter,
    feature,
    customer
}: {
    adapter: UsageAdapter,
    feature: Feature,
    customer: Customer,
}) {
    if (feature.reset) {
        return await adapter.syncUsage({
            referenceId: customer.referenceId,
            referenceType: customer.referenceType,
            feature: {
                key: feature.key,
                resetValue: feature.resetValue,
                reset: feature.reset
            }
        })
    }
}

