import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
    turbopack: {
        resolveAlias: {
            "package/index": path.resolve(__dirname, "../../dist/index.js"),
            "package/client": path.resolve(__dirname, "../../dist/client.js"),
            "package/react": path.resolve(__dirname, "../../dist/react.js"),
        },
    },
};

export default nextConfig;
