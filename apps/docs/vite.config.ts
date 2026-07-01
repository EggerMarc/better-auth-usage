import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import alchemy from "alchemy/cloudflare/tanstack-start";
import { defineConfig, type PluginOption } from "vite";

// TanStack Start + fumadocs. The alchemy() plugin shapes the Cloudflare Worker
// build output; deployment itself is defined in packages/infra/alchemy.run.ts
// (the TanStackStart resource) — the app carries no deploy scripts, same as web.
export default defineConfig({
  server: {
    port: 4000,
  },
  plugins: [
    mdx(),
    tailwindcss(),
    alchemy() as PluginOption,
    tanstackStart({
      prerender: {
        enabled: true,
      },
    }),
    react(),
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: "tslib/tslib.es6.js",
    },
  },
});
