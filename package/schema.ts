import { z } from "zod";

export const customerSchema = z.object({
    referenceId: z.string(),
    referenceType: z.string(),
    email: z.string().optional(),
    name: z.string().optional(),
    overrideKey: z.string().optional(),
    /*
    featureLimits: z.record(
        z.string(),
        z.object({
            maxLimit: z.number().optional(),
            minLimit: z.number().optional(),
        })
    ).optional(),
    */
})

export const customerLimitsSchema = z.object({
    referenceId: z.string(),
    featureKey: z.string(),
    maxLimit: z.number().optional(),
    minLimit: z.number().optional()
})

export const usageSchema = z.object({
    referenceId: z.string(),
    // referenceType: z.string(), -> Delete this, otherwise we can have missmatches
    event: z.string().optional(),
    createdAt: z.date(),
    lastResetAt: z.date(),
    amount: z.number(),
    // afterAmount: z.number(), -> We will instead use sum
    feature: z.string(),
})

export const cached_usageSchema = z.object({
    referenceId: z.string(),
    lastResetAt: z.date(),
    feature: z.string(),
    curr: z.number(),
    maxLimit: z.number().optional(),
    minLimit: z.number().optional(),
})
