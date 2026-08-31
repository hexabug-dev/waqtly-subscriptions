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
              totalPrice {
                amount
                currencyCode
              }
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
            lines(first: 5) {
              edges {
                node {
                  id
                  title
                  variantTitle
                  sellingPlanName
                  currentPrice {
                    amount
                    currencyCode
                  }
                  pricingPolicy {
                    cycleDiscounts {
                      afterCycle
                      computedPrice {
                        amount
                        currencyCode
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
  }
`;

// DEV_MOCK: remove before deploy
const DEV_MOCK = true;
const MOCK_CONTRACT = {
  id: 'gid://shopify/SubscriptionContract/26114752835',
  status: 'ACTIVE',
  createdAt: '2026-08-31T10:00:00Z',
  nextBillingDate: '2027-02-28T10:00:00Z',
  originOrder: {
    totalPrice: { amount: '139.00', currencyCode: 'EUR' },
  },
  customerPaymentMethod: {
    id: 'gid://shopify/CustomerPaymentMethod/abc123',
    instrumentUpdateUrl: null,
    instrument: { brand: 'visa', lastDigits: '4242', expiryMonth: 12, expiryYear: 2030 },
  },
  lines: {
    edges: [{
      node: {
        id: '1',
        title: 'Waqtly',
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
    }],
  },
};

function formatMoney(amount, currencyCode) {
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
        <s-banner tone="critical">
          <s-text>{loadError}</s-text>
        </s-banner>
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

  // Show ACTIVE, PAUSED, and FAILED — not CANCELLED or EXPIRED
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
          <ContractCard
            key={contract.id}
            contract={contract}
            onRefresh={load}
          />
        ))
      )}
    </s-stack>
  );
}

function ContractCard({ contract, onRefresh }) {
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  const line = contract.lines?.edges?.[0]?.node;
  const planName = line?.sellingPlanName ?? line?.title ?? 'Waqtly';
  const pm = contract.customerPaymentMethod;
  const card = pm?.instrument;
  const updateUrl = pm?.instrumentUpdateUrl;

  // Dynamic pricing from contract data
  const monthlyPrice = line?.currentPrice;
  const monthlyAmount = monthlyPrice
    ? formatMoney(monthlyPrice.amount, monthlyPrice.currencyCode)
    : null;

  // Free months: find the first non-zero paid cycle; its afterCycle = number of free months
  const discounts = line?.pricingPolicy?.cycleDiscounts ?? [];
  const firstPaid = discounts.find((d) => parseFloat(d.computedPrice?.amount ?? '0') > 0);
  const freeMonthsCount = firstPaid?.afterCycle ?? 0;

  // Entry payment from the original order total
  const originPrice = contract.originOrder?.totalPrice;
  const entryAmount = originPrice
    ? formatMoney(originPrice.amount, originPrice.currencyCode)
    : null;

  const fmt = (iso) =>
    iso
      ? new Date(iso).toLocaleDateString('en-IE', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null;

  const startDate = fmt(contract.createdAt);
  const nextBillingDate = fmt(contract.nextBillingDate);

  const isActive = contract.status === 'ACTIVE';
  const isPaused = contract.status === 'PAUSED';
  const isFailed = contract.status === 'FAILED';

  const STATUS_LABELS = {
    ACTIVE: 'Active',
    PAUSED: 'Paused',
    FAILED: 'Payment failed',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired',
  };
  const STATUS_TONES = {
    ACTIVE: 'success',
    PAUSED: 'warning',
    FAILED: 'critical',
    CANCELLED: 'info',
    EXPIRED: 'info',
  };
  const statusLabel = STATUS_LABELS[contract.status] ?? contract.status;
  const statusTone = STATUS_TONES[contract.status] ?? 'info';

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

        {/* Plan header */}
        <s-stack direction="inline" spacing="tight" alignItems="center">
          <s-text emphasis="bold">{planName}</s-text>
          <s-badge tone={statusTone}>{statusLabel}</s-badge>
        </s-stack>

        {/* Status banners */}
        {isPaused && (
          <s-banner tone="warning">
            <s-text>
              Your subscription is paused. Waqtly features on your tablet are currently restricted. Resume at any time to restore access.
            </s-text>
          </s-banner>
        )}

        {isFailed && (
          <s-banner tone="critical">
            <s-text>
              Your last payment failed. Update your payment method to restore full access.
            </s-text>
          </s-banner>
        )}

        <s-divider />

        {/* Billing timeline */}
        <s-heading level="3">Billing timeline</s-heading>
        <s-stack spacing="tight">
          {entryAmount && (
            <BillingRow
              label={startDate ? `Entry payment · ${startDate}` : 'Entry payment'}
              amount={entryAmount}
              status="paid"
            />
          )}
          {freeMonthsCount > 0 && (
            <BillingRow
              label={`Months 1–${freeMonthsCount}`}
              amount="No charge"
              status="free"
            />
          )}
          {monthlyAmount && (
            <BillingRow
              label={
                nextBillingDate
                  ? `From ${nextBillingDate}`
                  : freeMonthsCount > 0
                  ? `Month ${freeMonthsCount + 1} onwards`
                  : 'Recurring'
              }
              amount={`${monthlyAmount} / month`}
              status={isPaused ? 'paused' : 'upcoming'}
            />
          )}
        </s-stack>

        {/* Payment method */}
        {card && (
          <>
            <s-divider />
            <s-heading level="3">Payment method</s-heading>
            <s-text>
              {capitalise(card.brand ?? 'Card')} ending {card.lastDigits}
              {card.expiryMonth && card.expiryYear
                ? ` · Expires ${card.expiryMonth}/${String(card.expiryYear).slice(-2)}`
                : ''}
            </s-text>
          </>
        )}

        {/* Per-card error */}
        {actionError && (
          <s-banner tone="critical">
            <s-text>{actionError}</s-text>
          </s-banner>
        )}

        <s-divider />

        {/* Actions */}
        {isActive && pauseConfirmOpen ? (
          <s-banner tone="warning">
            <s-stack spacing="base">
              <s-stack spacing="tight">
                <s-text emphasis="bold">Pause {planName}?</s-text>
                <s-text size="small">
                  Waqtly features on your tablet will be restricted until you resume. You can resume at any time from this page.
                </s-text>
              </s-stack>
              <s-stack direction="inline" spacing="tight">
                <s-button
                  variant="primary"
                  tone="critical"
                  onClick={confirmPause}
                  disabled={loading}
                  loading={loading}
                >
                  Yes, pause
                </s-button>
                <s-button
                  variant="secondary"
                  onClick={() => setPauseConfirmOpen(false)}
                  disabled={loading}
                >
                  Keep active
                </s-button>
              </s-stack>
            </s-stack>
          </s-banner>
        ) : (
          <s-stack direction="inline" spacing="tight">
            {updateUrl && (
              <s-button variant="secondary" href={updateUrl}>
                Update payment method
              </s-button>
            )}
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
              <s-button
                variant="primary"
                onClick={confirmResume}
                disabled={loading}
                loading={loading}
              >
                Resume subscription
              </s-button>
            )}
            {isFailed && updateUrl && (
              <s-button variant="primary" href={updateUrl}>
                Update payment method
              </s-button>
            )}
          </s-stack>
        )}

      </s-stack>
    </s-box>
  );
}

function BillingRow({ label, amount, status }) {
  const prefix = status === 'paid' ? '✓' : status === 'upcoming' || status === 'paused' ? '→' : '–';
  const isBold = status === 'upcoming' || status === 'paused';
  const badgeTone = status === 'paid' ? 'success' : status === 'paused' ? 'warning' : 'info';
  const badgeLabel = status === 'paid' ? 'Paid' : status === 'paused' ? 'Paused' : status === 'upcoming' ? 'Upcoming' : null;

  return (
    <s-stack direction="inline" spacing="tight" alignItems="center">
      <s-text size="small" emphasis={isBold ? 'bold' : undefined}>
        {prefix} {label} · {amount}
      </s-text>
      {badgeLabel && <s-badge tone={badgeTone}>{badgeLabel}</s-badge>}
    </s-stack>
  );
}

function capitalise(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
