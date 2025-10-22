import type { Feature, Usage } from "@/types"
import { APIError, type Adapter } from "better-auth"


export async function resetUsageQuery({
    adapter,
    referenceId,
    referenceType,
    curr,
    feature,
}: {
    adapter: Adapter,
    referenceId: string,
    referenceType: string,
    curr?: number,
    feature: Omit<Feature, "hooks">
}) {
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
                referenceType,
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
                    referenceType,
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
                referenceType,
                lastResetAt: new Date(),
                createdAt: new Date()
            }
        })
        return usage
    })
    return transaction
}

export interface ResetError extends APIError { };
export interface ResetSuccess { }; // TODO

