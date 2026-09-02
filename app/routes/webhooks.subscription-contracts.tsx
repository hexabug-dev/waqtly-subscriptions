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
