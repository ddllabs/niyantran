import { useEffect, useState } from 'react';
import { completeCheckout, fetchBillingConfig, fetchPurchases, formatInr } from '../../lib/billing.js';

export default function Purchases({ user }) {
  const [config, setConfig] = useState(null);
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    Promise.all([fetchBillingConfig(), fetchPurchases()]).then(([c, rows]) => {
      if (live) { setConfig(c); setOrders(rows || []); }
    });
    return () => { live = false; };
  }, [user?.id]);
  async function buy(productId) {
    setBusy(true); setMessage('Opening secure checkout…');
    try {
      const result = await completeCheckout({ productId, user });
      setMessage(result.ok ? 'Purchase confirmed. Your credits have been refreshed.' : result.reason || 'Confirmation is pending. Check purchases before paying again.');
      setOrders(await fetchPurchases());
    } finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true);
    try { setOrders(await fetchPurchases()); setMessage('Purchase status refreshed.'); }
    finally { setBusy(false); }
  }
  return <section className="cp-card" aria-labelledby="topup-title">
    <h3 id="topup-title" className="cp-card-title">Credit top-ups</h3>
    <p>Available on Free and paid accounts. Valid for 12 months. Model access follows your plan.</p>
    {!config?.enabled ? <p>Top-ups coming soon. Need more credits now? Write to <a href="mailto:niyantranai@gmail.com">niyantranai@gmail.com</a>.</p> : null}
    <div className="plan-up-choices">
      {(config?.topups || []).map(pack => <button type="button" className="plan-up-plan" key={pack.productId} disabled={busy || !config?.enabled} onClick={() => buy(pack.productId)}>
        <strong>{pack.credits.toLocaleString('en-IN')} credits</strong><span>{formatInr(pack.amountPaise / 100)}</span>
      </button>)}
    </div>
    {message ? <p role="status">{message}</p> : null}
    {orders.length ? <>
      <h4>Your recent purchases</h4>
      <p>Pending confirmation does not mean you need to pay again.</p>
      <ul>{orders.map(order => <li key={order.id}>{order.snapshot?.label} · {order.creation_retryable ? 'Checkout not started — retry available' : order.state === 'fulfilled' ? 'Confirmed' : order.state === 'review' ? 'Support review required' : order.state === 'refunded' ? 'Refund recorded' : 'Confirmation pending'}</li>)}</ul>
      <button type="button" disabled={busy} onClick={refresh}>Refresh purchase status</button>
    </> : null}
  </section>;
}
