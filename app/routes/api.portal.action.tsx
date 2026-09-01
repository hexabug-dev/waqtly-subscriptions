import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
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
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
    : {};
}

// Preflight
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  return json({ endpoint: "POST /api/portal/action" }, { headers: corsHeaders(origin) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  let body: { action?: string; contractId?: string; customerId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders(origin) });
  }

  const { action: act, contractId, customerId } = body;

  if (!act || !contractId || !customerId) {
    return json({ error: "action, contractId, and customerId are required" }, { status: 400, headers: corsHeaders(origin) });
  }
  if (act !== "pause" && act !== "resume") {
    return json({ error: "action must be pause or resume" }, { status: 400, headers: corsHeaders(origin) });
  }

  const customerGid = customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;

  try {
    const { admin } = await unauthenticated.admin(SHOP);

    // Verify the contract belongs to this customer before mutating
    const contractRes = await admin.graphql(
      `query($contractId: ID!) {
        subscriptionContract(id: $contractId) {
          id
          status
          customer { id }
        }
      }`,
      { variables: { contractId } }
    );
    const contractData = await contractRes.json();
    const contract = contractData?.data?.subscriptionContract;

    if (!contract) {
      return json({ error: "Contract not found" }, { status: 404, headers: corsHeaders(origin) });
    }
    if (contract.customer?.id !== customerGid) {
      return json({ error: "Forbidden" }, { status: 403, headers: corsHeaders(origin) });
    }

    // Create a draft to apply the status change
    const draftRes = await admin.graphql(
      `mutation($contractId: ID!) {
        subscriptionContractUpdate(contractId: $contractId) {
          draft { id }
          userErrors { field message }
        }
      }`,
      { variables: { contractId } }
    );
    const draftData = await draftRes.json();
    const draftId = draftData?.data?.subscriptionContractUpdate?.draft?.id;

    if (!draftId) {
      const errs = draftData?.data?.subscriptionContractUpdate?.userErrors ?? [];
      return json({ error: errs.map((e: { message: string }) => e.message).join(", ") || "Failed to create draft" }, { status: 500, headers: corsHeaders(origin) });
    }

    const newStatus = act === "pause" ? "PAUSED" : "ACTIVE";

    const commitRes = await admin.graphql(
      `mutation($draftId: ID!, $input: SubscriptionDraftInput!) {
        subscriptionDraftUpdate(draftId: $draftId, input: $input) {
          draft { id }
          userErrors { field message }
        }
      }`,
      { variables: { draftId, input: { status: newStatus } } }
    );
    const commitData = await commitRes.json();
    const commitErrors = commitData?.data?.subscriptionDraftUpdate?.userErrors ?? [];
    if (commitErrors.length) {
      return json({ error: commitErrors.map((e: { message: string }) => e.message).join(", ") }, { status: 500, headers: corsHeaders(origin) });
    }

    const finalRes = await admin.graphql(
      `mutation($draftId: ID!) {
        subscriptionDraftCommit(draftId: $draftId) {
          contract { id status }
          userErrors { field message }
        }
      }`,
      { variables: { draftId } }
    );
    const finalData = await finalRes.json();
    const finalErrors = finalData?.data?.subscriptionDraftCommit?.userErrors ?? [];
    if (finalErrors.length) {
      return json({ error: finalErrors.map((e: { message: string }) => e.message).join(", ") }, { status: 500, headers: corsHeaders(origin) });
    }

    const updatedContract = finalData?.data?.subscriptionDraftCommit?.contract;
    return json({ success: true, status: updatedContract?.status }, { headers: corsHeaders(origin) });

  } catch (err) {
    console.error("[portal/action]", err);
    return json({ error: "Internal server error" }, { status: 500, headers: corsHeaders(origin) });
  }
};
