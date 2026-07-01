import { describe, it, expect } from "bun:test";
import { checkLimit, shouldReset } from "../utils";

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
        expect(result.shouldReset).toBe(false);
        expect(result.nextReset).toBeInstanceOf(Date);
    });
});
