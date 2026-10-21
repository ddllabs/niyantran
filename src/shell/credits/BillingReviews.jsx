import { useEffect, useState } from 'react';
import { fetchBillingReviews, reviewBillingAdjustment, runBillingRecovery } from '../../lib/billing.js';

export default function BillingReviews({ user }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState('');
  const [credits, setCredits] = useState('0');
  const [cancel, setCancel] = useState(false);
  const [restore, setRestore] = useState('0');
  const [restorePeriod, setRestorePeriod] = useState(false);
  const [reason, setReason] = useState('');
  const [documentRef, setDocumentRef] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(null);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let live = true;
    fetchBillingReviews().then(list => { if (live) { setRows(list); setLoadError(''); } })
      .catch(() => { if (live) setLoadError('Payment operations could not be loaded. Try refreshing the page.'); });
    return () => { live = false; };
  }, [user.id]);
  function changed() { setRequestId(null); }
  async function review(event) {
    event.preventDefault(); setBusy(true);
    const stable = requestId || globalThis.crypto.randomUUID(); setRequestId(stable);
    const result = await reviewBillingAdjustment({ adjustmentId: selected, requestId: stable,
      decision: { resolution: rows.find(r => r.id === selected)?.kind === 'purchase_review' ? 'refund_recorded' : 'reviewed', creditsToRemove: Number(credits), creditsToRestore: Number(restore), cancelPeriod: cancel, restorePeriod, reason, document: documentRef ? { reference: documentRef } : null } });
    setMessage(result.ok ? 'Reviewed adjustment recorded.' : result.reason || 'Review could not be confirmed. Retry the same decision.');
    if (result.ok) {
      try { setRows(await fetchBillingReviews()); setLoadError(''); }
      catch { setLoadError('Adjustment list could not be refreshed.'); }
      setSelected(''); setRequestId(null);
    }
    setBusy(false);
  }
  async function recover() {
    setBusy(true);
    const result = await runBillingRecovery();
    setMessage(result.ok ? `Recovery checked ${result.ordersChecked} orders and processed ${result.eventsProcessed} events.` : result.reason);
    try { setRows(await fetchBillingReviews()); setLoadError(''); }
    catch { setLoadError('Payment operations could not be loaded.'); }
    setBusy(false);
  }
  return <section className="cp-card" aria-labelledby="billing-reviews-title">
    <details className="billing-disclosure"><summary id="billing-reviews-title">Payment operations · Admin only</summary>
    <p>Purchase exceptions require a confirmed full provider refund before they can be closed. Provider events are recorded automatically. This action changes benefits only; it does not initiate a cash refund.</p>
    <p>Top-up removal requires a full refund and the entire unused original credit allocation. Used, reserved or partially refunded credits require support review; unrelated credits are never substituted.</p>
    <button type="button" disabled={busy} onClick={recover}>Run bounded payment recovery</button>
    {loadError ? <p role="alert">{loadError}</p> : rows.length ? <form onSubmit={review}>
      <label>Adjustment <select required value={selected} disabled={busy} onChange={e => {setSelected(e.target.value);changed();}}>
        <option value="">Choose an adjustment</option>{rows.map(row => <option key={row.id} value={row.id}>{row.kind} · {row.provider_adjustment_id} · {row.provider_status}</option>)}
      </select></label>
      <label>Credits to remove <input required type="number" min="0" step="0.0001" value={credits} disabled={busy} onChange={e=>{setCredits(e.target.value);changed();}} /></label>
      <label><input type="checkbox" checked={cancel} disabled={busy} onChange={e=>{setCancel(e.target.checked);changed();}} />Cancel this purchase’s paid period</label>
      <label>Previously reversed credits to restore <input type="number" min="0" step="0.0001" value={restore} disabled={busy} onChange={e=>{setRestore(e.target.value);changed();}} /></label>
      <label><input type="checkbox" checked={restorePeriod} disabled={busy} onChange={e=>{setRestorePeriod(e.target.checked);changed();}} />Restore the original unexpired paid period</label>
      <label>Review reason <textarea required minLength={5} maxLength={1000} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);changed();}} /></label>
      <label>Adjustment document reference <input maxLength={160} value={documentRef} disabled={busy} onChange={e=>{setDocumentRef(e.target.value);changed();}} /></label>
      <button type="submit" disabled={busy || !selected}>Record reviewed adjustment</button>
    </form> : <p>No unreviewed adjustments were returned.</p>}
    {message ? <p role="status">{message}</p> : null}
    </details>
  </section>;
}
