import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation, useLoaderData } from "@remix-run/react";
import { Page, Card, Text, Button, BlockStack, InlineStack, Badge } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const PRESETS = [
  {
    label: "Subscription Contracts",
    query: `{
  subscriptionContracts(first: 10) {
    nodes {
      id
      status
      customer { defaultEmailAddress { emailAddress } }
      lines(first: 5) {
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
}`,
  },
  {
    label: "Selling Plan Groups",
    query: `{
  sellingPlanGroups(first: 10) {
    nodes {
      id
      name
      appId
      merchantCode
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
}`,
  },
  {
    label: "Webhooks",
    query: `{
  webhookSubscriptions(first: 25) {
    nodes {
      id
      topic
      endpoint {
        __typename
        ... on WebhookHttpEndpoint { callbackUrl }
      }
      format
      createdAt
    }
  }
}`,
  },
  {
    label: "Recent Orders",
    query: `{
  orders(first: 5, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id
      name
      displayFinancialStatus
      lineItems(first: 3) {
        nodes {
          title
          sellingPlanAllocation {
            sellingPlan { name }
          }
        }
      }
    }
  }
}`,
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const query = formData.get("query") as string;

  if (!query?.trim()) {
    return json({ error: "Query is required", result: null, ms: 0 });
  }

  const start = Date.now();
  try {
    const response = await admin.graphql(query);
    const data = await response.json();
    return json({ error: null, result: data, ms: Date.now() - start });
  } catch (err) {
    return json({
      error: err instanceof Error ? err.message : String(err),
      result: null,
      ms: Date.now() - start,
    });
  }
};

export default function GraphiQLPage() {
  useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isRunning = navigation.state === "submitting";

  const hasErrors = actionData?.result?.errors?.length > 0;
  const resultJson = actionData?.result
    ? JSON.stringify(actionData.result, null, 2)
    : null;

  return (
    <Page>
      <TitleBar title="GraphiQL" />
      <Layout>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "start" }}>
          {/* Left: query editor */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <Card padding="0">
              <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid #e1e3e5" }}>
                <Text as="h2" variant="headingSm">Query</Text>
              </div>
              <Form method="post" id="gql-form">
                <div style={{ padding: "12px 16px" }}>
                  <textarea
                    name="query"
                    id="gql-query"
                    defaultValue={PRESETS[0].query}
                    style={{
                      width: "100%",
                      minHeight: "340px",
                      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                      fontSize: "13px",
                      lineHeight: "1.6",
                      padding: "12px",
                      border: "1px solid #e1e3e5",
                      borderRadius: "6px",
                      backgroundColor: "#0d1117",
                      color: "#e6edf3",
                      resize: "vertical",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                    spellCheck={false}
                  />
                </div>
                <div style={{ padding: "0 16px 14px" }}>
                  <InlineStack gap="200" blockAlign="center">
                    <Button submit loading={isRunning} variant="primary" size="slim">
                      {isRunning ? "Running…" : "▶ Run"}
                    </Button>
                    {actionData?.ms != null && !isRunning && (
                      <Text as="span" variant="bodySm" tone="subdued">{actionData.ms} ms</Text>
                    )}
                    {actionData?.result && !isRunning && (
                      <Badge tone={hasErrors ? "critical" : "success"}>
                        {hasErrors ? "Errors" : "OK"}
                      </Badge>
                    )}
                  </InlineStack>
                </div>
              </Form>
            </Card>

            {/* Presets */}
            <Card padding="0">
              <div style={{ padding: "10px 16px 8px", borderBottom: "1px solid #e1e3e5" }}>
                <Text as="h2" variant="headingSm">Presets</Text>
              </div>
              <div style={{ padding: "8px 12px 10px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      const ta = document.getElementById("gql-query") as HTMLTextAreaElement;
                      if (ta) ta.value = p.query;
                    }}
                    style={{
                      padding: "4px 10px",
                      fontSize: "12px",
                      fontWeight: 500,
                      border: "1px solid #e1e3e5",
                      borderRadius: "4px",
                      background: "#f6f6f7",
                      color: "#202223",
                      cursor: "pointer",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Card>
          </div>

          {/* Right: result */}
          <Card padding="0">
            <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid #e1e3e5" }}>
              <Text as="h2" variant="headingSm">Result</Text>
            </div>
            <div style={{ padding: "12px 16px" }}>
              {actionData?.error ? (
                <pre style={{ margin: 0, fontSize: "13px", color: "#e5534b", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {actionData.error}
                </pre>
              ) : resultJson ? (
                <pre style={{
                  margin: 0,
                  fontSize: "12px",
                  lineHeight: "1.6",
                  color: "#e6edf3",
                  backgroundColor: "#0d1117",
                  padding: "12px",
                  borderRadius: "6px",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: "600px",
                  overflowY: "auto",
                }}>
                  {resultJson}
                </pre>
              ) : (
                <div style={{ padding: "40px 0", textAlign: "center", color: "#6d7175" }}>
                  <Text as="p" variant="bodySm" tone="subdued">Run a query to see results here.</Text>
                </div>
              )}
            </div>
          </Card>
        </div>
      </Layout>
    </Page>
  );
}

// Inline layout component since we're not importing Layout above
function Layout({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
