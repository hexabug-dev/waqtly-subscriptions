import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation, useLoaderData } from "@remix-run/react";
import { Page, Card, Text, Button, InlineStack, Badge } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const PRESETS: { label: string; tag: string; query: string; variables?: string }[] = [
  {
    label: "Contracts",
    tag: "query",
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
    label: "Selling Plans",
    tag: "query",
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
    tag: "query",
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
    tag: "query",
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
  {
    label: "Billing Attempts",
    tag: "query",
    query: `{
  subscriptionBillingAttempts(
    subscriptionContractId: "gid://shopify/SubscriptionContract/REPLACE_ID"
    first: 10
  ) {
    nodes {
      id
      ready
      errorMessage
      errorCode
      order { id name totalPriceSet { shopMoney { amount currencyCode } } }
    }
  }
}`,
  },
  {
    label: "Delete Webhook",
    tag: "mutation",
    query: `mutation webhookSubscriptionDelete($id: ID!) {
  webhookSubscriptionDelete(id: $id) {
    deletedWebhookSubscriptionId
    userErrors { field message }
  }
}`,
    variables: `{
  "id": "gid://shopify/WebhookSubscription/REPLACE_ID"
}`,
  },
  {
    label: "Cancel Contract",
    tag: "mutation",
    query: `mutation subscriptionContractUpdate($contractId: ID!, $input: SubscriptionContractUpdateInput!) {
  subscriptionContractUpdate(contractId: $contractId, input: $input) {
    contract { id status }
    userErrors { field message }
  }
}`,
    variables: `{
  "contractId": "gid://shopify/SubscriptionContract/REPLACE_ID",
  "input": { "status": "CANCELLED" }
}`,
  },
  {
    label: "Pause Contract",
    tag: "mutation",
    query: `mutation subscriptionContractUpdate($contractId: ID!, $input: SubscriptionContractUpdateInput!) {
  subscriptionContractUpdate(contractId: $contractId, input: $input) {
    contract { id status }
    userErrors { field message }
  }
}`,
    variables: `{
  "contractId": "gid://shopify/SubscriptionContract/REPLACE_ID",
  "input": { "status": "PAUSED" }
}`,
  },
  {
    label: "Resume Contract",
    tag: "mutation",
    query: `mutation subscriptionContractActivate($subscriptionContractId: ID!) {
  subscriptionContractActivate(subscriptionContractId: $subscriptionContractId) {
    contract { id status }
    userErrors { field message }
  }
}`,
    variables: `{
  "subscriptionContractId": "gid://shopify/SubscriptionContract/REPLACE_ID"
}`,
  },
];

const TAG_COLORS: Record<string, { bg: string; color: string }> = {
  query: { bg: "#e3f1e3", color: "#1a7a4a" },
  mutation: { bg: "#fdf3e7", color: "#7a4a1a" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const query = formData.get("query") as string;
  const variablesRaw = (formData.get("variables") as string)?.trim();

  if (!query?.trim()) {
    return json({ error: "Query is required", result: null, ms: 0 });
  }

  let variables: Record<string, unknown> | undefined;
  if (variablesRaw) {
    try {
      variables = JSON.parse(variablesRaw);
    } catch {
      return json({ error: "Variables must be valid JSON", result: null, ms: 0 });
    }
  }

  const start = Date.now();
  try {
    const response = variables
      ? await admin.graphql(query, { variables })
      : await admin.graphql(query);
    const data = await response.json();
    const { headers: _h, ...cleanData } = data as Record<string, unknown>;
    return json({ error: null, result: cleanData, ms: Date.now() - start });
  } catch (err) {
    return json({
      error: err instanceof Error ? err.message : String(err),
      result: null,
      ms: Date.now() - start,
    });
  }
};

const editorStyle: React.CSSProperties = {
  width: "100%",
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  fontSize: "13px",
  lineHeight: "1.6",
  padding: "12px",
  border: "1px solid #30363d",
  borderRadius: "6px",
  backgroundColor: "#0d1117",
  color: "#e6edf3",
  resize: "vertical",
  outline: "none",
  boxSizing: "border-box" as const,
};

export default function GraphiQLPage() {
  useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isRunning = navigation.state === "submitting";

  const hasErrors = actionData?.result?.errors?.length > 0;
  const resultJson = actionData?.result ? JSON.stringify(actionData.result, null, 2) : null;

  return (
    <Page>
      <TitleBar title="GraphiQL" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "start" }}>

        {/* Left: editor */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <Card padding="0">
            <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid #e1e3e5" }}>
              <Text as="h2" variant="headingSm">Query</Text>
            </div>
            <Form method="post" id="gql-form">
              <div style={{ padding: "12px 16px 8px" }}>
                <textarea
                  name="query"
                  id="gql-query"
                  defaultValue={PRESETS[0].query}
                  style={{ ...editorStyle, minHeight: "260px" }}
                  spellCheck={false}
                />
              </div>
              <div style={{ padding: "0 16px 8px" }}>
                <Text as="p" variant="bodySm" tone="subdued">Variables (JSON)</Text>
              </div>
              <div style={{ padding: "0 16px 8px" }}>
                <textarea
                  name="variables"
                  id="gql-variables"
                  placeholder="{}"
                  style={{ ...editorStyle, minHeight: "80px", opacity: 0.85 }}
                  spellCheck={false}
                />
              </div>
              <div style={{ padding: "8px 16px 14px" }}>
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
              {PRESETS.map((p) => {
                const tc = TAG_COLORS[p.tag] ?? TAG_COLORS.query;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      const q = document.getElementById("gql-query") as HTMLTextAreaElement;
                      const v = document.getElementById("gql-variables") as HTMLTextAreaElement;
                      if (q) q.value = p.query;
                      if (v) v.value = p.variables ?? "";
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
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 5px", borderRadius: "3px", backgroundColor: tc.bg, color: tc.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {p.tag}
                    </span>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Right: result */}
        <Card padding="0">
          <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid #e1e3e5" }}>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">Result</Text>
              {resultJson && !isRunning && (
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(resultJson)}
                  style={{ fontSize: "12px", background: "none", border: "none", cursor: "pointer", color: "#6d7175", padding: "2px 6px" }}
                >
                  Copy
                </button>
              )}
            </InlineStack>
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
                maxHeight: "640px",
                overflowY: "auto",
              }}>
                {resultJson}
              </pre>
            ) : (
              <div style={{ padding: "60px 0", textAlign: "center", color: "#6d7175" }}>
                <Text as="p" variant="bodySm" tone="subdued">Run a query or mutation to see results.</Text>
              </div>
            )}
          </div>
        </Card>

      </div>
    </Page>
  );
}
