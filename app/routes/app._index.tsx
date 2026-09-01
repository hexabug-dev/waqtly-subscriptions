import { Page, Layout, Card, Text, BlockStack, Badge, InlineStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

export default function Index() {
  return (
    <Page>
      <TitleBar title="Waqtly Subscriptions" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Waqtly Subscriptions</Text>
              <Text as="p" variant="bodyMd">
                Manage your subscription plans, contracts, and billing from this dashboard.
              </Text>
              <InlineStack gap="200">
                <Badge tone="success">Shopify Payments verified</Badge>
                <Badge tone="success">8/8 webhooks registered</Badge>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Quick links</Text>
              <Text as="p" variant="bodySm">
                <a href="/app/selling-plans">Selling Plans →</a>
              </Text>
              <Text as="p" variant="bodySm">
                <a href="/app/contracts">Contracts →</a>
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
