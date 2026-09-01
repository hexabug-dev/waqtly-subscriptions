import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "@remix-run/react";
import { Page, Button } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const PLAN_CONFIG = [
  {
    oldId: "gid://shopify/SellingPlanGroup/78453342531",
    name: "Subscribe (Plus) - Entry",
    merchantCode: "subscribe-plus-entry",
    productId: "gid://shopify/Product/14693478891843",
    entryPrice: "139.00",
    recurringPrice: "7.99",
  },
  {
    oldId: "gid://shopify/SellingPlanGroup/78453375299",
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
          merchantCode
          sellingPlans(first: 5) {
            nodes {
              id
              name
              category
              billingPolicy {
                ... on SellingPlanRecurringBillingPolicy { interval intervalCount }
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
    if (intent !== "fix-ownership") return json({ success: false, errors: ["Unknown action"], created: [] });

    const errors: string[] = [];
    const created: { name: string; id: string; appId: string | null }[] = [];

    for (const plan of PLAN_CONFIG) {
      try {
        const delRes = await admin.graphql(`mutation { sellingPlanGroupDelete(id: "${plan.oldId}") { deletedSellingPlanGroupId userErrors { field message } } }`);
        await delRes.json();
      } catch {}
    }

    for (const plan of PLAN_CONFIG) {
      try {
        const createRes = await admin.graphql(
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
                appId: "waqtly-subscriptions",
                options: ["Subscription Plan"],
                sellingPlansToCreate: [{
                  name: plan.name,
                  options: ["Subscription Plan"],
                  position: 1,
                  category: "SUBSCRIPTION",
                  billingPolicy: { recurring: { interval: "MONTH", intervalCount: 1, minCycles: 1 } },
                  deliveryPolicy: { recurring: { interval: "MONTH", intervalCount: 1 } },
                  pricingPolicies: [
                    { fixed: { adjustmentType: "PRICE", adjustmentValue: { fixedValue: plan.entryPrice } } },
                    { recurring: { afterCycle: 1, adjustmentType: "PRICE", adjustmentValue: { fixedValue: plan.recurringPrice } } },
                  ],
                }],
              },
              resources: { productIds: [plan.productId] },
            },
          }
        );
        const createData = await createRes.json();
        const result = createData.data?.sellingPlanGroupCreate;
        if (result?.userErrors?.length) {
          errors.push(`${plan.name}: ${result.userErrors.map((e: { message: string }) => e.message).join(", ")}`);
        } else if (result?.sellingPlanGroup) {
          created.push({ name: result.sellingPlanGroup.name, id: result.sellingPlanGroup.id, appId: result.sellingPlanGroup.appId });
        } else {
          errors.push(`${plan.name}: No data returned from Shopify`);
        }
      } catch (err) {
        errors.push(`${plan.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return json({ success: errors.length === 0, errors, created });
  } catch (topErr) {
    return json({ success: false, errors: [`Server error: ${topErr instanceof Error ? topErr.message : String(topErr)}`], created: [] });
  }
};

export function ErrorBoundary() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Page>
      <TitleBar title="Selling Plans — Error" />
      <div style={{ padding: "16px", backgroundColor: "#f8d7da", border: "1px solid #f5c6cb", borderRadius: "8px", color: "#842029" }}>
        <strong>Unexpected error</strong>
        <p style={{ margin: "4px 0 0" }}>{message}</p>
      </div>
    </Page>
  );
}

type PlanGroup = {
  id: string;
  name: string;
  appId: string | null;
  merchantCode: string | null;
  sellingPlans: { nodes: { id: string; name: string; category: string; billingPolicy: { interval: string; intervalCount: number } }[] };
};

// ─── Design tokens ───────────────────────────────────────────────
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px" };
const thStyle: React.CSSProperties = { padding: "10px 16px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "#6d7175", backgroundColor: "#f6f6f7", borderBottom: "1px solid #e1e3e5", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "12px 16px", fontSize: "13px", color: "#202223", verticalAlign: "top" };

function Pill({ label, tone }: { label: string; tone: "success" | "neutral" | "info" }) {
  const styles = {
    success: { backgroundColor: "#d4edda", color: "#1a7a4a" },
    neutral: { backgroundColor: "#f6f6f7", color: "#6d7175" },
    info:    { backgroundColor: "#cce5ff", color: "#004085" },
  };
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: "10px", fontSize: "12px", fontWeight: 600, lineHeight: "20px", ...styles[tone] }}>
      {label}
    </span>
  );
}

export default function SellingPlansPage() {
  const { planGroups } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <Page>
      <TitleBar title="Selling Plans" />
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

        {actionData?.success && (
          <div style={{ padding: "12px 16px", borderRadius: "8px", border: "1px solid #b7dfb8", backgroundColor: "#d4edda", color: "#1a7a4a", fontSize: "14px" }}>
            <strong>Plan groups created:</strong> {actionData.created.map((c) => c.name).join(" and ")}
          </div>
        )}
        {actionData && !actionData.success && actionData.errors?.length > 0 && (
          <div style={{ padding: "12px 16px", borderRadius: "8px", border: "1px solid #f5c6cb", backgroundColor: "#f8d7da", color: "#842029", fontSize: "14px" }}>
            <strong>Error:</strong> {actionData.errors.join("; ")}
          </div>
        )}

        <div style={{ ...card, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px 10px", borderBottom: "1px solid #e1e3e5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#202223" }}>
              Plan Groups ({planGroups.length})
            </p>
            {planGroups.length === 0 && (
              <Form method="post">
                <input type="hidden" name="intent" value="fix-ownership" />
                <Button submit loading={isSubmitting} variant="primary">Create Plan Groups</Button>
              </Form>
            )}
          </div>

          {planGroups.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: "14px", color: "#6d7175" }}>
                No selling plan groups. Click Create to set up the Plus and Nano subscription plans.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Name", "Merchant code", "Billing", "Category", "Status"].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(planGroups as PlanGroup[]).map((group) => {
                    const plan = group.sellingPlans.nodes[0];
                    const billing = plan?.billingPolicy
                      ? `Every ${plan.billingPolicy.intervalCount} ${plan.billingPolicy.interval.toLowerCase()}`
                      : "—";
                    return (
                      <tr key={group.id} style={{ borderBottom: "1px solid #f1f2f3" }}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{group.name}</td>
                        <td style={{ ...tdStyle, color: "#6d7175", fontSize: "12px", fontFamily: "monospace" }}>{group.merchantCode ?? group.id.split("/").pop()}</td>
                        <td style={tdStyle}>{billing}</td>
                        <td style={{ padding: "12px 16px", verticalAlign: "top" }}>
                          <Pill label={plan?.category ?? "—"} tone="info" />
                        </td>
                        <td style={{ padding: "12px 16px", verticalAlign: "top" }}>
                          <Pill label="App owned" tone="success" />
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
