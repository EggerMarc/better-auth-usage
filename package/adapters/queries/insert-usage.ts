import type { Usage } from "@/types";
import type { Adapter, TransactionAdapter } from "better-auth";

/**
 * Create a new usage record via the provided adapter.
 *
 * @param referenceId - Identifier for the entity the usage belongs to
 * @param featureKey - Feature identifier to associate with the usage record
 * @param lastResetAt - Timestamp when the feature's usage counters were last reset
 * @param amount - Quantity to record for this usage event
 * @param event - Event name describing the usage (defaults to `"use"`)
 * @returns The created `Usage` record
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