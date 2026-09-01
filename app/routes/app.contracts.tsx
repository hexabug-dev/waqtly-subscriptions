import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, Badge, BlockStack, InlineStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query {
      subscriptionContracts(first: 20) {
        nodes {
          id
          status
          customer {
            defaultEmailAddress {
              emailAddress
            }
          }
          lines(first: 5) {
            nodes {
              title
              sellingPlanId
              sellingPlanName
              currentPrice { amount currencyCode }
            }
          }
          billingPolicy {
            interval
            intervalCount
          }
        }
      }
    }
  `);

  const data = await response.json();
  return json({ contracts: data.data?.subscriptionContracts?.nodes ?? [] });
};

type ContractLine = {
  title: string;
  sellingPlanId: string | null;
  sellingPlanName: string | null;
  currentPrice: { amount: string; currencyCode: string } | null;
};

type Contract = {
  id: string;
  status: string;
  customer: { defaultEmailAddress: { emailAddress: string } | null } | null;
  lines: { nodes: ContractLine[] };
  billingPolicy: { interval: string; intervalCount: number } | null;
};

export default function ContractsPage() {
  const { contracts } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Subscription Contracts" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Contracts ({contracts.length})
              </Text>

              {contracts.length === 0 && (
                <Text as="p" variant="bodyMd" tone="subdued">
                  No subscription contracts found. Place a test checkout with a selling plan to create one.
                </Text>
              )}

              {(contracts as Contract[]).map((contract) => (
                <Card key={contract.id}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">
                        {contract.customer?.defaultEmailAddress?.emailAddress ?? "Unknown customer"}
                      </Text>
                      <Badge tone={contract.status === "ACTIVE" ? "success" : "warning"}>
                        {contract.status}
                      </Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">{contract.id}</Text>
                    {contract.billingPolicy && (
                      <Text as="p" variant="bodySm">
                        Billing: every {contract.billingPolicy.intervalCount} {contract.billingPolicy.interval.toLowerCase()}
                      </Text>
                    )}
                    {contract.lines.nodes.map((line, i) => (
                      <Text key={i} as="p" variant="bodySm">
                        {line.title} — {line.sellingPlanName ?? "no plan"}{" "}
                        {line.currentPrice ? `(${line.currentPrice.currencyCode} ${line.currentPrice.amount})` : ""}
                      </Text>
                    ))}
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
