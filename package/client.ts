import type { usage } from "./index.ts";
import type { BetterAuthClientPlugin } from "better-auth/types";

export const usageClient = () => {
    return {
        id: "@eggermarc/usage-client",
        $InferServerPlugin: {} as ReturnType<typeof usage>,
        pathMethods: {
            "/usage/feature": "GET",
            "/usage/register-customer": "POST",
            "/usage/consume": "POST",
            "/usage/check": "GET",
            "/usage/sync": "POST",
        },
    } satisfies BetterAuthClientPlugin;
};
