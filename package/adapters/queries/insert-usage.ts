import type { Usage } from "@/types";
import type { Adapter, TransactionAdapter } from "better-auth";

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