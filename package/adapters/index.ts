import type { AuthContext } from "better-auth/types";
import type { Customer, Feature, ResetType, Usage } from "@/types.ts"
import { shouldReset } from "@/utils.ts";
import { resetUsageQuery } from "./queries/reset-usage";
import { insertUsageQuery } from "./queries/insert-usage";
import { getUsageQuery } from "./queries/get-usage";

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

        resetUsage: async ({
            referenceId,
            referenceType,
            curr,
            feature,
        }: {
            referenceId: string,
            referenceType: string,
            curr?: number,
            feature: Omit<Feature, "hooks">
        }) => {
            return resetUsageQuery({
                adapter, referenceId, referenceType, curr, feature
            })
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
            feature: Omit<Feature, "hooks">
        }) => {
            const usage = await adapter.transaction(async (tx) => {
                const usage = await getUsageQuery({
                    adapter,
                    referenceId,
                    referenceType,
                    feature
                });

                return insertUsageQuery({
                    adapter: tx,
                    featureKey: feature.key,
                    lastResetAt: usage?.lastResetAt!,
                    referenceId,
                    referenceType,
                    amount,
                    event
                })
            })

            return usage
        },

        syncUsage: async ({ referenceId, referenceType, feature }: {
            referenceId: string,
            referenceType: string
            feature: {
                key: string,
                reset: ResetType,
                resetValue?: number,
            }
        }) => {
            const usage = await getUsageQuery({
                adapter,
                referenceId,
                referenceType,
                feature
            });
            return usage
        },

        getCustomer: async ({ referenceId }: { referenceId: string }) => {
            const customer = await adapter.findOne<Customer>({
                model: "customer", where: [{
                    field: "referenceId",
                    value: referenceId
                }]
            })
            return customer
        },

        upsertCustomer: async (customer: Customer) => {
            const upsertedCustomer = await adapter.transaction(async (tx) => {
                const existingCustomer = await tx.findOne<Customer>({
                    model: "customer",
                    where: [{ field: "referenceId", value: customer.referenceId }],
                });

                if (existingCustomer) {
                    return await tx.update<Customer>({
                        model: "customer",
                        where: [{ field: "referenceId", value: customer.referenceId }],
                        update: customer,
                    });
                } else {
                    return await tx.create<Customer>({
                        model: "customer",
                        data: customer,
                    });
                }
            });
            return upsertedCustomer;
        }
    };
};

export type UsageAdapter = ReturnType<typeof getUsageAdapter>
