import { env } from "@repo/env/server"
import { defineConfig } from "drizzle-kit"

export default defineConfig({
    schema: "./src/schema",
    out: "./src/migrations",
    dialect: "sqlite",
    dbCredentials: { url: env.DATABASE_URL },
})
