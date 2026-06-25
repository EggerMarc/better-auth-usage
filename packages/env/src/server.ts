import "dotenv/config"
import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

// String config via process.env (populated on Workers via nodejs_compat).
// Object bindings (DB, USAGE_DO) are NOT here — read those from
// `cloudflare:workers` where needed.
export const env = createEnv({
    server: {
        DATABASE_URL: z.string().min(1),
        CORS_ORIGIN: z.url(),
        BETTER_AUTH_URL: z.url(),
        BETTER_AUTH_SECRET: z.string().min(1),
        NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
    // Skip when server env is unavailable (e.g. web/native builds).
    skipValidation: !process.env.DATABASE_URL,
})
