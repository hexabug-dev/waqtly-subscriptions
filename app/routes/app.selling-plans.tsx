import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "@remix-run/react";
import {
  Page, Layout, Card, Text, Badge, Button, BlockStack, InlineStack, Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const PLAN_CONFIG = [
  {
    oldId: "gid://shopify/SellingPlanGroup/78452949315",
    name: "Subscribe (Plus) - Entry",
    merchantCode: "subscribe-plus-entry",
    productId: "gid://shopify/Product/14693478891843",
    entryPrice: "139.00",
    recurringPrice: "7.99",
  },
  {
    oldId: "gid://shopify/SellingPlanGroup/78452982083",
    name: "Subscribe (Nano) - Entry",
    merchantCode: "subscribe-nano-entry",
    productId: "gid://shopify/Product/14696508358979",
    entryPrice: "99.00",
    recurringPrice: "7.99",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query {
      sellingPlanGroups(first: 20) {
        nodes {
          id
          name
          appId
          sellingPlans(first: 5) {
            nodes {
              id
              name
              category
              billingPolicy {
                ... on SellingPlanRecurringBillingPolicy {
                  interval
                  intervalCount
                }
              }
            }
          }
        }
      }
    }
  `);

  const data = await response.json();
  return json({ planGroups: data.data?.sellingPlanGroups?.nodes ?? [] });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    if (intent !== "fix-ownership") {
      return json({ success: false, errors: ["Unknown action"], created: [] });
    }

    const errors: string[] = [];
    const created: { name: string; id: string; appId: string | null }[] = [];

    // Delete old groups — non-fatal; they may already be gone
    for (const plan of PLAN_CONFIG) {
      try {
        const delRes = await admin.graphql(`
          mutation {
            sellingPlanGroupDelete(id: "${plan.oldId}") {
              deletedSellingPlanGroupId
              userErrors { field message }
            }
          }
        `);
        await delRes.json();
      } catch (delErr) {
        console.error(`[selling-plans] delete ${plan.oldId}:`, delErr);
      }
    }

    // Re-create under this app's OAuth token
    // Step 1: create the group (sellingPlans removed from SellingPlanGroupInput in 2025-10)
    // Step 2: add selling plans via sellingPlanGroupAddSellingPlans
    for (const plan of PLAN_CONFIG) {
      try {
        // --- Step 1: create the group shell ---
        const groupRes = await admin.graphql(
          `mutation sellingPlanGroupCreate($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
            sellingPlanGroupCreate(input: $input, resources: $resources) {
              sellingPlanGroup { id appId name }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              input: {
                name: plan.name,
                merchantCode: plan.merchantCode,
                options: ["Subscription Plan"],
              },
              resources: {
                productIds: [plan.productId],
              },
            },
          }
        );

        const groupData = await groupRes.json();
        const groupResult = groupData.data?.sellingPlanGroupCreate;

        if (groupResult?.userErrors?.length) {
          const msg = groupResult.userErrors.map((e: { message: string }) => e.message).join(", ");
          console.error(`[selling-plans] group userErrors for ${plan.name}:`, msg);
          errors.push(`${plan.name} (group): ${msg}`);
          continue;
        }

        const groupId = groupResult?.sellingPlanGroup?.id;
        if (!groupId) {
          console.error(`[selling-plans] no groupId for ${plan.name}:`, JSON.stringify(groupData));
          errors.push(`${plan.name}: No group ID returned`);
          continue;
        }

        // --- Step 2: add selling plans ---
        const plansRes = await admin.graphql(
          `mutation addPlans($id: ID!, $sellingPlansToAdd: [SellingPlanInput!]!) {
            sellingPlanGroupAddSellingPlans(id: $id, sellingPlansToAdd: $sellingPlansToAdd) {
              sellingPlans { id name }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              id: groupId,
              sellingPlansToAdd: [
                {
                  name: plan.name,
                  options: ["Subscription Plan"],
                  position: 1,
                  category: "SUBSCRIPTION",
                  billingPolicy: {
                    recurring: {
                      interval: "MONTH",
                      intervalCount: 1,
                      minCycles: 1,
                    },
                  },
                  deliveryPolicy: {
                    recurring: {
                      interval: "MONTH",
                      intervalCount: 1,
                    },
                  },
                  pricingPolicies: [
                    {
                      fixed: {
                        adjustmentType: "PRICE",
                        adjustmentValue: { fixedValue: plan.entryPrice },
                      },
                    },
                    {
                      recurring: {
                        afterCycle: 1,
                        adjustmentType: "PRICE",
                        adjustmentValue: { fixedValue: plan.recurringPrice },
                      },
                    },
                  ],
                },
              ],
            },
          }
        );

        const plansData = await plansRes.json();
        const plansResult = plansData.data?.sellingPlanGroupAddSellingPlans;

        if (plansResult?.userErrors?.length) {
          const msg = plansResult.userErrors.map((e: { message: string }) => e.message).join(", ");
          console.error(`[selling-plans] plans userErrors for ${plan.name}:`, msg);
          errors.push(`${plan.name} (plans): ${msg}`);
        } else {
          created.push({
            name: groupResult.sellingPlanGroup.name,
            id: groupId,
            appId: groupResult.sellingPlanGroup.appId,
          });
        }
      } catch (err) {
        console.error(`[selling-plans] exception for ${plan.name}:`, err);
        errors.push(`${plan.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return json({ success: errors.length === 0, errors, created });
  } catch (topErr) {
    console.error("[selling-plans] action top-level error:", topErr);
    return json({
      success: false,
      errors: [`Server error: ${topErr instanceof Error ? topErr.message : String(topErr)}`],
      created: [],
    });
  }
};

export function ErrorBoundary() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Page>
      <TitleBar title="Selling Plans — Error" />
      <Layout>
        <Layout.Section>
          <Banner title="Unexpected error" tone="critical">
            <p>{message}</p>
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export default function SellingPlansPage() {
  const { planGroups } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const orphaned = planGroups.filter((g: { appId: string | null }) => !g.appId);

  return (
    <Page>
      <TitleBar title="Selling Plans" />
      <Layout>
        {orphaned.length > 0 && !actionData?.success && (
          <Layout.Section>
            <Banner title={`${orphaned.length} plan group(s) have no app owner`} tone="warning">
              <p>
                Shopify cannot auto-create subscription contracts without an app owner on the selling
                plan group. Click <strong>Fix Ownership</strong> to delete and re-create them under
                this app. The products will be re-linked automatically.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {actionData?.success && (
          <Layout.Section>
            <Banner title="Ownership fixed successfully" tone="success">
              <p>
                {actionData.created.map((c) => c.name).join(" and ")} re-created under this app.
                Run a test checkout to confirm <code>SUBSCRIPTION_CONTRACTS_CREATE</code> fires.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {actionData && !actionData.success && actionData.errors?.length > 0 && (
          <Layout.Section>
            <Banner title="Errors creating selling plan groups" tone="critical">
              {actionData.errors.map((e: string, i: number) => <p key={i}>{e}</p>)}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Plan Groups ({planGroups.length})
                </Text>
                {orphaned.length > 0 && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="fix-ownership" />
                    <Button submit tone="critical" loading={isSubmitting}>
                      Fix Ownership — Delete &amp; Recreate
                    </Button>
                  </Form>
                )}
              </InlineStack>

              {planGroups.length === 0 && (
                <BlockStack gap="300">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No selling plan groups found. Click below to create them under this app.
                  </Text>
                  <Form method="post">
                    <input type="hidden" name="intent" value="fix-ownership" />
                    <Button submit loading={isSubmitting}>
                      Create Selling Plan Groups
                    </Button>
                  </Form>
                </BlockStack>
              )}

              {planGroups.map((group: {
                id: string;
                name: string;
                appId: string | null;
                sellingPlans: { nodes: { id: string; name: string; category: string }[] };
              }) => (
                <Card key={group.id}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">{group.name}</Text>
                      {group.appId ? (
                        <Badge tone="success">App owned</Badge>
                      ) : (
                        <Badge tone="critical">appId: null — contracts broken</Badge>
                      )}
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">{group.id}</Text>
                    <Text as="p" variant="bodySm">
                      Plans: {group.sellingPlans.nodes.map((p) => `${p.name} (${p.category})`).join(", ")}
                    </Text>
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
