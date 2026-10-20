import { useEffect, useState } from 'react';
import { fetchPurchases, formatInr, openInvoice } from '../../lib/billing.js';

const date = iso => Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
const title = order => {
  const s = order.snapshot || {};
  const plan = s.planId ? s.planId.charAt(0).toUpperCase() + s.planId.slice(1) : '';
  return s.action === 'upgrade' ? `Upgrade to ${plan}` : s.kind === 'topup' ? `${Number(s.credits).toLocaleString('en-IN')} AI credits` : s.label || (plan ? `${plan} plan` : 'Purchase');
};
function TransactionDetails({ reference, providerOrder }) {
  const [copied, setCopied] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(reference); setCopied('Copied'); }
    catch { setCopied('Select the reference to copy it.'); }
  }
  return <details className="billing-transaction-details"><summary>Details</summary>
    <dl><dt>Purchase reference</dt><dd>{reference}</dd>{providerOrder ? <><dt>Payment order</dt><dd>{providerOrder}</dd></> : null}</dl>
    <button type="button" className="billing-text-button" onClick={copy}>Copy reference</button>
    {copied ? <span role="status">{copied}</span> : null}
  </details>;
}

export function BillingHistoryTable({ orders, invoices, invoiceError = '' }) {
  const visible = orders.filter(o => !o.creation_retryable && o.state !== 'ready');
  const usedInvoices = new Set();
  const rows = visible.map(order => {
    const invoice = invoices.find(i => i.orderId && i.orderId === order.provider_order_id);
    if (invoice) usedInvoices.add(invoice.id);
    return { id: order.id, reference: order.id, providerOrder: order.provider_order_id, date: order.created_at, title: title(order), amount: Number(order.snapshot?.amountPaise) / 100, status: order.state, invoice };
  });
  for (const invoice of invoices) if (!usedInvoices.has(invoice.id)) rows.push({ id: invoice.id, date: invoice.issuedAt, title: invoice.description || invoice.label || `${invoice.planId || ''} plan`, amount: Number(invoice.total), status: 'fulfilled', invoice });
  rows.sort((a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const uncertain = rows.some(r => !['fulfilled','refunded'].includes(r.status));
  return <>
    {uncertain ? <p className="billing-status billing-status-warn" role="status">Check before paying again: a purchase still needs confirmation or support review.</p> : null}
    {invoiceError ? <p role="alert" className="billing-status billing-status-warn">{invoiceError}</p> : null}
    {rows.length ? <div className="billing-table-scroll" role="region" aria-label="Billing history table" tabIndex={0}><table className="billing-table">
      <caption className="billing-sr-only">Payments and invoices</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" className="billing-number">Amount</th><th scope="col">Status</th><th scope="col">Invoice</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td><time dateTime={row.date}>{date(row.date)}</time></td>
        <td><strong>{row.title}</strong>{row.reference ? <TransactionDetails reference={row.reference} providerOrder={row.providerOrder} /> : null}</td>
        <td className="billing-number">{Number.isFinite(row.amount) ? formatInr(row.amount) : '—'}</td>
        <td><span className={`billing-status-pill ${row.status === 'fulfilled' ? 'is-paid' : row.status === 'refunded' ? 'is-neutral' : 'is-pending'}`}>{({fulfilled:'Paid',refunded:'Refund recorded',review:'Support review'}[row.status] || 'Confirming')}</span></td>
        <td>{row.invoice ? <><button type="button" className="billing-text-button" onClick={() => openInvoice(row.invoice.id)}>View invoice</button><small>{row.invoice.invoiceNo}</small></> : <span className="billing-muted">{invoiceError ? 'Unavailable' : 'Pending'}</span>}</td>
      </tr>)}</tbody>
    </table></div> : <p className="billing-empty">No completed purchases yet. Your payments and invoices will appear here.</p>}
  </>;
}
export default function BillingHistory({ invoices, invoiceError, revision, onRefresh }) {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetchPurchases().then(value => { if(live) { setOrders(value);setError(''); } }).catch(() => { if(live) setError('Payment history could not be loaded. Please refresh.'); });
    return () => { live = false; };
  }, [revision]);
  async function refresh() {
    if(busy) return;setBusy(true);
    try { setOrders(await fetchPurchases());setError('');onRefresh(); }
    catch { setError('Payment history could not be loaded. Please refresh.'); }
    finally { setBusy(false); }
  }
  return <section className="billing-surface" aria-labelledby="billing-history-title">
    <div className="billing-section-head"><div><h3 id="billing-history-title">Billing history</h3><p>Payments, receipts and invoices in one place.</p></div><button type="button" className="billing-secondary" disabled={busy} onClick={refresh}>{busy ? 'Refreshing…' : 'Refresh'}</button></div>
    {error ? <p role="alert" className="billing-status billing-status-warn">{error}</p> : orders === null || (invoices === null && !invoiceError) ? <p className="billing-empty">Loading billing history…</p> : <BillingHistoryTable orders={orders} invoices={invoices || []} invoiceError={invoiceError} />}
  </section>;
}
