import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
    if (process.env.NODE_ENV !== "production") {
        console.debug(`[REQ] ${request.method} ${request.nextUrl.pathname}`);
    }
    return NextResponse.next();
}

