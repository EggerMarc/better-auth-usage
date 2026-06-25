import { defineConfig } from "drizzle-kit"

export default defineConfig({
    schema: "./src/schema",
    out: "./src/migrations",
    dialect: "sqlite",
    // D1 over HTTP: https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit
    driver: "d1-http",
})
