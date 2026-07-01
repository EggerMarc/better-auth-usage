import alchemy from "alchemy";
import {
  Worker,
  Vite,
  TanStackStart,
  D1Database,
  DurableObjectNamespace,
} from "alchemy/cloudflare";
import { env } from "@repo/env/infra";
import { CloudflareStateStore } from "alchemy/state";
import { config } from "dotenv";

config({ path: "./.env" });

const app = await alchemy("better-auth-usage", {
  password: env.ALCHEMY_PASSWORD,
  stateStore: (scope) =>
    new CloudflareStateStore(scope, {
      stateToken: alchemy.secret(env.ALCHEMY_STATE_TOKEN),
      forceUpdate: true,
    }),
});

export const web = await Vite("web", {
  name: "better-auth-usage-web",
  adopt: true,
  cwd: "../../apps/web",
  assets: "dist",
  domains: ["better-auth-usage.com"],
  bindings: {
    VITE_SERVER_URL: "https://api.better-auth-usage.com",
  },
});

export const docs = await TanStackStart("docs", {
  name: "better-auth-usage-docs",
  adopt: true,
  cwd: "../../apps/docs",
  domains: ["docs.better-auth-usage.com"],
});

const db = await D1Database("database", {
  migrationsDir: "../../packages/db/src/migrations",
  adopt: true,
});

const usageDO = DurableObjectNamespace("usage", {
  className: "UsageDurableObject",
  sqlite: true,
});

export const server = await Worker("server", {
  name: "better-auth-usage-api",
  cwd: "../../apps/server",
  adopt: true,
  entrypoint: "src/index.ts",
  compatibilityDate: "2025-06-01",
  compatibilityFlags: ["nodejs_compat", "nodejs_compat_populate_process_env"],
  domains: ["api.better-auth-usage.com"],
  bindings: {
    DB: db,
    USAGE_DO: usageDO,
    BETTER_AUTH_SECRET: alchemy.secret(env.BETTER_AUTH_SECRET),
    BETTER_AUTH_URL: "https://api.better-auth-usage.com",
    CORS_ORIGIN: "https://better-auth-usage.com",
    NODE_ENV: "production",
  },
});
console.log(`API  -> ${server.url}`);
console.log(`Web  -> ${web.url}`);
console.log(`Docs -> ${docs.url}`);

await app.finalize();
