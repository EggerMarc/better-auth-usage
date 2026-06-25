import { defineConfig } from "tsup";

export default defineConfig(({ watch = false }) => ({
    clean: true,
    dts: true,
    entry: {
        index: "package/index.ts",
        client: "package/client.ts",
        react: "package/client/react.tsx",
        drivers: "package/drivers/index.ts",
    },
    format: "esm",
    splitting: false,
    watch,
    minify: !watch,
    loader: { '.lua': 'text' }
}));
