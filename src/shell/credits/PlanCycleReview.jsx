import { useEffect, useRef, useState } from 'react';
import PlanChoices from '../PlanChoices.jsx';
import { cancelNextPlan, completeCheckout, fetchPlanQuote, fetchPlanState, formatInr, scheduleNextPlan } from '../../lib/billing.js';
import { PUBLIC_PLANS, purchaseKind } from '../../lib/publicPlans.js';

const name = id => PUBLIC_PLANS.find(p => p.id === id)?.name || 'Free';
const date = iso => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// One account-keyed review. Quotes are server-owned; card selection cannot pay.
export default function PlanCycleReview({ ent, user, initialPlan, onUpdated }) {
  const [selected, setSelected] = useState(initialPlan || null);
  const [quote, setQuote] = useState(null);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [intent, setIntent] = useState(null);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const action = selected === 'free' ? 'downgrade' : selected ? purchaseKind(ent, selected) : null;
  const downgrade = action === 'downgrade' && intent !== 'renew';
  const active = ent?.status === 'active' && !ent.lapsed;
  const renewDue = active && ent.periodEnd && Date.parse(ent.periodEnd) - Date.now() <= 7 * 86400000;
  useEffect(() => {
    let live = true;
    fetchPlanState().then(value => {
      if (!live) return;
      if (value.ok) setState(value);
      else setMessage(value.reason || 'Plan schedule unavailable. Refresh before changing plans.');
    });
    return () => { live = false; };
  }, [revision]);
  useEffect(() => {
    let live = true;
    setQuote(null);
    if (selected && !downgrade) {
      fetchPlanQuote(selected, intent).then(value => {
        if (!live) return;
        if (value.ok) setQuote(value.quote);
        else setMessage(value.reason || 'Quote unavailable. Review again before paying.');
      });
    }
    return () => { live = false; };
  }, [selected, downgrade, intent, revision]);
  function choose(id, nextIntent = null) { setSelected(id); setIntent(nextIntent); setMessage(''); setQuote(null); }
  async function perform(operation) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const result = await operation();
      if (result?.ok) {
        setMessage(downgrade ? 'Next-plan selection saved. Nothing was charged. A paid plan requires manual renewal.' : 'Confirmed. Your plan and credits have been refreshed.');
        setSelected(null); setQuote(null); setRevision(v => v + 1); onUpdated();
      } else { setMessage(result?.reason || 'Could not confirm this operation. Refresh before retrying.'); setQuote(null); }
    } catch { setMessage('Could not confirm this operation. Refresh before retrying.'); setQuote(null); }
    finally { setBusy(false); lock.current = false; }
  }
  return <section className="cp-card" aria-labelledby="plan-change-title">
    <h3 id="plan-change-title" className="cp-card-title">Change plan</h3>
    <PlanChoices ent={ent} selected={selected} busy={busy} onSelect={choose} />
    {active ? <button type="button" className="billing-secondary" disabled={busy} onClick={() => choose('free')}>Return to Free after this period</button> : null}
    {state?.scheduled ? <section className="billing-review" aria-label="Next plan selection">
      <h4>Next selection: {name(state.scheduled.planId)}</h4>
      <p>{Date.parse(state.scheduled.effectiveAt) > Date.now() ? 'Current access continues until' : 'Your previous paid period ended on'} {date(state.scheduled.effectiveAt)}. Scheduling charge: {formatInr(0)}.</p>
      <p>{state.scheduled.planId === 'free' ? 'Your account returns to Free when this paid period ends.' : 'This is an unpaid selection. Pay manually to start the next paid month; otherwise your account returns to Free.'}</p>
      {(renewDue || !active) && state.scheduled.planId !== 'free' ? <button type="button" className="billing-secondary" disabled={busy} onClick={() => choose(state.scheduled.planId, 'renew')}>Review next month</button> : null}
      <button type="button" className="billing-secondary" disabled={busy} onClick={() => perform(cancelNextPlan)}>Cancel next selection</button>
    </section> : null}
    {selected && downgrade ? <section className="billing-review" aria-label="Review plan change">
      <h4>Schedule {name(selected)} for your next period</h4>
      <p>{name(ent.plan)} stays active until {date(ent.periodEnd)}. Nothing changes today.</p>
      <p><strong>Due today: {formatInr(0)}</strong></p>
      <p>{selected === 'free' ? 'No payment is needed to return to Free.' : 'Payment is required to start the next paid month. No automatic renewal.'} A new selection replaces your previous unpaid selection.</p>
      <button type="button" className="plan-up-pay" disabled={busy || !state} onClick={() => perform(() => scheduleNextPlan(selected))}>Schedule change — {formatInr(0)} today</button>
      <button type="button" className="billing-secondary" disabled={busy} onClick={() => choose(null)}>Cancel selection</button>
    </section> : selected ? <section className="billing-review" aria-label="Review your purchase">
      <h4>{quote?.action === 'upgrade' ? 'Review prorated upgrade' : 'Review your purchase'}</h4>
      {quote ? <>
        <dl>
          <div><dt>Plan</dt><dd>{name(selected)}</dd></div>
          <div><dt>{quote.action === 'upgrade' ? 'Additional credits this cycle' : 'Monthly credits'}</dt><dd>{Number(quote.credits).toLocaleString('en-IN', { maximumFractionDigits: 4 })}</dd></div>
          <div><dt>Covered period</dt><dd>{quote.action === 'upgrade' ? 'Now' : date(quote.cycleStartsAt)} – {date(quote.cycleEndsAt)}</dd></div>
          <div><dt>Total payable today</dt><dd>{formatInr(quote.amountPaise / 100)}</dd></div>
        </dl>
        {quote.action === 'upgrade' ? <p>{(Number(quote.fraction) * 100).toFixed(2)}% of this cycle remains. Both the price difference and additional credits are prorated. Your existing credits and cycle end stay unchanged. Any unpaid next-plan selection will be cancelled.</p> : null}
        <p>Next full month: {formatInr(quote.monthlyAmountPaise / 100)} for {Number(quote.monthlyCredits).toLocaleString('en-IN')} credits. Renewal is manual. No GST is charged.</p>
        <p>10% of unused monthly credits rolls over for one month. Top-ups keep their own expiry.</p>
        <button type="button" className="plan-up-pay" disabled={busy || Date.parse(quote.expiresAt) <= Date.now()} onClick={() => perform(() => completeCheckout({ planId: selected, quoteId: quote.quoteId, user }))}>Pay {formatInr(quote.amountPaise / 100)} with Razorpay</button>
      </> : <p>Request a current server quote before paying. Same-plan renewal opens during the last seven days.</p>}
      <button type="button" className="billing-secondary" disabled={busy} onClick={() => { setMessage(''); setRevision(v => v + 1); }}>Refresh quote</button>
      <button type="button" className="billing-secondary" disabled={busy} onClick={() => choose(null)}>Cancel selection</button>
    </section> : null}
    {message ? <p role="status">{message}</p> : null}
    <p className="plan-up-note">Upgrades apply to the remaining paid cycle. Downgrade scheduling is free. Without manual renewal, your account returns to Free at expiry.</p>
  </section>;
}
