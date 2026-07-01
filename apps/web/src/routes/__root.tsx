import { Outlet, createRootRoute } from "@tanstack/react-router"
import { Providers } from "../providers"
import "../index.css"

export const Route = createRootRoute({
    component: () => (
        <Providers>
            <Outlet />
        </Providers>
    ),
})
