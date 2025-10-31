import type { UsageAdapter } from "@/adapters";
import type { Customer, UsageOptionsWithCache } from "@/types";

interface UpsertCustomerParams {
    adapter: UsageAdapter,
    options: UsageOptionsWithCache,
    customer: Customer
}

export const resolveUpsertCustomer = async ({
    adapter, options, customer
}: UpsertCustomerParams) => {
    const response = await adapter.upsertCustomer(customer);
    options.cache && options.cache.setCustomer(customer).catch(() => {
        console.log("[ERROR][CUSTOMER] Cache failed to insert customer")
    })
    return response
}
