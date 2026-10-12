import { useEffect, useRef, useState } from 'react';
import { completeCheckout, fetchBillingConfig, fetchInvoices, openInvoice } from '../lib/billing.js';
import { refreshEntitlement } from '../lib/entitlementStore.js';
import { PUBLIC_PLANS, purchaseKind, rupees } from '../lib/publicPlans.js';

const PAID = PUBLIC_PLANS.filter((p) => p.monthly > 0);
const RENEW_WINDOW_MS = 7 * 86400000;

function planLabel(id) {
  const plan = PUBLIC_PLANS.find((p) => p.id === id);
  return plan ? plan.name[0] + plan.name.slice(1).toLowerCase() : 'Free';
}

function day(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Plan & billing (open-work F110). Shows the server's view of the plan, offers
 * a month of Plus, Pro or Max (renew or upgrade only while a plan is active),
 * and lists invoices. Payment is checkout.js -> /api/billing/verify; the panel
 * reports only what the server verified, and says so plainly while checkout is
 * closed.
 */
export default function PlanBilling({ ent, user, onClose, initialPlan = null }) {
  const [config, setConfig] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [selected, setSelected] = useState(() =>
    PAID.some((p) => p.id === initialPlan) && purchaseKind(ent, initialPlan) !== 'blocked' ? initialPlan : null,
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const card = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let live = true;
    fetchBillingConfig().then((c) => live && setConfig(c));
    Promise.resolve(fetchInvoices()).then((list) => live && setInvoices(list || []));
    refreshEntitlement();
    card.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') close.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      live = false;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const active = ent?.status === 'active';
  const current = active ? ent.plan : 'free';
  const end = active ? ent.periodEnd : null;
  const renewDue = Boolean(end) && Date.parse(end) - Date.now() <= RENEW_WINDOW_MS;
  const choice = PAID.find((p) => p.id === selected) || null;
  const kind = choice ? purchaseKind(ent, choice.id) : null;
  const open = Boolean(config?.enabled);

  async function pay() {
    if (!choice) return;
    setBusy(true);
    setResult(null);
    const outcome = await completeCheckout({ planId: choice.id, user });
    setBusy(false);
    if (outcome?.ok) {
      setResult({ ok: true, invoice: outcome.invoice || null });
      setSelected(null);
      Promise.resolve(fetchInvoices()).then((list) => setInvoices(list || []));
    } else {
      setResult({ ok: false, text: outcome?.reason || 'The payment could not be completed.' });
    }
  }

  return (
    <div className="plan-up-root" role="dialog" aria-modal="true" aria-labelledby="plan-billing-title">
      <button type="button" className="plan-up-scrim" aria-label="Close plan and billing" onClick={() => close.current?.()} />
      <div className="plan-up-card plan-billing" ref={card} tabIndex={-1}>
        <div className="plan-up-head">
          <div>
            <p className="plan-up-kicker">PLAN &amp; BILLING</p>
            <h2 id="plan-billing-title">Your plan: {planLabel(current)}</h2>
          </div>
          <button type="button" className="plan-up-x" aria-label="Close" onClick={() => close.current?.()}>×</button>
        </div>
        <p className="plan-up-lead">
          {active
            ? `${planLabel(current)} is active ${end ? `until ${day(end)}` : 'with no end date'}.`
            : 'You are on Free: every desk and the AI research assistant, at no cost.'}
        </p>
        {renewDue ? (
          <p className="plan-up-renew">Your {planLabel(current)} month ends on {day(end)}. Renew to keep it.</p>
        ) : null}

        <div className="plan-up-choices">
          {PAID.map((p) => {
            const option = purchaseKind(ent, p.id);
            const blocked = option === 'blocked';
            return (
              <button
                type="button"
                key={p.id}
                className={`plan-up-plan${selected === p.id ? ' on' : ''}`}
                aria-pressed={selected === p.id}
                disabled={blocked || busy}
                onClick={() => {
                  setSelected(p.id);
                  setResult(null);
                }}
              >
                {option === 'renew' ? <em>Current</em> : p.popular ? <em>Popular</em> : null}
                <strong>{p.name}</strong>
                <span className="amt">{rupees(p.monthly)}<small>/month</small></span>
                <span className="who">{blocked ? `Not available while ${planLabel(current)} is active` : p.tag}</span>
              </button>
            );
          })}
        </div>

        {choice ? (
          <p className="plan-up-selnote">
            {kind === 'upgrade'
              ? `Your ${planLabel(choice.id)} month starts now. Unused days of ${planLabel(current)} are not refunded.`
              : kind === 'renew'
                ? `Adds one month after ${day(end)}.`
                : `One month of ${planLabel(choice.id)}, starting now.`}
          </p>
        ) : null}

        <div className="plan-up-actions">
          <button type="button" className="plan-up-pay" disabled={!choice || busy || !open} onClick={pay}>
            {busy ? 'Opening payment…' : choice ? `Pay ${rupees(choice.monthly)} for one month` : 'Choose a plan'}
          </button>
        </div>
        {config && !open ? (
          <p className="plan-up-note">
            Online payments open soon. To upgrade now, write to{' '}
            <a href="mailto:niyantranai@gmail.com">niyantranai@gmail.com</a>.
          </p>
        ) : null}
        {result?.ok ? (
          <p className="plan-up-ok" role="status">
            Payment verified. Your plan is updated.
            {result.invoice ? (
              <>
                {' '}
                <button type="button" className="plan-up-inv-link" onClick={() => openInvoice(result.invoice.id)}>
                  Open invoice {result.invoice.invoiceNo}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {result && !result.ok ? <p className="plan-up-err" role="alert">{result.text}</p> : null}

        <h3 className="plan-up-sub">Invoices</h3>
        {invoices === null ? (
          <p className="plan-up-note">Loading invoices…</p>
        ) : invoices.length ? (
          <ul className="plan-up-invoices">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <span>{inv.invoiceNo}</span>
                <span>{inv.issuedAt ? day(inv.issuedAt) : ''}</span>
                <span>{rupees(Math.round(Number(inv.total) || 0))}</span>
                <button type="button" className="plan-up-inv-link" onClick={() => openInvoice(inv.id)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="plan-up-note">No invoices yet.</p>
        )}

        <p className="plan-up-note">
          Prices in Indian rupees; no GST is charged. Each payment covers one month. See the{' '}
          <a href="/refunds">Refund &amp; Cancellation Policy</a>.
        </p>
      </div>
    </div>
  );
}
