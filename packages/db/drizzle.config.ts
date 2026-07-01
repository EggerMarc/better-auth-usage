import { defineConfig } from "drizzle-kit"

// Generates SQL migrations into ./src/migrations; apply to D1 with
// `wrangler d1 migrations apply` (local or remote).
export default defineConfig({
    schema: "./src/schema",
    out: "./src/migrations",
    dialect: "sqlite",
})
