import { APIError, AuthPluginSchema } from "better-auth";
import { ConsumptionLimitType, Customer, Customers, Feature, Features, Overrides, ResetType } from "./types";

export function mergeSchema<S extends AuthPluginSchema>(
    schema: S,
    newSchema?: {
        [K in keyof S]?: {
            modelName?: string;
            fields?: {
                [P: string]: string;
            };
        };
    },
) {
    if (!newSchema) {
        return schema;
    }
    for (const table in newSchema) {
        const newModelName = newSchema[table]?.modelName;
        if (newModelName) {
            schema[table].modelName = newModelName;
        }
        for (const field in schema[table].fields) {
            const newField = newSchema[table]?.fields?.[field];
            if (!newField) {
                continue;
            }
            schema[table].fields[field].fieldName = newField;
        }
    }
    return schema;
}

interface CheckLimitProps {
    maxLimit?: number,
    minLimit?: number,
    value: number
}

export function checkLimit({
    maxLimit,
    minLimit,
    value
}: CheckLimitProps): ConsumptionLimitType {
    if (maxLimit && value > maxLimit) return "above-limit"
    if (minLimit && value < minLimit) return "below-limit"
    return "in-limit"
}

export function shouldReset(lastReset: Date, reset: ResetType): boolean {
    const now = new Date();
    let nextResetTime = new Date(now);

    switch (reset) {
        case "hourly":
            nextResetTime.setHours(nextResetTime.getHours() + 1, 0, 0, 0);
            break;
        case "6-hourly": {
            const hour = now.getHours();
            const nextBlock = Math.floor(hour / 6) * 6 + 6;
            if (nextBlock >= 24) {
                nextResetTime.setDate(nextResetTime.getDate() + 1);
                nextResetTime.setHours(0, 0, 0, 0);
            } else {
                nextResetTime.setHours(nextBlock, 0, 0, 0);
            }
            break;
        }
        case "daily":
            nextResetTime.setDate(nextResetTime.getDate() + 1);
            nextResetTime.setHours(0, 0, 0, 0);
            break;
        case "weekly": {
            const day = nextResetTime.getDay(); // 0 = Sunday
            const daysUntilNextMonday = (8 - day) % 7 || 7;
            nextResetTime.setDate(nextResetTime.getDate() + daysUntilNextMonday);
            nextResetTime.setHours(0, 0, 0, 0);
            break;
        }
        case "monthly":
            nextResetTime.setMonth(nextResetTime.getMonth() + 1, 1);
            nextResetTime.setHours(0, 0, 0, 0);
            break;
        case "quarterly": {
            const currentMonth = nextResetTime.getMonth();
            const nextQuarterStartMonth = Math.floor(currentMonth / 3) * 3 + 3;
            if (nextQuarterStartMonth >= 12) {
                nextResetTime.setFullYear(nextResetTime.getFullYear() + 1);
                nextResetTime.setMonth(0, 1);
            } else {
                nextResetTime.setMonth(nextQuarterStartMonth, 1);
            }
            nextResetTime.setHours(0, 0, 0, 0);
            break;
        }
        case "yearly":
            nextResetTime.setFullYear(nextResetTime.getFullYear() + 1, 0, 1);
            nextResetTime.setHours(0, 0, 0, 0);
            break;
    }

    return now >= nextResetTime || lastReset < nextResetTime;
}

export function getFeature(
    params: {
        features: Features,
        featureKey: string,
        overrideKey?: string
        overrides?: Overrides,
        customer?: Customer
    }
): Feature {
    let feature = params.features[params.featureKey]

    if (!feature) {
        throw new APIError("NOT_FOUND", { message: `Feature ${params.featureKey} not found` });
    }

    if (params.overrideKey && params.overrides?.[params.overrideKey]) {
        feature = {
            ...feature,
            ...params.overrides[params.overrideKey].features[params.featureKey],
        }
    }

    if (params.customer?.featureLimits?.[params.featureKey]) {
        feature = {
            ...feature,
            ...params.customer.featureLimits[params.featureKey],
        };
    }

    return feature
}

export function getCustomer(
    params: {
        customers: Customers,
        referenceId: string,
    }
): Customer {
    let customer = params.customers[params.referenceId]
    if (!customer) {
        throw new APIError("NOT_FOUND", { message: `Customer ${params.referenceId} not found` });
    }
    return customer
}

