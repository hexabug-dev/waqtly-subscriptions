import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(`
    query {
      subscriptionContracts(first: 50) {
        nodes {
          id
          status
          customer { defaultEmailAddress { emailAddress } }
          lines(first: 10) {
            nodes {
              title
              sellingPlanName
              currentPrice { amount currencyCode }
            }
          }
          billingPolicy { interval intervalCount }
          nextBillingDate
        }
      }
    }
  `);
  const data = await response.json();
  return json({ contracts: data.data?.subscriptionContracts?.nodes ?? [] });
};

type ContractLine = {
  title: string;
  sellingPlanName: string | null;
  currentPrice: { amount: string; currencyCode: string } | null;
};
type Contract = {
  id: string;
  status: string;
  customer: { defaultEmailAddress: { emailAddress: string } | null } | null;
  lines: { nodes: ContractLine[] };
  billingPolicy: { interval: string; intervalCount: number } | null;
  nextBillingDate: string | null;
};

// ─── Design tokens ───────────────────────────────────────────────
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px" };
const thStyle: React.CSSProperties = { padding: "10px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#6d7175", backgroundColor: "#f6f6f7", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "12px 16px", fontSize: "13px", color: "#202223", verticalAlign: "top" };

const STATUS_PILL: Record<string, { backgroundColor: string; color: string }> = {
  ACTIVE:    { backgroundColor: "#d4edda", color: "#1a7a4a" },
  PAUSED:    { backgroundColor: "#fff3cd", color: "#856404" },
  CANCELLED: { backgroundColor: "#f8d7da", color: "#842029" },
  FAILED:    { backgroundColor: "#f8d7da", color: "#842029" },
  EXPIRED:   { backgroundColor: "#cce5ff", color: "#004085" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_PILL[status] ?? { backgroundColor: "#f6f6f7", color: "#6d7175" };
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: "10px", fontSize: "12px", fontWeight: 600, lineHeight: "20px", ...s }}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

export default function ContractsPage() {
  const { contracts } = useLoaderData<typeof loader>();
  const rows = contracts as Contract[];
  const active    = rows.filter((c) => c.status === "ACTIVE").length;
  const paused    = rows.filter((c) => c.status === "PAUSED").length;
  const cancelled = rows.filter((c) => c.status === "CANCELLED").length;

  return (
    <Page>
      <TitleBar title="Subscription Contracts" />
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
          {[
            { label: "Total",     value: rows.length, color: "#202223" },
            { label: "Active",    value: active,      color: "#1a7a4a" },
            { label: "Paused",    value: paused,      color: "#856404" },
            { label: "Cancelled", value: cancelled,   color: "#6d7175" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ ...card, padding: "16px 20px" }}>
              <p style={{ margin: "0 0 6px", fontSize: "12px", color: "#6d7175", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</p>
              <p style={{ margin: 0, fontSize: "32px", fontWeight: 700, color, lineHeight: 1 }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px 10px", borderBottom: "1px solid #e1e3e5" }}>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#202223" }}>All Contracts</p>
          </div>

          {rows.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "#6d7175" }}>
              <p style={{ margin: 0, fontSize: "14px" }}>Place a test checkout using a selling plan to create the first subscription contract.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Customer", "Product(s)", "Plan", "Price", "Billing", "Next date", "Status"].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((contract) => {
                    const lines = contract.lines.nodes;
                    const billing = contract.billingPolicy
                      ? `Every ${contract.billingPolicy.intervalCount} ${contract.billingPolicy.interval.toLowerCase()}`
                      : "—";
                    const email = contract.customer?.defaultEmailAddress?.emailAddress ?? "—";
                    return (
                      <tr key={contract.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{email}</td>
                        <td style={tdStyle}>
                          {lines.map((l, i) => (
                            <div key={i} style={{ lineHeight: "1.6" }}>{l.title}</div>
                          ))}
                        </td>
                        <td style={{ ...tdStyle, color: "#6d7175" }}>
                          {lines.map((l, i) => (
                            <div key={i} style={{ lineHeight: "1.6", fontSize: "12px" }}>{l.sellingPlanName ?? "—"}</div>
                          ))}
                        </td>
                        <td style={tdStyle}>
                          {lines.map((l, i) => (
                            <div key={i} style={{ lineHeight: "1.6", fontVariantNumeric: "tabular-nums" }}>
                              {l.currentPrice ? `${l.currentPrice.currencyCode} ${parseFloat(l.currentPrice.amount).toFixed(2)}` : "—"}
                            </div>
                          ))}
                        </td>
                        <td style={{ ...tdStyle, color: "#6d7175" }}>{billing}</td>
                        <td style={{ ...tdStyle, color: "#6d7175", fontVariantNumeric: "tabular-nums" }}>
                          {contract.nextBillingDate ? new Date(contract.nextBillingDate).toLocaleDateString() : "—"}
                        </td>
                        <td style={{ padding: "12px 16px", verticalAlign: "top" }}>
                          <StatusPill status={contract.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </Page>
  );
}
