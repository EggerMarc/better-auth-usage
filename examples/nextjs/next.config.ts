import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    turbopack: {
        root: "../../",
        resolveAlias: {
            "package/index": "../../dist/index.js",
            "package/client": "../../dist/client.js",
            "package/react": "../../dist/react.js",
        },
    },
};

export default nextConfig;
