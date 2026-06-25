import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

/**
 * Client env for the web app (Vite). `VITE_SERVER_URL` points at the Worker
 * that hosts better-auth + the usage plugin.
 */
export const env = createEnv({
    clientPrefix: "VITE_",
    client: {
        VITE_SERVER_URL: z.string().url(),
    },
    runtimeEnv: (import.meta as any).env,
    emptyStringAsUndefined: true,
    skipValidation: !!(import.meta as any).env?.SKIP_ENV_VALIDATION,
})
