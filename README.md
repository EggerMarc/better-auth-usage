# @eggermarc/better-auth-usage

**⚠️ Warning!** This package is a **work in progress**! Expect breaking changes and functionality changes.

Feature and usage-based authorization plugin for [BetterAuth](https://www.better-auth.com/). Provides a way to define **features**, **track usage**, apply **per-plan limits**, and integrate with external systems (Stripe, custom hooks, etc).

## Features

- Define features with maxLimit, minLimit, reset strategies, and metadata.
- Apply customer-specific overrides (e.g. different limits per customer).
- Hook into usage events (before and after).
- Add custom authorization logic with authorizeReference.

### Installation
```bash
npm add @eggermarc/better-auth-usage
```

### Usage
#### Server
```typescript
// server
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
import { usageClient } from "@eggermarc/better-auth-usage/client";

export const client = createAuthClient({
  plugins: [usageClient()],
});

// Example: consume usage, in your app
await client.usage.consume({
  featureKey: "token-feature",
  overrideKey: "starter-plan",
  referenceId: "123",
  amount: 1,
});
```
#### Customer Registration
```ts
// in your app
import type { Customer } from "@eggermarc/better-auth-usage";

const customer: Customer = {
  referenceId: "456",
  referenceType: "organization",
  email: "test@example.com",
  name: "Test User",
};

await client.usage.registerCustomer(customer)
```

### Goals
Why customer registration and not per user / organization query?
- Generalizing customer management is not straight forward. Our goal was to not make many assumptions on the origin of the customer to let this plugin be usable for non typical use cases, like users and organizations. By giving customer registration to the dev, we allow multiple scenarios to arise, for instance **per-session** or **per-ip** limitations. We also open the door to **team** based usage.


#### Examples
##### Team based
```ts
const teamLimits = getTeamLimits(teamId, "token-feature") 

const customer: Customer = {
    referenceId: teamId, // Team ID,
    referenceType: "team",
    email: session.user.email, // User in team email
    name: `${session.user.name}@${teamName}`,
    // WIP featureLimits: new Record("token-feature", teamLimits)
}

await client.usage.registerCustomer(customer)

await client.usage.consume({
    featureKey: "token-feature",
    overrideKey: "team-plan",
    referenceId: teamId,
    amount: 1,
})
```
##### Session based / IP based
```ts
const customer: Customer = {
    referenceId: session.session.ipAddress ?? session.session.id,
    referenceType: "session",
}

await client.usage.registerCustomer(customer)


await client.usage.consume({
    featureKey: "token-feature",
    referenceId: session.session.id,
    amount: 1
})
```

In this current version, we apply to all customers the root limits, then overrides, and finally with customer specific overrides. 
