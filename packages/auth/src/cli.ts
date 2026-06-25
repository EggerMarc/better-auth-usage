import { makeAuth } from "./index"
import { memoryDriver } from "@repo/core/drivers/memory"

// Node-loadable auth instance for the better-auth CLI (`generate`/`migrate`).
// Uses the in-memory driver so there's no cloudflare:workers dependency.
export const auth = makeAuth(memoryDriver())
