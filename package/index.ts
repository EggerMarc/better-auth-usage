import { BetterAuthPlugin } from "better-auth";
import { UsageOptions } from "./types";

export function usage<O extends UsageOptions>(options: O) {
    const { customers, features, overrides } = options
    return {
        id: "usage"
    } satisfies BetterAuthPlugin;
}
