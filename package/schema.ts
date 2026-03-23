import { Schema } from "@effect/schema"

// ── Core schemas ──

export const CustomerSchema = Schema.Struct({
    referenceId: Schema.String,
    referenceType: Schema.String,
    email: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
    overrideKey: Schema.optional(Schema.String),
})

export const UsageSchema = Schema.Struct({
    referenceId: Schema.String,
    feature: Schema.String,
    amount: Schema.Number,
    event: Schema.optional(Schema.String),
    createdAt: Schema.DateFromSelf,
    lastResetAt: Schema.DateFromSelf,
    updatedAt: Schema.optional(Schema.DateFromSelf),
})

export const UsageEventSchema = Schema.Struct({
    referenceId: Schema.String,
    feature: Schema.String,
    amount: Schema.Number,
    event: Schema.String,
    overrideKey: Schema.optional(Schema.String),
    lastResetAt: Schema.DateFromSelf,
    createdAt: Schema.DateFromSelf,
})

// ── Cache schemas ──

export const CachedUsageSchema = Schema.Struct({
    referenceId: Schema.String,
    feature: Schema.String,
    current: Schema.Number,
    lastResetAt: Schema.NullOr(Schema.DateFromSelf),
    maxLimit: Schema.optional(Schema.Number),
    minLimit: Schema.optional(Schema.Number),
})

export const CachedLimitsSchema = Schema.Struct({
    referenceId: Schema.String,
    feature: Schema.String,
    maxLimit: Schema.optional(Schema.Number),
    minLimit: Schema.optional(Schema.Number),
    resetValue: Schema.optional(Schema.Number),
    lastResetAt: Schema.optional(Schema.DateFromSelf),
    resetAt: Schema.optional(Schema.DateFromSelf),
})

export const CachedUsageEventSchema = Schema.Struct({
    referenceId: Schema.String,
    feature: Schema.String,
    amount: Schema.Number,
    event: Schema.optional(Schema.String),
})

// ── Legacy Zod compatibility ──
// BetterAuth endpoints require Zod for body validation.
// These re-exports keep the old import paths working for
// cache.ts and usage-tracker.ts until they're rewritten.

import { z } from "zod"

/** @deprecated Use CachedUsageEventSchema instead */
export const cached_usageEventSchema = z.object({
    referenceId: z.string(),
    feature: z.string(),
    amount: z.number(),
    event: z.string().optional()
})

/** @deprecated Use CustomerSchema instead */
export const customerSchema = z.object({
    referenceId: z.string(),
    referenceType: z.string(),
    email: z.string().optional(),
    name: z.string().optional(),
    overrideKey: z.string().optional(),
})

/** @deprecated Use CachedUsageSchema instead */
export const cached_usageSchema = z.object({
    referenceId: z.string(),
    lastResetAt: z.date().nullable(),
    feature: z.string(),
    current: z.number(),
    maxLimit: z.number().optional(),
    minLimit: z.number().optional(),
})
