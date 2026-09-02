# Waqtly Subscriptions — Storefront Integration Guide

For designers and developers building or redesigning the Waqtly online store theme. Covers what the subscription system has set up, what the storefront must provide, and what is locked to Shopify's own interfaces.

---

## Overview

Waqtly sells physical tablet devices bundled with a recurring SaaS subscription. The subscription is managed by the **Waqtly Subscriptions** private Shopify app. Three storefront surfaces interact with it:

| Surface | Who controls the design |
|---|---|
| Product page | You (theme or custom UI) |
| Checkout | Shopify (native — not customised) |
| Customer account — Subscription tab | The app's Customer Accounts UI extension |

---

## 1. Product Page

### How subscription products are set up

Each Waqtly device product has a **selling plan group** attached to it. A selling plan defines the recurring billing terms. Shopify surfaces this on the product page as a "purchase option" — the buyer must select it before adding to cart.

The billing model for every Waqtly device is:

- **Entry payment** — paid at checkout (one-time, covers device hardware)
- **Months 1–6** — no charge (free period)
- **Month 7 onwards** — recurring monthly subscription

Both the entry amount and the monthly amount live on the selling plan's `pricingPolicy.cycleDiscounts`. The first non-zero `computedPrice` cycle indicates when regular billing begins.

### What the product page must include

**Selling plan selector** — Shopify's standard themes (Dawn, Sense, etc.) include this natively under "Purchase options". If you are building a custom theme or headless storefront, you must render the plan selector yourself and pass `sellingPlanId` in the cart line item when adding to cart.

Without a `sellingPlanId` in the add-to-cart payload, Shopify treats the item as a one-time purchase — no subscription contract is created and the customer will not appear in the Subscriptions app.

#### Liquid (standard theme)

Standard themes handle this automatically. Ensure you are not stripping the `selling_plan` block from `product-form.liquid`.

#### Headless / custom JS

```js
// Add to cart with selling plan
await fetch('/cart/add.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: variantId,          // Shopify variant ID (integer)
    quantity: 1,
    selling_plan: sellingPlanId  // selling plan ID (integer) — required
  })
});
```

The `sellingPlanId` comes from the product's `selling_plan_groups` data. Expose it from Liquid or query it via the Storefront API:

```graphql
query ProductSellingPlans($handle: String!) {
  product(handle: $handle) {
    sellingPlanGroups(first: 1) {
      nodes {
        sellingPlans(first: 1) {
          nodes {
            id
            name
            priceAdjustments {
              orderCount
              adjustmentValue {
                ... on SellingPlanPercentagePriceAdjustment { adjustmentPercentage }
                ... on SellingPlanFixedAmountPriceAdjustment { adjustmentAmount { amount } }
                ... on SellingPlanFixedPriceAdjustment { price { amount currencyCode } }
              }
            }
          }
        }
      }
    }
  }
}
```

### Product image

The product's **variant image** is displayed in the customer's Subscription tab to identify the device. Make sure each product variant has an image assigned — this is what the portal uses for the device thumbnail.

---

## 2. Checkout

### What happens at checkout

Shopify's native checkout handles everything. No checkout UI extension has been added.

When a customer checks out with a subscription item:

1. Shopify charges the **entry payment** immediately (one-time).
2. Shopify captures the customer's **payment method** and vaults it.
3. Shopify creates a **subscription contract** linked to the customer, the selling plan, and the vaulted payment method.
4. The Waqtly Subscriptions app receives a `subscription_contracts/create` webhook.

The recurring monthly charge (from month 7) is triggered separately by the app's billing scheduler — it calls `subscriptionBillingAttemptCreate` at the right time. The checkout itself does not configure when future charges happen — that is determined by the selling plan's `billingPolicy`.

### Theme constraints at checkout

Shopify's checkout is fully hosted and styled by Shopify. Its visual appearance is controlled in **Online Store → Themes → Customize → Checkout** (colours, logo, fonts) — not by custom code. This is by design for PCI compliance.

Do not attempt to inject custom JS or HTML into the checkout page. Shopify blocks this.

### Shopify Payments

Waqtly uses **Shopify Payments** as the payment processor. This is required for subscription contracts and native payment method vaulting. Third-party payment gateways do not support subscription contracts.

---

## 3. Customer Accounts — Subscription Tab

### What this is

The `subscription-portal` extension is a **Customer Accounts UI Extension** built by the Waqtly Subscriptions app. It adds a dedicated **"Subscription"** page to the customer's account at:

```
waqtly.com/account
```

Shopify renders it as a navigation tab alongside Orders, Profile, etc. The extension target is `customer-account.page.render`.

### What the customer sees

The portal renders one card per active subscription contract. Cancelled and expired contracts are hidden. Each card shows three sections:

**Devices**
- Status indicator (Active / Paused / Payment failed) with colour-coded icon
- Each subscribed device with its product image thumbnail, title, and plan name

**Billing timeline**
- Entry payment date and amount (marked Paid in green)
- Free period label if applicable (months 1–6)
- Upcoming recurring charge with amount and next billing date

**Payment method**
- Card brand and last 4 digits
- Expiry date
- "Update" button — sends the customer a Shopify-managed secure email link to update their card without entering the app

**Actions (below the card)**
- Active subscriptions: "Pause subscription" (requires confirmation)
- Paused subscriptions: "Resume subscription"
- Failed payment: "Update payment method" (same secure email flow)

### Design constraints — what you can and cannot change

The Customer Accounts UI extension uses **Shopify's own component library** (`s-section`, `s-stack`, `s-text`, `s-button`, etc.). These components inherit the Shopify Customer Accounts design system — they follow the colours, typography, and spacing the merchant sets in **Online Store → Themes → Customize → Customer accounts**.

| What you control | How |
|---|---|
| Brand colours in the account UI | Customer accounts theme settings in Shopify admin |
| Typography in the account UI | Customer accounts theme settings |
| Which navigation items appear | Customer accounts navigation settings |
| The content and layout inside the Subscription tab | The extension source code (`extensions/subscription-portal/src/index.jsx`) |

**You cannot** apply arbitrary CSS to the extension's content — the `s-*` components are sandboxed and styled by Shopify's system. Layout changes (reordering sections, adding new information) require editing the extension and redeploying with `shopify app deploy`.

### Component tone values supported in this surface

Some `s-badge` tone values (`success`, `warning`, `info`) do not render with colour in the `customer-account.page.render` surface — they fall back to dark/neutral. The portal currently uses `s-icon` + `s-text` for coloured status indicators instead, which do respect `tone="success"`, `tone="warning"`, and `tone="critical"`.

Keep this in mind if extending the portal with new status indicators.

---

## 4. Data Flow Summary

```
Customer adds device to cart
  → with sellingPlanId (required)
    ↓
Shopify checkout
  → charges entry payment
  → vaults payment method
  → creates SubscriptionContract
    ↓
Waqtly Subscriptions app (Railway backend)
  ← subscription_contracts/create webhook
  → activates device in CRM (pending)
    ↓
Month 7 billing scheduler
  → subscriptionBillingAttemptCreate
  → charges monthly fee via vaulted payment method
    ↓
Customer account portal (extension)
  → reads contracts via /api/portal/contracts
  → allows pause / resume / payment update
```

---

## 5. Extension Configuration Reference

**File:** `extensions/subscription-portal/shopify.extension.toml`

```toml
api_version = "2026-07"

[[extensions]]
name = "subscription-portal"
handle = "subscription-portal"
type = "ui_extension"

[[extensions.targeting]]
module = "./src/index.jsx"
target = "customer-account.page.render"

[extensions.capabilities]
api_access = true
network_access = true  # required for fetching from Railway backend
```

**Backend URL (hardcoded in extension source):**

```
extensions/subscription-portal/src/index.jsx — line 5
const APP_URL = 'https://waqtly-subscriptions-production.up.railway.app';
```

If the backend moves to a new host, update this line and run `shopify app deploy`.

---

## 6. Storefront Checklist for a New Theme

Before going live with a redesigned storefront, verify the following:

- [ ] **Selling plan selector is visible** on every product page that has subscription products — buyer must be able to select the subscription option
- [ ] **Add-to-cart includes `selling_plan` field** — check this in the browser network tab (POST `/cart/add.js`) for a test add from the new product page
- [ ] **Variant images are set** in Shopify admin for each device product — used as thumbnails in the customer portal
- [ ] **Customer accounts navigation** shows the Subscription tab — verify in Shopify admin under Online Store → Customize → Customer accounts → Navigation
- [ ] **Checkout branding** (logo, colours) is updated in Online Store → Customize → Checkout if the brand has changed
- [ ] **No custom JS injected into checkout** — any checkout-page scripting will be blocked by Shopify

---

## 7. App Scopes in Use

The Waqtly Subscriptions app holds the following access scopes relevant to storefront behaviour:

| Scope | Purpose |
|---|---|
| `read_products`, `write_products` | Read product/variant data and selling plan groups |
| `read_purchase_options`, `write_purchase_options` | Create and manage selling plans |
| `read_own_subscription_contracts`, `write_own_subscription_contracts` | Read and mutate subscription contracts |
| `read_customer_payment_methods`, `write_payment_mandate` | Read vaulted cards, send update emails |
| `read_customers`, `write_customers` | Look up customers by ID for portal data |
| `customer_read_own_subscription_contracts`, `customer_write_own_subscription_contracts` | Customer-scoped access used by the extension session token |

These are declared in `shopify.app.toml` and approved via the Partners Dashboard. No theme-side scope configuration is needed.
