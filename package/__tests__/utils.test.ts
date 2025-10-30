import { describe, test, expect } from "bun:test";
import { checkLimit, shouldReset, tryCatch } from "../utils";
import type { ResetType } from "../types";

describe("utils.ts - tryCatch", () => {
  test("should return data on successful promise", async () => {
    const result = await tryCatch(Promise.resolve("success"));
    expect(result.data).toBe("success");
    expect(result.error).toBeNull();
  });

  test("should return error on rejected promise", async () => {
    const testError = new Error("test error");
    const result = await tryCatch(Promise.reject(testError));
    expect(result.data).toBeNull();
    expect(result.error).toBe(testError);
  });

  test("should handle async function returning value", async () => {
    const asyncFn = async () => {
      return { value: 42 };
    };
    const result = await tryCatch(asyncFn());
    expect(result.data).toEqual({ value: 42 });
    expect(result.error).toBeNull();
  });

  test("should handle async function throwing error", async () => {
    const asyncFn = async () => {
      throw new Error("async error");
    };
    const result = await tryCatch(asyncFn());
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe("async error");
  });

  test("should preserve error type", async () => {
    class CustomError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.code = code;
      }
    }
    const customError = new CustomError("custom", "CUSTOM_CODE");
    const result = await tryCatch<any, CustomError>(Promise.reject(customError));
    expect(result.error).toBeInstanceOf(CustomError);
    expect(result.error?.code).toBe("CUSTOM_CODE");
  });

  test("should handle null/undefined values", async () => {
    const nullResult = await tryCatch(Promise.resolve(null));
    expect(nullResult.data).toBeNull();
    expect(nullResult.error).toBeNull();

    const undefinedResult = await tryCatch(Promise.resolve(undefined));
    expect(undefinedResult.data).toBeUndefined();
    expect(undefinedResult.error).toBeNull();
  });
});

describe("utils.ts - checkLimit (edge cases)", () => {
  test("should handle exact limit boundaries", () => {
    expect(checkLimit({ maxLimit: 100, value: 100 })).toBe("in-limit");
    expect(checkLimit({ maxLimit: 100, value: 101 })).toBe("above-max-limit");
    expect(checkLimit({ minLimit: 10, value: 10 })).toBe("in-limit");
    expect(checkLimit({ minLimit: 10, value: 9 })).toBe("below-min-limit");
  });

  test("should handle zero limits", () => {
    expect(checkLimit({ maxLimit: 0, value: 0 })).toBe("in-limit");
    expect(checkLimit({ maxLimit: 0, value: 1 })).toBe("above-max-limit");
    expect(checkLimit({ minLimit: 0, value: 0 })).toBe("in-limit");
    expect(checkLimit({ minLimit: 0, value: -1 })).toBe("below-min-limit");
  });

  test("should handle negative values", () => {
    expect(checkLimit({ maxLimit: -5, value: -6 })).toBe("in-limit");
    expect(checkLimit({ maxLimit: -5, value: -4 })).toBe("above-max-limit");
    expect(checkLimit({ minLimit: -10, value: -9 })).toBe("in-limit");
    expect(checkLimit({ minLimit: -10, value: -11 })).toBe("below-min-limit");
  });
});

describe("utils.ts - shouldReset (additional edge cases)", () => {
  test("should handle reset on exact boundary times", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const lastReset = new Date("2023-12-31T23:59:59Z");
    const result = shouldReset(lastReset, "daily");
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeDefined();
  });

  test("should handle null lastReset for all reset types", () => {
    const resetTypes: ResetType[] = [
      "hourly", "6-hourly", "daily", "weekly", "monthly", "quarterly", "yearly", "never"
    ];
    
    resetTypes.forEach(resetType => {
      const result = shouldReset(null, resetType);
      if (resetType === "never") {
        expect(result.shouldReset).toBe(false);
      } else {
        expect(result.shouldReset).toBe(true);
        expect(result.nextReset).toBeDefined();
      }
    });
  });

  test("should handle edge of week (Sunday to Monday)", () => {
    const sunday = new Date("2024-01-07T23:00:00Z"); // Sunday
    const result = shouldReset(sunday, "weekly");
    expect(result.shouldReset).toBe(true);
    const nextReset = result.nextReset!;
    expect(nextReset.getDay()).toBe(1); // Monday
  });

  test("should handle edge of month", () => {
    const endOfMonth = new Date("2024-01-31T23:00:00Z");
    const result = shouldReset(endOfMonth, "monthly");
    expect(result.shouldReset).toBe(true);
    const nextReset = result.nextReset!;
    expect(nextReset.getDate()).toBe(1);
    expect(nextReset.getMonth()).toBe(1); // February
  });

  test("should handle leap year for yearly reset", () => {
    const leapYear = new Date("2024-02-29T12:00:00Z");
    const result = shouldReset(leapYear, "yearly");
    expect(result.shouldReset).toBe(true);
  });

  test("should handle quarter boundaries", () => {
    const q1End = new Date("2024-03-31T23:00:00Z");
    const result = shouldReset(q1End, "quarterly");
    expect(result.shouldReset).toBe(true);
    const nextReset = result.nextReset!;
    expect(nextReset.getMonth()).toBe(3); // April (Q2 start)
  });
});