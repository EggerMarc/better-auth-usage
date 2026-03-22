# @eggermarc/better-auth-usage

**Warning!** This package is a **work in progress**! Expect breaking changes and functionality changes.

Feature and usage-based authorization plugin for [BetterAuth](https://www.better-auth.com/). Provides a way to define **features**, **track usage**, apply **per-plan limits**, and integrate with external systems (Stripe, custom hooks, etc).

## Roadmap
Below are the action items to fix known limitations of this plugin. Namely, customer management and consumption idempotency.
- [x] Customer table
- [x] Consumption adapter as transaction
- [x] Redis caching with Lua-based atomic increments
- [x] Real-time WebSocket updates (optional)
- [x] Integration test suite (DB-only + cached)
- [ ] Customer provider (Optional - considering leaving this to dev)
    - [ ] `useCustomer(referenceId)`
- [ ] Per-customer feature limits (`featureLimits`)


## Features

- Define features with maxLimit, minLimit, reset strategies, and metadata.
- Apply plan-specific overrides (e.g. different limits per plan).
- Hook into usage events (before and after).
- Add custom authorization logic with authorizeReference.
- Optional Redis caching with atomic Lua-based increments.
- Optional real-time usage tracking via WebSocket (Socket.IO).

### Installation
```bash
npm add @eggermarc/better-auth-usage
```

### Usage
#### Server
```typescript
import { betterAuth } from "better-auth";
import { usage } from "@eggermarc/better-auth-usage";

export const auth = betterAuth({
    plugins: [usage({
        features: {
            "token-feature": {
                key: "token-feature",
                maxLimit: 1000,
                reset: "monthly",
                resetValue: 0,
                details: ["Number of tokens per month"],
            }
        },
        overrides: {
            "starter-plan": {
                features: {
                    "token-feature": {
                        maxLimit: 10_000,
                        stripeId: "price_xxx", // Can declare extra fields
                        hooks: {
                            after: async ({ usage, customer, feature }) => {
                                console.log(
                                    `[AFTER HOOK] ${customer.referenceId} used ${usage.amount} of ${feature.key}`
                                );
                            },
                        },
                    },
                },
            },
            "pro-plan": {
                features: {
                    "token-feature": {
                        maxLimit: 1_000_000,
                    },
                },
            },
        },
        // Optional: enable Redis caching
        // cacheOptions: {
        //     redisUrl: process.env.REDIS_URL!,
        //     enableRealtime: true,  // optional WebSocket support
        //     port: 3001,            // required if enableRealtime is true
        // },
    })]
})
```

#### Client
```ts
import { createAuthClient } from "better-auth/client";
import { usageClient } from "@eggermarc/better-auth-usage/client";

export const client = createAuthClient({
  plugins: [usageClient()],
});
```

### Customer Registration

**Important:** A customer must be registered before consuming usage. The consume endpoint requires the customer to exist.

```ts
// Register a customer first
await client.usage.upsertCustomer({
  referenceId: "123",
  referenceType: "user",
  name: "John Doe",
  email: "john@example.com",
});

// Then consume usage
await client.usage.consume({
  featureKey: "token-feature",
  overrideKey: "starter-plan",
  referenceId: "123",
  amount: 1,
});

// Check current usage and limits
const status = await client.usage.check({
  featureKey: "token-feature",
  referenceId: "123",
});
// => { status: "in-limit", currentAmount: 1, maxLimit: 1000, minLimit: undefined }
```

### Goals
Why customer registration and not per user / organization query?
- Generalizing customer management is not straight forward. Our goal was to not make many assumptions on the origin of the customer to let this plugin be usable for non typical use cases, like users and organizations. By giving customer registration to the dev, we allow multiple scenarios to arise, for instance **per-session** or **per-ip** limitations. We also open the door to **team** based usage.


#### Examples
##### Team based
```ts
const customer = {
    referenceId: teamId,
    referenceType: "team",
    email: session.user.email,
    name: `${session.user.name}@${teamName}`,
}

await client.usage.upsertCustomer(customer)

await client.usage.consume({
    featureKey: "token-feature",
    overrideKey: "team-plan",
    referenceId: teamId,
    amount: 1,
})
```
##### Session based / IP based
```ts
const referenceId = session.session.ipAddress ?? session.session.id;

await client.usage.upsertCustomer({
    referenceId,
    referenceType: "session",
})

await client.usage.consume({
    featureKey: "token-feature",
    referenceId,
    amount: 1,
})
```

### API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/usage/features` | GET | none | List all registered features |
| `/usage/features/{featureKey}` | GET | none | Get a single feature config (with optional override) |
| `/usage/consume` | POST | session | Consume/increment usage for a feature |
| `/usage/check` | POST | session | Check current usage vs limits (with optional preview amount) |
| `/usage/check-customer` | POST | session | Get customer details by referenceId |
| `/usage/upsert-customer` | POST | session | Create or update a customer |
| `/usage/sync` | POST | none | Manually trigger reset if due |

### Override Structure

Overrides require a nested `features` key:

```ts
overrides: {
    "plan-name": {
        features: {                    // <-- required
            "feature-key": {
                maxLimit: 10_000,      // overrides the base feature's maxLimit
                // any Feature field except `key` can be overridden
            },
        },
    },
}
```

The `overrideKey` is passed per-request to `consume`, `check`, or `sync` endpoints to apply the override for that specific call.

### Reset Strategies

Features can specify a `reset` interval to automatically zero out usage:

| Reset | Boundary |
|-------|----------|
| `"hourly"` | Start of next hour |
| `"6-hourly"` | Next 6-hour block (00:00, 06:00, 12:00, 18:00) |
| `"daily"` | Tomorrow at 00:00 |
| `"weekly"` | Next Monday at 00:00 |
| `"monthly"` | 1st of next month at 00:00 |
| `"quarterly"` | 1st of next quarter at 00:00 |
| `"yearly"` | January 1st of next year at 00:00 |
| `"never"` | Never resets |
