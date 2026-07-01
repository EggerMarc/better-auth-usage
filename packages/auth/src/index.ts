import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { anonymous } from "better-auth/plugins"
import { usage } from "@eggermarc/better-auth-usage"
import type { UsageDriver } from "@eggermarc/better-auth-usage"
import type { DB } from "@repo/db"
import * as schema from "@repo/db/schema/auth"
import { env } from "@repo/env/server"

/**
 * Build the better-auth instance for a given usage driver. The driver is
 * injected so the runtime decides: a Durable Object in the deployed Worker, an
 * in-memory driver under `bun` dev. Everything else is identical.
 */
export function makeAuth(driver: UsageDriver, db: DB) {
    return betterAuth({
        database: drizzleAdapter(db, { provider: "sqlite", schema }),
        trustedOrigins: [env.CORS_ORIGIN],
        emailAndPassword: { enabled: true },
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
        advanced: {
            defaultCookieAttributes: { sameSite: "none", secure: true, httpOnly: true },
        },
        plugins: [
            anonymous(),
            usage({
                features: {
                    "api-calls": { maxLimit: 1000, reset: "monthly", resetValue: 0 },
                    "storage": { maxLimit: 500, reset: "never", resetValue: 0 },
                    "credits": { maxLimit: 1000, minLimit: -500, reset: "never", resetValue: 0 },
                },
                overrides: {
                    "starter": { features: { "api-calls": { maxLimit: 1000 }, "storage": { maxLimit: 500 }, "credits": { maxLimit: 1000 } } },
                    "pro": { features: { "api-calls": { maxLimit: 100000 }, "storage": { maxLimit: 50000 }, "credits": { maxLimit: 100000 } } },
                },
                driver,
            }),
        ],
    })
}

export type Auth = ReturnType<typeof makeAuth>
