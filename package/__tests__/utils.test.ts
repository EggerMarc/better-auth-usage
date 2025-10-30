import { describe, test, expect } from "bun:test";
import { checkLimit, shouldReset, tryCatch } from "../utils";

describe("checkLimit", () => {
  test("returns 'in-limit' when value is within both max and min limits", () => {
    const result = checkLimit({
      maxLimit: 100,
      minLimit: 10,
      value: 50,
    });
    expect(result).toBe("in-limit");
  });

  test("returns 'above-max-limit' when value exceeds maxLimit", () => {
    const result = checkLimit({
      maxLimit: 100,
      minLimit: 10,
      value: 150,
    });
    expect(result).toBe("above-max-limit");
  });

  test("returns 'below-min-limit' when value is below minLimit", () => {
    const result = checkLimit({
      maxLimit: 100,
      minLimit: 10,
      value: 5,
    });
    expect(result).toBe("below-min-limit");
  });

  test("returns 'in-limit' when value equals maxLimit", () => {
    const result = checkLimit({
      maxLimit: 100,
      value: 100,
    });
    expect(result).toBe("in-limit");
  });

  test("handles zero value", () => {
    const result = checkLimit({
      maxLimit: 100,
      minLimit: 0,
      value: 0,
    });
    expect(result).toBe("in-limit");
  });

  test("handles negative values", () => {
    const result = checkLimit({
      maxLimit: 0,
      minLimit: -100,
      value: -50,
    });
    expect(result).toBe("in-limit");
  });
});

describe("shouldReset", () => {
  test("returns false for 'never' reset type", () => {
    const result = shouldReset(new Date(), "never");
    expect(result.shouldReset).toBe(false);
    expect(result.nextReset).toBeUndefined();
  });

  test("should reset when lastReset is more than an hour ago for hourly", () => {
    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
    
    const result = shouldReset(twoHoursAgo, "hourly");
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeDefined();
  });

  test("should reset when lastReset is null", () => {
    const result = shouldReset(null, "hourly");
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeDefined();
  });

  test("should reset when lastReset is yesterday for daily", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const result = shouldReset(yesterday, "daily");
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset).toBeDefined();
  });

  test("next reset should be at midnight for daily", () => {
    const result = shouldReset(null, "daily");
    expect(result.shouldReset).toBe(true);
    expect(result.nextReset?.getHours()).toBe(0);
    expect(result.nextReset?.getMinutes()).toBe(0);
    expect(result.nextReset?.getSeconds()).toBe(0);
  });
});

describe("tryCatch", () => {
  test("returns success result when promise resolves", async () => {
    const successPromise = Promise.resolve("success");
    const result = await tryCatch(successPromise);
    
    expect(result.data).toBe("success");
    expect(result.error).toBeNull();
  });

  test("returns failure result when promise rejects", async () => {
    const errorMessage = "Something went wrong";
    const failurePromise = Promise.reject(new Error(errorMessage));
    const result = await tryCatch(failurePromise);
    
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  test("handles promise that resolves with null", async () => {
    const nullPromise = Promise.resolve(null);
    const result = await tryCatch(nullPromise);
    
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });

  test("handles promise that resolves with object", async () => {
    const obj = { id: 1, name: "test" };
    const objectPromise = Promise.resolve(obj);
    const result = await tryCatch(objectPromise);
    
    expect(result.data).toEqual(obj);
    expect(result.error).toBeNull();
  });
});