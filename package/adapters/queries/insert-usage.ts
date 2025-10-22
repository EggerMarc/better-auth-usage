import type { Usage } from "@/types";
import type { Adapter, TransactionAdapter } from "better-auth";

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
