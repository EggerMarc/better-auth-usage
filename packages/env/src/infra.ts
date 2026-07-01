import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Deploy-time secrets for alchemy.run.ts (from packages/infra/.env). The public
 * URLs (domains) are hardcoded in alchemy.run.ts; only the secrets live here.
 */
export const env = createEnv({
  server: {
    BETTER_AUTH_SECRET: z.string().min(1),
    ALCHEMY_PASSWORD: z.string().min(1),
    ALCHEMY_STATE_TOKEN: z.string().min(1),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
