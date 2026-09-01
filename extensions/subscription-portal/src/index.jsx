import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';

const APP_URL = 'https://waqtly-subscriptions-production.up.railway.app';

const SUBSCRIPTIONS_QUERY = `
  query GetSubscriptions {
    customer {
      id
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
  const [customerId, setCustomerId] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await shopify.query(SUBSCRIPTIONS_QUERY);
      const cid = result?.data?.customer?.id ?? null;
      const edges = result?.data?.customer?.subscriptionContracts?.edges ?? [];
      setCustomerId(cid);
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
        ? <s-text tone="subdued">You have no active subscriptions.</s-text>
        : visible.map((c) => (
          <ContractCard key={c.id} contract={c} customerId={customerId} onRefresh={load} />
        ))
      }
    </s-stack>
  );
}

function ContractCard({ contract, customerId, onRefresh }) {
  const [pauseOpen, setPauseOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState(null);

  const lines = contract.lines?.edges?.map((e) => e.node) ?? [];
  const pm = contract.customerPaymentMethod;
  const pmCard = pm?.instrument;
  const updateUrl = pm?.instrumentUpdateUrl;

  const isActive = contract.status === 'ACTIVE';
  const isPaused = contract.status === 'PAUSED';
  const isFailed = contract.status === 'FAILED';

  const STATUS_TONES  = { ACTIVE: 'success', PAUSED: 'warning', FAILED: 'critical' };
  const STATUS_LABELS = { ACTIVE: 'Active',  PAUSED: 'Paused',  FAILED: 'Payment failed' };

  const firstLine  = lines[0];
  const discounts  = firstLine?.pricingPolicy?.cycleDiscounts ?? [];
  const firstPaid  = discounts.find((d) => parseFloat(d.computedPrice?.amount ?? '0') > 0);
  const freeMonths = firstPaid?.afterCycle ?? 0;
  const originPrice = contract.originOrder?.totalPrice;
  const startDate  = fmtDate(contract.createdAt);
  const nextDate   = fmtDate(contract.nextBillingDate);

  async function callAction(act) {
    setLoading(true);
    setActionError(null);
    setPauseOpen(false);
    try {
      const r = await fetch(`${APP_URL}/api/portal/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act, contractId: contract.id, customerId }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || 'Request failed');
      }
      await onRefresh();
    } catch (err) {
      const label = act === 'pause' ? 'pause' : 'resume';
      setActionError(`Unable to ${label} your subscription. Contact support@waqtly.com.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <s-stack spacing="base">

      {/* ── Status alerts ── */}
      {isPaused && (
        <s-banner tone="warning">
          <s-text>Your subscription is paused. Waqtly features on your tablet are restricted until you resume.</s-text>
        </s-banner>
      )}
      {isFailed && (
        <s-banner tone="critical">
          <s-text>Your last payment failed. Update your payment method to restore access.</s-text>
        </s-banner>
      )}

      {/* ── Card ── */}
      <s-box background="base" padding="none" border="base">

        {/* Devices */}
        <s-box padding="base">
          <s-stack spacing="tight">
            <s-text size="small" tone="subdued" emphasis="bold">DEVICES</s-text>
            {lines.map((line) => (
              <s-columns key={line.id} columns="1fr auto" alignY="center" spacing="base">
                <s-stack spacing="none">
                  <s-text emphasis="bold">{line.title}</s-text>
                  <s-text size="small" tone="subdued">{line.sellingPlanName ?? ''}</s-text>
                </s-stack>
                <s-badge tone={STATUS_TONES[contract.status] ?? 'info'}>
                  {STATUS_LABELS[contract.status] ?? contract.status}
                </s-badge>
              </s-columns>
            ))}
          </s-stack>
        </s-box>

        <s-divider />

        {/* Billing timeline */}
        <s-box padding="base">
          <s-stack spacing="tight">
            <s-text size="small" tone="subdued" emphasis="bold">BILLING TIMELINE</s-text>

            {originPrice && (
              <s-columns columns="1fr auto auto" alignY="center" spacing="base">
                <s-text size="small">
                  Entry payment{startDate ? ` — ${startDate}` : ''}
                </s-text>
                <s-text size="small" emphasis="bold">
                  {money(originPrice.amount, originPrice.currencyCode)}
                </s-text>
                <s-badge tone="success">Paid</s-badge>
              </s-columns>
            )}

            {freeMonths > 0 && (
              <s-columns columns="1fr auto auto" alignY="center" spacing="base">
                <s-text size="small">Months 1–{freeMonths}</s-text>
                <s-text size="small" emphasis="bold">No charge</s-text>
                <s-badge tone="info">Free period</s-badge>
              </s-columns>
            )}

            {lines.map((line) => {
              if (!line.currentPrice) return null;
              const amt = money(line.currentPrice.amount, line.currentPrice.currencyCode);
              const when = nextDate
                ? `From ${nextDate}`
                : freeMonths > 0 ? `Month ${freeMonths + 1} onwards` : 'Recurring';
              return (
                <s-columns key={line.id} columns="1fr auto auto" alignY="center" spacing="base">
                  <s-text size="small">{line.title} — {when}</s-text>
                  <s-text size="small" emphasis="bold">{amt} / mo</s-text>
                  <s-badge tone={isPaused ? 'warning' : 'info'}>
                    {isPaused ? 'Paused' : 'Upcoming'}
                  </s-badge>
                </s-columns>
              );
            })}
          </s-stack>
        </s-box>

        {/* Payment method */}
        {pmCard && (
          <>
            <s-divider />
            <s-box padding="base">
              <s-stack spacing="tight">
                <s-text size="small" tone="subdued" emphasis="bold">PAYMENT METHOD</s-text>
                <s-columns columns="1fr auto" alignY="center" spacing="base">
                  <s-text>
                    {cap(pmCard.brand ?? 'Card')} ending {pmCard.lastDigits}
                    {pmCard.expiryMonth && pmCard.expiryYear
                      ? ` — Expires ${pmCard.expiryMonth}/${String(pmCard.expiryYear).slice(-2)}`
                      : ''}
                  </s-text>
                  {updateUrl && (
                    <s-button variant="secondary" href={updateUrl}>Update</s-button>
                  )}
                </s-columns>
              </s-stack>
            </s-box>
          </>
        )}

        {/* Actions */}
        <s-divider />
        <s-box padding="base">
          <s-stack spacing="base">
            {actionError && (
              <s-banner tone="critical"><s-text>{actionError}</s-text></s-banner>
            )}

            {isActive && pauseOpen ? (
              <s-banner tone="warning">
                <s-stack spacing="base">
                  <s-stack spacing="none">
                    <s-text emphasis="bold">Pause your subscription?</s-text>
                    <s-text size="small">
                      Waqtly features on your tablet will be restricted until you resume.
                    </s-text>
                  </s-stack>
                  <s-stack direction="inline" spacing="tight">
                    <s-button
                      variant="primary"
                      tone="critical"
                      onClick={() => callAction('pause')}
                      disabled={loading}
                      loading={loading}
                    >
                      Yes, pause
                    </s-button>
                    <s-button
                      variant="secondary"
                      onClick={() => setPauseOpen(false)}
                      disabled={loading}
                    >
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
                    onClick={() => { setActionError(null); setPauseOpen(true); }}
                    disabled={loading}
                  >
                    Pause subscription
                  </s-button>
                )}
                {isPaused && (
                  <s-button
                    variant="primary"
                    onClick={() => callAction('resume')}
                    disabled={loading}
                    loading={loading}
                  >
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

      </s-box>
    </s-stack>
  );
}
