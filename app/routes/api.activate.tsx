import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN ?? "bpb1ru-85.myshopify.com";
const FREE_MONTHS = 6;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Called when a customer activates their device (enters welcome code).
 * Sets waqtly.activation_date metafield on the contract and advances
 * nextBillingDate to activationDate + 6 months.
 *
 * POST /api/activate
 * Authorization: Bearer $BILLING_SCHEDULER_SECRET
 * Body: { "contractId": "gid://shopify/SubscriptionContract/xxx", "activationDate": "2026-09-01T00:00:00Z" }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = process.env.BILLING_SCHEDULER_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { contractId?: string; activationDate?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { contractId, activationDate: activationDateStr } = body;
  if (!contractId || !activationDateStr) {
    return json({ error: "contractId and activationDate are required" }, { status: 400 });
  }

  const activationDate = new Date(activationDateStr);
  if (isNaN(activationDate.getTime())) {
    return json({ error: "activationDate must be a valid ISO date string" }, { status: 400 });
  }

  const { admin } = await unauthenticated.admin(SHOP);
  const firstBillingDate = addMonths(activationDate, FREE_MONTHS);

  // Set activation_date metafield on the contract
  const metafieldRes = await admin.graphql(
    `mutation($ownerId: ID!, $namespace: String!, $key: String!, $value: String!, $type: String!) {
      metafieldsSet(metafields: [{ ownerId: $ownerId, namespace: $namespace, key: $key, value: $value, type: $type }]) {
        metafields { id key value }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        ownerId: contractId,
        namespace: "waqtly",
        key: "activation_date",
        value: activationDate.toISOString(),
        type: "date_time",
      },
    }
  );
  const metafieldJson = await metafieldRes.json();
  const metafieldErrors = metafieldJson.data?.metafieldsSet?.userErrors ?? [];
  if (metafieldErrors.length) {
    return json({ error: "Failed to set activation metafield", details: metafieldErrors }, { status: 500 });
  }

  // Advance nextBillingDate to activation + 6 months via draft workflow
  const draftRes = await admin.graphql(
    `mutation($contractId: ID!) {
      subscriptionContractUpdate(contractId: $contractId) {
        draft { id }
        userErrors { field message }
      }
    }`,
    { variables: { contractId } }
  );
  const draftJson = await draftRes.json();
  const draftId = draftJson.data?.subscriptionContractUpdate?.draft?.id;

  if (draftId) {
    await admin.graphql(
      `mutation($draftId: ID!, $input: SubscriptionDraftInput!) {
        subscriptionDraftUpdate(draftId: $draftId, input: $input) {
          draft { id nextBillingDate }
          userErrors { field message }
        }
      }`,
      { variables: { draftId, input: { nextBillingDate: firstBillingDate.toISOString() } } }
    );
    await admin.graphql(
      `mutation($draftId: ID!) {
        subscriptionDraftCommit(draftId: $draftId) {
          contract { id nextBillingDate }
          userErrors { field message }
        }
      }`,
      { variables: { draftId } }
    );
  }

  console.log(`[activate] contract ${contractId} activated on ${activationDate.toISOString()}, first billing ${firstBillingDate.toISOString()}`);

  return json({
    success: true,
    contractId,
    activationDate: activationDate.toISOString(),
    firstBillingDate: firstBillingDate.toISOString(),
  });
};
