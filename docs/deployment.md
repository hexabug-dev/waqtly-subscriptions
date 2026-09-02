# Waqtly Subscriptions — Deployment Architecture

## Live URLs

- **App (Railway):** `https://waqtly-subscriptions-production.up.railway.app`
- **Store:** `waqtly.myshopify.com`
- **Customer portal:** `waqtly.com/account` → Subscription tab

## Railway Project

**Project:** `poetic-friendship` / `production`  
**Region:** EU West (Amsterdam)  
**Services:**
- `waqtly-subscriptions` — Remix app (Dockerfile builder, auto-detected)
- `Postgres` — PostgreSQL (persistent volume, EU West)

## Deploying

```bash
# Backend
railway up   # select waqtly-subscriptions service

# Extension (Shopify CDN)
shopify app deploy
```

Start command (Dockerfile): `npm run docker-start`  
= `prisma generate && prisma db push && remix-serve ./build/server/index.js`

`prisma db push` runs on every container start — idempotent, creates `Session` table if missing.

## Session Storage

- **Provider:** PostgreSQL via `PrismaSessionStorage(prisma)` (`app/shopify.server.ts`)
- **Schema:** `prisma/schema.prisma` — `provider = "postgresql"`, `url = env("DATABASE_URL")`
- **Session type:** Offline (persists across deploys; tied to `waqtly.myshopify.com`)
- **Token refresh:** `expiringOfflineAccessTokens: true` — SDK auto-refreshes via stored `refreshToken`

**After any new deploy:** open the app from Shopify Admin (Admin → Apps → Waqtly Subscriptions) to ensure the offline session exists in Postgres. Required for `unauthenticated.admin()` to work in portal routes.

## Environment Variables

| Variable | Notes |
|---|---|
| `SHOPIFY_API_KEY` | `cfa6249b93adcd8462081b7d8400d5f2` |
| `SHOPIFY_API_SECRET` | App client secret |
| `SHOPIFY_APP_URL` | `https://waqtly-subscriptions-production.up.railway.app` |
| `SHOPIFY_STORE_DOMAIN` | `waqtly.myshopify.com` |
| `DATABASE_URL` | Auto-injected by Railway from Postgres service |
| `SCOPES` | See Partners Dashboard app settings |

## Customer Accounts UI Extension

**Extension:** `subscription-portal`  
**Target:** `customer-account.page.render`  
**API version:** `2026-07` (`extensions/subscription-portal/shopify.extension.toml`)  
**APP_URL:** hardcoded in `extensions/subscription-portal/src/index.jsx:5` — update and run `shopify app deploy` if host changes.

### Customer ID

```js
const token = await shopify.sessionToken.get();
const payload = JSON.parse(atob(token.split('.')[1]));
const customerId = payload.sub; // = "gid://shopify/Customer/{id}"
```

### Portal API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/portal/contracts` | GET | Fetch customer's subscription contracts |
| `/api/portal/action` | POST | Pause or resume a contract |

Both use `unauthenticated.admin(SHOP)` with the Prisma session store. Ownership verified server-side before any mutation.

### Known GraphQL Schema Issues (2025-10 API)

- `originOrder.totalPrice` is a scalar string — use `originOrder.totalPriceSet { shopMoney { amount currencyCode } }`
- `customerPaymentMethod.instrumentUpdateUrl` does not exist — removed
- `s-columns` / `s-column` do not render in `customer-account.page.render` — use `s-stack direction="inline"`

## Webhooks

All 9 are app-registered (Waqtly Subscriptions app), signed with the app client secret, pointing to `/webhooks/subscription-contracts`.

Handler: `app/routes/webhooks.subscription-contracts.tsx` — verifies HMAC, routes by topic, returns 200.

| Topic | Handler |
|---|---|
| `subscription_billing_attempts/failure` | Sends `customerPaymentMethodSendUpdateEmail` |
| `customer_payment_methods/revoke` | Sends `customerPaymentMethodSendUpdateEmail` |
| All others | Logs payload — handler pending |

| Topic | Shopify ID |
|---|---|
| SUBSCRIPTION_CONTRACTS_CREATE | gid://shopify/WebhookSubscription/1982786339139 |
| SUBSCRIPTION_CONTRACTS_UPDATE | gid://shopify/WebhookSubscription/1982786371907 |
| SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS | gid://shopify/WebhookSubscription/1982786404675 |
| SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE | gid://shopify/WebhookSubscription/1982786437443 |
| SUBSCRIPTION_BILLING_ATTEMPTS_CHALLENGED | gid://shopify/WebhookSubscription/1982786470211 |
| CUSTOMER_PAYMENT_METHODS_CREATE | gid://shopify/WebhookSubscription/1982861771075 |
| CUSTOMER_PAYMENT_METHODS_UPDATE | gid://shopify/WebhookSubscription/1982861803843 |
| CUSTOMER_PAYMENT_METHODS_REVOKE | gid://shopify/WebhookSubscription/1982861836611 |
| DISPUTES_CREATE | gid://shopify/WebhookSubscription/1982862033219 |

## Pending Work

- [ ] Webhook handler business logic per topic (CRM notification, entitlement update, dunning)
- [ ] Billing scheduler cron job — reads activation dates from CRM; charges `subscriptionBillingAttemptCreate` at month 7 from activation (not from purchase date), then monthly until paused/cancelled
- [ ] CRM integration — `/api/activate` called on `subscription_contracts/create` webhook to register device and record activation date; activation date is the reference point for all billing timing
- [x] Payment method update flow — portal button + webhook auto-trigger via `CustomerPaymentMethodSendUpdateEmail`
- [ ] `ApiVersion.January25` mismatch in `app/shopify.server.ts` — update to `October25`
- [ ] Dev store (`waqtly-dev.myshopify.com`) full testing
