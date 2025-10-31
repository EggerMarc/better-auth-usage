import type { AuthContext } from "better-auth/types";
import type { Customer, Feature, ResetType, Usage } from "@/types.ts"
import { resetUsageQuery } from "./queries/reset-usage";
import { insertUsageQuery } from "./queries/insert-usage";
import { getUsageQuery } from "./queries/get-usage";
import type { UsageCache } from "./cache";

export const getUsageAdapter = (context: AuthContext, cache?: UsageCache) => {
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
            curr,
            feature,
        }: {
            referenceId: string,
            curr?: number,
            feature: Omit<Feature, "hooks">
        }) => {
            return resetUsageQuery({
                adapter, referenceId, curr, feature
            })
        },

        insertUsage: async ({
            amount,
            referenceId,
            event,
            feature
        }: {
            amount: number,
            referenceId: string,
            event: string,
            feature: Omit<Feature, "hooks">
        }) => {
            const usage = await adapter.transaction(async (tx) => {
                const usage = await getUsageQuery({
                    adapter,
                    referenceId,
                    feature
                });

                return insertUsageQuery({
                    adapter: tx,
                    featureKey: feature.key,
                    // Set date if no prior resetDate
                    lastResetAt: usage?.lastResetAt ?? new Date(),
                    referenceId,
                    amount,
                    event
                })
            })

            return usage
        },

        getCustomer: async ({ referenceId, }: { referenceId: string, }) => {
            let customer: Customer | null = null;
            if (cache) {
                customer = await cache.getCustomer(referenceId)
            }

            if (customer === undefined) {
                customer = await adapter.findOne<Customer>({
                    model: "customer", where: [{
                        field: "referenceId",
                        value: referenceId
                    }]
                })

                if (cache && customer) {
                    await cache.setCustomer(customer)
                }
            }

            return customer;
        },

        upsertCustomer: async (customer: Customer, cache?: UsageCache) => {
            const upsertedCustomer = await adapter.transaction(async (tx) => {
                const existingCustomer = await tx.findOne<Customer>({
                    model: "customer",
                    where: [{ field: "referenceId", value: customer.referenceId }],
                });

                if (existingCustomer) {
                    await tx.update<Customer>({
                        model: "customer",
                        where: [{ field: "referenceId", value: customer.referenceId }],
                        update: customer,
                    });
                } else {
                    await tx.create<Customer>({
                        model: "customer",
                        data: customer,
                    });
                }

                if (cache) {
                    await cache.setCustomer(customer)
                }
                return customer
            });
            return upsertedCustomer;
        },

        getUsage: async ({ referenceId, feature }: {
            referenceId: string, feature: Omit<Feature, "hooks">
        }) => {
            return await getUsageQuery({ adapter, referenceId, feature })
        }
    };
};

export type UsageAdapter = ReturnType<typeof getUsageAdapter>
