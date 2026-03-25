import { betterAuth } from "better-auth";
import { openAPI } from "better-auth/plugins";
import { anonymous } from "better-auth/plugins/anonymous";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { usage, type UsageOptions } from "@eggermarc/better-auth-usage"

export const usageOptions = {
    features: {
        "api-calls": {
            reset: "monthly",
            resetValue: 0,
            maxLimit: 100,
        },
        "credits": {
            reset: "monthly",
            resetValue: 0,
            minLimit: -10,
        },
        "storage": {
            reset: "never",
            resetValue: 0,
            maxLimit: 0,
            minLimit: 0,
            hooks: {
                before: ({ usage, feature }) => {
                    if (
                        usage.afterAmount > (feature.maxLimit ?? Infinity) ||
                        usage.afterAmount < (feature.minLimit ?? -Infinity)
                    ) {
                        throw new Error("Storage limit exceeded — upgrade your plan")
                    }
                }
            }
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
            drainStrategy: "poll" as const,
            pollInterval: 100
        }
    },
} satisfies UsageOptions

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
    socialProviders: {
        github: {
            clientId: process.env.GITHUB_CLIENT_ID!,
            clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        },
    },
    plugins: [
        anonymous(),
        usage(usageOptions),
        openAPI(),
    ]
});
