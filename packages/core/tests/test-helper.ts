import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { createAuthClient } from "better-auth/client";
import { usage } from "../src/index";
import type { UsageOptions } from "../src/types";

import { resetRuntime } from "../src/runtime";

export async function shutdownUsage() {
    resetRuntime();
}

/**
 * Default feature config used across tests.
 */
export const defaultFeatures: UsageOptions["features"] = {
    "api-calls": {
        maxLimit: 100,
        minLimit: 0,
        reset: "monthly",
        resetValue: 0,
    },
    "credits": {
        maxLimit: 1000,
        minLimit: -500,
        reset: "never",
        resetValue: 0,
    },
};

export const defaultOverrides: UsageOptions["overrides"] = {
    "pro-plan": {
        features: {
            "api-calls": { maxLimit: 10000 },
            "credits": { maxLimit: 50000 },
        },
    },
    "free-plan": {
        features: {
            "api-calls": { maxLimit: 10 },
        },
    },
};

/**
 * Creates a fresh in-memory BetterAuth test instance with the usage plugin.
 * Uses bun:sqlite in-memory (BetterAuth's default when no database is specified).
 */
export async function createTestInstance(opts?: {
    features?: UsageOptions["features"];
    overrides?: UsageOptions["overrides"];
}) {
    const features = opts?.features ?? defaultFeatures;
    const overrides = opts?.overrides ?? defaultOverrides;

    const auth = betterAuth({
        baseURL: "http://localhost:3000",
        secret: "test-secret-at-least-32-chars-long!!",
        emailAndPassword: { enabled: true },
        rateLimit: { enabled: false },
        advanced: {
            disableCSRFCheck: true,
        },
        plugins: [
            bearer(),
            usage({ features, overrides }),
        ],
    });

    const customFetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
        return auth.handler(new Request(url, init));
    };

    const client = createAuthClient({
        baseURL: "http://localhost:3000/api/auth",
        fetchOptions: {
            customFetchImpl,
        },
    });

    // Create a test user
    const testUser = {
        email: "test@test.com",
        password: "test123456",
        name: "Test User",
    };

    await auth.api.signUpEmail({
        body: testUser,
    });

    return { auth, client, testUser };
}

type TestInstance = Awaited<ReturnType<typeof createTestInstance>>;

/**
 * Signs in with the default test user and returns session headers (cookie-based).
 */
export async function signInWithTestUser(instance: TestInstance) {
    const headers = new Headers();

    await instance.client.signIn.email({
        email: instance.testUser.email,
        password: instance.testUser.password,
        fetchOptions: {
            onSuccess(context: any) {
                const header = context.response.headers.get("set-cookie");
                if (header) {
                    // Parse set-cookie header to get session token
                    const match = header.match(/better-auth\.session_token=([^;]+)/);
                    if (match) {
                        headers.set("cookie", `better-auth.session_token=${match[1]}`);
                    }
                }
            },
        },
    });

    return { headers };
}

/**
 * Creates a customer via the upsert-customer endpoint.
 * Must be called before consuming usage for a referenceId.
 */
export async function createCustomer(
    instance: TestInstance,
    headers: Headers,
    referenceId: string,
    referenceType: string = "user",
) {
    const res = await instance.client.$fetch("/usage/upsert-customer", {
        method: "POST",
        body: { referenceId, referenceType },
        headers,
    });
    return res;
}
