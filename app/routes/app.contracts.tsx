import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page, Layout, Card, Text, Badge, BlockStack, IndexTable, EmptyState,
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
                <EmptyState
                  heading="No contracts yet"
                  image=""
                >
                  <p>Place a test checkout using a selling plan to create the first subscription contract.</p>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: "contract", plural: "contracts" }}
                  itemCount={rows.length}
                  headings={[
                    { title: "Customer" },
                    { title: "Product" },
                    { title: "Plan" },
                    { title: "Price" },
                    { title: "Billing" },
                    { title: "Status" },
                  ]}
                  selectable={false}
                >
                  {rows.map((contract, i) => {
                    const line = contract.lines.nodes[0];
                    const price = line?.currentPrice
                      ? `${line.currentPrice.currencyCode} ${parseFloat(line.currentPrice.amount).toFixed(2)}`
                      : "—";
                    const billing = contract.billingPolicy
                      ? `Every ${contract.billingPolicy.intervalCount} ${contract.billingPolicy.interval.toLowerCase()}`
                      : "—";
                    const email = contract.customer?.defaultEmailAddress?.emailAddress ?? "—";
                    return (
                      <IndexTable.Row id={contract.id} key={contract.id} position={i}>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">{email}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd">{line?.title ?? "—"}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd" tone="subdued">{line?.sellingPlanName ?? "—"}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd">{price}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd" tone="subdued">{billing}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge tone={STATUS_TONE[contract.status] ?? "info"}>
                            {contract.status}
                          </Badge>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
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
