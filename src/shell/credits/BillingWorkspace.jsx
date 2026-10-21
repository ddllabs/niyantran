import { useState } from 'react';
import { PUBLIC_PLANS } from '../../lib/publicPlans.js';
import { formatInr } from '../../lib/billing.js';
import { creditsText } from '../../lib/creditsStore.js';
import BillingRenewalNotice from './BillingRenewalNotice.jsx';
import BillingHistory from './BillingHistory.jsx';
import BillingReviews from './BillingReviews.jsx';
import PlanCycleReview from './PlanCycleReview.jsx';
import Purchases from './Purchases.jsx';
import PlanPeriods from './PlanPeriods.jsx';
import BillingCreditBreakdown from './BillingCreditBreakdown.jsx';
import './billingWorkspace.css';

const label = id => id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Free';
const date = iso => Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
export default function BillingWorkspace({ ent,user,initialPlan,config,credits,creditsTried,invoices,invoiceError,revision,onUpdated,onRetryConfig }) {
  const [notice,setNotice] = useState('');
  const [renewalReview,setRenewalReview] = useState(null);
  const ready = Boolean(config && !config.unavailable);
  const active = ent?.status === 'active' && !ent.lapsed && PUBLIC_PLANS.some(p => p.id === ent.plan && p.monthly > 0);
  const inGrace = active && ent.inGrace === true;
  const plan = active ? ent.plan : 'free';
  const product = PUBLIC_PLANS.find(p => p.id === plan);
  function updated() { setNotice('Billing updated.');onUpdated(); }
  return <div className="billing-modern">
    <section className="billing-surface billing-account" aria-labelledby="billing-current-title">
      <div className="billing-account-head"><div><div className="billing-title-line"><h3 id="billing-current-title">Your plan</h3><span className={`billing-plan-badge plan-${plan}`}>{label(plan)}</span></div>
        <p>{inGrace ? 'Paid period ended · temporary model access' : active ? `Active until ${date(ent.periodEnd)}` : 'Use your welcome and top-up credits, or choose a paid plan.'}</p></div>
      </div>
      <BillingRenewalNotice ent={ent} onRenew={ready ? id => {
        setRenewalReview(previous => ({ plan: id, key: (previous?.key || 0) + 1 }));
        requestAnimationFrame(() => {
          const picker = document.getElementById('billing-plan-picker');
          picker?.scrollIntoView({ block: 'start' });
          const target = picker?.querySelector('button[aria-pressed="true"]') || picker?.querySelector('button:not(:disabled)');
          target?.focus({ preventScroll: true });
        });
      } : undefined}/>
      <dl className="billing-account-facts">
        <div><dt>Plan price</dt><dd>{formatInr(product?.monthly || 0)}{active ? <small> / month</small> : null}</dd></div>
        <div><dt>{inGrace ? 'Allowance per paid month' : 'Monthly allowance'}</dt><dd>{active ? <>{creditsText(product.monthlyCredits)}<small> / month</small></> : 'No monthly allowance'}</dd></div>
        <div><dt>Credits available</dt><dd>{credits ? creditsText(credits.available) : '—'}</dd></div>
      </dl>
      {creditsTried && !credits ? <p role="alert" className="billing-status billing-status-warn">Your balance could not be loaded. Refresh before buying credits.</p> : null}
      <p className="billing-balance-note">Includes all your unexpired credits. Open the breakdown for their sources and expiry dates.</p>
      {credits?.held > 0 ? <p className="billing-muted">{creditsText(credits.held)} held for a running answer; excluded from your available balance.</p> : null}
      {credits?.debt > 0 ? <p className="billing-status billing-status-warn">{creditsText(credits.debt)} owed, taken from your next credits.</p> : null}
      <details className="billing-credit-details"><summary><span>Credit breakdown &amp; expiry</span><span className="billing-disclosure-chevron" aria-hidden="true">⌄</span></summary>
        {!inGrace && active && credits?.allowance != null ? <p className="billing-muted">Plan credits added this period: <strong>{creditsText(credits.allowance)}</strong>.</p> : null}
        {!inGrace && active && credits?.allowance != null && credits.allowance !== product.monthlyCredits ? <p className="billing-muted">A prorated upgrade adds credits for the remaining days, so this period’s allocation can differ from a full month’s allowance.</p> : null}
        {credits?.usedThisCycle != null ? <p className="billing-muted">Used this period: {creditsText(credits.usedThisCycle)}</p> : null}
        {credits ? <BillingCreditBreakdown lots={credits.lots}/> : <p className="billing-muted" role="status">{creditsTried ? 'Your credit breakdown is unavailable. Please refresh.' : 'Loading your credit breakdown…'}</p>}
      </details>
      <div className="billing-account-foot"><span>{inGrace ? 'Renew to continue paid model access' : active ? 'Renew manually before expiry' : 'No monthly subscription'}</span><span>Top-ups keep their own expiry dates</span></div>
      {notice ? <p role="status" className="billing-feedback">{notice}</p> : null}
    </section>
    {ready ? <>
    <div id="billing-plan-picker"><PlanCycleReview key={renewalReview?.key || initialPlan} ent={ent} user={user} initialPlan={renewalReview ? renewalReview.plan : initialPlan} onUpdated={updated}/></div>
    {active ? <PlanPeriods revision={revision} compact /> : null}
    <Purchases user={user} onUpdated={onUpdated} revision={revision} showHistory={false} suppliedConfig={config}/>
    <BillingHistory invoices={invoices} invoiceError={invoiceError} revision={revision} onRefresh={onUpdated}/>
    <p className="billing-policy-note">Prices in INR. No GST is charged. Plans renew manually; top-up credits are valid for 12 months. <a href="/refunds">Refund &amp; cancellation policy</a></p>
    {user?.role === 'admin' ? <BillingReviews user={user}/> : null}
    </> : <section className="billing-surface billing-options-loading" aria-busy={!config} aria-labelledby="billing-options-loading-title">
      <h3 id="billing-options-loading-title">{config?.unavailable ? 'Billing options could not be loaded' : 'Loading plan options…'}</h3>
      <p className="billing-muted" role="status">{config?.unavailable ? 'Your current plan is unchanged. Try again to view billing options.' : 'Your current plan and balance load independently.'}</p>
      {config?.unavailable ? <button type="button" className="billing-secondary" onClick={onRetryConfig}>Try again</button> : <div className="billing-options-skeleton" aria-hidden="true">{[0,1,2,3].map(i => <span key={i}/>)}</div>}
    </section>}
  </div>;
}
