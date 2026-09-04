import crypto from "crypto";
import type { ActionFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN ?? "waqtly.myshopify.com";

async function adminGQL(query: string, variables?: Record<string, unknown>) {
  const { admin } = await unauthenticated.admin(SHOP);
  const response = await admin.graphql(query, { variables });
  return response.json();
}

async function sendPaymentUpdateEmail(paymentMethodId: string) {
  const result = await adminGQL(
    `mutation($id: ID!) {
      customerPaymentMethodSendUpdateEmail(customerPaymentMethodId: $id) {
        customer { id }
        userErrors { field message }
      }
    }`,
    { id: paymentMethodId }
  );
  const errors = result?.data?.customerPaymentMethodSendUpdateEmail?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors.map((e: { message: string }) => e.message).join(", "));
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const body = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shop = request.headers.get("x-shopify-shop-domain") ?? "";

  const secret = process.env.SHOPIFY_API_SECRET ?? "";
  const generated = crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");

  if (!crypto.timingSafeEqual(Buffer.from(generated), Buffer.from(hmac))) {
    console.error(`[webhook] HMAC mismatch for ${topic} from ${shop}`);
    return new Response(null, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(body);
  } catch {
    // non-JSON body — log topic only
  }

  console.log(`[webhook] ${topic} from ${shop}`);

  try {
    switch (topic) {
      case "subscription_billing_attempts/failure": {
        // Fetch the contract to get its payment method, then send update email
        const contractGid = payload.admin_graphql_api_subscription_contract_id as string | undefined;
        if (contractGid) {
          const data = await adminGQL(
            `query($id: ID!) { subscriptionContract(id: $id) { customerPaymentMethod { id } } }`,
            { id: contractGid }
          );
          const pmId = data?.data?.subscriptionContract?.customerPaymentMethod?.id as string | undefined;
          if (pmId) {
            await sendPaymentUpdateEmail(pmId);
            console.log(`[webhook] payment update email sent for contract ${contractGid}`);
          }
        }
        break;
      }

      case "customer_payment_methods/revoke": {
        // Payment method GID is directly in the payload
        const pmId = payload.admin_graphql_api_id as string | undefined;
        if (pmId) {
          await sendPaymentUpdateEmail(pmId);
          console.log(`[webhook] payment update email sent for revoked method ${pmId}`);
        }
        break;
      }

      case "orders/cancelled": {
        const orderGid = payload.admin_graphql_api_id as string | undefined;
        const fulfillmentStatus = payload.fulfillment_status as string | null | undefined;

        // Only auto-cancel if tablet has not shipped — fulfilled/partial orders stay manual
        if (!orderGid || (fulfillmentStatus && fulfillmentStatus !== "unfulfilled")) {
          console.log(`[webhook] orders/cancelled skipped — fulfillment_status: ${fulfillmentStatus ?? "null"}`);
          break;
        }

        // order.subscriptionContracts doesn't exist — look up via customer instead
        const customer = payload.customer as Record<string, unknown> | undefined;
        const customerNumericId = customer?.id as number | string | undefined;
        if (!customerNumericId) {
          console.log(`[webhook] orders/cancelled — no customer on order ${orderGid}, skipping`);
          break;
        }
        const customerGid = `gid://shopify/Customer/${customerNumericId}`;

        const customerData = await adminGQL(
          `query($customerId: ID!) {
            customer(id: $customerId) {
              subscriptionContracts(first: 10) {
                nodes {
                  id
                  status
                  originOrder { id }
                }
              }
            }
          }`,
          { customerId: customerGid }
        );

        const allContracts: Array<{ id: string; status: string; originOrder: { id: string } | null }> =
          customerData?.data?.customer?.subscriptionContracts?.nodes ?? [];

        // Only cancel contracts whose origin order matches this cancelled order
        const cancellable = allContracts.filter(
          (c) =>
            c.originOrder?.id === orderGid &&
            (c.status === "ACTIVE" || c.status === "PAUSED")
        );

        for (const contract of cancellable) {
          const result = await adminGQL(
            `mutation($id: ID!) {
              subscriptionContractCancel(subscriptionContractId: $id) {
                contract { id status }
                userErrors { field message }
              }
            }`,
            { id: contract.id }
          );
          const errors: Array<{ message: string }> =
            result?.data?.subscriptionContractCancel?.userErrors ?? [];
          if (errors.length) {
            throw new Error(
              `Cancel failed for ${contract.id}: ${errors.map((e) => e.message).join(", ")}`
            );
          }
          console.log(`[webhook] contract ${contract.id} cancelled — order ${orderGid} cancelled unfulfilled`);
        }

        if (cancellable.length === 0) {
          console.log(`[webhook] orders/cancelled — no active/paused contracts for order ${orderGid}`);
        }
        break;
      }

      default:
        // Log unhandled topics — handlers for contracts/update, billing success/challenged, disputes TBD
        console.log(`[webhook] ${topic} — no handler yet, payload logged`);
        console.log(JSON.stringify(payload).slice(0, 500));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] ${topic} handler error: ${msg}`);
    // Return 200 to prevent Shopify retrying — errors are logged for monitoring
  }

  return new Response(null, { status: 200 });
};
