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
  Box,
  Divider,
  DataTable,
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
        merchantCode
        products(first: 5) { edges { node { id title } } }
        sellingPlans(first: 5) {
          edges {
            node {
              id
              name
              options
              category
              billingPolicy {
                ... on SellingPlanRecurringBillingPolicy {
                  interval
                  intervalCount
                  minCycles
                }
              }
              pricingPolicies {
                ... on SellingPlanFixedPricingPolicy {
                  adjustmentType
                  adjustmentValue {
                    ... on MoneyV2 { amount currencyCode }
                  }
                }
                ... on SellingPlanRecurringPricingPolicy {
                  adjustmentType
                  afterCycle
                  adjustmentValue {
                    ... on MoneyV2 { amount currencyCode }
                  }
                }
              }
            }
          }
        }
      }
      nano: sellingPlanGroup(id: "gid://shopify/SellingPlanGroup/78452982083") {
        id
        name
        merchantCode
        products(first: 5) { edges { node { id title } } }
        sellingPlans(first: 5) {
          edges {
            node {
              id
              name
              options
              category
              billingPolicy {
                ... on SellingPlanRecurringBillingPolicy {
                  interval
                  intervalCount
                  minCycles
                }
              }
              pricingPolicies {
                ... on SellingPlanFixedPricingPolicy {
                  adjustmentType
                  adjustmentValue {
                    ... on MoneyV2 { amount currencyCode }
                  }
                }
                ... on SellingPlanRecurringPricingPolicy {
                  adjustmentType
                  afterCycle
                  adjustmentValue {
                    ... on MoneyV2 { amount currencyCode }
                  }
                }
              }
            }
          }
        }
      }
    }
  `);

  const data = await response.json();
  return { plus: data.data?.plus ?? null, nano: data.data?.nano ?? null };
};

function formatPrice(policy: any) {
  const val = policy?.adjustmentValue;
  if (!val?.amount) return "—";
  return `€${parseFloat(val.amount).toFixed(2)}`;
}

function PricingRow({ policy, index }: { policy: any; index: number }) {
  const isFixed = "afterCycle" in policy ? false : !("afterCycle" in policy) && policy.adjustmentType !== undefined && !policy.afterCycle;
  const isRecurring = policy.afterCycle !== undefined;
  return (
    <InlineStack gap="300" blockAlign="center">
      <Badge tone={isRecurring ? "info" : "success"}>
        {isRecurring ? `Recurring (after cycle ${policy.afterCycle})` : "Entry / Fixed"}
      </Badge>
      <Text variant="bodySm" as="span">{formatPrice(policy)}</Text>
    </InlineStack>
  );
}

function GroupCard({ group, label }: { group: any; label: string }) {
  if (!group) {
    return (
      <Card>
        <Text tone="caution" as="p">Selling plan group not found.</Text>
      </Card>
    );
  }

  const plan = group.sellingPlans?.edges?.[0]?.node;
  const billing = plan?.billingPolicy;
  const products = group.products?.edges?.map((e: any) => e.node.title).join(", ");
  const groupNumericId = group.id.replace("gid://shopify/SellingPlanGroup/", "");
  const planNumericId = plan?.id?.replace("gid://shopify/SellingPlan/", "");

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h3">{group.name}</Text>
            <Text variant="bodySm" tone="subdued" as="p">
              Merchant code: <code>{group.merchantCode}</code>
            </Text>
          </BlockStack>
          <Badge tone="success">Active</Badge>
        </InlineStack>

        <Divider />

        <BlockStack gap="200">
          <Text variant="headingXs" tone="subdued" as="h4">GROUP</Text>
          <InlineStack align="space-between">
            <Text variant="bodySm" tone="subdued" as="span">Group ID</Text>
            <Text variant="bodySm" as="span">{groupNumericId}</Text>
          </InlineStack>
          <InlineStack align="space-between">
            <Text variant="bodySm" tone="subdued" as="span">Product</Text>
            <Text variant="bodySm" as="span">{products}</Text>
          </InlineStack>
        </BlockStack>

        {plan && (
          <>
            <Divider />
            <BlockStack gap="200">
              <Text variant="headingXs" tone="subdued" as="h4">SELLING PLAN</Text>
              <InlineStack align="space-between">
                <Text variant="bodySm" tone="subdued" as="span">Plan name</Text>
                <Text variant="bodySm" as="span">{plan.name}</Text>
              </InlineStack>
              <InlineStack align="space-between">
                <Text variant="bodySm" tone="subdued" as="span">Plan ID</Text>
                <Text variant="bodySm" as="span">{planNumericId}</Text>
              </InlineStack>
              <InlineStack align="space-between">
                <Text variant="bodySm" tone="subdued" as="span">Option label</Text>
                <Text variant="bodySm" as="span">{plan.options?.[0]}</Text>
              </InlineStack>
              <InlineStack align="space-between">
                <Text variant="bodySm" tone="subdued" as="span">Category</Text>
                <Badge>{plan.category}</Badge>
              </InlineStack>
            </BlockStack>

            {billing && (
              <>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="headingXs" tone="subdued" as="h4">BILLING</Text>
                  <InlineStack align="space-between">
                    <Text variant="bodySm" tone="subdued" as="span">Interval</Text>
                    <Text variant="bodySm" as="span">
                      Every {billing.intervalCount} {billing.interval?.toLowerCase()}
                    </Text>
                  </InlineStack>
                  {billing.minCycles && (
                    <InlineStack align="space-between">
                      <Text variant="bodySm" tone="subdued" as="span">Min cycles</Text>
                      <Text variant="bodySm" as="span">{billing.minCycles}</Text>
                    </InlineStack>
                  )}
                </BlockStack>
              </>
            )}

            {plan.pricingPolicies?.length > 0 && (
              <>
                <Divider />
                <BlockStack gap="200">
                  <Text variant="headingXs" tone="subdued" as="h4">PRICING POLICIES</Text>
                  {plan.pricingPolicies.map((policy: any, i: number) => (
                    <PricingRow key={i} policy={policy} index={i} />
                  ))}
                </BlockStack>
              </>
            )}
          </>
        )}
      </BlockStack>
    </Card>
  );
}

export default function SellingPlans() {
  const { plus, nano } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Selling Plans" />
      <BlockStack gap="400">
        <Text variant="bodyMd" as="p" tone="subdued">
          Both selling plan groups are owned by Waqtly Subscriptions (app ID 416841826305).
          All subscription API calls must use this app's token.
        </Text>
        <Layout>
          <Layout.Section variant="oneHalf">
            <GroupCard group={plus} label="Plus" />
          </Layout.Section>
          <Layout.Section variant="oneHalf">
            <GroupCard group={nano} label="Nano" />
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
