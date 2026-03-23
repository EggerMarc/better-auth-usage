import { describe, test, expect } from "bun:test";
import { Schema } from "@effect/schema"
import { Either } from "effect"
import { UsageSchema, CustomerSchema, CachedUsageSchema, CachedUsageEventSchema } from "../schema";

const isValid = <A, I>(schema: Schema.Schema<A, I>, data: unknown): boolean =>
    Either.isRight(Schema.decodeUnknownEither(schema)(data))

describe("UsageSchema", () => {
    test("validates correct usage data", () => {
        expect(isValid(UsageSchema, {
            referenceId: "ref-123",
            event: "use",
            createdAt: new Date(),
            lastResetAt: new Date(),
            amount: 10,
            feature: "api-calls",
        })).toBe(true);
    });

    test("rejects missing required fields", () => {
        expect(isValid(UsageSchema, {
            referenceId: "ref-123",
            amount: 10,
        })).toBe(false);
    });

    test("accepts optional event field", () => {
        expect(isValid(UsageSchema, {
            referenceId: "ref-123",
            createdAt: new Date(),
            lastResetAt: new Date(),
            amount: 10,
            feature: "api-calls",
        })).toBe(true);
    });
});

describe("CustomerSchema", () => {
    test("validates correct customer data", () => {
        expect(isValid(CustomerSchema, {
            referenceId: "cust-123",
            referenceType: "organization",
            email: "test@example.com",
            name: "Test Customer",
        })).toBe(true);
    });

    test("requires referenceId and referenceType", () => {
        expect(isValid(CustomerSchema, {
            email: "test@example.com",
        })).toBe(false);
    });
});

describe("CachedUsageSchema", () => {
    test("validates cached usage data structure", () => {
        expect(isValid(CachedUsageSchema, {
            referenceId: "ref-123",
            lastResetAt: new Date(),
            feature: "api-calls",
            current: 50,
            maxLimit: 100,
        })).toBe(true);
    });
});

describe("CachedUsageEventSchema", () => {
    test("validates usage event structure", () => {
        expect(isValid(CachedUsageEventSchema, {
            referenceId: "ref-123",
            feature: "api-calls",
            amount: 5,
        })).toBe(true);
    });

    test("requires amount field", () => {
        expect(isValid(CachedUsageEventSchema, {
            referenceId: "ref-123",
            feature: "api-calls",
        })).toBe(false);
    });
});
