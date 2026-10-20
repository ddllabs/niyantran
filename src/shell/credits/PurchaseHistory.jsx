import { formatInr } from '../../lib/billing.js';

const statusOf = order => order.creation_retryable ? 'Checkout not started — retry available'
  : ({ ready: 'Awaiting payment', fulfilled: 'Confirmed', review: 'Support review required', refunded: 'Refund recorded' }[order.state] || 'Confirmation pending');

function PurchaseRows({ orders }) {
  return <ul className="billing-history-list">{orders.map(order => {
    const date = new Date(order.created_at);
    const amount = order.snapshot?.amountPaise;
    return <li key={order.id}>
      <div className="billing-history-main"><strong>{order.snapshot?.label || 'Purchase'}</strong><span>{statusOf(order)}</span></div>
      <div className="billing-history-meta">
        {Number.isFinite(date.getTime()) ? <time dateTime={order.created_at}>{date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time> : null}
        {Number.isFinite(amount) ? <span>{formatInr(amount / 100)}</span> : null}
        <span className="billing-reference">Reference: {order.id}</span>
      </div>
    </li>;
  })}</ul>;
}

export default function PurchaseHistory({ orders }) {
  const attempts = orders.filter(o => o.state === 'ready' || o.creation_retryable);
  const completed = orders.filter(o => o.state === 'fulfilled' || o.state === 'refunded');
  const unresolved = orders.filter(o => !attempts.includes(o) && !completed.includes(o));
  return <div className="billing-history">
    <h4>Purchase history</h4>
    {completed.length ? <PurchaseRows orders={completed} /> : <p className="plan-up-note">No completed purchases yet.</p>}
    {unresolved.length ? <section aria-label="Needs confirmation">
      <h4>Needs confirmation</h4>
      <p>Check these purchases before paying again. A pending status is not proof of payment.</p>
      <PurchaseRows orders={unresolved} />
    </section> : null}
  </div>;
}
