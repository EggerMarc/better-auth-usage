import { describe, test, expect } from "bun:test";
import { checkLimit, shouldReset, tryCatch } from "../utils";

describe("checkLimit", () => {
  test("should return 'in-limit' when value is within bounds", () => {
    const result = checkLimit({
      maxLimit: 100,
      minLimit: 10,
      value: 50,
    });
    expect(result).toBe("in-limit");
  });

  test("should return 'above-max-limit' when value exceeds maxLimit", () => {
    const result = checkLimit({
      maxLimit: 100,
      minLimit: 10,
      value: 150,
    });
    expect(result).toBe("above-max-limit");
  });

  test("should return 'below-min-limit' when value is below minLimit", () => {
    const result = checkLimit({
      maxLimit: 100,
      minLimit: 10,
      value: 5,
    });
    expect(result).toBe("below-min-limit");
  });

  test("should return 'in-limit' when no limits are defined", () => {
    const result = checkLimit({
      value: 50,
    });
    expect(result).toBe("in-limit");
  });

  test("should return 'in-limit' when value equals maxLimit", () => {
    const result = checkLimit({
      maxLimit: 100,
      value: 100,
    });
    expect(result).toBe("in-limit");
  });

  test("should return 'in-limit' when value equals minLimit", () => {
    const result = checkLimit({
      minLimit: 10,
      value: 10,
    });
    expect(result).toBe("in-limit");
  });

  test("should handle edge case with only maxLimit", () => {
    const result = checkLimit({
      maxLimit: 100,
      value: 50,
    });
    expect(result).toBe("in-limit");
  });

  test("should handle edge case with only minLimit", () => {
    const result = checkLimit({
      minLimit: 10,
      value: 50,
    });
    expect(result).toBe("in-limit");
  });

  test("should handle zero values correctly", () => {
    const result = checkLimit({
      maxLimit: 100,
      minLimit: 0,
      value: 0,
    });
    expect(result).toBe("in-limit");
  });

  test("should handle negative values", () => {
    const result = checkLimit({
      maxLimit: 0,
      minLimit: -100,
      value: -50,
    });
    expect(result).toBe("in-limit");
  });
});

describe("shouldReset", () => {
  test("should return false for 'never' reset type", () => {
    const result = shouldReset(new Date(), "never");
    expect(result.shouldReset).toBe(false);
    expect(result.nextReset).toBeUndefined();
  });

  test("should return true when lastReset is null and reset type is not 'never'", () => {
    const result = shouldReset(null, "daily");
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeInstanceOf(Date);
  });

  test("should calculate next reset for hourly", () => {
    const now = new Date("2024-01-01T10:30:00Z");
    const lastReset = new Date("2024-01-01T09:00:00Z");
    const result = shouldReset(lastReset, "hourly");
    
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeInstanceOf(Date);
    expect(result.nextReset!.getMinutes()).toBe(0);
    expect(result.nextReset!.getSeconds()).toBe(0);
  });

  test("should calculate next reset for 6-hourly", () => {
    const now = new Date("2024-01-01T10:00:00Z");
    const lastReset = new Date("2024-01-01T05:00:00Z");
    const result = shouldReset(lastReset, "6-hourly");
    
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeInstanceOf(Date);
  });

  test("should calculate next reset for daily", () => {
    const now = new Date("2024-01-01T23:00:00Z");
    const lastReset = new Date("2024-01-01T00:00:00Z");
    const result = shouldReset(lastReset, "daily");
    
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeInstanceOf(Date);
    expect(result.nextReset!.getHours()).toBe(0);
  });

  test("should calculate next reset for weekly", () => {
    const lastReset = new Date("2024-01-01T00:00:00Z"); // Monday
    const result = shouldReset(lastReset, "weekly");
    
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeInstanceOf(Date);
  });

  test("should calculate next reset for monthly", () => {
    const lastReset = new Date("2024-01-01T00:00:00Z");
    const result = shouldReset(lastReset, "monthly");
    
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeInstanceOf(Date);
    expect(result.nextReset!.getDate()).toBe(1);
  });

  test("should calculate next reset for quarterly", () => {
    const lastReset = new Date("2024-01-01T00:00:00Z");
    const result = shouldReset(lastReset, "quarterly");
    
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeInstanceOf(Date);
  });

  test("should calculate next reset for yearly", () => {
    const lastReset = new Date("2024-01-01T00:00:00Z");
    const result = shouldReset(lastReset, "yearly");
    
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeInstanceOf(Date);
    expect(result.nextReset!.getMonth()).toBe(0);
    expect(result.nextReset!.getDate()).toBe(1);
  });

  test("should not reset if lastReset is after nextReset", () => {
    const futureReset = new Date(Date.now() + 86400000); // Tomorrow
    const result = shouldReset(futureReset, "hourly");
    
    expect(result.shouldReset).toBe(false);
  });

  test("should handle edge case at month boundary for monthly reset", () => {
    const lastReset = new Date("2024-01-31T00:00:00Z");
    const result = shouldReset(lastReset, "monthly");
    
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeInstanceOf(Date);
  });

  test("should handle quarter transitions correctly", () => {
    const lastReset = new Date("2024-03-31T00:00:00Z"); // End of Q1
    const result = shouldReset(lastReset, "quarterly");
    
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeInstanceOf(Date);
  });

  test("should handle year transitions correctly", () => {
    const lastReset = new Date("2024-12-31T23:59:59Z");
    const result = shouldReset(lastReset, "yearly");
    
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeInstanceOf(Date);
  });
});

describe("tryCatch", () => {
  test("should return data on successful promise", async () => {
    const promise = Promise.resolve("success");
    const result = await tryCatch(promise);
    
    expect(result.data).toBe("success");
    expect(result.error).toBeNull();
  });

  test("should return error on rejected promise", async () => {
    const error = new Error("test error");
    const promise = Promise.reject(error);
    const result = await tryCatch(promise);
    
    expect(result.data).toBeNull();
    expect(result.error).toBe(error);
  });

  test("should handle async functions", async () => {
    const asyncFn = async () => {
      return "async success";
    };
    const result = await tryCatch(asyncFn());
    
    expect(result.data).toBe("async success");
    expect(result.error).toBeNull();
  });

  test("should handle thrown errors in async functions", async () => {
    const asyncFn = async () => {
      throw new Error("async error");
    };
    const result = await tryCatch(asyncFn());
    
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe("async error");
  });

  test("should handle non-Error objects", async () => {
    const promise = Promise.reject("string error");
    const result = await tryCatch(promise);
    
    expect(result.data).toBeNull();
    expect(result.error).toBe("string error");
  });

  test("should preserve error type information", async () => {
    class CustomError extends Error {
      code: number;
      constructor(message: string, code: number) {
        super(message);
        this.code = code;
      }
    }
    
    const error = new CustomError("custom error", 404);
    const promise = Promise.reject(error);
    const result = await tryCatch<any, CustomError>(promise);
    
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(CustomError);
    expect(result.error?.code).toBe(404);
  });

  test("should handle promises that resolve to null", async () => {
    const promise = Promise.resolve(null);
    const result = await tryCatch(promise);
    
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });

  test("should handle promises that resolve to undefined", async () => {
    const promise = Promise.resolve(undefined);
    const result = await tryCatch(promise);
    
    expect(result.data).toBeUndefined();
    expect(result.error).toBeNull();
  });

  test("should handle complex return types", async () => {
    const complexData = {
      nested: {
        array: [1, 2, 3],
        object: { key: "value" },
      },
    };
    const promise = Promise.resolve(complexData);
    const result = await tryCatch(promise);
    
    expect(result.data).toEqual(complexData);
    expect(result.error).toBeNull();
  });
});