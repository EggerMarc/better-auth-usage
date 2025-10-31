import type { Feature, Usage } from "@/types";
import type { Adapter } from "better-auth";
import { getUsageQuery } from "./get-usage";


export interface InsertUsageQueryParams {
    amount: number,
    referenceId: string,
    event: string,
    lastResetAt: Date,
    feature: Omit<Feature, "hooks">
    adapter: Adapter,
}

/**
 * Insert a usage record for a feature using the provided adapter.
 *
 * @param referenceId - Identifier that ties the usage to an external entity (e.g., subscription or user)
 * @param featureKey - Key of the feature being consumed
 * @param lastResetAt - Timestamp when usage counters for the feature were last reset
 * @param amount - Quantity of usage to record
 * @param event - Event name describing the usage action (defaults to `"use"`)
 * @returns The created `Usage` record
 */
export async function insertUsageQuery({
    adapter,
    referenceId,
    feature,
    lastResetAt,
    amount,
    event = "use"
}: InsertUsageQueryParams) {
    if (lastResetAt) {
        await adapter.create<Usage>({
            model: "usage",
            data: {
                referenceId,
                amount,
                lastResetAt,
                event,
                feature: feature.key,
                createdAt: new Date()
            }
        })
    }


    const transaction = await adapter.transaction(async (tx) => {
        const usage = await getUsageQuery({
            adapter: tx,
            referenceId,
            feature
        });


        return await tx.create<Usage>({
            model: "usage",
            data: {
                referenceId,
                amount,
                lastResetAt: usage?.lastResetAt ?? new Date(),
                event,
                feature: feature.key,
                createdAt: new Date()
            }
        })
    })
    return transaction
}
