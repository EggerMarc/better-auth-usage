import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { anonymous } from "better-auth/plugins"
import { usage } from "@eggermarc/better-auth-usage"
import type { UsageDriver, UsageOptions } from "@eggermarc/better-auth-usage"
import type { DB } from "@repo/db"
import * as schema from "@repo/db/schema/auth"
import { env } from "@repo/env/server"

/**
 * A fast key/value store for sessions (better-auth `secondaryStorage`). Back it
 * with Cloudflare KV / Redis so session validation reads from there instead of
 * the primary DB (D1) on every request — the dominant per-request cost. Optional:
 * omit it (bun dev, CLI) and sessions fall back to the primary DB.
 */
export interface SessionStore {
    get: (key: string) => Promise<string | null> | string | null
    set: (key: string, value: string, ttl?: number) => Promise<void> | void
    delete: (key: string) => Promise<void> | void
}

/**
 * Build the better-auth instance for a given usage driver. The driver is
 * injected so the runtime decides: a Durable Object in the deployed Worker, an
 * in-memory driver under `bun` dev. Everything else is identical.
 *
 * `secondaryStorage` (fast session store) is optional — pass a KV/Redis-backed
 * store in the Worker to keep session validation off the primary DB.
 *
 * `usageRuntime` passes platform hooks to the usage plugin: `background`
 * (the Worker's `waitUntil`) and `serverTiming`.
 */
export function makeAuth(
    driver: UsageDriver,
    db: DB,
    secondaryStorage?: SessionStore,
    usageRuntime?: Pick<UsageOptions, "background" | "serverTiming">,
) {
    return betterAuth({
        database: drizzleAdapter(db, { provider: "sqlite", schema }),
        secondaryStorage,
        // Cache the validated session so getSession doesn't hit the store on every
        // request: cookie cache covers browser callers; the secondary store keeps
        // bearer/API-key callers off the primary DB. Trade: revocation lags up to
        // maxAge (see SECURITY_TODO.md).
        session: {
            cookieCache: { enabled: true, maxAge: 60 * 5 },
        },
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
                ...usageRuntime,
            }),
        ],
    })
}

export type Auth = ReturnType<typeof makeAuth>
