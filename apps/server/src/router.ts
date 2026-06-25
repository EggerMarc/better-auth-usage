import { os } from "@orpc/server"

/**
 * oRPC router — typed routes the web app calls. Kept tiny for the example;
 * add procedures here. `health` doubles as a liveness check.
 */
export const router = {
    health: os.handler(async () => ({ ok: true })),
}

export type Router = typeof router
