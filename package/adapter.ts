import type { AuthContext } from "better-auth/types";
import type { Feature, Usage } from "./types.ts"
import { shouldReset } from "./utils.ts";

export const getUsageAdapter = (context: AuthContext) => {
    const adapter = context.adapter;
    return {
        findLatestUsage: async ({
            referenceId,
            featureKey,
            event
        }: {
            referenceId: string,
            featureKey: string,
            event?: string
        }) => {
            const conditions = event ? [{
                field: "referenceId",
                value: referenceId,
            },
            {
                field: "feature",
                value: featureKey
            }, {
                field: "event",
                value: event
            }] : [{
                field: "referenceId",
                value: referenceId,
            },
            {
                field: "feature",
                value: featureKey
            }]

            const usage = await adapter.findMany<Usage>({
                model: "usage",
                where: conditions,
                sortBy: {
                    field: "createdAt",
                    direction: "desc"
                }
            });
            return usage[0]
        },

        insertUsage: async ({
            amount,
            referenceId,
            referenceType,
            event,
            feature
        }: {
            amount: number,
            referenceId: string,
            referenceType: string,
            event: string,
            feature: Omit<Feature, "hooks" | "">
        }) => {
            const usage = await adapter.transaction(async (tx) => {
                const lastUsage = await tx.findMany<Usage>({
                    model: "usage",
                    where: [{ field: "referenceId", value: referenceId }, { field: "feature", value: feature.key }],
                    sortBy: { field: "createdAt", direction: "desc" }, limit: 1
                })
                const reset = shouldReset(lastUsage[0].lastResetAt, feature.reset ?? "never");
                if (reset.shouldReset && reset.nextReset) {
                    // trigger sync
                    const usage = await tx.create<Usage>({
                        model: "usage", data: {
                            referenceId,
                            referenceType,
                            event,
                            amount,
                            feature: feature.key,
                            lastResetAt: reset.nextReset,
                            afterAmount: amount + (feature.resetValue ?? 0),
                            createdAt: new Date(Date.now())
                        }
                    })

                    return usage
                }

                const usage = await tx.create<Usage>({
                    model: "usage",
                    data: {
                        referenceId,
                        referenceType,
                        event,
                        amount,
                        lastResetAt: lastUsage[0].lastResetAt,
                        feature: feature.key,
                        afterAmount: amount + (lastUsage[0].afterAmount ?? 0),
                        createdAt: new Date(Date.now()),
                    }
                })

                return usage
            })
            return usage
        },

        syncUsage: async ({ referenceId }: { referenceId: string }) => {
            const usage = await adapter.transaction(async (tx) => {
                const lastUsage = await tx.findMany<Usage>({
                    model: "usage",
                    where: [{ field: "referenceId", value: referenceId }],
                    sortBy: { field: "createdAt", direction: "desc" },
                    limit: 1
                });
                if (lastUsage[0] && shouldReset(lastUsage[0].createdAt, lastUsage[0].))

            });
            return usage
        }
    };
};

export type UsageAdapter = ReturnType<typeof getUsageAdapter>
