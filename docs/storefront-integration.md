# Waqtly Subscriptions — Storefront Integration Guide

For designers and developers building or redesigning the Waqtly online store. Covers how the subscription system works end-to-end, what the two subscription products look like, what any new theme must preserve, and a recommendation on how to approach a redesign.

---

## How it works — the full user journey

### 1. The customer lands on a product page

Waqtly has two tablet products that carry a subscription. They are the only products in the store with a selling plan attached:

| Product | Handle | Entry payment | Monthly (from month 2) |
|---|---|---|---|
| **Waqtly Plus** • 13.5 inch | `/products/waqtlyplus` | €139.00 | €7.99 |
| **Waqtly Nano** • 10.1 inch | `/products/waqtlynano` | €99.00 | €7.99 |

*(Waqtly Frames and Waqtly Power Supply are one-time purchase products with no selling plan — subscription logic does not apply to them.)*

Each tablet comes in multiple variants — screen colour (White or Black) and frame colour (White, Black, Oak, Walnut). Every variant is the same price; the combination controls the product image shown in the Devices section of the customer portal.

The product page shows a **"Subscribe" option** — this is Shopify's native purchase option selector, driven by the selling plan attached to the product. The customer must select this option. Without it, the item goes into the cart as a one-off purchase and no subscription is created.

### 2. The customer goes to checkout

The customer adds the tablet to the cart and proceeds to checkout. Shopify's own checkout page handles everything from here.

At checkout:
- Shopify charges the **entry payment** immediately (€139 for Plus, €99 for Nano).
- Shopify **captures and vaults** the customer's payment card for future use.
- Shopify **creates a subscription contract** — a record that links the customer, their vaulted card, the product, and the selling plan.

The Waqtly Subscriptions app receives a `subscription_contracts/create` webhook the moment the contract is created. This is the trigger for any downstream actions (device activation, CRM notification — see deployment doc).

The customer does not need to do anything else. The recurring billing is handled automatically from this point.

### 3. Monthly billing happens automatically

From month 2 onward, the Waqtly Subscriptions app's billing scheduler calls Shopify's `subscriptionBillingAttemptCreate` each month. Shopify charges the vaulted card €7.99 and records a new billing attempt against the contract.

If the charge succeeds, the subscription stays active.  
If the charge fails, Shopify fires a `subscription_billing_attempts/failure` webhook — the app catches this and automatically emails the customer a secure Shopify-managed link to update their card.

### 4. The customer manages their subscription in their account

Logged-in customers can visit `waqtly.com/account` and navigate to the **Subscription** tab. This tab is rendered by the Waqtly Subscriptions Customer Accounts UI extension — it is not part of the theme.

From the Subscription tab, the customer can:

- See the status of their subscription (Active / Paused / Payment failed) with colour-coded indicators
- See each device they are subscribed to, with its product thumbnail image
- See their billing timeline — the entry payment date and amount, and the upcoming monthly charge
- See their saved payment method (card brand, last 4 digits, expiry)
- Click **Update** to receive a Shopify-managed email with a secure link to change their card — no password required
- **Pause** an active subscription (with a confirmation step)
- **Resume** a paused subscription

---

## Product configuration details

### Waqtly Plus • 13.5 inch

- **Shopify product ID:** `gid://shopify/Product/14693478891843`
- **URL handle:** `waqtlyplus`
- **Variants:** White screen + [White / Black / Oak / Walnut frame], Black screen + [White / Black / Oak / Walnut frame]
- **Selling plan group:** Subscribe (Plus) - Entry
- **Selling plan ID:** `gid://shopify/SellingPlan/691771572547`
- **Billing cycle:** Monthly (`MONTH`, interval 1)
- **Pricing:**
  - Cycle 1 (checkout): **€139.00**
  - From cycle 2 onwards: **€7.99/month**

### Waqtly Nano • 10.1 inch

- **Shopify product ID:** `gid://shopify/Product/14696508358979`
- **URL handle:** `waqtlynano`
- **Variants:** White screen + [White / Black / Oak / Walnut frame], Black screen + [White / Black / Oak / Walnut frame]
- **Selling plan group:** Subscribe (Nano) - Entry
- **Selling plan ID:** `gid://shopify/SellingPlan/691771605315`
- **Billing cycle:** Monthly (`MONTH`, interval 1)
- **Pricing:**
  - Cycle 1 (checkout): **€99.00**
  - From cycle 2 onwards: **€7.99/month**

### Non-subscription products (no selling plan)

| Product | Handle | Price |
|---|---|---|
| Waqtly Frames | `waqtly-frames` | €35.00 |
| Waqtly Power Supply | `waqtly-power-supply` | €29.00 |

These are standard one-time purchase products. The subscription system has no interaction with them.

---

## The three storefront surfaces and who controls each

### Product page — controlled by the theme

The product page is part of the theme. Its design is entirely yours to change. The one thing that must not be removed is the **selling plan / purchase option selector** — the UI element that lets the customer choose "Subscribe" before adding to the cart.

Standard Shopify themes (Dawn, Refresh, Sense, etc.) include this automatically under the add-to-cart button. If you are building a headless or fully custom storefront, you must render the selector yourself and pass `selling_plan` in the add-to-cart request:

```js
// Headless add to cart — selling_plan is required
await fetch('/cart/add.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: variantId,          // numeric variant ID
    quantity: 1,
    selling_plan: sellingPlanId  // numeric selling plan ID — must be included
  })
});
```

Without `selling_plan` in the payload, Shopify treats the item as a one-time purchase. The checkout will still succeed, but no subscription contract is created and the customer will never be billed again.

**Also important:** Each variant must have a product image set in Shopify admin. The customer portal uses the variant's image as the device thumbnail in the Subscription tab. If a variant has no image, the portal shows the title only.

### Checkout — controlled by Shopify

The checkout page is fully managed by Shopify. It cannot be modified with custom code — Shopify blocks this for PCI compliance reasons.

Visual branding (logo, colours, font, button style) is configurable in **Online Store → Customize → Checkout** in the Shopify admin. That is the extent of what can be changed here.

**Shopify Payments must remain the active payment processor.** Native subscription contracts and payment method vaulting only work with Shopify Payments. A third-party gateway would break the recurring billing system entirely.

### Customer account Subscription tab — controlled by the app extension

The Subscription tab in the customer account is rendered by the `subscription-portal` Customer Accounts UI Extension. It is not part of the theme — it lives on Shopify's CDN and is deployed separately via `shopify app deploy`.

The visual components inside the tab (`s-section`, `s-text`, `s-button`, etc.) follow Shopify's Customer Accounts design system. Their colours and spacing respond to the Customer Accounts theme settings in Shopify admin — not to the storefront theme. You can update the Customer Accounts colour palette in **Online Store → Customize → Customer accounts**, and the extension will pick up those changes automatically.

The content and layout inside the tab (what sections appear, what text is shown, what actions are available) requires editing the extension source code at `extensions/subscription-portal/src/index.jsx` and redeploying.

---

## Theme recommendation

### What exists today

The live store runs a **custom-built Shopify theme** named "Final Figma Homepage - FT - 3-11-2025" — built to match the Waqtly Figma design system. It is not a standard Shopify theme; it was coded from scratch to match brand specifications.

### For a redesign: build within Shopify's theme system

**Recommendation: redesign within a Shopify Liquid theme** (whether adapting the existing custom theme or starting from a new base like Dawn). Avoid going headless unless there is a strong product reason.

Here is why:

**The subscription system is almost entirely theme-agnostic.** The selling plan selector, the checkout, and the customer portal extension are all handled by Shopify natively. The theme only needs to:
1. Not strip the purchase option selector from the product form
2. Keep variant images populated so the portal thumbnail works

A theme swap or redesign does not affect contracts, webhooks, billing, or the Subscription tab at all.

**Headless introduces meaningful complexity for no subscription-related gain.** A headless storefront (React/Next.js + Storefront API) would require you to:
- Manually implement the selling plan selector UI
- Manually pass `sellingPlanId` in every add-to-cart call
- Handle subscription-specific cart state (selling plans cannot be added via the standard Cart API without the field)
- Separately solve for the Customer Accounts extension, which only renders in Shopify's native customer accounts — not in a custom-built account page

If the goal is a redesign, the most efficient path is to either:
- **Edit the existing custom theme** — keeps all existing subscription wiring intact, only updates visuals
- **Start from Dawn** — Shopify's open-source reference theme, fully subscription-aware out of the box, then apply Waqtly brand styling on top

Either way, the Subscriptions app, the extension, and the checkout branding remain unchanged and continue to work.

---

## Pre-launch checklist for any new theme

- [ ] Selling plan selector visible on `/products/waqtlyplus` and `/products/waqtlynano`
- [ ] Test add-to-cart in browser devtools: POST `/cart/add.js` payload includes `selling_plan` field
- [ ] All product variants have images assigned in Shopify admin (portal thumbnails)
- [ ] Customer accounts Subscription tab appears in account navigation (`waqtly.com/account`)
- [ ] Checkout branding (logo, colours) updated in Online Store → Customize → Checkout
- [ ] Shopify Payments remains active as the payment processor
- [ ] No custom JS injected into checkout pages

---

## Quick reference: selling plan IDs

These IDs are needed if rendering the purchase option selector manually in a headless storefront.

| Product | Selling Plan ID (GID) | Numeric ID |
|---|---|---|
| Waqtly Plus • 13.5 inch | `gid://shopify/SellingPlan/691771572547` | `691771572547` |
| Waqtly Nano • 10.1 inch | `gid://shopify/SellingPlan/691771605315` | `691771605315` |

For standard Liquid themes these IDs are exposed automatically via `product.selling_plan_groups` and do not need to be hardcoded.
