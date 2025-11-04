import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { openAPI } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { usage } from "package/index"

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
    }),
    emailAndPassword: {
        enabled: true
    },
    plugins: [usage({
        features: {
            "clicks": {
                key: "clicks",
                reset: "monthly",
                resetValue: 0,
                maxLimit: 100,
                minLimit: -100,

                hooks: {
                    before: (ctx) => {
                        if (ctx.usage.afterAmount > 100) {
                            console.log("above limit!")
                        }

                        if (ctx.usage.afterAmount < -100) {
                            throw new Error("below limit!")
                        }
                    }
                }
            }
        },
        overrides: {
            "authenticated": {
                features: {
                    "clicks": {
                        reset: "never"
                    }
                }
            },
        },
        cacheOptions: {
            redisUrl: process.env.REDIS_URL!,
            port: 3000
        }
    }) as BetterAuthPlugin,
    openAPI()]
});
