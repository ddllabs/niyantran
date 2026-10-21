import { manualRenewalNotice, billingDateTime, MANUAL_EXPIRY_COPY } from '../../lib/manualRenewalNotice.js';
import { rupees } from '../../lib/publicPlans.js';

export default function BillingRenewalNotice({ ent, onRenew, now }) {
  const notice = manualRenewalNotice(ent, now);
  if (!notice) return null;
  const grace = notice.kind === 'grace';
  const lapsed = notice.kind === 'lapsed';
  const title = grace ? 'Your paid period has ended' : lapsed ? 'Your account is now Free' : notice.kind === 'due-soon' ? 'Your plan expires within two days' : 'Your plan expires within seven days';
  return <section className={`billing-renewal-notice billing-renewal-${notice.kind}`} aria-label="Manual renewal notice">
    <div><h4>{title}</h4>
      {grace ? <><p>Paid model access continues until <strong>{billingDateTime(notice.deadline)}</strong>. Renew to keep access beyond this deadline; otherwise your account returns to Free.</p><p>No new monthly credits are added during grace. Monthly credits expire normally with no rollover. Valid welcome and top-up credits remain usable. Every AI request still uses credits and needs sufficient funds.</p><p>Renewal costs the full plan price and keeps your original monthly anchor. Payment covers the period starting at your original paid expiry, not a new month from today.</p></> : lapsed ? <p>Your paid period ended {billingDateTime(notice.deadline)}. Choose a paid plan to restore paid model access. Valid welcome and top-up credits remain usable with Free models.</p> : <p>{notice.product.name} expires {billingDateTime(notice.deadline)}. Renew manually for {rupees(notice.product.monthly)} per month. No automatic charges. {MANUAL_EXPIRY_COPY}</p>}
    </div>
    {onRenew ? <button type="button" className="billing-secondary" onClick={() => onRenew(notice.planId || null)}>{lapsed ? 'Choose a paid plan' : 'Renew now'}</button> : null}
  </section>;
}
