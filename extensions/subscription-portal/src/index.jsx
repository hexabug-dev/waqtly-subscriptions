import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';

const SUBSCRIPTIONS_QUERY = `
  query GetSubscriptions {
    customer {
      subscriptionContracts(first: 10) {
        edges {
          node {
            id
            status
            createdAt
            nextBillingDate
            originOrder {
              totalPrice { amount currencyCode }
            }
            customerPaymentMethod {
              id
              instrumentUpdateUrl
              instrument {
                ... on CustomerCreditCard {
                  brand
                  lastDigits
                  expiryMonth
                  expiryYear
                }
              }
            }
            lines(first: 10) {
              edges {
                node {
                  id
                  title
                  variantTitle
                  sellingPlanName
                  currentPrice { amount currencyCode }
                  pricingPolicy {
                    cycleDiscounts {
                      afterCycle
                      computedPrice { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// DEV_MOCK: set to false once pause/resume backend is live
const DEV_MOCK = true;
const MOCK_CONTRACT = {
  id: 'gid://shopify/SubscriptionContract/26114752835',
  status: 'ACTIVE',
  createdAt: '2026-08-31T10:00:00Z',
  nextBillingDate: '2027-02-28T10:00:00Z',
  originOrder: {
    totalPrice: { amount: '238.00', currencyCode: 'EUR' },
  },
  customerPaymentMethod: {
    id: 'gid://shopify/CustomerPaymentMethod/abc123',
    instrumentUpdateUrl: null,
    instrument: { brand: 'visa', lastDigits: '4242', expiryMonth: 12, expiryYear: 2030 },
  },
  lines: {
    edges: [
      {
        node: {
          id: '1',
          title: 'Waqtly Plus',
          variantTitle: null,
          sellingPlanName: 'Waqtly Plus — Monthly',
          currentPrice: { amount: '7.99', currencyCode: 'EUR' },
          pricingPolicy: {
            cycleDiscounts: [
              { afterCycle: 0, computedPrice: { amount: '0.00', currencyCode: 'EUR' } },
              { afterCycle: 6, computedPrice: { amount: '7.99', currencyCode: 'EUR' } },
            ],
          },
        },
      },
      {
        node: {
          id: '2',
          title: 'Waqtly Nano',
          variantTitle: null,
          sellingPlanName: 'Waqtly Nano — Monthly',
          currentPrice: { amount: '7.99', currencyCode: 'EUR' },
          pricingPolicy: {
            cycleDiscounts: [
              { afterCycle: 0, computedPrice: { amount: '0.00', currencyCode: 'EUR' } },
              { afterCycle: 6, computedPrice: { amount: '7.99', currencyCode: 'EUR' } },
            ],
          },
        },
      },
    ],
  },
};

function fmt(amount, currencyCode) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode || 'EUR',
      minimumFractionDigits: 2,
    }).format(parseFloat(amount || 0));
  } catch {
    return `${currencyCode || ''}${parseFloat(amount || 0).toFixed(2)}`;
  }
}

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function capitalise(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export default async () => {
  render(<SubscriptionPortal />, document.body);
};

function SubscriptionPortal() {
  const [contracts, setContracts] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      if (DEV_MOCK) {
        setContracts([MOCK_CONTRACT]);
        return;
      }
      const result = await shopify.query(SUBSCRIPTIONS_QUERY);
      const edges = result?.data?.customer?.subscriptionContracts?.edges ?? [];
      setContracts(edges.map((e) => e.node));
    } catch {
      setLoadError('Unable to load your subscription. Please try again later.');
    }
  }, []);

  useEffect(() => { load(); }, []);

  if (loadError) {
    return (
      <s-stack spacing="base">
        <s-heading level="1">My Subscription</s-heading>
        <s-banner tone="critical"><s-text>{loadError}</s-text></s-banner>
      </s-stack>
    );
  }

  if (contracts === null) {
    return (
      <s-stack spacing="base">
        <s-heading level="1">My Subscription</s-heading>
        <s-spinner size="large" />
      </s-stack>
    );
  }

  const visible = contracts.filter(
    (c) => c.status !== 'CANCELLED' && c.status !== 'EXPIRED',
  );

  return (
    <s-stack spacing="loose">
      <s-heading level="1">My Subscription</s-heading>
      {visible.length === 0 ? (
        <s-text>You have no active subscriptions.</s-text>
      ) : (
        visible.map((contract) => (
          <ContractCard key={contract.id} contract={contract} onRefresh={load} />
        ))
      )}
    </s-stack>
  );
}

function ContractCard({ contract, onRefresh }) {
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  const lines = contract.lines?.edges?.map((e) => e.node) ?? [];
  const pm = contract.customerPaymentMethod;
  const pmCard = pm?.instrument;
  const updateUrl = pm?.instrumentUpdateUrl;

  const isActive = contract.status === 'ACTIVE';
  const isPaused = contract.status === 'PAUSED';
  const isFailed = contract.status === 'FAILED';

  const STATUS_LABELS = { ACTIVE: 'Active', PAUSED: 'Paused', FAILED: 'Payment failed' };
  const STATUS_TONES = { ACTIVE: 'success', PAUSED: 'warning', FAILED: 'critical' };

  // Entry payment from original order
  const originPrice = contract.originOrder?.totalPrice;
  const entryAmount = originPrice ? fmt(originPrice.amount, originPrice.currencyCode) : null;
  const startDate = fmtDate(contract.createdAt);
  const nextDate = fmtDate(contract.nextBillingDate);

  // Free months — derived from first line's pricing policy
  const firstLine = lines[0];
  const discounts = firstLine?.pricingPolicy?.cycleDiscounts ?? [];
  const firstPaid = discounts.find((d) => parseFloat(d.computedPrice?.amount ?? '0') > 0);
  const freeMonths = firstPaid?.afterCycle ?? 0;

  async function confirmPause() {
    setLoading(true);
    setActionError(null);
    setPauseConfirmOpen(false);
    try {
      const resp = await fetch('https://hooks.waqtly.com/subscriptions/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: contract.id }),
      });
      if (!resp.ok) throw new Error('pause_failed');
      await onRefresh();
    } catch {
      setActionError('Unable to pause at this time. Please contact support@waqtly.com.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmResume() {
    setLoading(true);
    setActionError(null);
    try {
      const resp = await fetch('https://hooks.waqtly.com/subscriptions/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: contract.id }),
      });
      if (!resp.ok) throw new Error('resume_failed');
      await onRefresh();
    } catch {
      setActionError('Unable to resume at this time. Please contact support@waqtly.com.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <s-box background="base" padding="base" border="base base">
      <s-stack spacing="base">

        {/* ── Status banners ── */}
        {isPaused && (
          <s-banner tone="warning">
            <s-text>Your subscription is paused. Waqtly features on your tablet are restricted until you resume.</s-text>
          </s-banner>
        )}
        {isFailed && (
          <s-banner tone="critical">
            <s-text>Your last payment failed. Update your payment method to restore full access.</s-text>
          </s-banner>
        )}

        {/* ── Devices ── */}
        <s-heading level="3">Devices</s-heading>
        <s-stack spacing="tight">
          {lines.map((line) => (
            <s-stack key={line.id} direction="inline" spacing="tight" alignItems="center">
              <s-text emphasis="bold">{line.title}</s-text>
              <s-text size="small" tone="subdued">{line.sellingPlanName ?? ''}</s-text>
              <s-badge tone={STATUS_TONES[contract.status] ?? 'info'}>
                {STATUS_LABELS[contract.status] ?? contract.status}
              </s-badge>
            </s-stack>
          ))}
        </s-stack>

        <s-divider />

        {/* ── Billing timeline ── */}
        <s-heading level="3">Billing timeline</s-heading>
        <s-stack spacing="tight">

          {entryAmount && (
            <s-stack direction="inline" spacing="tight" alignItems="center">
              <s-text size="small">
                Entry payment{startDate ? ` · ${startDate}` : ''}
              </s-text>
              <s-text size="small" emphasis="bold">{entryAmount}</s-text>
              <s-badge tone="success">Paid</s-badge>
            </s-stack>
          )}

          {freeMonths > 0 && (
            <s-stack direction="inline" spacing="tight" alignItems="center">
              <s-text size="small">Months 1–{freeMonths} · No charge</s-text>
              <s-badge tone="info">Free period</s-badge>
            </s-stack>
          )}

          {lines.map((line) => {
            const monthly = line.currentPrice;
            if (!monthly) return null;
            const monthlyStr = fmt(monthly.amount, monthly.currencyCode);
            const label = nextDate
              ? `From ${nextDate}`
              : freeMonths > 0
              ? `Month ${freeMonths + 1} onwards`
              : 'Recurring';
            return (
              <s-stack key={line.id} direction="inline" spacing="tight" alignItems="center">
                <s-text size="small">
                  {line.title} · {label}
                </s-text>
                <s-text size="small" emphasis="bold">{monthlyStr} / month</s-text>
                <s-badge tone={isPaused ? 'warning' : 'info'}>
                  {isPaused ? 'Paused' : 'Upcoming'}
                </s-badge>
              </s-stack>
            );
          })}

        </s-stack>

        {/* ── Payment method ── */}
        {pmCard && (
          <>
            <s-divider />
            <s-heading level="3">Payment method</s-heading>
            <s-stack direction="inline" spacing="tight" alignItems="center">
              <s-text>
                {capitalise(pmCard.brand ?? 'Card')} ending {pmCard.lastDigits}
                {pmCard.expiryMonth && pmCard.expiryYear
                  ? ` · Expires ${pmCard.expiryMonth}/${String(pmCard.expiryYear).slice(-2)}`
                  : ''}
              </s-text>
              {updateUrl && (
                <s-button variant="secondary" href={updateUrl} size="slim">Update</s-button>
              )}
            </s-stack>
          </>
        )}

        {/* ── Action error ── */}
        {actionError && (
          <s-banner tone="critical"><s-text>{actionError}</s-text></s-banner>
        )}

        <s-divider />

        {/* ── Actions ── */}
        {isActive && pauseConfirmOpen ? (
          <s-banner tone="warning">
            <s-stack spacing="base">
              <s-stack spacing="tight">
                <s-text emphasis="bold">Pause your subscription?</s-text>
                <s-text size="small">
                  Waqtly features on your tablet will be restricted until you resume. You can resume any time from this page.
                </s-text>
              </s-stack>
              <s-stack direction="inline" spacing="tight">
                <s-button variant="primary" tone="critical" onClick={confirmPause} disabled={loading} loading={loading}>
                  Yes, pause
                </s-button>
                <s-button variant="secondary" onClick={() => setPauseConfirmOpen(false)} disabled={loading}>
                  Keep active
                </s-button>
              </s-stack>
            </s-stack>
          </s-banner>
        ) : (
          <s-stack direction="inline" spacing="tight">
            {isActive && (
              <s-button
                variant="secondary"
                tone="critical"
                onClick={() => { setActionError(null); setPauseConfirmOpen(true); }}
                disabled={loading}
              >
                Pause subscription
              </s-button>
            )}
            {isPaused && (
              <s-button variant="primary" onClick={confirmResume} disabled={loading} loading={loading}>
                Resume subscription
              </s-button>
            )}
            {isFailed && updateUrl && (
              <s-button variant="primary" href={updateUrl}>Update payment method</s-button>
            )}
          </s-stack>
        )}

      </s-stack>
    </s-box>
  );
}
