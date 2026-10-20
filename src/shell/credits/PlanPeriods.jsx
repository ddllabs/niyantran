import { useEffect, useState } from 'react';
import { fetchPlanPeriods, openInvoice } from '../../lib/billing.js';
import { creditsText } from '../../lib/creditsStore.js';
import { PUBLIC_PLANS } from '../../lib/publicPlans.js';

const day = value => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

// Mounted with the account key: a previous buyer's schedule cannot survive a switch.
export default function PlanPeriods({ revision = 0, compact = false }) {
  const [periods, setPeriods] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    fetchPlanPeriods().then(list => { if (live) { setPeriods(list); setError(''); } })
      .catch(() => { if (live) setError('Purchased plan periods could not be loaded. Refresh purchases to try again.'); });
    return () => { live = false; };
  }, [revision]);
  const displayed = compact && periods ? periods.filter(p => p.status === 'scheduled') : periods;
  if (compact && displayed && !displayed.length && !error) return null;
  return <section className="plan-periods" aria-labelledby="plan-periods-title">
    <h4 id="plan-periods-title" className="plan-credits-sub">{compact ? 'Next paid period' : 'Purchased plan periods'}</h4>
    {error ? <p role="alert">{error}</p> : periods === null ? <p className="plan-up-note">Loading purchased plan periods…</p>
      : displayed.length ? <ul className="plan-periods-list">{displayed.map(period => {
        const name = PUBLIC_PLANS.find(plan => plan.id === period.plan)?.name || period.plan;
        return <li key={period.id}>
          <strong>{name.charAt(0) + name.slice(1).toLowerCase()} · {period.status === 'scheduled' ? compact ? 'Paid · starts next cycle' : 'Scheduled' : 'Active'}</strong>
          <span>{day(period.startsAt)} – {day(period.endsAt)}</span>
          <span>{creditsText(period.credits)} allowance{period.status === 'scheduled' ? ' — available when this period starts; excluded from your current balance.' : ' for this period.'}</span>
          {period.invoiceId ? <button type="button" className="plan-up-inv-link" onClick={() => openInvoice(period.invoiceId)}>Open invoice</button> : null}
        </li>;
      })}</ul> : <p className="plan-up-note">No upcoming paid periods. Your current plan is shown above.</p>}
    <p className="plan-up-note">No automatic renewal. Top-up credits keep their own expiry dates.</p>
  </section>;
}
