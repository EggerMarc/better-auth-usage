import type { UsageAdapter } from "@/adapters";
import type { Customer, UsageOptionsWithCache } from "@/types";
import { tryCatch } from "@/utils";
import { APIError } from "better-auth";

interface ResolveGetCustomerParams {
    referenceId: string,
    adapter: UsageAdapter,
    options: UsageOptionsWithCache
}

export async function resolveGetCustomer({ referenceId, options, adapter }: ResolveGetCustomerParams): Promise<Customer> {
    if (options.cache) {
        const { data: customer, error } = await tryCatch(options.cache.getCustomer(referenceId))
        if (error) {
            //TODO handle error
            throw new APIError()
        }
        if (customer) {
            return customer
        }
    }

    const { data: customer, error } = await tryCatch(adapter.getCustomer({ referenceId }));

    if (error) {
        // TODO handle error
        throw new APIError()
    }

    if (!customer) {
        // TODO handle not found
        throw new APIError()
    }

    if (options.cache) {
        options.cache.setCustomer(customer).catch(() => {
            console.log(new APIError().message)
        })
    }

    return customer
}
