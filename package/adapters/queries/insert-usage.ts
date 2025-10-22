import type { Usage } from "@/types";
import type { Adapter, TransactionAdapter } from "better-auth";

export async function insertUsageQuery({
    adapter,
    referenceId,
    referenceType,
    featureKey,
    lastResetAt,
    amount,
    event = "use"
}: {
    adapter: Adapter | TransactionAdapter,
    referenceId: string,
    referenceType: string,
    featureKey: string,
    lastResetAt: Date,
    amount: number,
    event: string
}) {
    return await adapter.create<Usage>({
        model: "usage",
        data: {
            referenceId,
            referenceType,
            amount,
            lastResetAt,
            event,
            feature: featureKey,
            createdAt: new Date()
        }
    })
}
