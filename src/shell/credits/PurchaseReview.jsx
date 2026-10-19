import { formatInr } from '../../lib/billing.js';

export default function PurchaseReview({ label, amountPaise, credits, timing, currentPlan, topup = false, busy, disabled, onConfirm, onCancel }) {
  return <section className="billing-review" aria-label="Review your purchase">
    <h4>Review your purchase</h4>
    <dl>
      <div><dt>Item</dt><dd>{label}</dd></div>
      {currentPlan ? <div><dt>Current plan</dt><dd>{currentPlan}</dd></div> : null}
      <div><dt>AI credits</dt><dd>{credits.toLocaleString('en-IN')}</dd></div>
      <div><dt>Total payable</dt><dd>{formatInr(amountPaise / 100)}</dd></div>
    </dl>
    {timing ? <p>{timing}</p> : null}
    <p>{topup ? 'Your plan and model access stay unchanged. Credits are valid for 12 months from fulfilment.' : 'One payment covers one month. No automatic renewal.'} No GST is charged.</p>
    <div className="billing-review-actions">
      <button type="button" className="plan-up-pay" disabled={disabled || busy} onClick={onConfirm}>{busy ? 'Opening payment…' : `Pay ${formatInr(amountPaise / 100)} with Razorpay`}</button>
      <button type="button" className="billing-secondary" disabled={busy} onClick={onCancel}>Cancel selection</button>
    </div>
  </section>;
}
