import { useState } from 'react';
import { PUBLIC_PLANS } from '../../lib/publicPlans.js';
import { formatInr } from '../../lib/billing.js';
import { creditsText } from '../../lib/creditsStore.js';
import BillingHistory from './BillingHistory.jsx';
import BillingReviews from './BillingReviews.jsx';
import PlanCycleReview from './PlanCycleReview.jsx';
import Purchases from './Purchases.jsx';
import PlanPeriods from './PlanPeriods.jsx';
import BillingCreditBreakdown from './BillingCreditBreakdown.jsx';
import './billingWorkspace.css';

const label = id => id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Free';
const date = iso => Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
export default function BillingWorkspace({ ent,user,initialPlan,config,credits,creditsTried,invoices,invoiceError,revision,onUpdated }) {
  const [choosing,setChoosing] = useState(Boolean(initialPlan));
  const [planState,setPlanState] = useState(null);
  const [notice,setNotice] = useState('');
  const active = ent?.status === 'active' && !ent.lapsed && PUBLIC_PLANS.some(p => p.id === ent.plan && p.monthly > 0);
  const plan = active ? ent.plan : 'free';
  const product = PUBLIC_PLANS.find(p => p.id === plan);
  const topups = credits?.lots?.filter(l => l.kind === 'topup').reduce((n,l) => n + l.remaining,0) || 0;
  function updated() { setChoosing(false);setNotice('Billing updated.');onUpdated(); }
  return <div className="billing-modern">
    <section className="billing-surface billing-account" aria-labelledby="billing-current-title">
      <div className="billing-account-head"><div><div className="billing-title-line"><h3 id="billing-current-title">Your plan</h3><span className={`billing-plan-badge plan-${plan}`}>{label(plan)}</span></div>
        <p>{active ? `Active until ${date(ent.periodEnd)}` : 'Use your welcome and top-up credits, or choose a paid plan.'}</p></div>
        <button type="button" className="billing-primary" aria-expanded={choosing} aria-controls="billing-plan-picker" onClick={() => setChoosing(v => !v)}>{choosing ? 'Close plan options' : 'Change plan'}</button>
      </div>
      <dl className="billing-account-facts">
        <div><dt>{active ? 'Monthly price' : 'Plan price'}</dt><dd>{formatInr(product?.monthly || 0)}{active ? <small> / month</small> : null}</dd></div>
        <div><dt>{active ? 'Included this cycle' : 'Welcome credits remaining'}</dt><dd>{credits ? creditsText(active ? credits.allowance : credits.lots.filter(l => l.kind === 'signup').reduce((n,l) => n+l.remaining,0)) : '—'}</dd></div>
        <div><dt>Available balance</dt><dd>{credits ? creditsText(credits.available) : '—'}</dd></div>
        <div><dt>Top-up balance</dt><dd>{credits ? creditsText(topups) : '—'}</dd></div>
      </dl>
      {creditsTried && !credits ? <p role="alert" className="billing-status billing-status-warn">Your balance could not be loaded. Refresh before buying credits.</p> : null}
      {credits?.held > 0 ? <p className="billing-muted">{creditsText(credits.held)} held for a running answer; excluded from your available balance.</p> : null}
      {credits?.debt > 0 ? <p className="billing-status billing-status-warn">{creditsText(credits.debt)} owed, taken from your next credits.</p> : null}
      {credits ? <details className="billing-credit-details"><summary>Credit breakdown &amp; expiry</summary>
        {credits.usedThisCycle != null ? <p className="billing-muted">Used this cycle: {creditsText(credits.usedThisCycle)}</p> : null}
        <BillingCreditBreakdown lots={credits.lots}/>
      </details> : null}
      <div className="billing-account-foot"><span>{active ? 'Renew manually before expiry · 10% monthly rollover' : 'No monthly subscription'}</span><span>Top-ups keep their own expiry dates</span></div>
      {planState?.scheduled ? <div className="billing-next-notice"><span className="billing-next-dot"/><div><strong>{label(planState.scheduled.planId)} selected for next month</strong><p>{planState.scheduled.planId === 'free' ? `Your paid access ends ${date(planState.scheduled.effectiveAt)}.` : `After ${date(planState.scheduled.effectiveAt)} · payment required to activate`}</p></div><button type="button" className="billing-text-button" onClick={() => setChoosing(true)}>Manage</button></div> : null}
      {notice ? <p role="status" className="billing-feedback">{notice}</p> : null}
    </section>
    <div id="billing-plan-picker" hidden={!choosing}><PlanCycleReview ent={ent} user={user} initialPlan={initialPlan} onUpdated={updated} onStateChange={setPlanState}/></div>
    <PlanPeriods revision={revision} compact />
    <Purchases user={user} onUpdated={onUpdated} revision={revision} showHistory={false} suppliedConfig={config}/>
    <BillingHistory invoices={invoices} invoiceError={invoiceError} revision={revision} onRefresh={onUpdated}/>
    <p className="billing-policy-note">Prices in INR. No GST is charged. Plans renew manually; top-up credits are valid for 12 months. <a href="/refunds">Refund &amp; cancellation policy</a></p>
    {user?.role === 'admin' ? <BillingReviews user={user}/> : null}
  </div>;
}
