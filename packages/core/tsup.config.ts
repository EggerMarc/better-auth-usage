import { defineConfig } from "tsup";

export default defineConfig(({ watch = false }) => ({
    clean: true,
    dts: true,
    entry: {
        index: "src/index.ts",
        client: "src/client.ts",
        react: "src/client/react.tsx",
        drivers: "src/drivers/index.ts",
        "drivers/memory": "src/drivers/memory.ts",
        cloudflare: "src/drivers/cloudflare/index.ts",
    },
    format: "esm",
    splitting: false,
    watch,
    minify: !watch
}));
