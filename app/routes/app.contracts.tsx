import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Layout, Card, Text, Badge, BlockStack,
} from "@shopify/polaris";
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
          customer {
            defaultEmailAddress { emailAddress }
          }
          lines(first: 3) {
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

const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "info"> = {
  ACTIVE: "success",
  PAUSED: "warning",
  CANCELLED: "critical",
  FAILED: "critical",
  EXPIRED: "info",
};

export default function ContractsPage() {
  const { contracts } = useLoaderData<typeof loader>();
  const rows = contracts as Contract[];

  const active = rows.filter((c) => c.status === "ACTIVE").length;
  const paused = rows.filter((c) => c.status === "PAUSED").length;

  return (
    <Page>
      <TitleBar title="Subscription Contracts" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <InlineStatCards total={rows.length} active={active} paused={paused} />

            <Card padding="0">
              {rows.length === 0 ? (
                <div style={{ padding: "24px 20px", textAlign: "center", color: "#6d7175" }}>
                  <p style={{ margin: 0 }}>Place a test checkout using a selling plan to create the first subscription contract.</p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Customer", "Product", "Plan", "Price", "Billing", "Status"].map((h) => (
                          <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#6d7175", backgroundColor: "#f6f6f7", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((contract) => {
                        const line = contract.lines.nodes[0];
                        const price = line?.currentPrice
                          ? `${line.currentPrice.currencyCode} ${parseFloat(line.currentPrice.amount).toFixed(2)}`
                          : "—";
                        const billing = contract.billingPolicy
                          ? `Every ${contract.billingPolicy.intervalCount} ${contract.billingPolicy.interval.toLowerCase()}`
                          : "—";
                        const email = contract.customer?.defaultEmailAddress?.emailAddress ?? "—";
                        return (
                          <tr key={contract.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                            <td style={{ padding: "12px 16px", fontSize: "14px", color: "#202223", fontWeight: 600 }}>{email}</td>
                            <td style={{ padding: "12px 16px", fontSize: "14px", color: "#202223" }}>{line?.title ?? "—"}</td>
                            <td style={{ padding: "12px 16px", fontSize: "13px", color: "#6d7175" }}>{line?.sellingPlanName ?? "—"}</td>
                            <td style={{ padding: "12px 16px", fontSize: "14px", color: "#202223" }}>{price}</td>
                            <td style={{ padding: "12px 16px", fontSize: "13px", color: "#6d7175" }}>{billing}</td>
                            <td style={{ padding: "12px 16px" }}><Badge tone={STATUS_TONE[contract.status] ?? "info"}>{contract.status}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function InlineStatCards({ total, active, paused }: { total: number; active: number; paused: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
      {[
        { label: "Total", value: total, tone: undefined },
        { label: "Active", value: active, tone: "#1a7a4a" },
        { label: "Paused", value: paused, tone: "#7a5a1a" },
      ].map(({ label, value, tone }) => (
        <Card key={label}>
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
            <Text as="p" variant="heading2xl" fontWeight="bold">
              <span style={tone ? { color: tone } : {}}>{value}</span>
            </Text>
          </BlockStack>
        </Card>
      ))}
    </div>
  );
}
