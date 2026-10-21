import { PUBLIC_PLANS, purchaseKind, rupees } from '../lib/publicPlans.js';

export default function PlanChoices({ ent, selected, busy = false, includeFree = false, onSelect }) {
  const current = ent?.status === 'active' && !ent?.lapsed ? ent.plan : 'free';
  return <div className={`plan-up-choices${includeFree ? ' has-free' : ''}`} role="group" aria-label="Available plans">
    {PUBLIC_PLANS.filter(p => includeFree || p.monthly > 0).map(p => {
      const free = p.id === 'free';
      const option = free ? current === 'free' ? 'current-free' : 'downgrade' : purchaseKind(ent, p.id);
      return <button type="button" key={p.id}
        className={`plan-up-plan${selected === p.id ? ' on' : ''}${current === p.id ? ' billing-current' : ''}`}
        aria-pressed={selected === p.id} disabled={busy || option === 'blocked' || option === 'current-free'} onClick={() => onSelect(p.id)}>
        {current === p.id ? <em>Current plan</em> : p.popular ? <em>Popular</em> : null}
        <strong>{p.name}</strong>
        <span className="amt">{rupees(p.monthly)}<small>/month</small></span>
        <span className="plan-up-allowance">{free ? 'No monthly credit allowance' : p.items[0]}</span>
        <span className="who">{free ? 'All desks. AI uses your available credits.' : option === 'blocked' ? 'Unavailable for your current plan' : option === 'downgrade' ? 'Starts after your current paid period' : p.tag}</span>
      </button>;
    })}
  </div>;
}
