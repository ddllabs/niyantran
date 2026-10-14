import { useEffect, useRef, useState } from 'react';
import { completeCheckout, fetchBillingConfig, fetchInvoices, openInvoice } from '../lib/billing.js';
import { creditsText, openCreditsUsage, refreshCredits, serverCredits, subscribeCredits } from '../lib/creditsStore.js';
import { refreshEntitlement } from '../lib/entitlementStore.js';
import { PUBLIC_PLANS, purchaseKind, rupees } from '../lib/publicPlans.js';
import CreditLots, { dayOrNull } from './CreditLots.jsx';
import UsageMiniCard from './usage/UsageMini.jsx';

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
 * The AI credits section (F111, docs/specs/2026-10-14-ai-credits.md §8). Credits
 * only (F184); the server sends only credits. "Used
 * this cycle" is the server's own count of credits charged to answers since the
 * cycle began (my_credits().used_this_cycle), never derived here from the
 * allowance and the lots; it is left out when there is no cycle (null). Below the lots sits the small
 * version of the Credits usage page (F153), which replaced the "Recent answers" list: those rows are
 * now the page's All AI activity.
 */
function CreditsSection({ credits, tried, onSeeUsage }) {
  if (!credits) {
    return (
      <section className="plan-credits" aria-labelledby="plan-credits-title">
        <h3 className="plan-up-sub" id="plan-credits-title">AI credits</h3>
        <p className="plan-up-note">{tried ? 'Your credits could not be loaded just now.' : 'Loading credits…'}</p>
      </section>
    );
  }
  const owed = credits.balance < 0;
  const free = credits.plan === 'free';
  const endsOn = dayOrNull(credits.cycleEndsAt);
  return (
    <section className="plan-credits" aria-labelledby="plan-credits-title">
      <h3 className="plan-up-sub" id="plan-credits-title">AI credits</h3>
      <p className={`plan-credits-balance${owed ? ' plan-credits-negative' : ''}`}>
        <strong>{creditsText(credits.balance)}</strong>
      </p>
      {owed ? <p className="plan-credits-owed">taken from your next credits</p> : null}
      {/* F162: credits set aside for an answer still running. */}
      {credits.held > 0 ? (
        <p className="plan-credits-cycle"><span className="plan-credits-until">{creditsText(credits.held)} held for a running answer</span></p>
      ) : null}

      {credits.allowance !== null && credits.allowance > 0 ? (
        <p className="plan-credits-cycle">
          {free ? 'Sign-up credits' : 'Monthly allowance'} <strong>{creditsText(credits.allowance)}</strong>
          {endsOn ? <span className="plan-credits-until">{free ? `valid until ${endsOn}` : `this month ends ${endsOn}`}</span> : null}
        </p>
      ) : null}

      {credits.usedThisCycle !== null && credits.usedThisCycle !== undefined ? (
        <p className="plan-credits-cycle plan-credits-used">Used this cycle: <strong>{creditsText(credits.usedThisCycle)}</strong></p>
      ) : null}

      <h4 className="plan-credits-sub">Credits by expiry</h4>
      <CreditLots lots={credits.lots} />

      <h4 className="plan-credits-sub">Usage this period</h4>
      <UsageMiniCard credits={credits} onSeeUsage={onSeeUsage} />

      {/* F161: top-ups are not on sale until O6, whatever the state of plan checkout. */}
      <p className="plan-up-note plan-credits-note">
        Top-ups coming soon. Need more credits now? Write to{' '}
        <a href="mailto:niyantranai@gmail.com">niyantranai@gmail.com</a>.
      </p>
    </section>
  );
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
  const userId = user?.id || null;
  const [credits, setCredits] = useState(() => serverCredits(userId));
  const [creditsTried, setCreditsTried] = useState(false);
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

  // Credits are read the way the plan is: subscribe to the store, then refresh it.
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    const sync = () => {
      if (live) setCredits(serverCredits(userId));
    };
    const unsubscribe = subscribeCredits(sync);
    Promise.resolve(refreshCredits()).then(() => {
      sync();
      if (live) setCreditsTried(true);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [userId]);

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
            : 'You are on Free: every desk at no cost, with 1,000 AI credits to start.'}
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

        {userId ? (
          <CreditsSection
            credits={credits}
            tried={creditsTried}
            onSeeUsage={() => {
              close.current?.();
              openCreditsUsage();
            }}
          />
        ) : null}

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
