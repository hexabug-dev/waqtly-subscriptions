import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN ?? "bpb1ru-85.myshopify.com";

const CORS_ORIGINS = ["https://waqtly.com", ".myshopify.com"];

function corsHeaders(origin: string | null) {
  const allowed =
    origin && CORS_ORIGINS.some((o) => o.startsWith(".") ? origin.endsWith(o) : origin === o)
      ? origin
      : null;
  return allowed
    ? {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    : {};
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");

  if (!customerId) {
    return json({ error: "customerId is required" }, { status: 400, headers: corsHeaders(origin) });
  }

  // Normalise to GID
  const customerGid = customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;

  try {
    const { admin } = await unauthenticated.admin(SHOP);

    const res = await admin.graphql(
      `query($customerId: ID!) {
        customer(id: $customerId) {
          subscriptionContracts(first: 10) {
            nodes {
              id
              status
              createdAt
              nextBillingDate
              originOrder {
                totalPrice { amount currencyCode }
              }
              customerPaymentMethod {
                id
                instrumentUpdateUrl
                instrument {
                  ... on CustomerCreditCard {
                    brand
                    lastDigits
                    expiryMonth
                    expiryYear
                  }
                }
              }
              lines(first: 10) {
                nodes {
                  id
                  title
                  sellingPlanName
                  currentPrice { amount currencyCode }
                  pricingPolicy {
                    cycleDiscounts {
                      afterCycle
                      computedPrice { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { customerId: customerGid } }
    );

    const data = await res.json();
    const contracts = data?.data?.customer?.subscriptionContracts?.nodes ?? [];

    return json({ contracts }, { headers: corsHeaders(origin) });
  } catch (err) {
    console.error("[portal/contracts]", err);
    return json({ error: "Failed to fetch contracts" }, { status: 500, headers: corsHeaders(origin) });
  }
};
