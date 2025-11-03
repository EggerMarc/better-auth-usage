import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { usage } from "../../../package/index.ts"

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
                reset: "monthly",
                resetValue: 0,
                maxLimit: 100,
                minLimit: -100
            }
        },
        overrides: {
            "authenticated": {
                features: {
                    "clicks": {
                        resetValue: "never
                    }
                }
            }
        }
    }) as BetterAuthPlugin]
});
