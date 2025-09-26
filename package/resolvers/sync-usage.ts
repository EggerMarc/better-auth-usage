import type { UsageAdapter } from "package/adapter"
import type { Feature, Customer } from "package/types"

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

