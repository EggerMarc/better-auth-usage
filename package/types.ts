import { usageSchema } from "./schema"
import { z } from "zod";

export type Usage = z.infer<typeof usageSchema>;
type ExtraFields = {
    [key: string]: string;
}

export type Customer = {
    referenceId: string;
    referenceType: string;
    email?: string;
    name?: string;
};

export type CustomerExpanded = Customer & ExtraFields;
export type Feature = {
    /*
     *
     */
    availableInPlans?: string[];
    key: string,
    maxLimit?: number,
    minLimit?: number,
    details?: string[],
    stripeId?: string,
    reset?: ResetType,
    resetValue?: number,
    hooks?: {
        after?: (props: {
            usage: Usage,
            customer: Customer,
            feature: Feature
        }) => void
        before?: (props: {
            usage: Usage,
            customer: Customer,
            feature: Feature
        }) => void
    },
};
export type FeatureExpanded = Feature & ExtraFields
export type ResetType = "hourly" | "6-hourly" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "never"
export type ConsumptionLimitType = "in-limit" | "above-limit" | "below-limit";
export interface UsageOptions {
    features: Record<string, Feature>
    overrides?: Record<string, {
        features: Record<string, Partial<Feature>>
    }>
    customers?: Record<string, Customer>
}
