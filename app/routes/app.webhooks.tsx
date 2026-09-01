import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, Text, Badge, Button, BlockStack, InlineStack, Banner, DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const REQUIRED_TOPICS = [
  "subscription_contracts/create",
  "subscription_contracts/update",
  "subscription_billing_attempts/success",
  "subscription_billing_attempts/failure",
  "subscription_billing_attempts/challenged",
];

const WEBHOOK_CALLBACK = "/webhooks/subscription-contracts";

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
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
            ... on WebhookEventBridgeEndpoint {
              arn
            }
          }
          createdAt
          updatedAt
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
      return json({ success: true, message: `Deleted ${id}` });
    } catch (err) {
      return json({ success: false, message: String(err) });
    }
  }

  if (intent === "register-missing") {
    const appUrl = process.env.SHOPIFY_APP_URL ?? "https://waqtly-subscriptions-production.up.railway.app";
    const callbackUrl = `${appUrl}${WEBHOOK_CALLBACK}`;
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
          {
            variables: {
              topic: topic.toUpperCase().replace(/\//g, "_") as string,
              webhookSubscription: { callbackUrl, format: "JSON" },
            },
          }
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
        ? `Registered ${created.length}, failed: ${errors.join("; ")}`
        : `Registered: ${created.join(", ")}`,
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

  const registeredTopics = new Set((webhooks as Webhook[]).map((w) => w.topic.toLowerCase().replace(/_/g, "/")));
  const missingTopics = REQUIRED_TOPICS.filter((t) => !registeredTopics.has(t));

  const rows = (webhooks as Webhook[]).map((w) => {
    const url = w.endpoint?.__typename === "WebhookHttpEndpoint" ? w.endpoint.callbackUrl ?? "—" : w.endpoint?.arn ?? "—";
    const isOurs = url.includes("railway.app") || url.includes("waqtly.com");
    return [
      <Text as="span" variant="bodySm">{w.topic}</Text>,
      <Badge tone={isOurs ? "success" : "warning"}>{isOurs ? "App" : "Other"}</Badge>,
      <Text as="span" variant="bodySm" tone="subdued" breakWord>{url}</Text>,
      <Text as="span" variant="bodySm" tone="subdued">{new Date(w.createdAt).toLocaleDateString()}</Text>,
      <Form method="post">
        <input type="hidden" name="intent" value="delete" />
        <input type="hidden" name="id" value={w.id} />
        <Button submit size="slim" tone="critical" loading={isSubmitting}>Delete</Button>
      </Form>,
    ];
  });

  return (
    <Page>
      <TitleBar title="Webhooks" />
      <Layout>
        {actionData && (
          <Layout.Section>
            <Banner tone={actionData.success ? "success" : "critical"} title={actionData.message} />
          </Layout.Section>
        )}

        {missingTopics.length > 0 && (
          <Layout.Section>
            <Banner tone="warning" title={`${missingTopics.length} required topic(s) not registered`}>
              <BlockStack gap="100">
                {missingTopics.map((t) => <Text key={t} as="p" variant="bodySm">{t}</Text>)}
              </BlockStack>
              <br />
              <Form method="post">
                <input type="hidden" name="intent" value="register-missing" />
                <Button submit loading={isSubmitting}>Register Missing</Button>
              </Form>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Registered Webhooks ({webhooks.length})</Text>
              </InlineStack>

              {webhooks.length === 0 ? (
                <BlockStack gap="300">
                  <Text as="p" variant="bodyMd" tone="subdued">No webhooks registered under this app.</Text>
                  <Form method="post">
                    <input type="hidden" name="intent" value="register-missing" />
                    <Button submit loading={isSubmitting}>Register All Required</Button>
                  </Form>
                </BlockStack>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={["Topic", "Owner", "Callback URL", "Created", ""]}
                  rows={rows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
