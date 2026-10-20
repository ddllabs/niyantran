import { useEffect, useRef, useState } from 'react';
import PlanChoices from '../PlanChoices.jsx';
import { creditsText } from '../../lib/creditsStore.js';
import { cancelNextPlan, completeCheckout, fetchPlanQuote, fetchPlanState, formatInr, scheduleNextPlan } from '../../lib/billing.js';
import { PUBLIC_PLANS, purchaseKind } from '../../lib/publicPlans.js';

const name = id => { const value = PUBLIC_PLANS.find(p => p.id === id)?.name || 'Free'; return value.charAt(0) + value.slice(1).toLowerCase(); };
const date = iso => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

// One contextual review. The server still owns every quote and confirmed change.
export default function PlanCycleReview({ ent, user, initialPlan, onUpdated, onStateChange }) {
  const [selected, setSelected] = useState(() => PUBLIC_PLANS.some(p => p.id === initialPlan && p.monthly > 0) ? initialPlan : null);
  const [quote, setQuote] = useState(null);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [intent, setIntent] = useState(null);
  const [revision, setRevision] = useState(0);
  const [quoteStatus, setQuoteStatus] = useState('idle');
  const lock = useRef(false);
  const action = selected === 'free' ? 'downgrade' : selected ? purchaseKind(ent, selected) : null;
  const downgrade = action === 'downgrade' && intent !== 'renew';
  const active = ent?.status === 'active' && !ent.lapsed;
  const renewDue = active && ent.periodEnd && Date.parse(ent.periodEnd) - Date.now() <= 7 * 86400000;
  const renewalLater = action === 'renew' && !renewDue;
  const scheduled = state?.scheduled;
  const savedChoice = downgrade && selected === scheduled?.planId;
  const resting = !selected || savedChoice;
  const target = PUBLIC_PLANS.find(p => p.id === selected);
  const expired = quote && Date.parse(quote.expiresAt) <= Date.now();
  useEffect(() => {
    let live = true;
    fetchPlanState().then(value => {
      if (!live) return;
      if (value.ok) { setState(value); onStateChange?.(value); }
      else setMessage(value.reason || 'Plan schedule unavailable. Refresh before changing plans.');
    });
    return () => { live = false; };
  }, [revision, onStateChange]);
  useEffect(() => {
    let live = true;
    setQuote(null);
    if (selected && !downgrade && !renewalLater) {
      setQuoteStatus('loading');
      fetchPlanQuote(selected, intent).then(value => {
        if (!live) return;
        if (value.ok) { setQuote(value.quote); setQuoteStatus('ready'); }
        else { setMessage(value.reason || 'Quote unavailable. Please try again.'); setQuoteStatus('error'); }
      }).catch(() => { if (live) { setMessage('Price could not be loaded. Please try again.'); setQuoteStatus('error'); } });
    }
    return () => { live = false; };
  }, [selected, downgrade, renewalLater, intent, revision]);
  function choose(id, nextIntent = null) { setSelected(id); setIntent(nextIntent); setMessage(''); setQuote(null); setQuoteStatus('idle'); }
  function retryQuote() { setMessage(''); setQuoteStatus('loading'); setRevision(v => v + 1); }
  async function perform(operation, confirmation) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const result = await operation();
      if (result?.ok) {
        setMessage(confirmation || (downgrade ? 'Next-plan selection saved. Nothing was charged. A paid plan requires manual renewal.' : 'Confirmed. Your plan and credits have been refreshed.'));
        setSelected(null); setQuote(null); setRevision(v => v + 1); onUpdated();
      } else { setMessage(result?.reason || 'Could not confirm this operation. Refresh before retrying.'); setQuote(null); setQuoteStatus('error'); }
    } catch { setMessage('Could not confirm this operation. Refresh before retrying.'); setQuote(null); setQuoteStatus('error'); }
    finally { setBusy(false); lock.current = false; }
  }
  return <section className="cp-card" aria-labelledby="plan-change-title">
    <div className="billing-section-head"><div><h3 id="plan-change-title" className="cp-card-title">Choose your plan</h3><p>Upgrade this cycle, or select a lower plan for next month.</p></div></div>
    <PlanChoices ent={ent} selected={selected} busy={busy} onSelect={choose} />
    {resting && scheduled ? <section className="plan-context plan-context-saved" aria-label="Next plan selection">
      <div className="plan-context-heading"><div><span className="plan-context-eyebrow">Next period · {date(scheduled.effectiveAt)}</span><h4>{name(scheduled.planId)} selected <span className="plan-context-tag">{scheduled.planId === 'free' ? 'No payment needed' : 'Unpaid'}</span></h4></div>
        <div className="plan-context-tools">{(renewDue || !active) && scheduled.planId !== 'free' ? <button type="button" className="billing-secondary" disabled={busy} onClick={() => choose(scheduled.planId, 'renew')}>Review next month</button> : null}
        <button type="button" className="billing-text-button" disabled={busy} onClick={() => perform(cancelNextPlan, 'Next-plan selection removed. Nothing was charged.')}>Cancel next selection</button></div></div>
      <p>{scheduled.planId === 'free' ? `Your ${name(ent?.plan)} access continues until ${date(scheduled.effectiveAt)}, then your account returns to Free.` : 'This is an unpaid selection. Pay manually to activate it; otherwise your account returns to Free at expiry.'}</p>
    </section> : renewalLater ? <section className="plan-context plan-context-current" aria-label="Current plan renewal">
      <div className="plan-context-heading"><div><h4>You're on {name(selected)}</h4><p>{ent?.periodEnd ? `Active until ${date(ent.periodEnd)}. Renewal opens ${date(new Date(Date.parse(ent.periodEnd) - 7 * 86400000).toISOString())}.` : 'Manual renewal opens during the last seven days of your paid period.'}</p></div><button type="button" className="billing-text-button" disabled={busy} onClick={() => choose(null)}>Back to plan options</button></div>
      {scheduled ? <p>{name(scheduled.planId)} is selected for your next period. <button type="button" className="billing-text-button" disabled={busy} onClick={() => choose(scheduled.planId)}>View next selection</button></p> : <p>No action is needed today. Your current access continues.</p>}
    </section> : selected && !savedChoice && downgrade ? <section className="plan-context plan-context-review" aria-label="Review plan change">
      <div className="plan-context-heading"><div><span className="plan-context-eyebrow">Change at period end</span><h4>Move to {name(selected)}</h4></div><div className="plan-context-total"><span>Due today</span><strong>{formatInr(0)}</strong></div></div>
      <div className="plan-context-timeline"><div><span className="plan-context-eyebrow">Until {date(ent.periodEnd)}</span><strong>{name(ent.plan)} stays active</strong></div><span className="plan-context-arrow" aria-hidden="true">→</span><div><span className="plan-context-eyebrow">After this period</span><strong>{name(selected)}{selected === 'free' ? ' · no payment needed' : ` · ${formatInr(target.monthly)} / month`}</strong></div></div>
      <p>{selected === 'free' ? 'Your paid access continues until this period ends. Your top-up credits keep their expiry dates.' : 'Save this choice now. Pay manually to activate the next paid month; nothing is charged or changed today.'}{scheduled ? ` This replaces your saved ${name(scheduled.planId)} selection.` : ''}</p>
      <div className="plan-context-actions"><button type="button" className="plan-up-pay" disabled={busy || !state} onClick={() => perform(() => scheduleNextPlan(selected))}>Schedule change to {name(selected)}</button><button type="button" className="billing-text-button" disabled={busy} onClick={() => choose(null)}>Cancel selection</button></div>
    </section> : selected && !savedChoice ? <section className="plan-context plan-context-review" aria-label="Review your purchase" aria-busy={!quote && quoteStatus !== 'error'}>
      {quote ? <>
        <div className="plan-context-heading"><div><span className="plan-context-eyebrow">{quote.action === 'upgrade' ? 'Upgrade now' : quote.action === 'renew' ? 'Manual renewal' : 'Start your plan'}</span><h4>{quote.action === 'upgrade' ? `Upgrade to ${name(selected)}` : `${name(selected)} · one month`}</h4></div><div className="plan-context-total"><span>Due today</span><strong>{formatInr(quote.amountPaise / 100)}</strong></div></div>
        <dl className="plan-context-facts"><div><dt>{quote.action === 'upgrade' ? 'Additional credits' : 'Included credits'}</dt><dd>{creditsText(quote.credits)}</dd></div><div><dt>{quote.action === 'upgrade' ? 'Available until' : 'Plan period'}</dt><dd>{quote.action === 'upgrade' ? '' : `${date(quote.cycleStartsAt)} – `}{date(quote.cycleEndsAt)}</dd></div></dl>
        <p>{quote.action === 'upgrade' ? 'Applies immediately. Your existing credits and cycle end stay unchanged.' : quote.action === 'renew' ? 'Your current access continues. This payment covers your next monthly period.' : 'Your plan starts after confirmed payment for the period shown above.'}{quote.action === 'upgrade' && scheduled ? ` On payment, your saved ${name(scheduled.planId)} selection will be cancelled.` : ''}</p>
        <details className="plan-context-details"><summary>{quote.action === 'upgrade' ? 'How this upgrade is calculated' : 'Renewal & credit details'}</summary>
          {quote.action === 'upgrade' ? <p>{quote.prorationBasis === 'ist-calendar-day-v1' ? `${quote.remainingDays} of ${quote.cycleDays} billing days remaining. Today's price is fixed until midnight IST or your cycle ends.` : 'Price and additional credits cover the rest of this cycle.'}</p> : null}
          <p>Next full month: {formatInr(quote.monthlyAmountPaise / 100)} for {creditsText(quote.monthlyCredits)}. Renewal is manual. No GST is charged.</p><p>10% of unused monthly credits rolls over for one month. Top-ups keep their own expiry.</p>
        </details>
        {expired ? <p role="status" className="plan-context-warning">This quote has expired. Refresh it before paying.</p> : null}
        <div className="plan-context-actions"><button type="button" className="plan-up-pay" disabled={busy || expired} onClick={() => perform(() => completeCheckout({ planId: selected, quoteId: quote.quoteId, user }))}>Pay {formatInr(quote.amountPaise / 100)} with Razorpay</button>{expired ? <button type="button" className="billing-secondary" disabled={busy} onClick={retryQuote}>Refresh quote</button> : null}<button type="button" className="billing-text-button" disabled={busy} onClick={() => choose(null)}>Cancel selection</button></div>
      </> : quoteStatus === 'error' ? <><h4>Price unavailable</h4><p role="alert">{message}</p><div className="plan-context-actions"><button type="button" className="billing-secondary" disabled={busy} onClick={retryQuote}>Try quote again</button><button type="button" className="billing-text-button" disabled={busy} onClick={() => choose(null)}>Back to plans</button></div></> : <div className="plan-context-loading" role="status"><span className="plan-context-loading-mark" aria-hidden="true"/><div><h4>Getting your price</h4><p>Calculating {name(selected)} for your account. Nothing has been charged.</p></div></div>}
    </section> : null}
    {message && !(selected && !downgrade && !renewalLater && quoteStatus === 'error') ? <p role="status" className="plan-context-message">{message}</p> : null}
    <div className="plan-context-footer"><span>Manual renewal. No automatic charges.</span>{active && scheduled?.planId !== 'free' ? <button type="button" className="billing-text-button" aria-pressed={selected === 'free'} disabled={busy} onClick={() => choose(selected === 'free' ? null : 'free')}>{selected === 'free' ? 'Free selected for review' : 'Use Free after this period'}</button> : null}</div>
  </section>;
}
