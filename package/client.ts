import type { usage } from "./index";
import type { BetterAuthClientPlugin } from "better-auth/types";

export const adminClient = () => {
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
