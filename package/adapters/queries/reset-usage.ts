import type { Feature, Usage } from "@/types"
import { APIError, type Adapter } from "better-auth"


/**
 * Create a usage "reset" record that adjusts a feature's recorded usage for a given reference.
 *
 * If `feature.resetValue` is falsy, no operation is performed. If `curr` is provided, a single
 * reset record is created with `amount = feature.resetValue - curr`. If `curr` is not provided,
 * the function computes the current total usage for the reference and feature (within a transaction)
 * and creates a reset record with `amount = feature.resetValue - total` (or `feature.resetValue`
 * if no prior usage exists).
 *
 * @param referenceId - Identifier of the entity whose usage is being reset
 * @param curr - Optional current usage amount to compute the reset delta against
 * @param feature - Feature descriptor (without hooks) that contains `key` and `resetValue`
 * @returns The created `Usage` record representing the reset, or `undefined` if no reset was performed
 */
export async function resetUsageQuery({
    adapter,
    referenceId,
    curr,
    feature,
}: {
    adapter: Adapter,
    referenceId: string,
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

export interface ResetError extends APIError { };
export interface ResetSuccess { }; // TODO
