import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { openAPI } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { usage } from "package/index"

const appOrigin = process.env.APP_ORIGIN;
if (!appOrigin) {
    throw new Error("Missing APP_ORIGIN");
}


export const auth = betterAuth({
    trustedOrigins: [appOrigin],
    database: drizzleAdapter(db, {
        provider: "pg",
    }),
    emailAndPassword: {
        enabled: true
    },
    plugins: [usage({
        features: {
            "api-calls": {
                key: "api-calls",
                reset: "monthly",
                resetValue: 0,
                maxLimit: 1000,
                minLimit: 0,
            },
            "storage": {
                key: "storage",
                reset: "never",
                resetValue: 0,
                maxLimit: 500,
                minLimit: 0,
            },
            "credits": {
                key: "credits",
                reset: "monthly",
                resetValue: 0,
                maxLimit: 50,
                minLimit: -10,
            },
        },
        overrides: {
            "starter": {
                features: {
                    "api-calls": { maxLimit: 1000 },
                    "storage": { maxLimit: 500 },
                    "credits": { maxLimit: 50 },
                }
            },
            "pro": {
                features: {
                    "api-calls": { maxLimit: 10000 },
                    "storage": { maxLimit: 5000 },
                    "credits": { maxLimit: 500 },
                }
            },
        },
        cacheOptions: {
            redisUrl: process.env.CACHE_URL!,
        },
    }) as BetterAuthPlugin,
    openAPI()]
});
