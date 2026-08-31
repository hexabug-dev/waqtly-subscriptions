import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    #graphql
    {
      plus: sellingPlanGroup(id: "gid://shopify/SellingPlanGroup/78452949315") {
        id
        name
        sellingPlans(first: 1) { edges { node { id name options } } }
        products(first: 1) { edges { node { title } } }
      }
      nano: sellingPlanGroup(id: "gid://shopify/SellingPlanGroup/78452982083") {
        id
        name
        sellingPlans(first: 1) { edges { node { id name options } } }
        products(first: 1) { edges { node { title } } }
      }
      contracts: subscriptionContracts(first: 250) {
        edges {
          node {
            id
            status
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `);

  const data = await response.json();
  const contracts = data.data?.contracts?.edges ?? [];
  const active = contracts.filter((e: any) => e.node.status === "ACTIVE").length;
  const paused = contracts.filter((e: any) => e.node.status === "PAUSED").length;
  const cancelled = contracts.filter((e: any) => e.node.status === "CANCELLED").length;
  const failed = contracts.filter((e: any) => e.node.status === "FAILED").length;

  return {
    plus: data.data?.plus ?? null,
    nano: data.data?.nano ?? null,
    stats: {
      total: contracts.length,
      active,
      paused,
      cancelled,
      failed,
      hasMore: data.data?.contracts?.pageInfo?.hasNextPage ?? false,
    },
  };
};

function StatBox({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "critical" | "info" }) {
  return (
    <Box
      background="bg-surface-secondary"
      borderRadius="200"
      padding="400"
      minWidth="120px"
    >
      <BlockStack gap="100" align="center">
        <Text variant="heading2xl" as="p" tone={tone}>
          {value}
        </Text>
        <Text variant="bodySm" as="p" tone="subdued">
          {label}
        </Text>
      </BlockStack>
    </Box>
  );
}

function PlanCard({ group }: { group: any }) {
  if (!group) return null;
  const plan = group.sellingPlans?.edges?.[0]?.node;
  const product = group.products?.edges?.[0]?.node;
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h3">{group.name}</Text>
          <Badge tone="success">Active</Badge>
        </InlineStack>
        <Divider />
        <BlockStack gap="100">
          <InlineStack align="space-between">
            <Text variant="bodySm" tone="subdued" as="span">Product</Text>
            <Text variant="bodySm" as="span">{product?.title ?? "—"}</Text>
          </InlineStack>
          <InlineStack align="space-between">
            <Text variant="bodySm" tone="subdued" as="span">Plan</Text>
            <Text variant="bodySm" as="span">{plan?.name ?? "—"}</Text>
          </InlineStack>
          <InlineStack align="space-between">
            <Text variant="bodySm" tone="subdued" as="span">Option</Text>
            <Text variant="bodySm" as="span">{plan?.options?.[0] ?? "—"}</Text>
          </InlineStack>
          <InlineStack align="space-between">
            <Text variant="bodySm" tone="subdued" as="span">Group ID</Text>
            <Text variant="bodySm" as="span">{group.id.replace("gid://shopify/SellingPlanGroup/", "")}</Text>
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

export default function Dashboard() {
  const { plus, nano, stats } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Waqtly Subscriptions" />
      <BlockStack gap="600">

        {/* Contracts overview */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd" as="h2">Subscription Contracts</Text>
              <Button url="/app/contracts" variant="plain">View all</Button>
            </InlineStack>
            <InlineStack gap="300" wrap>
              <StatBox label="Total" value={stats.total} />
              <StatBox label="Active" value={stats.active} tone="success" />
              <StatBox label="Paused" value={stats.paused} tone="warning" />
              <StatBox label="Failed" value={stats.failed} tone="critical" />
              <StatBox label="Cancelled" value={stats.cancelled} />
            </InlineStack>
            {stats.hasMore && (
              <Text variant="bodySm" tone="caution" as="p">
                250+ contracts — showing first 250. Full list on the Contracts page.
              </Text>
            )}
          </BlockStack>
        </Card>

        {/* Selling plan groups */}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="headingMd" as="h2">Selling Plan Groups</Text>
            <Button url="/app/selling-plans" variant="plain">Manage</Button>
          </InlineStack>
          <Layout>
            <Layout.Section variant="oneHalf">
              <PlanCard group={plus} />
            </Layout.Section>
            <Layout.Section variant="oneHalf">
              <PlanCard group={nano} />
            </Layout.Section>
          </Layout>
        </BlockStack>

        {/* Quick links */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">Quick links</Text>
            <InlineStack gap="300">
              <Button url="/app/selling-plans">Selling Plans</Button>
              <Button url="/app/contracts">Contracts</Button>
            </InlineStack>
          </BlockStack>
        </Card>

      </BlockStack>
    </Page>
  );
}
