import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';

const APP_URL = 'https://waqtly-subscriptions-production.up.railway.app';

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

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  } catch { return null; }
}

// Customer ID comes from Shopify's session token (JWT sub claim = customer GID)
export default async (_root, _api) => {
  let customerId = null;
  try {
    const token = await shopify.sessionToken.get();
    const payload = decodeJwtPayload(token);
    if (payload?.sub) customerId = payload.sub;
  } catch { /* render will show load error */ }

  if (customerId && !customerId.includes('gid://')) {
    customerId = `gid://shopify/Customer/${customerId}`;
  }

  render(<SubscriptionPortal customerId={customerId} />, document.body);
};

function SubscriptionPortal({ customerId }) {
  const [contracts, setContracts] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    if (!customerId) {
      setLoadError('Unable to identify your account. Please try again.');
      return;
    }
    try {
      const resp = await fetch(
        `${APP_URL}/api/portal/contracts?customerId=${encodeURIComponent(customerId)}`
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
      }
      const { contracts: data } = await resp.json();
      setContracts(data ?? []);
    } catch (err) {
      setLoadError('Unable to load your subscription. Please try again or contact support@waqtly.com.');
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

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
  const [emailSent, setEmailSent] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);

  const lines = contract.lines?.nodes ?? contract.lines?.edges?.map((e) => e.node) ?? [];
  const pm = contract.customerPaymentMethod;
  const pmCard = pm?.instrument;

  const isActive = contract.status === 'ACTIVE';
  const isPaused = contract.status === 'PAUSED';
  const isFailed = contract.status === 'FAILED';

  const STATUS_TONES  = { ACTIVE: 'success', PAUSED: 'warning', FAILED: 'critical' };
  const STATUS_LABELS = { ACTIVE: 'Active',  PAUSED: 'Paused',  FAILED: 'Payment failed' };
  const STATUS_ICONS  = { ACTIVE: 'check-circle', PAUSED: 'clock', FAILED: 'alert-triangle' };

  const firstLine  = lines[0];
  const discounts  = firstLine?.pricingPolicy?.cycleDiscounts ?? [];
  const firstPaid  = discounts.find((d) => parseFloat(d.computedPrice?.amount ?? '0') > 0);
  const freeMonths = firstPaid?.afterCycle ?? 0;
  const originPrice = contract.originOrder?.totalPriceSet?.shopMoney;
  const startDate  = fmtDate(contract.createdAt);
  const nextDate   = fmtDate(contract.nextBillingDate);

  async function sendUpdateEmail() {
    setEmailLoading(true);
    setActionError(null);
    try {
      const r = await fetch(`${APP_URL}/api/portal/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-update-email', paymentMethodId: pm?.id, customerId }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || 'Request failed');
      }
      setEmailSent(true);
    } catch {
      setActionError('Unable to send payment update email. Contact support@waqtly.com.');
    } finally {
      setEmailLoading(false);
    }
  }

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
    } catch {
      setActionError(`Unable to ${act} your subscription. Contact support@waqtly.com.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <s-stack spacing="base">

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

      {/* Devices */}
      <s-section heading="Devices">
        <s-badge slot="primary-action"
          tone={STATUS_TONES[contract.status] ?? 'neutral'}
          icon={STATUS_ICONS[contract.status]}>
          {STATUS_LABELS[contract.status] ?? contract.status}
        </s-badge>
        <s-stack spacing="tight">
          {lines.map((line) => (
            <s-stack key={line.id} spacing="none">
              <s-text emphasis="bold">{line.title}</s-text>
              <s-text size="small" tone="subdued">{line.sellingPlanName ?? ''}</s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      {/* Billing timeline */}
      <s-section heading="Billing timeline">
        <s-stack spacing="tight">
          {originPrice && (
            <s-stack direction="inline" spacing="base">
              <s-text size="small">
                Entry payment{startDate ? ` — ${startDate}` : ''} · {money(originPrice.amount, originPrice.currencyCode)}
              </s-text>
              <s-badge tone="success" icon="check-circle">Paid</s-badge>
            </s-stack>
          )}
          {freeMonths > 0 && (
            <s-stack direction="inline" spacing="base">
              <s-text size="small">Months 1–{freeMonths} · No charge</s-text>
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
              <s-stack key={line.id} direction="inline" spacing="base">
                <s-text size="small">{line.title} — {when} · {amt}/mo</s-text>
                <s-badge tone={isPaused ? 'warning' : 'info'} icon={isPaused ? 'clock' : 'calendar'}>
                  {isPaused ? 'Paused' : 'Upcoming'}
                </s-badge>
              </s-stack>
            );
          })}
        </s-stack>
      </s-section>

      {/* Payment method */}
      {pmCard && (
        <s-section heading="Payment method">
          {emailSent ? (
            <s-stack direction="inline" spacing="tight">
              <s-icon type="check-circle" tone="success" size="small" />
              <s-text size="small" tone="success">Update link sent — check your email.</s-text>
            </s-stack>
          ) : (
            <s-grid gridTemplateColumns="1fr auto" alignItems="center" gap="base">
              <s-stack spacing="none">
                <s-text emphasis="bold">
                  {cap(pmCard.brand ?? 'Card')} ending {pmCard.lastDigits}
                </s-text>
                {pmCard.expiryMonth && pmCard.expiryYear && (
                  <s-text size="small" tone="subdued">
                    Expires {pmCard.expiryMonth}/{String(pmCard.expiryYear).slice(-2)}
                  </s-text>
                )}
              </s-stack>
              <s-button variant="secondary" onClick={sendUpdateEmail} disabled={emailLoading} loading={emailLoading}>
                Update
              </s-button>
            </s-grid>
          )}
        </s-section>
      )}

      {/* Actions */}
      {actionError && (
        <s-banner tone="critical"><s-text>{actionError}</s-text></s-banner>
      )}

      {isActive && pauseOpen ? (
        <s-banner tone="warning">
          <s-stack spacing="base">
            <s-stack spacing="none">
              <s-text emphasis="bold">Pause your subscription?</s-text>
              <s-text size="small">Waqtly features on your tablet will be restricted until you resume.</s-text>
            </s-stack>
            <s-stack direction="inline" spacing="tight">
              <s-button variant="primary" tone="critical"
                onClick={() => callAction('pause')} disabled={loading} loading={loading}>
                Yes, pause
              </s-button>
              <s-button variant="secondary"
                onClick={() => setPauseOpen(false)} disabled={loading}>
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
            <s-button variant="primary"
              onClick={() => callAction('resume')} disabled={loading} loading={loading}>
              Resume subscription
            </s-button>
          )}
          {isFailed && (
            emailSent ? (
              <s-stack direction="inline" spacing="tight">
                <s-icon type="check-circle" tone="success" size="small" />
                <s-text size="small" tone="success">Update link sent — check your email.</s-text>
              </s-stack>
            ) : (
              <s-button variant="primary" onClick={sendUpdateEmail} disabled={emailLoading} loading={emailLoading}>
                Update payment method
              </s-button>
            )
          )}
        </s-stack>
      )}

    </s-stack>
  );
}
