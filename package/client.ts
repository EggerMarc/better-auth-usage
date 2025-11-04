import type { usage } from "./index.ts";
import type { BetterAuthClientPlugin } from "better-auth/types";

export const usageClient = () => {
    return {
        id: "usage",
        $InferServerPlugin: {} as ReturnType<typeof usage>,
        pathMethods: {
            "/usage/features": "GET",
            "/usage/features/:featureKey": "GET",
            "/usage/upsert-customer": "POST",
            "/usage/consume": "POST",
            "/usage/check": "POST",
            "/usage/sync": "POST",
            "/usage/check-customer": "POST"
        },
    } as BetterAuthClientPlugin;
};
