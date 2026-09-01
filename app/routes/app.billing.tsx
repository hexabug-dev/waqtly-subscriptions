import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Text, Button, BlockStack } from "@shopify/polaris";
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

// ─── Design tokens ──────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e1e3e5",
  borderRadius: "8px",
};
const cardPadded: React.CSSProperties = { ...card, padding: "16px 20px" };
const tableCard: React.CSSProperties = { ...card, overflow: "hidden" };

const thStyle: React.CSSProperties = {
  padding: "10px 16px",
  textAlign: "left",
  fontSize: "12px",
  fontWeight: 600,
  color: "#6d7175",
  backgroundColor: "#f6f6f7",
  borderBottom: "1px solid #e1e3e5",
  whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: "13px",
  color: "#202223",
  verticalAlign: "top",
};

const PILL_STYLES: Record<string, { backgroundColor: string; color: string }> = {
  "pending-activation": { backgroundColor: "#fff3cd", color: "#856404" },
  "in-free-period":     { backgroundColor: "#cce5ff", color: "#004085" },
  "due":                { backgroundColor: "#f8d7da", color: "#842029" },
  "upcoming":           { backgroundColor: "#d4edda", color: "#1a7a4a" },
};

const STATE_LABELS: Record<ContractRow["billingState"], string> = {
  "pending-activation": "Pending activation",
  "in-free-period":     "Free period",
  "due":                "Due now",
  "upcoming":           "Upcoming",
};

function Pill({ state }: { state: ContractRow["billingState"] }) {
  const s = PILL_STYLES[state];
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: "10px",
      fontSize: "12px",
      fontWeight: 600,
      lineHeight: "20px",
      ...s,
    }}>
      {STATE_LABELS[state]}
    </span>
  );
}

export default function BillingPage() {
  const { rows, now } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const actionData = fetcher.data;
  const isRunning = fetcher.state === "submitting";

  const due     = rows.filter((r) => r.billingState === "due").length;
  const free    = rows.filter((r) => r.billingState === "in-free-period").length;
  const pending = rows.filter((r) => r.billingState === "pending-activation").length;

  const stats = [
    { label: "Total contracts",    value: rows.length, color: "#202223" },
    { label: "Due now",            value: due,         color: due > 0 ? "#842029" : "#1a7a4a" },
    { label: "Free period",        value: free,        color: "#004085" },
    { label: "Pending activation", value: pending,     color: "#856404" },
  ];

  return (
    <Page>
      <TitleBar title="Billing Scheduler" />
      <BlockStack gap="400">

        {actionData && (
          <div style={{
            padding: "12px 16px",
            borderRadius: "8px",
            border: `1px solid ${actionData.success ? "#b7dfb8" : "#f5c6cb"}`,
            backgroundColor: actionData.success ? "#d4edda" : "#f8d7da",
            color: actionData.success ? "#1a7a4a" : "#842029",
            fontSize: "14px",
          }}>
            {actionData.message}
          </div>
        )}

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
          {stats.map(({ label, value, color }) => (
            <div key={label} style={cardPadded}>
              <p style={{ margin: "0 0 6px", fontSize: "12px", color: "#6d7175", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</p>
              <p style={{ margin: 0, fontSize: "32px", fontWeight: 700, color, lineHeight: 1 }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Manual trigger */}
        <div style={cardPadded}>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Manual Run</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Triggers the billing scheduler now. Only contracts due AND past their 6-month free period will be charged.
              Checked at: {new Date(now).toLocaleString()}
            </Text>
            <div>
              <Button
                onClick={() => fetcher.submit({}, { method: "post" })}
                loading={isRunning}
                variant="primary"
                tone="critical"
              >
                {isRunning ? "Running…" : "Run Billing Scheduler"}
              </Button>
            </div>
          </BlockStack>
        </div>

        {/* Contract table */}
        <div style={tableCard}>
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
                {rows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{row.email}</td>
                    <td style={{ ...tdStyle, color: "#6d7175", fontSize: "12px", fontFamily: "monospace" }}>
                      {row.id.split("/").pop()}
                    </td>
                    <td style={tdStyle}>
                      {row.activationDate
                        ? new Date(row.activationDate).toLocaleDateString()
                        : <span style={{ color: "#6d7175" }}>Not activated</span>}
                    </td>
                    <td style={tdStyle}>{row.firstBillingEligible ? new Date(row.firstBillingEligible).toLocaleDateString() : "—"}</td>
                    <td style={tdStyle}>{row.nextBillingDate ? new Date(row.nextBillingDate).toLocaleDateString() : "—"}</td>
                    <td style={{ padding: "12px 16px", verticalAlign: "top" }}>
                      <Pill state={row.billingState} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Cron setup */}
        <div style={cardPadded}>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Automated Cron Setup</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Set up a daily cron at 08:00 UTC (cron-job.org or Railway Cron). Requires BILLING_SCHEDULER_SECRET and SHOPIFY_STORE_DOMAIN on Railway.
            </Text>
            <div style={{ background: "#0d1117", borderRadius: "6px", padding: "12px 16px" }}>
              <pre style={{ margin: 0, fontSize: "12px", color: "#e6edf3", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                {`curl -X POST https://waqtly-subscriptions-production.up.railway.app/api/billing/run \\\n  -H "Authorization: Bearer $BILLING_SCHEDULER_SECRET"`}
              </pre>
            </div>
          </BlockStack>
        </div>

      </BlockStack>
    </Page>
  );
}
