import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Page, Button } from "@shopify/polaris";
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

// ─── Design tokens ───────────────────────────────────────────────
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px" };
const thStyle: React.CSSProperties = { padding: "10px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#6d7175", backgroundColor: "#f6f6f7", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "12px 16px", fontSize: "13px", color: "#202223", verticalAlign: "top" };

function Pill({ label, tone }: { label: string; tone: "success" | "warning" | "neutral" | "info" }) {
  const styles = {
    success: { backgroundColor: "#d4edda", color: "#1a7a4a" },
    warning: { backgroundColor: "#fff3cd", color: "#856404" },
    neutral: { backgroundColor: "#f6f6f7", color: "#6d7175" },
    info:    { backgroundColor: "#cce5ff", color: "#004085" },
  };
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: "10px", fontSize: "12px", fontWeight: 600, lineHeight: "20px", ...styles[tone] }}>
      {label}
    </span>
  );
}

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
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* Result banner */}
        {actionData && (
          <div style={{
            padding: "12px 16px",
            borderRadius: "8px",
            border: `1px solid ${actionData.success ? "#b7dfb8" : "#f5c6cb"}`,
            backgroundColor: actionData.success ? "#d4edda" : "#f8d7da",
            color: actionData.success ? "#1a7a4a" : "#842029",
            fontSize: "14px",
          }}>
            {actionData.message}
          </div>
        )}

        {/* Missing topics warning */}
        {missingTopics.length > 0 && (
          <div style={{ padding: "14px 16px", borderRadius: "8px", border: "1px solid #ffe69c", backgroundColor: "#fff3cd", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
            <div>
              <p style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 600, color: "#856404" }}>
                {missingTopics.length} required topic{missingTopics.length > 1 ? "s" : ""} not registered
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {missingTopics.map((t) => (
                  <p key={t} style={{ margin: 0, fontSize: "12px", color: "#856404", fontFamily: "monospace" }}>{t}</p>
                ))}
              </div>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="register-missing" />
              <Button submit loading={isSubmitting} size="slim">
                {isSubmitting ? "Registering…" : "Register Missing"}
              </Button>
            </Form>
          </div>
        )}

        {/* Table */}
        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px 10px", borderBottom: "1px solid #e1e3e5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#202223" }}>
              Registered Webhooks ({rows.length})
            </p>
            {rows.length > 0 && missingTopics.length === 0 && (
              <Pill label="All topics active" tone="success" />
            )}
          </div>

          {rows.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: "14px", color: "#6d7175" }}>
                No webhooks registered under this app. Use the banner above to register all required topics.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Topic", "Callback URL", "Format", "Created", "Source", ""].map((h, i) => (
                      <th key={i} style={thStyle}>{h}</th>
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
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{topicDisplay}</td>
                        <td style={{ ...tdStyle, color: "#6d7175", fontSize: "12px", fontFamily: "monospace", maxWidth: "260px", wordBreak: "break-all" }}>
                          {url.length > 60 ? `…${url.slice(-50)}` : url}
                        </td>
                        <td style={tdStyle}>{w.format}</td>
                        <td style={{ ...tdStyle, color: "#6d7175", whiteSpace: "nowrap" }}>
                          {new Date(w.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ padding: "12px 16px", verticalAlign: "top" }}>
                          <Pill label={isOurs ? "App" : "External"} tone={isOurs ? "success" : "warning"} />
                        </td>
                        <td style={{ padding: "12px 16px", verticalAlign: "top" }}>
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={w.id} />
                            <Button submit size="slim" tone="critical" loading={isSubmitting}>Delete</Button>
                          </Form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </Page>
  );
}
