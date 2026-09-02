import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN ?? "waqtly.myshopify.com";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  return json({ endpoint: "POST /api/portal/action" }, { headers: corsHeaders() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  let body: { action?: string; contractId?: string; customerId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders() });
  }

  const { action: act, contractId, customerId } = body;

  if (!act || !contractId || !customerId) {
    return json({ error: "action, contractId, and customerId are required" }, { status: 400, headers: corsHeaders() });
  }
  if (act !== "pause" && act !== "resume") {
    return json({ error: "action must be pause or resume" }, { status: 400, headers: corsHeaders() });
  }

  const customerGid = customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;

  try {
    // Verify contract belongs to this customer
    const check = await adminGQL(
      `query($id: ID!) { subscriptionContract(id: $id) { id customer { id } } }`,
      { id: contractId }
    );
    const contract = check?.data?.subscriptionContract;
    if (!contract) {
      return json({ error: "Contract not found" }, { status: 404, headers: corsHeaders() });
    }
    if (contract.customer?.id !== customerGid) {
      return json({ error: "Forbidden" }, { status: 403, headers: corsHeaders() });
    }

    // Create draft
    const draftRes = await adminGQL(
      `mutation($id: ID!) {
        subscriptionContractUpdate(contractId: $id) {
          draft { id }
          userErrors { field message }
        }
      }`,
      { id: contractId }
    );
    const draftId = draftRes?.data?.subscriptionContractUpdate?.draft?.id;
    const draftErrors = draftRes?.data?.subscriptionContractUpdate?.userErrors ?? [];
    if (!draftId) {
      return json({ error: draftErrors.map((e: { message: string }) => e.message).join(", ") || "Draft creation failed" }, { status: 500, headers: corsHeaders() });
    }

    const newStatus = act === "pause" ? "PAUSED" : "ACTIVE";

    // Update status on draft
    const updateRes = await adminGQL(
      `mutation($id: ID!, $input: SubscriptionDraftInput!) {
        subscriptionDraftUpdate(draftId: $id, input: $input) {
          draft { id }
          userErrors { field message }
        }
      }`,
      { id: draftId, input: { status: newStatus } }
    );
    const updateErrors = updateRes?.data?.subscriptionDraftUpdate?.userErrors ?? [];
    if (updateErrors.length) {
      return json({ error: updateErrors.map((e: { message: string }) => e.message).join(", ") }, { status: 500, headers: corsHeaders() });
    }

    // Commit
    const commitRes = await adminGQL(
      `mutation($id: ID!) {
        subscriptionDraftCommit(draftId: $id) {
          contract { id status }
          userErrors { field message }
        }
      }`,
      { id: draftId }
    );
    const commitErrors = commitRes?.data?.subscriptionDraftCommit?.userErrors ?? [];
    if (commitErrors.length) {
      return json({ error: commitErrors.map((e: { message: string }) => e.message).join(", ") }, { status: 500, headers: corsHeaders() });
    }

    const updated = commitRes?.data?.subscriptionDraftCommit?.contract;
    return json({ success: true, status: updated?.status }, { headers: corsHeaders() });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[portal/action]", msg);
    return json({ error: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
};
