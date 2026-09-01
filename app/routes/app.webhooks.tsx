import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, Text, Badge, Button, BlockStack, InlineStack, Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const REQUIRED_TOPICS = [
  "SUBSCRIPTION_CONTRACTS_CREATE",
  "SUBSCRIPTION_CONTRACTS_UPDATE",
  "SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS",
  "SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE",
  "SUBSCRIPTION_BILLING_ATTEMPTS_CHALLENGED",
];

const CALLBACK_PATH = "/webhooks/subscription-contracts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(`
    query {
      webhookSubscriptions(first: 25) {
        nodes {
          id
          topic
          endpoint {
            __typename
            ... on WebhookHttpEndpoint { callbackUrl }
            ... on WebhookEventBridgeEndpoint { arn }
          }
          createdAt
          format
        }
      }
    }
  `);
  const data = await response.json();
  return json({ webhooks: data.data?.webhookSubscriptions?.nodes ?? [] });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "delete") {
    const id = formData.get("id") as string;
    try {
      const res = await admin.graphql(
        `mutation webhookSubscriptionDelete($id: ID!) {
          webhookSubscriptionDelete(id: $id) {
            deletedWebhookSubscriptionId
            userErrors { field message }
          }
        }`,
        { variables: { id } }
      );
      const data = await res.json();
      const errors = data.data?.webhookSubscriptionDelete?.userErrors ?? [];
      if (errors.length) return json({ success: false, message: errors.map((e: { message: string }) => e.message).join(", ") });
      return json({ success: true, message: "Webhook deleted." });
    } catch (err) {
      return json({ success: false, message: String(err) });
    }
  }

  if (intent === "register-missing") {
    const appUrl = process.env.SHOPIFY_APP_URL ?? "https://waqtly-subscriptions-production.up.railway.app";
    const callbackUrl = `${appUrl}${CALLBACK_PATH}`;
    const errors: string[] = [];
    const created: string[] = [];

    for (const topic of REQUIRED_TOPICS) {
      try {
        const res = await admin.graphql(
          `mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
            webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
              webhookSubscription { id topic }
              userErrors { field message }
            }
          }`,
          { variables: { topic, webhookSubscription: { callbackUrl, format: "JSON" } } }
        );
        const data = await res.json();
        const errs = data.data?.webhookSubscriptionCreate?.userErrors ?? [];
        if (errs.length) {
          errors.push(`${topic}: ${errs.map((e: { message: string }) => e.message).join(", ")}`);
        } else {
          created.push(topic);
        }
      } catch (err) {
        errors.push(`${topic}: ${String(err)}`);
      }
    }

    return json({
      success: errors.length === 0,
      message: errors.length
        ? `${created.length} registered. Errors: ${errors.join("; ")}`
        : `Registered ${created.length} webhook(s) successfully.`,
    });
  }

  return json({ success: false, message: "Unknown intent" });
};

type Webhook = {
  id: string;
  topic: string;
  endpoint: { __typename: string; callbackUrl?: string; arn?: string } | null;
  createdAt: string;
  format: string;
};

export default function WebhooksPage() {
  const { webhooks } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const rows = webhooks as Webhook[];
  const registeredTopics = new Set(rows.map((w) => w.topic));
  const missingTopics = REQUIRED_TOPICS.filter((t) => !registeredTopics.has(t));

  return (
    <Page>
      <TitleBar title="Webhooks" />
      <Layout>
        {actionData && (
          <Layout.Section>
            <Banner tone={actionData.success ? "success" : "critical"}>
              <p>{actionData.message}</p>
            </Banner>
          </Layout.Section>
        )}

        {missingTopics.length > 0 && (
          <Layout.Section>
            <Banner
              tone="warning"
              title={`${missingTopics.length} required topic${missingTopics.length > 1 ? "s" : ""} not registered under this app`}
              action={{
                content: isSubmitting ? "Registering…" : "Register Missing",
                onAction: () => {
                  const form = document.createElement("form");
                  form.method = "post";
                  const input = document.createElement("input");
                  input.name = "intent";
                  input.value = "register-missing";
                  form.appendChild(input);
                  document.body.appendChild(form);
                  form.submit();
                },
              }}
            >
              <BlockStack gap="100">
                {missingTopics.map((t) => (
                  <Text key={t} as="p" variant="bodySm" tone="subdued">{t}</Text>
                ))}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <div style={{ padding: "16px 20px 12px" }}>
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Registered Webhooks ({rows.length})</Text>
                {rows.length > 0 && missingTopics.length === 0 && (
                  <Badge tone="success">All topics active</Badge>
                )}
              </InlineStack>
            </div>

            {rows.length === 0 ? (
              <div style={{ padding: "24px 20px", textAlign: "center", color: "#6d7175" }}>
                <p style={{ margin: 0 }}>No webhooks registered under this app. Use the banner above to register all required topics.</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Topic", "Callback URL", "Format", "Created", ""].map((h, idx) => (
                        <th key={idx} style={{ padding: "10px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#6d7175", backgroundColor: "#f6f6f7", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((w) => {
                      const url = w.endpoint?.__typename === "WebhookHttpEndpoint"
                        ? w.endpoint.callbackUrl ?? "—"
                        : w.endpoint?.arn ?? "—";
                      const isOurs = url.includes("railway.app") || url.includes("waqtly.com");
                      const topicDisplay = w.topic.toLowerCase().replace(/_/g, " ").replace(/\//g, " / ");
                      return (
                        <tr key={w.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                          <td style={{ padding: "12px 16px", fontSize: "14px", color: "#202223", fontWeight: 600 }}>{topicDisplay}</td>
                          <td style={{ padding: "12px 16px", fontSize: "12px", color: "#6d7175", maxWidth: "260px", wordBreak: "break-all" }}>
                            {url.length > 60 ? `…${url.slice(-50)}` : url}
                          </td>
                          <td style={{ padding: "12px 16px" }}><Badge>{w.format}</Badge></td>
                          <td style={{ padding: "12px 16px", fontSize: "13px", color: "#6d7175", whiteSpace: "nowrap" }}>
                            {new Date(w.createdAt).toLocaleDateString()}
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone={isOurs ? "success" : "warning"}>{isOurs ? "App" : "External"}</Badge>
                              <Form method="post">
                                <input type="hidden" name="intent" value="delete" />
                                <input type="hidden" name="id" value={w.id} />
                                <Button submit size="slim" tone="critical" loading={isSubmitting}>Delete</Button>
                              </Form>
                            </InlineStack>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
