import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Page, Card, Text, Badge, Button, BlockStack, Banner } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const FREE_MONTHS = 6;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

type ContractRow = {
  id: string;
  status: string;
  email: string;
  nextBillingDate: string | null;
  activationDate: string | null;
  firstBillingEligible: string | null;
  billingState: "pending-activation" | "in-free-period" | "due" | "upcoming";
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const now = new Date();

  const res = await admin.graphql(`{
    subscriptionContracts(first: 100) {
      nodes {
        id
        status
        nextBillingDate
        customer { defaultEmailAddress { emailAddress } }
      }
    }
  }`);
  const { data } = await res.json();
  const contracts = data?.subscriptionContracts?.nodes ?? [];

  const rows: ContractRow[] = contracts.map((c: any) => {
    // activationDate comes from CRM via /api/activate — not yet stored on contracts
    const activationDateStr: string | null = null;
    const activationDate = activationDateStr ? new Date(activationDateStr) : null;
    const nextBilling = c.nextBillingDate ? new Date(c.nextBillingDate) : null;
    const firstBillingEligible = activationDate ? addMonths(activationDate, FREE_MONTHS) : null;

    let billingState: ContractRow["billingState"] = "pending-activation";
    if (activationDate) {
      if (now < firstBillingEligible!) {
        billingState = "in-free-period";
      } else if (nextBilling && nextBilling <= now) {
        billingState = "due";
      } else {
        billingState = "upcoming";
      }
    }

    return {
      id: c.id,
      status: c.status,
      email: c.customer?.defaultEmailAddress?.emailAddress ?? "—",
      nextBillingDate: c.nextBillingDate ?? null,
      activationDate: activationDateStr,
      firstBillingEligible: firstBillingEligible?.toISOString() ?? null,
      billingState,
    };
  });

  return json({ rows, now: now.toISOString() });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const secret = process.env.BILLING_SCHEDULER_SECRET;
  const appUrl = process.env.SHOPIFY_APP_URL ?? "https://waqtly-subscriptions-production.up.railway.app";

  if (!secret) {
    return json({ success: false, message: "BILLING_SCHEDULER_SECRET not set on Railway" });
  }

  try {
    const res = await fetch(`${appUrl}/api/billing/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    const data = await res.json();
    return json({ success: data.success, message: JSON.stringify(data.summary), details: data });
  } catch (err) {
    return json({ success: false, message: String(err) });
  }
};

const STATE_BADGE: Record<ContractRow["billingState"], { label: string; tone: "success" | "warning" | "info" | "critical" }> = {
  "pending-activation": { label: "Pending activation", tone: "warning" },
  "in-free-period":     { label: "Free period",        tone: "info" },
  "due":                { label: "Due now",             tone: "critical" },
  "upcoming":           { label: "Upcoming",            tone: "success" },
};

const thStyle = { padding: "10px 16px", textAlign: "left" as const, fontSize: "12px", fontWeight: 600, color: "#6d7175", backgroundColor: "#f6f6f7", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap" as const };
const tdStyle = { padding: "12px 16px", fontSize: "13px", color: "#202223", verticalAlign: "top" as const };

export default function BillingPage() {
  const { rows, now } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isRunning = navigation.state === "submitting";

  const due = rows.filter((r) => r.billingState === "due").length;
  const freePeriod = rows.filter((r) => r.billingState === "in-free-period").length;
  const pending = rows.filter((r) => r.billingState === "pending-activation").length;

  return (
    <Page>
      <TitleBar title="Billing Scheduler" />
      <BlockStack gap="400">

        {actionData && (
          <Banner tone={actionData.success ? "success" : "critical"}>
            <p>{actionData.message}</p>
          </Banner>
        )}

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
          {[
            { label: "Total contracts", value: rows.length, color: undefined },
            { label: "Due now",         value: due,         color: due > 0 ? "#e5534b" : "#1a7a4a" },
            { label: "Free period",     value: freePeriod,  color: "#1a7a4a" },
            { label: "Pending activation", value: pending,  color: "#7a5a1a" },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                <Text as="p" variant="heading2xl" fontWeight="bold">
                  <span style={color ? { color } : {}}>{value}</span>
                </Text>
              </BlockStack>
            </Card>
          ))}
        </div>

        {/* Manual trigger */}
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Manual Run</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Triggers the billing scheduler now. Only contracts that are due AND past their 6-month free period will be charged.
              Checked at: {new Date(now).toLocaleString()}
            </Text>
            <Form method="post">
              <Button submit loading={isRunning} variant="primary" tone="critical">
                {isRunning ? "Running…" : "Run Billing Scheduler"}
              </Button>
            </Form>
          </BlockStack>
        </Card>

        {/* Contract table */}
        <Card padding="0">
          <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #e1e3e5" }}>
            <Text as="h2" variant="headingMd">Contract Billing Status</Text>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Customer", "Contract ID", "Activation date", "First billing eligible", "Next billing date", "State"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const badge = STATE_BADGE[row.billingState];
                  return (
                    <tr key={row.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{row.email}</td>
                      <td style={{ ...tdStyle, color: "#6d7175", fontSize: "12px", fontFamily: "monospace" }}>
                        {row.id.split("/").pop()}
                      </td>
                      <td style={tdStyle}>{row.activationDate ? new Date(row.activationDate).toLocaleDateString() : <span style={{ color: "#6d7175" }}>Not activated</span>}</td>
                      <td style={tdStyle}>{row.firstBillingEligible ? new Date(row.firstBillingEligible).toLocaleDateString() : "—"}</td>
                      <td style={tdStyle}>{row.nextBillingDate ? new Date(row.nextBillingDate).toLocaleDateString() : "—"}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Cron setup note */}
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Automated Cron Setup</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Set up a daily cron job to call the scheduler automatically. Required env vars on Railway: BILLING_SCHEDULER_SECRET, SHOPIFY_STORE_DOMAIN.
            </Text>
            <div style={{ background: "#0d1117", borderRadius: "6px", padding: "12px 16px" }}>
              <pre style={{ margin: 0, fontSize: "12px", color: "#e6edf3", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                {`# cron-job.org or Railway cron — run daily at 08:00 UTC
curl -X POST https://waqtly-subscriptions-production.up.railway.app/api/billing/run \\
  -H "Authorization: Bearer $BILLING_SCHEDULER_SECRET"`}
              </pre>
            </div>
          </BlockStack>
        </Card>

      </BlockStack>
    </Page>
  );
}
