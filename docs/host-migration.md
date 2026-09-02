# Waqtly Subscriptions — Host Migration Guide (Railway → New Host)

Moving the Remix backend from Railway to any other host (Render, Fly.io, VPS, etc.).

---

## What lives where

| Asset | Location | Moves with host? |
|---|---|---|
| Remix backend | Railway (Docker) | Yes — redeploy to new host |
| PostgreSQL (sessions) | Railway Postgres service | Yes — export and import |
| Shopify extension | Shopify CDN (via `shopify app deploy`) | No — but `APP_URL` in source must be updated |
| Webhooks | Registered on waqtly.myshopify.com | No — must re-register with new URL |
| Partners Dashboard app config | dev.shopify.com | URL fields must be updated |

---

## Pre-migration checklist

- [ ] New host provisioned
- [ ] New PostgreSQL database provisioned
- [ ] New host URL known
- [ ] Docker supported on new host, OR Nixpacks/Buildpack support

---

## Step 1 — Export Railway PostgreSQL

Get the connection string from Railway dashboard → Postgres → Connect tab.

```bash
pg_dump "<railway-postgres-connection-string>" > waqtly_sessions_backup.sql
```

The only table that matters is `Session`. `prisma db push` recreates the schema on the new host automatically, so you can skip the import and just let users re-authenticate once if preferred.

---

## Step 2 — Import to new PostgreSQL

```bash
psql "<new-postgres-connection-string>" < waqtly_sessions_backup.sql
```

---

## Step 3 — Set environment variables on new host

| Variable | Value |
|---|---|
| `SHOPIFY_API_KEY` | `cfa6249b93adcd8462081b7d8400d5f2` |
| `SHOPIFY_API_SECRET` | App client secret |
| `SHOPIFY_APP_URL` | **New host URL** |
| `SCOPES` | Copy from Railway or Partners Dashboard |
| `DATABASE_URL` | New PostgreSQL connection string |
| `SHOPIFY_STORE_DOMAIN` | `waqtly.myshopify.com` |
| `PORT` | Port the new host expects (app uses `process.env.PORT || 3000`) |

---

## Step 4 — Deploy app to new host

The app uses a Dockerfile with start command:
```
npm run docker-start
= prisma generate && prisma db push && remix-serve ./build/server/index.js
```

If the new host doesn't support Docker, remove the `Dockerfile` and use Nixpacks auto-detection. Add a `Procfile`:
```
web: npm run docker-start
```

---

## Step 5 — Update Partners Dashboard app URL

1. Go to `https://dev.shopify.com/dashboard/233207903/apps/416841826305/settings`
2. Update **App URL** to the new host URL
3. Update **Allowed redirection URL(s)** — add `https://<new-host>/auth/callback`
4. Save

---

## Step 6 — Update hardcoded APP_URL in extension

```
File: extensions/subscription-portal/src/index.jsx
Line 5: const APP_URL = '...';
```

Update to the new host URL, then redeploy:

```bash
shopify app deploy
```

---

## Step 7 — Refresh OAuth session

1. Open `waqtly.myshopify.com/admin`
2. Apps → Waqtly Subscriptions → click to open
3. Shopify will re-validate; this stores a fresh offline session in the new Postgres

---

## Step 8 — Re-register webhooks

Delete the 9 existing registrations via `webhookSubscriptionDelete` (IDs in `docs/deployment.md`), then re-register all 9 topics through the app's GraphQL explorer using the new host URL:

```graphql
mutation {
  webhookSubscriptionCreate(topic: SUBSCRIPTION_CONTRACTS_CREATE, webhookSubscription: {
    uri: "https://<new-host>/webhooks/subscription-contracts",
    format: JSON
  }) { webhookSubscription { id } userErrors { message } }
}
```

Repeat for all 9 topics. Run one mutation at a time in the app's GraphQL explorer.

---

## Step 9 — Verify

- [ ] `https://<new-host>/` returns 200
- [ ] `/api/portal/contracts?customerId=gid://shopify/Customer/22472951398723` returns contract data
- [ ] Customer portal at `waqtly.com/account` → Subscription tab loads correctly
- [ ] Pause/resume works
- [ ] Webhook delivery confirmed in Railway logs (or new host logs)

---

## Decommission Railway

Only after full verification:

1. Remove the `waqtly-subscriptions` service (Danger zone in service settings)
2. Remove the Postgres service if no longer needed

Do NOT delete Railway before confirming — losing Postgres sessions means one re-auth per user, which is minor but avoidable.
