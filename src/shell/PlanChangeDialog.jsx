import { useEffect, useId, useRef, useState } from 'react';
import { PUBLIC_PLANS, purchaseKind } from '../lib/publicPlans.js';
import PlanChoices from './PlanChoices.jsx';

export default function PlanChangeDialog({ ent, onClose, onReview }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const [selected, setSelected] = useState(null);
  const active = ent?.status === 'active' && !ent?.lapsed;
  const current = PUBLIC_PLANS.find(p => p.id === (active ? ent.plan : 'free')) || PUBLIC_PLANS[0];
  const choice = PUBLIC_PLANS.find(p => p.id === selected);
  const kind = choice?.id === 'free' && current.id !== 'free' ? 'downgrade' : choice ? purchaseKind(ent, choice.id) : null;
  const end = active && ent.periodEnd ? new Date(ent.periodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.querySelector('.cp-profile-trigger');
    dialog.showModal();
    return () => { dialog.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);

  return <dialog ref={dialogRef} className="plan-picker" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="plan-picker-head">
      <h2 id={titleId}>Change plan</h2>
      <button type="button" className="billing-secondary" onClick={onClose} aria-label="Close plan picker">Close</button>
    </div>
    <p className="plan-up-lead">Current plan: <strong>{current.name}</strong>{end ? ` · active until ${end}` : ''}</p>
    <p className="plan-up-note">No automatic renewal. Review your plan change before confirming.</p>
    <PlanChoices ent={ent} selected={selected} includeFree onSelect={setSelected} />
    {choice ? <p role="status" className="plan-picker-timing">
      {kind === 'downgrade' ? `Your ${current.name} access continues${end ? ` until ${end}` : ' through the current paid period'}. ${choice.name} starts after that period ends.${choice.id === 'free' ? ' No payment is needed.' : ''}`
        : kind === 'renew' ? `Adds one month of ${choice.name} after your current paid period.`
          : kind === 'upgrade' ? `${choice.name} starts now. Unused days of ${current.name} are not refunded.`
            : `One month of ${choice.name}, starting now.`}
    </p> : null}
    <button type="button" className="plan-up-pay" disabled={!choice} onClick={() => { if (choice) onReview(choice.id); }}>
      {choice ? `Review ${choice.name} ${choice.id === 'free' ? 'change' : 'purchase'}` : 'Choose a plan'}
    </button>
  </dialog>;
}
