import { useEffect, useRef, useState } from 'react';
import { completeCheckout, fetchBillingConfig, fetchPurchases, formatInr } from '../../lib/billing.js';
import PurchaseHistory from './PurchaseHistory.jsx';
import PurchaseReview from './PurchaseReview.jsx';

export default function Purchases({ user, onUpdated, revision = 0 }) {
  const [config, setConfig] = useState(null);
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const buying = useRef(false);
  useEffect(() => {
    let live = true;
    Promise.all([fetchBillingConfig(), fetchPurchases()]).then(([c, rows]) => {
      if (live) { setConfig(c); setOrders(rows || []); }
    }).catch(() => { if (live) setError('Purchase history could not be loaded. Try refreshing.'); });
    return () => { live = false; };
  }, [user?.id, revision]);
  async function buy(productId) {
    if (buying.current) return;
    buying.current = true;
    setBusy(true); setMessage('Opening secure checkout…');
    try {
      const result = await completeCheckout({ productId, user });
      setMessage(result.ok ? 'Purchase confirmed. Your credits have been refreshed.' : result.reason || 'Confirmation is pending. Check purchases before paying again.');
      if (result.ok) { setSelected(null); onUpdated?.(); }
      setOrders(await fetchPurchases());
      setError('');
    } catch { setError('Purchase status could not be loaded. Check before paying again.'); }
    finally { buying.current = false; setBusy(false); }
  }
  async function refresh() {
    setBusy(true);
    try { setOrders(await fetchPurchases()); setError(''); setMessage('Purchase status refreshed.'); onUpdated?.(); }
    catch { setError('Purchase history could not be loaded. Try refreshing.'); }
    finally { setBusy(false); }
  }
  return <section className="cp-card" aria-labelledby="topup-title">
    <h3 id="topup-title" className="cp-card-title">Credit top-ups</h3>
    <p>Available on Free and paid accounts. Valid for 12 months. Model access follows your plan.</p>
    {!config?.enabled ? <p>Top-ups coming soon. Need more credits now? Write to <a href="mailto:niyantranai@gmail.com">niyantranai@gmail.com</a>.</p> : null}
    <div className="plan-up-choices">
      {(config?.topups || []).map(pack => <button type="button" className={`plan-up-plan${selected?.productId === pack.productId ? ' on' : ''}`} aria-pressed={selected?.productId === pack.productId} key={pack.productId} disabled={busy || !config?.enabled} onClick={() => { setSelected(pack); setMessage(''); }}>
        <strong>{pack.credits.toLocaleString('en-IN')} credits</strong><span>{formatInr(pack.amountPaise / 100)}</span>
      </button>)}
    </div>
    {selected ? <PurchaseReview label={`${selected.credits.toLocaleString('en-IN')} AI credits`} amountPaise={selected.amountPaise} credits={selected.credits}
      topup busy={busy} disabled={!config?.enabled} onConfirm={() => buy(selected.productId)} onCancel={() => setSelected(null)} /> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : <PurchaseHistory orders={orders} />}
    <button type="button" className="billing-secondary" disabled={busy} onClick={refresh}>Refresh purchase status</button>
  </section>;
}
