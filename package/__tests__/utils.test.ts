import { describe, test, expect } from "bun:test";
import { tryCatch, shouldReset, checkLimit } from "../utils";

describe("tryCatch", () => {
    describe("successful operations", () => {
        test("should return data on successful promise", async () => {
            const successPromise = Promise.resolve("success");
            const result = await tryCatch(successPromise);

            expect(result.data).toBe("success");
            expect(result.error).toBeNull();
        });

        test("should handle object return values", async () => {
            const objPromise = Promise.resolve({ id: 1, name: "test" });
            const result = await tryCatch(objPromise);

            expect(result.data).toEqual({ id: 1, name: "test" });
            expect(result.error).toBeNull();
        });

        test("should handle array return values", async () => {
            const arrPromise = Promise.resolve([1, 2, 3]);
            const result = await tryCatch(arrPromise);

            expect(result.data).toEqual([1, 2, 3]);
            expect(result.error).toBeNull();
        });

        test("should handle null return values", async () => {
            const nullPromise = Promise.resolve(null);
            const result = await tryCatch(nullPromise);

            expect(result.data).toBeNull();
            expect(result.error).toBeNull();
        });

        test("should handle undefined return values", async () => {
            const undefinedPromise = Promise.resolve(undefined);
            const result = await tryCatch(undefinedPromise);

            expect(result.data).toBeUndefined();
            expect(result.error).toBeNull();
        });

        test("should handle boolean return values", async () => {
            const boolPromise = Promise.resolve(false);
            const result = await tryCatch(boolPromise);

            expect(result.data).toBe(false);
            expect(result.error).toBeNull();
        });

        test("should handle number zero", async () => {
            const zeroPromise = Promise.resolve(0);
            const result = await tryCatch(zeroPromise);

            expect(result.data).toBe(0);
            expect(result.error).toBeNull();
        });

        test("should handle empty string", async () => {
            const emptyPromise = Promise.resolve("");
            const result = await tryCatch(emptyPromise);

            expect(result.data).toBe("");
            expect(result.error).toBeNull();
        });
    });

    describe("error handling", () => {
        test("should return error on rejected promise", async () => {
            const errorPromise = Promise.reject(new Error("test error"));
            const result = await tryCatch(errorPromise);

            expect(result.data).toBeNull();
            expect(result.error).toBeInstanceOf(Error);
            expect((result.error as Error).message).toBe("test error");
        });

        test("should handle custom error types", async () => {
            class CustomError extends Error {
                code: number;
                constructor(message: string, code: number) {
                    super(message);
                    this.code = code;
                }
            }

            const customErrorPromise = Promise.reject(new CustomError("custom", 404));
            const result = await tryCatch<any, CustomError>(customErrorPromise);

            expect(result.data).toBeNull();
            expect(result.error).toBeInstanceOf(CustomError);
            expect(result.error?.code).toBe(404);
        });

        test("should handle string errors", async () => {
            const stringErrorPromise = Promise.reject("string error");
            const result = await tryCatch(stringErrorPromise);

            expect(result.data).toBeNull();
            expect(result.error).toBe("string error");
        });

        test("should handle null errors", async () => {
            const nullErrorPromise = Promise.reject(null);
            const result = await tryCatch(nullErrorPromise);

            expect(result.data).toBeNull();
            expect(result.error).toBeNull();
        });

        test("should handle object errors", async () => {
            const objError = { code: 500, message: "server error" };
            const objErrorPromise = Promise.reject(objError);
            const result = await tryCatch(objErrorPromise);

            expect(result.data).toBeNull();
            expect(result.error).toEqual(objError);
        });

        test("should handle errors thrown in async functions", async () => {
            const throwingFunc = async () => {
                throw new Error("async throw");
            };

            const result = await tryCatch(throwingFunc());

            expect(result.data).toBeNull();
            expect(result.error).toBeInstanceOf(Error);
        });
    });

    describe("type safety", () => {
        test("should maintain type information for success", async () => {
            interface User {
                id: number;
                name: string;
            }

            const userPromise: Promise<User> = Promise.resolve({ id: 1, name: "Alice" });
            const result = await tryCatch<User>(userPromise);

            if (result.data) {
                expect(result.data.id).toBe(1);
                expect(result.data.name).toBe("Alice");
            }
        });

        test("should maintain type information for errors", async () => {
            class ValidationError extends Error {
                fields: string[];
                constructor(message: string, fields: string[]) {
                    super(message);
                    this.fields = fields;
                }
            }

            const errorPromise = Promise.reject(new ValidationError("Invalid", ["email"]));
            const result = await tryCatch<any, ValidationError>(errorPromise);

            if (result.error) {
                expect(result.error.fields).toEqual(["email"]);
            }
        });
    });

    describe("async operation patterns", () => {
        test("should work with setTimeout", async () => {
            const delayPromise = new Promise((resolve) => {
                setTimeout(() => resolve("delayed"), 10);
            });

            const result = await tryCatch(delayPromise);

            expect(result.data).toBe("delayed");
            expect(result.error).toBeNull();
        });

        test("should work with fetch-like operations", async () => {
            const mockFetch = async () => {
                return { status: 200, json: async () => ({ data: "test" }) };
            };

            const result = await tryCatch(mockFetch());

            expect(result.data).toBeDefined();
            expect(result.error).toBeNull();
        });

        test("should handle multiple sequential operations", async () => {
            const op1 = await tryCatch(Promise.resolve(1));
            const op2 = await tryCatch(Promise.resolve(2));
            const op3 = await tryCatch(Promise.resolve(3));

            expect(op1.data).toBe(1);
            expect(op2.data).toBe(2);
            expect(op3.data).toBe(3);
        });

        test("should handle chained promises", async () => {
            const chainedPromise = Promise.resolve(1)
                .then(x => x + 1)
                .then(x => x * 2);

            const result = await tryCatch(chainedPromise);

            expect(result.data).toBe(4);
        });
    });

    describe("edge cases", () => {
        test("should handle very large return values", async () => {
            const largeArray = new Array(10000).fill(1);
            const result = await tryCatch(Promise.resolve(largeArray));

            expect(result.data?.length).toBe(10000);
            expect(result.error).toBeNull();
        });

        test("should handle promises that resolve immediately", async () => {
            const immediatePromise = Promise.resolve("immediate");
            const result = await tryCatch(immediatePromise);

            expect(result.data).toBe("immediate");
        });

        test("should handle promises that reject immediately", async () => {
            const immediateReject = Promise.reject(new Error("immediate fail"));
            const result = await tryCatch(immediateReject);

            expect(result.error).toBeInstanceOf(Error);
        });
    });
});

describe("shouldReset", () => {
    describe("daily reset", () => {
        test("should reset when more than a day has passed", () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(0, 0, 0, 0);

            const result = shouldReset(yesterday, "daily");

            expect(result.shouldReset).toBe(true);
            expect(result.nextReset).toBeDefined();
        });

        test("should not reset within the same day", () => {
            const today = new Date();
            const result = shouldReset(today, "daily");

            expect(result.shouldReset).toBe(false);
        });
    });

    describe("weekly reset", () => {
        test("should reset after a week", () => {
            const lastWeek = new Date();
            lastWeek.setDate(lastWeek.getDate() - 8);

            const result = shouldReset(lastWeek, "weekly");

            expect(result.shouldReset).toBe(true);
        });

        test("should not reset within the same week", () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const result = shouldReset(yesterday, "weekly");

            expect(result.shouldReset).toBe(false);
        });
    });

    describe("monthly reset", () => {
        test("should reset after a month", () => {
            const lastMonth = new Date();
            lastMonth.setMonth(lastMonth.getMonth() - 1);

            const result = shouldReset(lastMonth, "monthly");

            expect(result.shouldReset).toBe(true);
        });
    });

    describe("never reset", () => {
        test("should never trigger reset", () => {
            const longAgo = new Date("2020-01-01");
            const result = shouldReset(longAgo, "never");

            expect(result.shouldReset).toBe(false);
            expect(result.nextReset).toBeNull();
        });
    });

    describe("null lastReset", () => {
        test("should trigger reset for all types except never", () => {
            const resetTypes = ["daily", "weekly", "monthly"] as const;

            for (const type of resetTypes) {
                const result = shouldReset(null, type);
                expect(result.shouldReset).toBe(true);
            }
        });
    });
});

describe("checkLimit", () => {
    describe("within limits", () => {
        test("should return in-limit when usage is within bounds", () => {
            const result = checkLimit(50, 0, 100);

            expect(result).toBe("in-limit");
        });

        test("should handle edge case at exact max limit", () => {
            const result = checkLimit(100, 0, 100);

            expect(result).toBe("in-limit");
        });

        test("should handle edge case at exact min limit", () => {
            const result = checkLimit(0, 0, 100);

            expect(result).toBe("in-limit");
        });
    });

    describe("above max limit", () => {
        test("should return above-max-limit when exceeding maximum", () => {
            const result = checkLimit(150, 0, 100);

            expect(result).toBe("above-max-limit");
        });

        test("should detect slight overages", () => {
            const result = checkLimit(101, 0, 100);

            expect(result).toBe("above-max-limit");
        });
    });

    describe("below min limit", () => {
        test("should return below-min-limit when under minimum", () => {
            const result = checkLimit(5, 10, 100);

            expect(result).toBe("below-min-limit");
        });

        test("should handle negative values", () => {
            const result = checkLimit(-10, 0, 100);

            expect(result).toBe("below-min-limit");
        });
    });

    describe("undefined limits", () => {
        test("should handle undefined maxLimit", () => {
            const result = checkLimit(1000, 0, undefined);

            expect(result).toBe("in-limit");
        });

        test("should handle undefined minLimit", () => {
            const result = checkLimit(-10, undefined, 100);

            expect(result).toBe("in-limit");
        });

        test("should handle both limits undefined", () => {
            const result = checkLimit(50, undefined, undefined);

            expect(result).toBe("in-limit");
        });
    });
});