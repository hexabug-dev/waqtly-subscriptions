# Waqtly Subscriptions App

Shopify embedded app managing subscription selling plans, contracts, webhooks, and billing for Waqtly devices.

**Live store:** `bpb1ru-85.myshopify.com` (admin: `admin.shopify.com/store/waqtly`)  
**App URL:** `https://waqtly-subscriptions-production.up.railway.app`  
**GitHub:** `https://github.com/hexabug-dev/waqtly-subscriptions`  
**Stack:** Remix + `@shopify/shopify-app-remix` v4.1.0, Polaris 12, Railway, PostgreSQL (Prisma)

---

## Navigation

The app has six pages in the Shopify admin sidebar under **Waqtly Subscriptions**:

| Nav label | Route | Purpose |
|---|---|---|
| Selling Plans | `/app/selling-plans` | View and create selling plan groups |
| Contracts | `/app/contracts` | View all subscription contracts |
| Webhooks | `/app/webhooks` | Manage webhook registrations |
| Billing | `/app/billing` | Billing scheduler status and manual trigger |
| GraphiQL | `/app/graphiql` | In-app GraphQL explorer (app-scoped token) |

---

## Subscription Model

### Products
- **Waqtly Plus** — 13.5 inch tablet (`gid://shopify/Product/14693478891843`)
- **Waqtly Nano** — 10.1 inch tablet (`gid://shopify/Product/14696508358979`)

### Selling Plan Groups
Two plan groups, one per product, both owned by this app:

| Group | Merchant code | Product |
|---|---|---|
| Subscribe (Plus) - Entry | `subscribe-plus-entry` | Waqtly Plus |
| Subscribe (Nano) - Entry | `subscribe-nano-entry` | Waqtly Nano |

### Pricing
| Stage | Plus | Nano |
|---|---|---|
| Entry (charged at checkout, cycle 1) | EUR 139.00 | EUR 99.00 |
| Recurring (month 7+ from activation) | EUR 7.99/month | EUR 7.99/month |

### Billing lifecycle
1. Customer orders → entry price charged at checkout → `SubscriptionContract` created (ACTIVE)
2. Customer activates device (enters welcome code) → CRM calls `/api/activate` → 6-month free period starts
3. Month 7 from activation → billing scheduler fires `subscriptionBillingAttemptCreate`
4. Every month after → recurring EUR 7.99 per device

### Contract structure
Shopify creates **one contract per order** regardless of how many subscription items are in the order. Multiple products appear as separate lines within the same contract. Both Nano and Plus ordered together → single contract ID with two lines.

---

## App Routes

### Admin pages (`app/routes/app.*.tsx`)

#### `app.selling-plans.tsx`
- **Loader:** Queries `sellingPlanGroups(first: 20)` — app-scoped, only returns groups created by this app
- **Action (`intent: fix-ownership`):** Deletes old groups, re-creates both Plus and Nano under this app's OAuth token
- **Display:** Table with Name, Merchant code, Billing interval, Category, Status ("App owned" badge)
- **Note:** `sellingPlanGroups` query is app-scoped — GraphiQL App always returns empty, this app returns both

#### `app.contracts.tsx`
- **Loader:** Queries `subscriptionContracts(first: 50)` with customer email, all lines (up to 10), billing policy, next billing date
- **Display:** Stat cards (Total / Active / Paused), table showing all lines stacked per contract row
- **Note:** `subscriptionContracts` uses `read_own_subscription_contracts` scope — also app-scoped

#### `app.webhooks.tsx`
- **Loader:** Queries `webhookSubscriptions(first: 25)` — returns API-registered webhooks only (not partner-managed)
- **Action `delete`:** Deletes a webhook by ID via `webhookSubscriptionDelete` mutation
- **Action `register-missing`:** Creates missing topics via `webhookSubscriptionCreate` mutation
- **Display:** Table with Topic, Callback URL, Format, Created date, App/External badge, Delete button
- **Note:** Partner-managed webhooks (from `shopify.app.toml` via `shopify app deploy`) do NOT appear in this query

#### `app.billing.tsx`
- **Loader:** Queries all active contracts, computes billing state per contract
- **Action:** Calls `/api/billing/run` internally using `BILLING_SCHEDULER_SECRET`
- **Display:** 4 stat cards (Total / Due now / Free period / Pending activation), contract billing state table, manual run button, cron command snippet
- **Billing states:** `pending-activation` | `in-free-period` | `due` | `upcoming`

#### `app.graphiql.tsx`
- **Loader:** Auth only
- **Action:** Runs any GraphQL query/mutation via `admin.graphql()` (app OAuth token) with optional JSON variables
- **Display:** Dark code editor (query + variables), Run button with timing, JSON result panel with Copy button
- **Presets:** Contracts, Selling Plans, Webhooks, Recent Orders, Billing Attempts, Delete Webhook, Cancel Contract, Pause Contract, Resume Contract

---

### API endpoints (`app/routes/api.*.tsx`)

All API endpoints require `Authorization: Bearer $BILLING_SCHEDULER_SECRET`.

#### `POST /api/billing/run`
Runs the billing scheduler. For each ACTIVE contract:
1. Skip if `nextBillingDate` is not yet due
2. Skip if no activation date recorded (device not activated)
3. Skip if within 6-month free period
4. Fire `subscriptionBillingAttemptCreate`
5. Advance `nextBillingDate` +1 month via draft workflow (`subscriptionContractUpdate` → `subscriptionDraftUpdate` → `subscriptionDraftCommit`)

Returns `{ summary, attempted[], skipped[], errors[] }`.

**TODO:** Activation date lookup currently hardcoded to `null` — needs CRM DB integration.

#### `POST /api/activate`
Called by CRM/backend when a device welcome code is activated.

Request body:
```json
{
  "contractId": "gid://shopify/SubscriptionContract/xxx",
  "activationDate": "2026-09-01T00:00:00Z"
}
```

Actions:
1. Sets `waqtly.activation_date` metafield on the contract
2. Updates `nextBillingDate` to `activationDate + 6 months` via draft workflow

Returns `{ contractId, activationDate, firstBillingDate }`.

---

### Webhook handler (`app/routes/webhooks.subscription-contracts.tsx`)

**`POST /webhooks/subscription-contracts`**

Receives all subscription webhook events. Uses manual HMAC validation (bypasses `authenticate.webhook` framework method which had unresolved validation failures).

Logs: `[webhook] <TOPIC> for <shop> <payload_first_500_chars>`

Configured topics (in `shopify.app.toml` as partner-managed + API-registered via Webhooks page):
- `subscription_contracts/create`
- `subscription_contracts/update`
- `subscription_billing_attempts/success`
- `subscription_billing_attempts/failure`
- `subscription_billing_attempts/challenged`

---

## Webhook Architecture

Two layers of webhook registration exist simultaneously:

| Type | How registered | Visible in `webhookSubscriptions` query | Delivery target |
|---|---|---|---|
| Partner-managed | `shopify app deploy` / `shopify.app.toml` | No | Railway app URL |
| API-registered | "Register Missing" button in Webhooks page | Yes | Railway app URL |

Both deliver to the same Railway endpoint. Partner Dashboard monitoring (`Logs` tab) shows partner-managed delivery statistics only.

**Old webhook.site registrations** (from GraphiQL App, pre-migration) still deliver to webhook.site for some topics. Delete via Webhooks page or GraphiQL `webhookSubscriptionDelete` mutation.

---

## Environment Variables (Railway)

| Variable | Required | Description |
|---|---|---|
| `SHOPIFY_API_KEY` | Yes | App client ID (`cfa6249b93adcd8462081b7d8400d5f2`) |
| `SHOPIFY_API_SECRET` | Yes | App client secret |
| `SHOPIFY_APP_URL` | Yes | `https://waqtly-subscriptions-production.up.railway.app` |
| `SCOPES` | Yes | Comma-separated OAuth scopes |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `BILLING_SCHEDULER_SECRET` | Yes | Strong random string — set on Railway; used as bearer token for `/api/billing/run` and `/api/activate` |
| `SHOPIFY_STORE_DOMAIN` | Yes | `bpb1ru-85.myshopify.com` |

---

## Shopify App Config (`shopify.app.toml`)

- **Client ID:** `cfa6249b93adcd8462081b7d8400d5f2`
- **API version:** `2025-10`
- **Embedded:** Yes

Key scopes: `read_purchase_options`, `write_purchase_options`, `read_own_subscription_contracts`, `write_own_subscription_contracts`, `read_orders`, `write_orders`, `read_customers`, `write_customers`

---

## Deployment

```bash
# Deploy app to Railway
railway up --service waqtly-subscriptions --detach

# Deploy partner-managed webhooks + extensions to Shopify
shopify app deploy

# View logs
railway logs --service waqtly-subscriptions
```

---

## Billing Scheduler Cron

Set up a daily cron at 08:00 UTC (cron-job.org or Railway Cron service):

```bash
curl -X POST https://waqtly-subscriptions-production.up.railway.app/api/billing/run \
  -H "Authorization: Bearer $BILLING_SCHEDULER_SECRET"
```

---

## Known Issues / Pending

| Item | Status | Notes |
|---|---|---|
| Activation date storage | Pending | `api.billing.run` hardcoded to null; needs CRM DB table or Shopify metafield lookup once `SubscriptionContract.metafield` API support is confirmed |
| `DISPUTES_CREATE` webhook | Pending | Requires Shopify Payments account verification (payouts paused) |
| Pause/resume backend | Not started | `POST hooks.waqtly.com/subscriptions/pause` → `subscriptionContractUpdate(status: PAUSED)` |
| Billing scheduler (month 7 trigger) | Scaffolded | Endpoint built, needs activation date integration |
| Customer portal pause/resume | DEV_MOCK | `extensions/subscription-portal/src/index.jsx` has `DEV_MOCK` flag — remove when backend is live |
| `orders/cancelled` → cancel contract | Not built | Cancelling an order does NOT auto-cancel the Shopify contract; needs `orders/cancelled` webhook + `subscriptionContractUpdate(CANCELLED)` handler |
| Dev store (`waqtly-dev.myshopify.com`) | Not configured | Needs correct product IDs in `PLAN_CONFIG` |
| `read_customer_payment_methods` scope | Done | Added to `shopify.app.toml` scopes — enables payment method queries and `customer_payment_methods/*` webhooks |
| `apiVersion` in `shopify.server.ts` | Mismatch | Set to `ApiVersion.January25` (2025-01) but toml uses `2025-10` — update to `ApiVersion.October25` |
