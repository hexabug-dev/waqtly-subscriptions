import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { useState, useEffect } from "react";

// ─── Action — cancel a contract ─────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const body = await request.formData();
  const contractId = body.get("contractId") as string;

  const result = await admin.graphql(
    `mutation($id: ID!) {
      subscriptionContractCancel(subscriptionContractId: $id) {
        contract { id status }
        userErrors { field message }
      }
    }`,
    { variables: { id: contractId } }
  );
  const data = await result.json();
  const errors: Array<{ message: string }> =
    data?.data?.subscriptionContractCancel?.userErrors ?? [];
  if (errors.length) return json({ error: errors[0].message }, { status: 400 });
  return json({ ok: true });
};

// ─── Loader ──────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(`
    query {
      subscriptionContracts(first: 50) {
        nodes {
          id
          status
          originOrder { name }
          customer {
            displayName
            defaultEmailAddress { emailAddress }
          }
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

// ─── Types ───────────────────────────────────────────────────────
type ContractLine = {
  title: string;
  sellingPlanName: string | null;
  currentPrice: { amount: string; currencyCode: string } | null;
};
type Contract = {
  id: string;
  status: string;
  originOrder: { name: string } | null;
  customer: {
    displayName: string | null;
    defaultEmailAddress: { emailAddress: string } | null;
  } | null;
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

// ─── Page ────────────────────────────────────────────────────────
export default function ContractsPage() {
  const { contracts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId]     = useState<string | null>(null);

  // Reset confirmation after successful cancel (loader revalidates automatically)
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setConfirmingId(null);
      setMenuOpenId(null);
    }
  }, [fetcher.state, fetcher.data]);

  const rows = contracts as Contract[];
  const active    = rows.filter((c) => c.status === "ACTIVE").length;
  const paused    = rows.filter((c) => c.status === "PAUSED").length;
  const cancelled = rows.filter((c) => c.status === "CANCELLED").length;

  function handleCancel(contractId: string) {
    const form = new FormData();
    form.set("contractId", contractId);
    fetcher.submit(form, { method: "POST" });
  }

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
                    {["Order", "Customer", "Product(s)", "Plan", "Price", "Billing", "Next date", "Status", ""].map((h, i) => (
                      <th key={i} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((contract) => {
                    const lines       = contract.lines.nodes;
                    const billing     = contract.billingPolicy
                      ? `Every ${contract.billingPolicy.intervalCount} ${contract.billingPolicy.interval.toLowerCase()}`
                      : "—";
                    const email       = contract.customer?.defaultEmailAddress?.emailAddress ?? "—";
                    const cancellable = contract.status === "ACTIVE" || contract.status === "PAUSED";
                    const isMenu      = menuOpenId === contract.id;
                    const isConfirm   = confirmingId === contract.id;
                    const isSubmitting = fetcher.state !== "idle" && confirmingId === contract.id;

                    return (
                      <tr key={contract.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                        <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {contract.originOrder?.name ?? "—"}
                        </td>
                        <td style={tdStyle}>
                          {contract.customer?.displayName && (
                            <div style={{ fontWeight: 600 }}>{contract.customer.displayName}</div>
                          )}
                          <div style={{ fontSize: "12px", color: "#6d7175" }}>{email}</div>
                        </td>
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

                        {/* Options cell */}
                        <td style={{ padding: "10px 16px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                          {!cancellable ? null : isConfirm ? (
                            // Confirmation state
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-start" }}>
                              <span style={{ fontSize: "12px", color: "#202223", fontWeight: 500 }}>Cancel this contract?</span>
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  disabled={isSubmitting}
                                  onClick={() => handleCancel(contract.id)}
                                  style={{ padding: "4px 10px", fontSize: "12px", fontWeight: 600, cursor: isSubmitting ? "not-allowed" : "pointer", background: "#d72c0d", color: "#fff", border: "none", borderRadius: "4px", opacity: isSubmitting ? 0.6 : 1 }}
                                >
                                  {isSubmitting ? "Cancelling…" : "Yes, cancel"}
                                </button>
                                <button
                                  disabled={isSubmitting}
                                  onClick={() => { setConfirmingId(null); setMenuOpenId(null); }}
                                  style={{ padding: "4px 10px", fontSize: "12px", fontWeight: 500, cursor: "pointer", background: "transparent", color: "#6d7175", border: "1px solid #c9cccf", borderRadius: "4px" }}
                                >
                                  Keep
                                </button>
                              </div>
                              {fetcher.data?.error && confirmingId === contract.id && (
                                <span style={{ fontSize: "11px", color: "#d72c0d" }}>{fetcher.data.error}</span>
                              )}
                            </div>
                          ) : isMenu ? (
                            // Dropdown open
                            <div style={{ position: "relative", display: "inline-block" }}>
                              <button
                                onClick={() => setMenuOpenId(null)}
                                style={{ padding: "4px 8px", fontSize: "16px", lineHeight: 1, cursor: "pointer", background: "#f1f2f3", border: "1px solid #c9cccf", borderRadius: "4px", color: "#202223" }}
                              >
                                ···
                              </button>
                              <div style={{ position: "absolute", right: 0, top: "100%", marginTop: "2px", background: "#fff", border: "1px solid #e1e3e5", borderRadius: "6px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 10, minWidth: "160px" }}>
                                <button
                                  onClick={() => { setMenuOpenId(null); setConfirmingId(contract.id); }}
                                  style={{ display: "block", width: "100%", padding: "10px 14px", fontSize: "13px", textAlign: "left", cursor: "pointer", background: "transparent", border: "none", color: "#d72c0d", fontWeight: 500 }}
                                >
                                  Cancel contract
                                </button>
                              </div>
                            </div>
                          ) : (
                            // Default ··· button
                            <button
                              onClick={() => setMenuOpenId(contract.id)}
                              style={{ padding: "4px 8px", fontSize: "16px", lineHeight: 1, cursor: "pointer", background: "transparent", border: "1px solid #c9cccf", borderRadius: "4px", color: "#6d7175" }}
                            >
                              ···
                            </button>
                          )}
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
