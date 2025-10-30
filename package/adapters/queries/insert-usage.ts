import type { Usage } from "@/types";
import type { Adapter, TransactionAdapter } from "better-auth";

/**
 * Creates a new usage record for a feature.
 *
 * @param referenceId - Identifier linking the usage to its owner or billing reference
 * @param featureKey - Key of the feature the usage applies to
 * @param lastResetAt - Timestamp when the feature's usage counters were last reset
 * @param amount - Quantity of usage to record
 * @param event - Event type describing the usage (defaults to `"use"`)
 * @returns The newly created `Usage` record
 */
export async function insertUsageQuery({
    adapter,
    referenceId,
    featureKey,
    lastResetAt,
    amount,
    event = "use"
}: {
    adapter: Adapter | TransactionAdapter,
    referenceId: string,
    featureKey: string,
    lastResetAt: Date,
    amount: number,
    event: string
}) {
    return await adapter.create<Usage>({
        model: "usage",
        data: {
            referenceId,
            amount,
            lastResetAt,
            event,
            feature: featureKey,
            createdAt: new Date()
        }
    })
}