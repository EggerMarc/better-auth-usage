import type { AuthContext } from "better-auth/types";
import type { Customer, Feature, ResetType, Usage } from "./types.ts"
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
            feature: Omit<Feature, "hooks">
        }) => {
            const usage = await adapter.transaction(async (tx) => {
                const lastUsage = await tx.findMany<Usage>({
                    model: "usage",
                    where: [
                        { field: "referenceId", value: referenceId },
                        { field: "feature",   value: feature.key }
                    ],
                    sortBy: { field: "createdAt", direction: "desc" },
                    limit: 1
                })
                const last = lastUsage[0];
                const reset = shouldReset(last?.lastResetAt ?? null, feature.reset ?? "never");
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

        syncUsage: async ({ referenceId, referenceType, feature }: {
            referenceId: string,
            referenceType: string
            feature: {
                key: string,
                reset: ResetType,
                resetValue?: number,
            }
        }) => {
            const usage = await adapter.transaction(async (tx) => {
                const lastUsage = await tx.findMany<Usage>({
                    model: "usage",
                    where: [{ field: "referenceId", value: referenceId }],
                    sortBy: { field: "createdAt", direction: "desc" },
                    limit: 1
                });

                const reset = shouldReset(lastUsage[0].lastResetAt, feature.reset ?? "never");
                if (reset.shouldReset && reset.nextReset) {
                    const usage = await tx.create<Usage>({
                        model: "usage",
                        data: {
                            referenceId,
                            referenceType,
                            event: "reset",
                            amount: 0,
                            feature: feature.key,
                            afterAmount: feature.resetValue ?? 0,
                            lastResetAt: reset.nextReset,
                            createdAt: reset.nextReset,
                        }
                    })
                    return usage
                }
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
