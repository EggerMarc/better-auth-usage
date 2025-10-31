
import type { Customer } from "@/types";
import type { Adapter } from "better-auth";

export const getCustomerQuery = async ({
    referenceId,
    adapter
}: {
    referenceId: string,
    adapter: Adapter
}) => {
    const customer = await adapter.findOne<Customer>({
        model: "customer", where: [{
            field: "referenceId",
            value: referenceId
        }]
    })
    return customer;
}
