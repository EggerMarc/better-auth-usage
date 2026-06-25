import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { usage } from "@eggermarc/better-auth-usage"
import { durableObjectDriver } from "@eggermarc/better-auth-usage/cloudflare"
import { createDb } from "@repo/db"
import { env } from "@repo/env/server"

/**
 * The better-auth config that powers the homepage example — a ~1:1 illustration
 * of how you'd wire the usage plugin on Cloudflare. The counter + realtime live
 * in a Durable Object (one per `referenceId`); D1 is the durable source of truth.
 */
export function createAuth() {
    const db = createDb()

    return betterAuth({
        database: drizzleAdapter(db, { provider: "sqlite" }),
        trustedOrigins: [env.CORS_ORIGIN],
        emailAndPassword: { enabled: true },
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
        advanced: {
            defaultCookieAttributes: { sameSite: "none", secure: true, httpOnly: true },
        },
        plugins: [
            usage({
                features: {
                    "api-calls": { maxLimit: 1000, reset: "monthly", resetValue: 0 },
                    "credits": { reset: "never", resetValue: 0 },
                },
                driver: durableObjectDriver({ namespace: env.USAGE_DO }),
            }),
        ],
    })
}

export type Auth = ReturnType<typeof createAuth>
