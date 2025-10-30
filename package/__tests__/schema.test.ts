import { describe, test, expect } from "bun:test";
import { usageSchema, customerSchema, cached_usageSchema, cached_usageEventSchema } from "../schema";

describe("usageSchema", () => {
  test("validates correct usage data", () => {
    const validUsage = {
      referenceId: "ref-123",
      event: "use",
      createdAt: new Date(),
      lastResetAt: new Date(),
      amount: 10,
      feature: "api-calls",
    };

    const result = usageSchema.safeParse(validUsage);
    expect(result.success).toBe(true);
  });

  test("rejects missing required fields", () => {
    const invalidUsage = {
      referenceId: "ref-123",
      amount: 10,
    };

    const result = usageSchema.safeParse(invalidUsage);
    expect(result.success).toBe(false);
  });

  test("accepts optional event field", () => {
    const usageWithoutEvent = {
      referenceId: "ref-123",
      createdAt: new Date(),
      lastResetAt: new Date(),
      amount: 10,
      feature: "api-calls",
    };

    const result = usageSchema.safeParse(usageWithoutEvent);
    expect(result.success).toBe(true);
  });
});

describe("customerSchema", () => {
  test("validates correct customer data", () => {
    const validCustomer = {
      referenceId: "cust-123",
      referenceType: "organization",
      email: "test@example.com",
      name: "Test Customer",
    };

    const result = customerSchema.safeParse(validCustomer);
    expect(result.success).toBe(true);
  });

  test("requires referenceId and referenceType", () => {
    const invalidCustomer = {
      email: "test@example.com",
    };

    const result = customerSchema.safeParse(invalidCustomer);
    expect(result.success).toBe(false);
  });
});

describe("cached_usageSchema", () => {
  test("validates cached usage data structure", () => {
    const validCachedUsage = {
      referenceId: "ref-123",
      lastResetAt: new Date(),
      updatedAt: new Date(),
      feature: "api-calls",
      current: 50,
      maxLimit: 100,
    };

    const result = cached_usageSchema.safeParse(validCachedUsage);
    expect(result.success).toBe(true);
  });
});

describe("cached_usageEventSchema", () => {
  test("validates usage event structure", () => {
    const validEvent = {
      referenceId: "ref-123",
      feature: "api-calls",
      amount: 5,
    };

    const result = cached_usageEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  test("requires all three fields", () => {
    const invalidEvent = {
      referenceId: "ref-123",
      feature: "api-calls",
    };

    const result = cached_usageEventSchema.safeParse(invalidEvent);
    expect(result.success).toBe(false);
  });
});
