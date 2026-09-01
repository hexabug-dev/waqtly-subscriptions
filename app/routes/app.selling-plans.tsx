import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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
    currency: "EUR",
  },
  {
    oldId: "gid://shopify/SellingPlanGroup/78452982083",
    name: "Subscribe (Nano) - Entry",
    merchantCode: "subscribe-nano-entry",
    productId: "gid://shopify/Product/14696508358979",
    entryPrice: "99.00",
    recurringPrice: "7.99",
    currency: "EUR",
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
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "fix-ownership") {
    const errors: string[] = [];
    const created: { name: string; id: string; appId: string | null }[] = [];

    // Delete old groups (errors here are non-fatal — they may already be gone)
    for (const plan of PLAN_CONFIG) {
      const delRes = await admin.graphql(`
        mutation {
          sellingPlanGroupDelete(id: "${plan.oldId}") {
            deletedSellingPlanGroupId
            userErrors { field message }
          }
        }
      `);
      await delRes.json(); // consume response
    }

    // Re-create under this app's OAuth token
    for (const plan of PLAN_CONFIG) {
      try {
        const createRes = await admin.graphql(
          `mutation sellingPlanGroupCreate($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
            sellingPlanGroupCreate(input: $input, resources: $resources) {
              sellingPlanGroup {
                id
                appId
                name
              }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              input: {
                name: plan.name,
                merchantCode: plan.merchantCode,
                options: ["Subscription Plan"],
                sellingPlans: [
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
                        anchors: [],
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
              resources: {
                productIds: [plan.productId],
              },
            },
          }
        );

        const createData = await createRes.json();
        const result = createData.data?.sellingPlanGroupCreate;

        if (result?.userErrors?.length) {
          errors.push(`${plan.name}: ${result.userErrors.map((e: { message: string }) => e.message).join(", ")}`);
        } else if (result?.sellingPlanGroup) {
          created.push({
            name: result.sellingPlanGroup.name,
            id: result.sellingPlanGroup.id,
            appId: result.sellingPlanGroup.appId,
          });
        } else {
          errors.push(`${plan.name}: No data returned from Shopify`);
        }
      } catch (err) {
        errors.push(`${plan.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return json({ success: errors.length === 0, errors, created });
  }

  return json({ success: false, errors: ["Unknown action"], created: [] });
};

export default function SellingPlansPage() {
  const { planGroups } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const orphaned = planGroups.filter((g: { appId: string | null }) => !g.appId);
  const owned = planGroups.filter((g: { appId: string | null }) => g.appId);

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
                New IDs assigned by Shopify — update your docs with the IDs shown below.
                Run a test checkout to confirm <code>SUBSCRIPTION_CONTRACTS_CREATE</code> fires.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {actionData && !actionData.success && actionData.errors?.length > 0 && (
          <Layout.Section>
            <Banner title="Some errors occurred" tone="critical">
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
                <Text as="p" variant="bodyMd" tone="subdued">
                  No selling plan groups found. They may have been deleted. Use the button above
                  to re-create them.
                </Text>
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

              {planGroups.length === 0 && orphaned.length === 0 && (
                <Form method="post">
                  <input type="hidden" name="intent" value="fix-ownership" />
                  <Button submit loading={isSubmitting}>
                    Create Selling Plan Groups
                  </Button>
                </Form>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
