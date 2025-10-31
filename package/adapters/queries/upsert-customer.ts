import type { Customer } from "@/types";
import type { Adapter } from "better-auth";

interface UpsertCustomerQueryParams {
    customer: Customer,
    adapter: Adapter
}

export const upsertCustomerQuery = async ({ adapter, customer }: UpsertCustomerQueryParams) => {
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
        return customer
    });
    return upsertedCustomer;
}
