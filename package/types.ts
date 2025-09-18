import { customerSchema, usageSchema } from "./schema"
import { z } from "zod";

export type Usage = z.infer<typeof usageSchema>;
export type Customer = z.infer<typeof customerSchema>
export type Feature = {
    /*
     *
     */
    availableInPlans?: string[],
    key: string,
    maxLimit?: number,
    minLimit?: number,
    details?: string[],
    stripeId?: string,
    reset?: ResetType,
    resetValue?: number,
    hooks?: {
        after?: (props: UsageProps) => void
        before?: (props: UsageProps) => void
    }
}
export type ResetType = "hourly" | "6-hourly" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "never"
export type ConsumptionLimitType = "in-limit" | "above-limit" | "below-limit";
export interface UsageOptions {
    features: Record<string, Feature>
    overrides?: Record<string, {
        features: Record<string, Partial<Feature>>
    }>
    customers?: Record<string, Customer>
}
