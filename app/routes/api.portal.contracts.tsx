import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN ?? "waqtly.myshopify.com";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function adminGQL(query: string, variables?: Record<string, unknown>) {
  const { admin } = await unauthenticated.admin(SHOP);
  const response = await admin.graphql(query, { variables });
  return response.json();
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");

  if (!customerId) {
    return json({ error: "customerId is required" }, { status: 400, headers: corsHeaders() });
  }

  const customerGid = customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;

  try {
    const data = await adminGQL(
      `query($customerId: ID!) {
        customer(id: $customerId) {
          subscriptionContracts(first: 10) {
            nodes {
              id
              status
              createdAt
              nextBillingDate
              originOrder {
                totalPriceSet { shopMoney { amount currencyCode } }
              }
              customerPaymentMethod {
                id
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
      { customerId: customerGid }
    );

    const contracts = data?.data?.customer?.subscriptionContracts?.nodes ?? [];
    return json({ contracts }, { headers: corsHeaders() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[portal/contracts]", msg);
    return json({ error: "Failed to fetch contracts" }, { status: 500, headers: corsHeaders() });
  }
};
