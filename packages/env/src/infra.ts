import "dotenv/config"
import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

/**
 * Build-time env for deployment (alchemy.run.ts). Loaded from
 * `packages/infra/.env` (alchemy runs with that cwd) and validated with t3-env.
 */
export const env = createEnv({
    server: {
        DATABASE_URL: z.string().min(1),
        CORS_ORIGIN: z.string().url(),
        BETTER_AUTH_URL: z.string().url(),
        BETTER_AUTH_SECRET: z.string().min(1),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
})
