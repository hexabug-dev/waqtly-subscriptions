import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  IndexTable,
  useIndexResourceState,
  Filters,
  ChoiceList,
  Button,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const STATUS_TONES: Record<string, "success" | "warning" | "critical" | "info" | undefined> = {
  ACTIVE: "success",
  PAUSED: "warning",
  FAILED: "critical",
  CANCELLED: undefined,
  EXPIRED: undefined,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") ?? "";

  const response = await admin.graphql(`
    #graphql
    {
      subscriptionContracts(first: 100) {
        edges {
          node {
            id
            status
            createdAt
            nextBillingDate
            customer {
              id
              firstName
              lastName
              email
            }
            lines(first: 3) {
              edges {
                node {
                  title
                  variantTitle
                  sellingPlanName
                  currentPrice {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `);

  const data = await response.json();
  let contracts = (data.data?.subscriptionContracts?.edges ?? []).map((e: any) => e.node);

  if (statusFilter) {
    contracts = contracts.filter((c: any) => c.status === statusFilter);
  }

  return {
    contracts,
    hasMore: data.data?.subscriptionContracts?.pageInfo?.hasNextPage ?? false,
    statusFilter,
  };
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatPrice(price: any) {
  if (!price?.amount) return "—";
  const symbol = price.currencyCode === "EUR" ? "€" : price.currencyCode;
  return `${symbol}${parseFloat(price.amount).toFixed(2)}`;
}

export default function Contracts() {
  const { contracts, hasMore, statusFilter } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const resourceName = { singular: "contract", plural: "contracts" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(contracts.map((c: any) => ({ id: c.id })));

  const rows = contracts.map((contract: any, index: number) => {
    const customer = contract.customer;
    const name = customer
      ? `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || customer.email
      : "Unknown";
    const line = contract.lines?.edges?.[0]?.node;
    const plan = line?.sellingPlanName ?? "—";
    const price = line?.currentPrice;

    return (
      <IndexTable.Row
        id={contract.id}
        key={contract.id}
        selected={selectedResources.includes(contract.id)}
        position={index}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {contract.id.replace("gid://shopify/SubscriptionContract/", "#")}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{name}</IndexTable.Cell>
        <IndexTable.Cell>
          {customer?.email ? (
            <Text variant="bodySm" tone="subdued" as="span">{customer.email}</Text>
          ) : "—"}
        </IndexTable.Cell>
        <IndexTable.Cell>{line?.title ?? "—"}</IndexTable.Cell>
        <IndexTable.Cell>{plan}</IndexTable.Cell>
        <IndexTable.Cell>{formatPrice(price)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={STATUS_TONES[contract.status]}>
            {contract.status}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{formatDate(contract.nextBillingDate)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodySm" tone="subdued" as="span">{formatDate(contract.createdAt)}</Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page>
      <TitleBar title="Subscription Contracts" />
      <BlockStack gap="400">

        {hasMore && (
          <Card>
            <Text tone="caution" as="p">
              Showing first 100 contracts. Pagination coming soon.
            </Text>
          </Card>
        )}

        <Card padding="0">
          <IndexTable
            resourceName={resourceName}
            itemCount={contracts.length}
            selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
            onSelectionChange={handleSelectionChange}
            headings={[
              { title: "ID" },
              { title: "Customer" },
              { title: "Email" },
              { title: "Product" },
              { title: "Plan" },
              { title: "Price" },
              { title: "Status" },
              { title: "Next billing" },
              { title: "Created" },
            ]}
            emptyState={
              <EmptyState
                heading="No contracts found"
                image=""
              >
                <Text as="p">
                  {statusFilter
                    ? `No contracts with status "${statusFilter}".`
                    : "Subscription contracts will appear here after the first checkout."}
                </Text>
              </EmptyState>
            }
          >
            {rows}
          </IndexTable>
        </Card>

        <InlineStack gap="200">
          {["", "ACTIVE", "PAUSED", "FAILED", "CANCELLED"].map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "primary" : "plain"}
              onClick={() => {
                const params = new URLSearchParams(searchParams);
                if (s) params.set("status", s);
                else params.delete("status");
                setSearchParams(params);
              }}
            >
              {s || "All"}
            </Button>
          ))}
        </InlineStack>

      </BlockStack>
    </Page>
  );
}
