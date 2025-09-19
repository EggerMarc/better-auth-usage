# @eggermarc/better-auth-usage

Feature and usage-based authorization plugin for [BetterAuth](https://www.better-auth.com/). Provides a way to define **features**, **track usage**, apply **per-plan limits**, and integrate with external systems (Stripe, custom hooks, etc).

## Features

- Define features with maxLimit, minLimit, reset strategies, and metadata.
- Apply customer-specific overrides (e.g. different limits per customer).
- Hook into usage events (before and after).
- Add custom authorization logic with authorizeReference.

### Installation
```bash
pnpm add @eggermarc/better-auth-usage
```

### Usage
#### Server
```ts
export const auth = betterAuth({
    plugins: [usage({
        features: {
            "token-feature": {
                key: "token-feature",
                maxLimit: 1000,
                reset: "monthly",
                details: ["Number of tokens per month"],
            }
        },
        overrides: {
            "starter-plan": {
                "token-feature":{ 
                    maxLimit: 10_000,
                    hooks: {
                    after: async ({ usage, customer, feature }) => {
                        console.log(
                        `[AFTER HOOK] ${customer.referenceId} used ${usage.amount} of ${feature.key}`
                        );
                    },
                    stripeId: env.TOKEN_STARTER_ID // Can declare new fields
                },
            },
            "pro-plan": {
                "token-features": {
                    maxLimit: 1_000_000,
                    hooks: {
                        after: async ({ usage, customer, feature }) => {
                            console.log(
                            `[AFTER HOOK] ${customer.referenceId} used ${usage.amount} of ${feature.key}`
                            );
                        },
                    },
                }
            },
        }
    })]
})
```
#### Client
```ts
// client.ts
import { createAuthClient } from "better-auth/client";
import { adminClient } from "@eggermarc/better-auth-usage/client";

export const client = createAuthClient({
  plugins: [adminClient()],
});

// Example: consume usage
await client.usage.consume({
  featureKey: "token-feature",
  overrideKey: "starter-plan",
  referenceId: "123",
  amount: 1,
});
```
#### Customer Registration
```ts
import type { Customer } from "@eggermarc/better-auth-usage";

const customer: Customer = {
  referenceId: "456",
  referenceType: "organization",
  email: "test@example.com",
  name: "Test User",
};

await client.usage.registerCustomer(customer)

```

