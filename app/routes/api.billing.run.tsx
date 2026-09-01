import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";

const SHOP = process.env.SHOPIFY_STORE_DOMAIN ?? "bpb1ru-85.myshopify.com";
const FREE_MONTHS = 6;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!checkAuth(request)) return json({ error: "Unauthorized" }, { status: 401 });
  return json({ endpoint: "POST /api/billing/run", description: "Runs the billing scheduler" });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!checkAuth(request)) return json({ error: "Unauthorized" }, { status: 401 });

  const { admin } = await unauthenticated.admin(SHOP);
  const now = new Date();

  const contractsRes = await admin.graphql(`{
    subscriptionContracts(first: 100) {
      nodes {
        id
        status
        nextBillingDate
        activationMeta: metafield(namespace: "waqtly", key: "activation_date") { value }
      }
    }
  }`);
  const { data } = await contractsRes.json();
  const contracts = data?.subscriptionContracts?.nodes ?? [];

  const attempted: { id: string; attemptId: string; nextBillingDate: string }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const errors: { id: string; error: string }[] = [];

  for (const contract of contracts) {
    const { id, status, nextBillingDate: nextBillingRaw, activationMeta } = contract;

    if (status !== "ACTIVE") {
      skipped.push({ id, reason: `status=${status}` });
      continue;
    }

    const nextBilling = nextBillingRaw ? new Date(nextBillingRaw) : null;
    if (!nextBilling || nextBilling > now) {
      skipped.push({ id, reason: `not due until ${nextBillingRaw ?? "unknown"}` });
      continue;
    }

    const activationDateStr = activationMeta?.value;
    if (!activationDateStr) {
      skipped.push({ id, reason: "device not yet activated — no activation_date metafield" });
      continue;
    }

    const activationDate = new Date(activationDateStr);
    const firstBillingEligible = addMonths(activationDate, FREE_MONTHS);
    if (now < firstBillingEligible) {
      skipped.push({ id, reason: `within ${FREE_MONTHS}-month free period (eligible ${firstBillingEligible.toISOString()})` });
      continue;
    }

    try {
      // Fire billing attempt
      const attemptRes = await admin.graphql(
        `mutation($contractId: ID!, $originTime: DateTime) {
          subscriptionBillingAttemptCreate(
            subscriptionContractId: $contractId
            subscriptionBillingAttemptInput: { originTime: $originTime }
          ) {
            subscriptionBillingAttempt { id ready errorMessage errorCode }
            userErrors { field message }
          }
        }`,
        { variables: { contractId: id, originTime: now.toISOString() } }
      );
      const attemptJson = await attemptRes.json();
      const result = attemptJson.data?.subscriptionBillingAttemptCreate;

      if (result?.userErrors?.length) {
        const msg = result.userErrors.map((e: { message: string }) => e.message).join(", ");
        errors.push({ id, error: msg });
        console.error(`[billing] userError for ${id}: ${msg}`);
        continue;
      }

      const attemptId = result?.subscriptionBillingAttempt?.id ?? "unknown";
      const nextMonthDate = addMonths(nextBilling, 1);

      // Advance nextBillingDate via draft workflow
      const draftRes = await admin.graphql(
        `mutation($contractId: ID!) {
          subscriptionContractUpdate(contractId: $contractId) {
            draft { id }
            userErrors { field message }
          }
        }`,
        { variables: { contractId: id } }
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
          { variables: { draftId, input: { nextBillingDate: nextMonthDate.toISOString() } } }
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

      attempted.push({ id, attemptId, nextBillingDate: nextMonthDate.toISOString() });
      console.log(`[billing] ✓ ${id} — attempt ${attemptId}, next billing ${nextMonthDate.toISOString()}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ id, error: msg });
      console.error(`[billing] exception for ${id}:`, msg);
    }
  }

  const summary = {
    runAt: now.toISOString(),
    total: contracts.length,
    attempted: attempted.length,
    skipped: skipped.length,
    errors: errors.length,
  };

  console.log("[billing] run complete", JSON.stringify(summary));
  return json({ success: true, summary, attempted, skipped, errors });
};

function checkAuth(request: Request): boolean {
  const secret = process.env.BILLING_SCHEDULER_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}
