import { describe, it, expect } from "bun:test";
import { tryCatch, checkLimit, shouldReset } from "@/utils";

describe("tryCatch", () => {
    it("should return data on successful promise", async () => {
        const promise = Promise.resolve(42);
        const result = await tryCatch(promise);

        expect(result.data).toBe(42);
        expect(result.error).toBeNull();

    });
    it("should handle string values", async () => {
        const promise = Promise.resolve("success");
        const result = await tryCatch(promise);

        expect(result.data).toBe("success");
        expect(result.error).toBeNull();
    });
    it("should handle object values", async () => {
        const obj = { id: 1, name: "test" };
        const promise = Promise.resolve(obj);
        const result = await tryCatch(promise);

        expect(result.data).toEqual(obj);
        expect(result.error).toBeNull();
    });

    it("should handle array values", async () => {
        const arr = [1, 2, 3];
        const promise = Promise.resolve(arr);
        const result = await tryCatch(promise);

        expect(result.data).toEqual(arr);
        expect(result.error).toBeNull();
    });

    it("should handle null values", async () => {
        const promise = Promise.resolve(null);
        const result = await tryCatch(promise);

        expect(result.data).toBeNull();
        expect(result.error).toBeNull();
    });

    it("should handle undefined values", async () => {
        const promise = Promise.resolve(undefined);
        const result = await tryCatch(promise);

        expect(result.data).toBeUndefined();
        expect(result.error).toBeNull();
    });

    it("should handle boolean values", async () => {
        const promise = Promise.resolve(true);
        const result = await tryCatch(promise);

        expect(result.data).toBe(true);
        expect(result.error).toBeNull();
    });
});

describe("failed promises", () => {
    it("should return error on rejected promise", async () => {
        const error = new Error("Test error");
        const promise = Promise.reject(error);
        const result = await tryCatch(promise);

        expect(result.data).toBeNull();
        expect(result.error).toBe(error);
    });

    it("should handle string errors", async () => {
        const promise = Promise.reject("String error");
        const result = await tryCatch(promise);

        expect(result.data).toBeNull();
        expect(result.error).toBe("String error");
    });

    it("should handle custom error types", async () => {
        class CustomError extends Error {
            code: number;
            constructor(message: string, code: number) {
                super(message);
                this.code = code;
            }
        }

        const error = new CustomError("Custom", 404);
        const promise = Promise.reject(error);
        const result = await tryCatch<any, CustomError>(promise);

        expect(result.error?.code).toBe(404);
    });

    it("should handle undefined errors", async () => {
        const promise = Promise.reject(undefined);
        const result = await tryCatch(promise);

        expect(result.data).toBeNull();
        expect(result.error).toBeUndefined();
    });

    it("should handle null errors", async () => {
        const promise = Promise.reject(null);
        const result = await tryCatch(promise);

        expect(result.data).toBeNull();
        expect(result.error).toBeNull();
    });
});

describe("async functions", () => {
    it("should work with async function that succeeds", async () => {
        const asyncFn = async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return "delayed success";
        };

        const result = await tryCatch(asyncFn());

        expect(result.data).toBe("delayed success");
        expect(result.error).toBeNull();
    });

    it("should work with async function that throws", async () => {
        const asyncFn = async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            throw new Error("delayed error");
        };

        const result = await tryCatch(asyncFn());

        expect(result.data).toBeNull();
        expect(result.error?.message).toBe("delayed error");
    });
});

describe("type safety", () => {
    it("should infer correct data type", async () => {
        const promise = Promise.resolve(42);
        const result = await tryCatch(promise);

        if (result.data !== null) {
            const num: number = result.data;
            expect(typeof num).toBe("number");
        }
    });

    it("should handle generic error types", async () => {
        interface ApiError {
            status: number;
            message: string;
        }

        const error: ApiError = { status: 500, message: "Server error" };
        const promise = Promise.reject(error);
        const result = await tryCatch<any, ApiError>(promise);

        if (result.error) {
            expect(result.error.status).toBe(500);
            expect(result.error.message).toBe("Server error");
        }
    });
});

describe("edge cases", () => {
    it("should handle very large data", async () => {
        const largeArray = new Array(10000).fill(1);
        const promise = Promise.resolve(largeArray);
        const result = await tryCatch(promise);

        expect(result.data?.length).toBe(10000);
        expect(result.error).toBeNull();
    });

    it("should handle promises that resolve immediately", async () => {
        const promise = Promise.resolve("immediate");
        const result = await tryCatch(promise);

        expect(result.data).toBe("immediate");
    });

    it("should handle promises that reject immediately", async () => {
        const promise = Promise.reject(new Error("immediate error"));
        const result = await tryCatch(promise);

        expect(result.error?.message).toBe("immediate error");
    });
});

describe("checkLimit", () => {
    it("should return 'in-limit' when within bounds", () => {
        const result = checkLimit({
            maxLimit: 100,
            minLimit: 0,
            value: 50
        });
        expect(result).toBe("in-limit");
    });

    it("should return 'above-max-limit' when exceeding max", () => {
        const result = checkLimit({
            maxLimit: 100,
            minLimit: 0,
            value: 150
        });
        expect(result).toBe("above-max-limit");
    });

    it("should return 'below-min-limit' when below min", () => {
        const result = checkLimit({
            maxLimit: 100,
            minLimit: 10,
            value: 5
        });
        expect(result).toBe("below-min-limit");
    });

    it("should handle undefined maxLimit", () => {
        const result = checkLimit({
            minLimit: 10,
            value: 50
        });
        expect(result).toBe("in-limit");
    });

    it("should handle undefined minLimit", () => {
        const result = checkLimit({
            maxLimit: 100,
            value: 50
        });
        expect(result).toBe("in-limit");
    });
});

describe("shouldReset", () => {
    it("should not reset for 'never' type", () => {
        const result = shouldReset(new Date(), "never");
        expect(result.shouldReset).toBe(false);
    });

    it("should reset when lastReset is null", () => {
        const result = shouldReset(null, "daily");
        expect(result.shouldReset).toBe(true);
        expect(result.nextReset).toBeInstanceOf(Date);
    });

    it("should reset for daily when last reset was yesterday", () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const result = shouldReset(yesterday, "daily");
        expect(result.shouldReset).toBe(true);
    });

    it("should not reset for daily when last reset was today", () => {
        const today = new Date();
        const result = shouldReset(today, "daily");
        // lastReset is after today's midnight boundary, so no reset needed
        expect(result.shouldReset).toBe(false);
        expect(result.nextReset).toBeInstanceOf(Date);
    });
});
