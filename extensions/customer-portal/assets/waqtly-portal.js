/* Waqtly Subscription Portal — theme app extension script */
(function () {
  'use strict';

  const root = document.getElementById('waqtly-portal');
  if (!root) return;

  const RAW_CUSTOMER_ID = root.dataset.customerId;
  const APP_URL = root.dataset.appUrl || 'https://waqtly-subscriptions-production.up.railway.app';
  // Liquid gives numeric ID; build GID
  const CUSTOMER_GID = RAW_CUSTOMER_ID.includes('gid://')
    ? RAW_CUSTOMER_ID
    : `gid://shopify/Customer/${RAW_CUSTOMER_ID}`;

  // ─── Helpers ────────────────────────────────────────────────
  function money(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency: currency || 'EUR', minimumFractionDigits: 2,
      }).format(parseFloat(amount || 0));
    } catch { return `${currency || 'EUR'} ${parseFloat(amount || 0).toFixed(2)}`; }
  }

  function fmtDate(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }

  function badge(label, cls) {
    return `<span class="waqtly-badge waqtly-badge--${cls}">${label}</span>`;
  }

  function btn(label, cls, attrs) {
    return `<button class="waqtly-btn waqtly-btn--${cls}" ${attrs || ''}>${label}</button>`;
  }

  // ─── Render ─────────────────────────────────────────────────
  function renderPortal(contracts) {
    const visible = contracts.filter((c) => c.status !== 'CANCELLED' && c.status !== 'EXPIRED');

    if (visible.length === 0) {
      root.innerHTML = `
        <div class="waqtly-portal">
          <h2 class="waqtly-portal__title">My Subscription</h2>
          <div class="waqtly-empty">You have no active subscriptions.</div>
        </div>`;
      return;
    }

    root.innerHTML = `
      <div class="waqtly-portal">
        <h2 class="waqtly-portal__title">My Subscription</h2>
        ${visible.map((c) => renderContract(c)).join('')}
      </div>`;

    attachHandlers();
  }

  function renderContract(c) {
    const lines       = c.lines?.nodes ?? [];
    const pm          = c.customerPaymentMethod;
    const pmCard      = pm?.instrument;
    const updateUrl   = pm?.instrumentUpdateUrl;

    const isActive = c.status === 'ACTIVE';
    const isPaused = c.status === 'PAUSED';
    const isFailed = c.status === 'FAILED';

    const STATUS_BADGE = {
      ACTIVE:  badge('Active', 'success'),
      PAUSED:  badge('Paused', 'warning'),
      FAILED:  badge('Payment failed', 'critical'),
    };

    // Billing timeline values
    const originPrice = c.originOrder?.totalPrice;
    const startDate   = fmtDate(c.createdAt);
    const nextDate    = fmtDate(c.nextBillingDate);
    const firstLine   = lines[0];
    const discounts   = firstLine?.pricingPolicy?.cycleDiscounts ?? [];
    const firstPaid   = discounts.find((d) => parseFloat(d.computedPrice?.amount ?? '0') > 0);
    const freeMonths  = firstPaid?.afterCycle ?? 0;

    const alertHtml = isPaused ? `
      <div class="waqtly-banner waqtly-banner--warning">
        Your subscription is paused. Waqtly features on your tablet are restricted until you resume.
      </div>` : isFailed ? `
      <div class="waqtly-banner waqtly-banner--critical">
        Your last payment failed. Update your payment method to restore full access.
      </div>` : '';

    const devicesHtml = lines.map((l) => `
      <div class="waqtly-device">
        <div>
          <span class="waqtly-device__name">${l.title}</span>
          <span class="waqtly-device__plan">${l.sellingPlanName ?? ''}</span>
        </div>
        ${STATUS_BADGE[c.status] ?? badge(c.status, 'info')}
      </div>`).join('');

    const timelineRows = [];
    if (originPrice) {
      timelineRows.push(`
        <div class="waqtly-timeline__row">
          <div class="waqtly-timeline__label">Entry payment${startDate ? ` &mdash; ${startDate}` : ''}</div>
          <div class="waqtly-timeline__amount">${money(originPrice.amount, originPrice.currencyCode)}</div>
          ${badge('Paid', 'success')}
        </div>`);
    }
    if (freeMonths > 0) {
      timelineRows.push(`
        <div class="waqtly-timeline__row">
          <div class="waqtly-timeline__label">Months 1&ndash;${freeMonths}</div>
          <div class="waqtly-timeline__amount">No charge</div>
          ${badge('Free period', 'info')}
        </div>`);
    }
    lines.forEach((l) => {
      if (!l.currentPrice) return;
      const when = nextDate
        ? `From ${nextDate}`
        : freeMonths > 0 ? `Month ${freeMonths + 1} onwards` : 'Recurring';
      timelineRows.push(`
        <div class="waqtly-timeline__row">
          <div class="waqtly-timeline__label">${l.title} &mdash; ${when}</div>
          <div class="waqtly-timeline__amount">${money(l.currentPrice.amount, l.currentPrice.currencyCode)} / month</div>
          ${badge(isPaused ? 'Paused' : 'Upcoming', isPaused ? 'warning' : 'upcoming')}
        </div>`);
    });

    const paymentHtml = pmCard ? `
      <div class="waqtly-section">
        <div class="waqtly-section__title">Payment method</div>
        <div class="waqtly-payment">
          <span>${cap(pmCard.brand ?? 'Card')} ending ${pmCard.lastDigits}${pmCard.expiryMonth ? ` &mdash; Expires ${pmCard.expiryMonth}/${String(pmCard.expiryYear).slice(-2)}` : ''}</span>
          ${updateUrl ? `<a href="${updateUrl}" class="waqtly-btn waqtly-btn--secondary">Update</a>` : ''}
        </div>
      </div>` : '';

    const actionsHtml = `
      <div class="waqtly-section" data-contract-id="${c.id}" data-contract-actions>
        <div class="waqtly-actions" data-actions-row>
          ${isActive ? btn('Pause subscription', 'danger', 'data-action="pause"') : ''}
          ${isPaused ? btn('Resume subscription', 'primary', 'data-action="resume"') : ''}
          ${isFailed && updateUrl ? `<a href="${updateUrl}" class="waqtly-btn waqtly-btn--primary">Update payment method</a>` : ''}
        </div>
        <div data-confirm-row style="display:none">
          <div class="waqtly-confirm">
            <p class="waqtly-confirm__title">Pause your subscription?</p>
            <p class="waqtly-confirm__body">Waqtly features on your tablet will be restricted until you resume.</p>
            <div class="waqtly-actions">
              ${btn('Yes, pause', 'danger', 'data-action="confirm-pause"')}
              ${btn('Keep active', 'secondary', 'data-action="cancel-pause"')}
            </div>
          </div>
        </div>
        <div data-error-row style="display:none;margin-top:10px;" class="waqtly-banner waqtly-banner--critical"></div>
      </div>`;

    return `
      <div class="waqtly-card">
        ${alertHtml ? `<div class="waqtly-section">${alertHtml}</div>` : ''}
        <div class="waqtly-section">
          <div class="waqtly-section__title">Devices</div>
          ${devicesHtml}
        </div>
        <div class="waqtly-section">
          <div class="waqtly-section__title">Billing timeline</div>
          ${timelineRows.join('')}
        </div>
        ${paymentHtml}
        ${actionsHtml}
      </div>`;
  }

  // ─── Event handlers ─────────────────────────────────────────
  function attachHandlers() {
    root.querySelectorAll('[data-contract-actions]').forEach((section) => {
      const contractId  = section.dataset.contractId;
      const actionsRow  = section.querySelector('[data-actions-row]');
      const confirmRow  = section.querySelector('[data-confirm-row]');
      const errorRow    = section.querySelector('[data-error-row]');

      function showError(msg) {
        errorRow.textContent = msg;
        errorRow.style.display = 'block';
      }
      function clearError() { errorRow.style.display = 'none'; }

      section.addEventListener('click', async (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (!action) return;

        clearError();

        if (action === 'pause') {
          actionsRow.style.display = 'none';
          confirmRow.style.display = 'block';
        }
        if (action === 'cancel-pause') {
          confirmRow.style.display = 'none';
          actionsRow.style.display = 'flex';
        }
        if (action === 'confirm-pause') {
          await doAction('pause', contractId, section, actionsRow, confirmRow, showError);
        }
        if (action === 'resume') {
          await doAction('resume', contractId, section, actionsRow, confirmRow, showError);
        }
      });
    });
  }

  async function doAction(act, contractId, section, actionsRow, confirmRow, showError) {
    const buttons = section.querySelectorAll('.waqtly-btn');
    buttons.forEach((b) => { b.disabled = true; });
    confirmRow.style.display = 'none';

    try {
      const resp = await fetch(`${APP_URL}/api/portal/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act, contractId, customerId: CUSTOMER_GID }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Request failed');
      }
      // Reload data to reflect new status
      await loadContracts();
    } catch (err) {
      buttons.forEach((b) => { b.disabled = false; });
      actionsRow.style.display = 'flex';
      showError(`Unable to ${act} at this time. Please contact support@waqtly.com.`);
    }
  }

  // ─── Data loading ────────────────────────────────────────────
  async function loadContracts() {
    root.innerHTML = `
      <div class="waqtly-portal">
        <h2 class="waqtly-portal__title">My Subscription</h2>
        <div class="waqtly-loading">
          <div class="waqtly-spinner"></div><br>Loading your subscription…
        </div>
      </div>`;

    try {
      const url = `${APP_URL}/api/portal/contracts?customerId=${encodeURIComponent(CUSTOMER_GID)}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Failed to load');
      const { contracts } = await resp.json();
      renderPortal(contracts);
    } catch {
      root.innerHTML = `
        <div class="waqtly-portal">
          <h2 class="waqtly-portal__title">My Subscription</h2>
          <div class="waqtly-banner waqtly-banner--critical" style="margin-top:8px;">
            Unable to load your subscription. Please refresh or contact support@waqtly.com.
          </div>
        </div>`;
    }
  }

  loadContracts();
})();
