import type { Feature, Usage } from "@/types"
import { type Adapter } from "better-auth"


export interface ResetUsageQueryParams {
    referenceId: string,
    curr?: number,
    feature: Omit<Feature, "hooks">
    adapter: Adapter
}


export async function resetUsageQuery({
    adapter,
    referenceId,
    curr,
    feature,
}: ResetUsageQueryParams) {
    if (!feature.resetValue) {
        return
    }

    if (curr) {
        const usage = await adapter.create<Usage>({
            model: "usage",
            data: {
                amount: feature.resetValue - curr,
                feature: feature.key,
                referenceId,
                event: "reset",
                lastResetAt: new Date(),
                createdAt: new Date()
            }
        })
        return usage
    }

    const transaction = await adapter.transaction(async (tx) => {
        const currentUsage = await tx.findMany<Usage>({
            model: "usage",
            where: [
                { field: "referenceId", value: referenceId },
                { field: "feature", value: feature.key },
            ],
            sortBy: { field: "createdAt", direction: "desc" }
        })
        if (currentUsage.length === 0) {
            const usage = await tx.create<Usage>({
                model: "usage",
                data: {
                    amount: feature.resetValue!,
                    feature: feature.key,
                    event: "reset",
                    referenceId,
                    lastResetAt: new Date(),
                    createdAt: new Date()
                }
            })

            return usage
        }
        const total = currentUsage.reduce((curr, { amount }) => amount + curr, 0)
        const usage = await tx.create<Usage>({
            model: "usage",
            data: {
                amount: feature.resetValue! - total,
                feature: feature.key,
                event: "reset",
                referenceId,
                lastResetAt: new Date(),
                createdAt: new Date()
            }
        })
        return usage
    })
    return transaction
}

