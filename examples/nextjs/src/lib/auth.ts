import { betterAuth } from "better-auth";
import { openAPI } from "better-auth/plugins";
import { anonymous } from "better-auth/plugins/anonymous";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { usage } from "package/index"

export const auth = betterAuth({
    trustedOrigins: (req) => {
        const origin = req.headers.get("origin") ?? ""
        if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return [origin]
        return []
    },
    database: drizzleAdapter(db, {
        provider: "pg",
    }),
    emailAndPassword: {
        enabled: true
    },
    plugins: [
        anonymous(),
        usage({
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
                redisUrl: process.env.CACHE_REDIS!,
                enableRealtime: true,
                port: 3178,
                wal: {
                    enabled: true,
                    drainStrategy: "poll",
                    pollInterval: 100
                }
            },
        }),
        openAPI(),
    ]
});
