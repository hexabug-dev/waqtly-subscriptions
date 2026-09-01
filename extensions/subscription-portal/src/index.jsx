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
  originOrder: { totalPrice: { amount: '238.00', currencyCode: 'EUR' } },
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

function money(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'EUR',
      minimumFractionDigits: 2,
    }).format(parseFloat(amount || 0));
  } catch {
    return `${currency || 'EUR'} ${parseFloat(amount || 0).toFixed(2)}`;
  }
}

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function cap(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
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
      if (DEV_MOCK) { setContracts([MOCK_CONTRACT]); return; }
      const result = await shopify.query(SUBSCRIPTIONS_QUERY);
      const edges = result?.data?.customer?.subscriptionContracts?.edges ?? [];
      setContracts(edges.map((e) => e.node));
    } catch {
      setLoadError('Unable to load your subscription. Please try again later.');
    }
  }, []);

  useEffect(() => { load(); }, []);

  if (loadError) return (
    <s-stack spacing="base">
      <s-heading level="1">My Subscription</s-heading>
      <s-banner tone="critical"><s-text>{loadError}</s-text></s-banner>
    </s-stack>
  );

  if (contracts === null) return (
    <s-stack spacing="base">
      <s-heading level="1">My Subscription</s-heading>
      <s-spinner size="large" />
    </s-stack>
  );

  const visible = contracts.filter((c) => c.status !== 'CANCELLED' && c.status !== 'EXPIRED');

  return (
    <s-stack spacing="loose">
      <s-heading level="1">My Subscription</s-heading>
      {visible.length === 0
        ? <s-text>You have no active subscriptions.</s-text>
        : visible.map((c) => <ContractCard key={c.id} contract={c} onRefresh={load} />)
      }
    </s-stack>
  );
}

function ContractCard({ contract, onRefresh }) {
  const [pauseOpen, setPauseOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  const lines = contract.lines?.edges?.map((e) => e.node) ?? [];
  const pm = contract.customerPaymentMethod;
  const pmCard = pm?.instrument;
  const updateUrl = pm?.instrumentUpdateUrl;

  const isActive  = contract.status === 'ACTIVE';
  const isPaused  = contract.status === 'PAUSED';
  const isFailed  = contract.status === 'FAILED';

  const STATUS_TONES  = { ACTIVE: 'success', PAUSED: 'warning', FAILED: 'critical' };
  const STATUS_LABELS = { ACTIVE: 'Active',  PAUSED: 'Paused',  FAILED: 'Payment failed' };

  // Shared billing values derived from first line
  const firstLine   = lines[0];
  const discounts   = firstLine?.pricingPolicy?.cycleDiscounts ?? [];
  const firstPaid   = discounts.find((d) => parseFloat(d.computedPrice?.amount ?? '0') > 0);
  const freeMonths  = firstPaid?.afterCycle ?? 0;
  const originPrice = contract.originOrder?.totalPrice;
  const startDate   = fmtDate(contract.createdAt);
  const nextDate    = fmtDate(contract.nextBillingDate);

  async function doPause() {
    setLoading(true); setActionError(null); setPauseOpen(false);
    try {
      const r = await fetch('https://hooks.waqtly.com/subscriptions/pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: contract.id }),
      });
      if (!r.ok) throw new Error();
      await onRefresh();
    } catch { setActionError('Unable to pause. Contact support@waqtly.com.'); }
    finally { setLoading(false); }
  }

  async function doResume() {
    setLoading(true); setActionError(null);
    try {
      const r = await fetch('https://hooks.waqtly.com/subscriptions/resume', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId: contract.id }),
      });
      if (!r.ok) throw new Error();
      await onRefresh();
    } catch { setActionError('Unable to resume. Contact support@waqtly.com.'); }
    finally { setLoading(false); }
  }

  return (
    <s-box background="base" padding="base" border="base base">
      <s-stack spacing="base">

        {/* ── Status alerts ── */}
        {isPaused && (
          <s-banner tone="warning">
            <s-text>Your subscription is paused. Waqtly features are restricted until you resume.</s-text>
          </s-banner>
        )}
        {isFailed && (
          <s-banner tone="critical">
            <s-text>Your last payment failed. Update your payment method to restore access.</s-text>
          </s-banner>
        )}

        {/* ── Devices ── */}
        <s-heading level="3">Devices</s-heading>
        <s-stack spacing="base">
          {lines.map((line) => (
            <s-stack key={line.id} direction="inline" spacing="base" alignItems="center">
              <s-stack spacing="none">
                <s-text emphasis="bold">{line.title}</s-text>
                <s-text size="small" tone="subdued">{line.sellingPlanName ?? ''}</s-text>
              </s-stack>
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
          {originPrice && (
            <s-stack direction="inline" spacing="base" alignItems="center">
              <s-text size="small">
                Entry payment{startDate ? ` — ${startDate}` : ''} — {money(originPrice.amount, originPrice.currencyCode)}
              </s-text>
              <s-badge tone="success">Paid</s-badge>
            </s-stack>
          )}
          {freeMonths > 0 && (
            <s-stack direction="inline" spacing="base" alignItems="center">
              <s-text size="small">Months 1–{freeMonths} — No charge</s-text>
              <s-badge tone="info">Free period</s-badge>
            </s-stack>
          )}
          {lines.map((line) => {
            if (!line.currentPrice) return null;
            const amt = money(line.currentPrice.amount, line.currentPrice.currencyCode);
            const when = nextDate
              ? `From ${nextDate}`
              : freeMonths > 0 ? `Month ${freeMonths + 1} onwards` : 'Recurring';
            return (
              <s-stack key={line.id} direction="inline" spacing="base" alignItems="center">
                <s-text size="small">
                  {line.title} — {when} — {amt} / month
                </s-text>
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
            <s-stack direction="inline" spacing="base" alignItems="center">
              <s-text>
                {cap(pmCard.brand ?? 'Card')} ending {pmCard.lastDigits}
                {pmCard.expiryMonth && pmCard.expiryYear
                  ? ` — Expires ${pmCard.expiryMonth}/${String(pmCard.expiryYear).slice(-2)}`
                  : ''}
              </s-text>
              {updateUrl && (
                <s-button variant="secondary" href={updateUrl}>Update</s-button>
              )}
            </s-stack>
          </>
        )}

        {actionError && (
          <s-banner tone="critical"><s-text>{actionError}</s-text></s-banner>
        )}

        <s-divider />

        {/* ── Actions ── */}
        {isActive && pauseOpen ? (
          <s-banner tone="warning">
            <s-stack spacing="base">
              <s-stack spacing="tight">
                <s-text emphasis="bold">Pause your subscription?</s-text>
                <s-text size="small">
                  Waqtly features on your tablet will be restricted until you resume.
                </s-text>
              </s-stack>
              <s-stack direction="inline" spacing="tight">
                <s-button variant="primary" tone="critical" onClick={doPause} disabled={loading} loading={loading}>
                  Yes, pause
                </s-button>
                <s-button variant="secondary" onClick={() => setPauseOpen(false)} disabled={loading}>
                  Keep active
                </s-button>
              </s-stack>
            </s-stack>
          </s-banner>
        ) : (
          <s-stack direction="inline" spacing="tight">
            {isActive && (
              <s-button variant="secondary" tone="critical"
                onClick={() => { setActionError(null); setPauseOpen(true); }}
                disabled={loading}>
                Pause subscription
              </s-button>
            )}
            {isPaused && (
              <s-button variant="primary" onClick={doResume} disabled={loading} loading={loading}>
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
