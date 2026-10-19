import BillingReviews from './credits/BillingReviews.jsx';
import Purchases from './credits/Purchases.jsx';
import PurchaseReview from './credits/PurchaseReview.jsx';
import { useEffect, useRef, useState } from 'react';
import { completeCheckout, fetchBillingConfig, fetchInvoices, openInvoice } from '../lib/billing.js';
import { creditsText, refreshCredits, serverCredits, subscribeCredits } from '../lib/creditsStore.js';
import { refreshEntitlement } from '../lib/entitlementStore.js';
import { PUBLIC_PLANS, purchaseKind, rupees } from '../lib/publicPlans.js';
import CreditLots, { dayOrNull } from './CreditLots.jsx';
import { PeriodBar } from './credits/CreditsVisuals.jsx';

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
 * allowance and the lots; it is left out when there is no cycle (null). On the credits page (F184) it
 * sits in the plan card with this period's bar; usage and activity have their own sections.
 */
function CreditsSection({ credits, tried, checkoutOpen }) {
  if (!credits) {
    return (
      <section className="plan-credits" aria-labelledby="plan-credits-title">
        <h4 className="plan-up-sub" id="plan-credits-title">AI credits</h4>
        <p className="plan-up-note">{tried ? 'Your credits could not be loaded just now.' : 'Loading credits…'}</p>
      </section>
    );
  }
  const owed = credits.balance < 0;
  const free = credits.plan === 'free';
  const endsOn = dayOrNull(credits.cycleEndsAt);
  return (
    <section className="plan-credits" aria-labelledby="plan-credits-title">
      <h4 className="plan-up-sub" id="plan-credits-title">AI credits</h4>
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

      <h4 className="plan-credits-sub">This period</h4>
      <PeriodBar credits={credits} compact />

      {/* F161: top-ups are not on sale until O6, whatever the state of plan checkout. */}
      {!checkoutOpen ? <p className="plan-up-note plan-credits-note">
        Top-ups coming soon. Need more credits now? Write to{' '}
        <a href="mailto:niyantranai@gmail.com">niyantranai@gmail.com</a>.
      </p> : null}
    </section>
  );
}

/**
 * The credits page's Plan and invoices section (F184 spec §3.5; F111's Plan & billing, once a modal):
 * your plan with this period's credits, the plan choices and checkout, and the invoices. Checkout
 * reports only what the server verified, and says so plainly while it is closed.
 */
export default function PlanBilling({ ent, user, initialPlan = null }) {
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
  const [invoiceError, setInvoiceError] = useState('');
  const [revision, setRevision] = useState(0);
  const paying = useRef(false);

  function updated() {
    setRevision(value => value + 1);
    Promise.allSettled([refreshCredits(), refreshEntitlement()]);
    fetchInvoices().then(list => { setInvoices(list); setInvoiceError(''); })
      .catch(() => setInvoiceError('Invoices could not be loaded. Try refreshing purchases.'));
  }

  useEffect(() => {
    let live = true;
    fetchBillingConfig().then((c) => live && setConfig(c));
    setInvoices(null); setInvoiceError('');
    Promise.resolve(fetchInvoices()).then((list) => live && setInvoices(list || []))
      .catch(() => live && setInvoiceError('Invoices could not be loaded. Try refreshing purchases.'));
    refreshEntitlement();
    return () => {
      live = false;
    };
  }, [userId]);

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

  const active = ent?.status === 'active' && !ent?.lapsed;
  const current = active ? ent.plan : 'free';
  const end = active ? ent.periodEnd : null;
  const renewDue = Boolean(end) && Date.parse(end) - Date.now() <= RENEW_WINDOW_MS;
  const choice = PAID.find((p) => p.id === selected) || null;
  const kind = choice ? purchaseKind(ent, choice.id) : null;
  const open = Boolean(config?.enabled);

  async function pay() {
    if (!choice || !open || paying.current) return;
    paying.current = true;
    setBusy(true);
    setResult(null);
    try {
      const outcome = await completeCheckout({ planId: choice.id, user });
      if (outcome?.ok) {
        setResult({ ok: true, invoice: outcome.invoice || null });
        setSelected(null);
        updated();
      } else {
        setResult({ ok: false, pending: outcome?.pending, text: outcome?.reason || 'The payment could not be completed.' });
      }
    } catch { setResult({ ok: false, text: 'Purchase status is uncertain. Refresh purchases before paying again.' }); }
    finally { setBusy(false); paying.current = false; }
  }

  return (
    <div className="plan-billing-section">
      <section className="cp-card" aria-labelledby="plan-billing-title">
        <h3 id="plan-billing-title" className="cp-card-title">Your plan: {planLabel(current)}</h3>
        <p className="plan-up-lead">
          {active
            ? `${planLabel(current)} is active ${end ? `until ${day(end)}` : 'with no end date'}.`
            : 'You are on Free: every desk at no cost, with 10,000 AI credits to start.'}
        </p>
        <p className="plan-up-note">No automatic renewal. Top-ups do not change your plan.</p>
        {renewDue ? (
          <p className="plan-up-renew">Your {planLabel(current)} month ends on {day(end)}. Renew to keep it.</p>
        ) : null}
        {userId ? <CreditsSection credits={credits} tried={creditsTried} checkoutOpen={open} /> : null}
      </section>

      {user ? <Purchases key={userId} user={user} revision={revision} onUpdated={updated} /> : null}
      {user?.role === 'admin' ? <BillingReviews user={user} /> : null}
      <section className="cp-card" aria-labelledby="plan-change-title">
        <h3 id="plan-change-title" className="cp-card-title">Change plan</h3>
        <div className="plan-up-choices">
          {PAID.map((p) => {
            const option = purchaseKind(ent, p.id);
            const blocked = option === 'blocked';
            return (
              <button
                type="button"
                key={p.id}
                className={`plan-up-plan${selected === p.id ? ' on' : ''}${current === p.id ? ' billing-current' : ''}`}
                aria-pressed={selected === p.id}
                disabled={blocked || busy}
                onClick={() => {
                  setSelected(p.id);
                  setResult(null);
                }}
              >
                {current === p.id ? <em>Current plan</em> : p.popular ? <em>Popular</em> : null}
                <strong>{p.name}</strong>
                <span className="amt">{rupees(p.monthly)}<small>/month</small></span>
                <span className="who">{blocked ? `Not available while ${planLabel(current)} is active` : option === 'downgrade' ? 'Starts after your current paid period' : p.tag}</span>
              </button>
            );
          })}
        </div>

        {choice ? <PurchaseReview label={`${choice.name} plan — one month`} amountPaise={choice.monthly * 100}
          credits={choice.items[0]} currentPlan={planLabel(current)} busy={busy} disabled={!open}
          onConfirm={pay} onCancel={() => setSelected(null)} timing={kind === 'upgrade'
              ? `Your ${planLabel(choice.id)} month starts now. Unused days of ${planLabel(current)} are not refunded.`
              : kind === 'renew'
                ? `Adds one month after ${day(end)}.`
                : kind === 'downgrade'
                  ? `Your ${planLabel(choice.id)} month starts after the current paid period. Your current access continues until then.`
                  : `One month of ${planLabel(choice.id)}, starting now.`} /> : null}

        {!choice ? <div className="plan-up-actions">
          <button type="button" className="plan-up-pay" disabled={!choice || busy || !open} onClick={pay}>
            {busy ? 'Opening payment…' : choice ? `Pay ${rupees(choice.monthly)} for one month` : 'Choose a plan'}
          </button>
        </div> : null}
        {config && !open ? (
          <p className="plan-up-note">
            Online payments open soon. To upgrade now, write to{' '}
            <a href="mailto:niyantranai@gmail.com">niyantranai@gmail.com</a>.
          </p>
        ) : null}
        {result?.ok ? (
          <p className="plan-up-ok" role="status">
            Payment verified. Your paid period has been recorded.
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
      </section>

      <section className="cp-card" aria-labelledby="plan-invoices-title">
        <h3 id="plan-invoices-title" className="cp-card-title">Invoices</h3>
        {invoiceError ? <p role="alert">{invoiceError}</p> : invoices === null ? (
          <p className="plan-up-note">Loading invoices…</p>
        ) : invoices.length ? (
          <ul className="plan-up-invoices">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <span>{inv.invoiceNo}</span>
                <span>{inv.issuedAt ? day(inv.issuedAt) : ''} · {inv.description || inv.label || planLabel(inv.planId)}</span>
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
          Prices in Indian rupees; no GST is charged. Plans cover one month; top-up credits are valid for 12 months. See the{' '}
          <a href="/refunds">Refund &amp; Cancellation Policy</a>.
        </p>
      </section>
    </div>
  );
}
