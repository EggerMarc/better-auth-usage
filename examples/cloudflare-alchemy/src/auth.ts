import { betterAuth } from "better-auth"
import { usage } from "@eggermarc/better-auth-usage"
import { durableObjectDriver } from "@eggermarc/better-auth-usage/cloudflare"
import type { Env } from "./env"

/**
 * Build the better-auth instance for a request. The usage plugin runs on the
 * Cloudflare-native Durable Object driver: one DO per `referenceId` holds the
 * atomic counter AND the realtime WebSocket connections — no Redis, no pub/sub.
 */
export function makeAuth(env: Env) {
    return betterAuth({
        baseURL: env.BASE_URL,
        secret: env.BETTER_AUTH_SECRET,
        emailAndPassword: { enabled: true },
        // database: <your D1 / Hyperdrive adapter here> — the durable source of truth
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
