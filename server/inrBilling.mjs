/**
 * INR plan quotes and invoices (open-work F109).
 *
 * Paid plans are Plus, Pro and Max, billed monthly in Indian rupees at the
 * prices on the public pricing page (src/lib/publicPlans.js, the one source of
 * plan prices). The seller is not registered under GST, so no GST is collected
 * (CGST Act s.32) and invoices are plain invoices, not tax invoices.
 */
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { PUBLIC_PLANS } from '../src/lib/publicPlans.js';

const PAID_PLANS = Object.fromEntries(
  PUBLIC_PLANS.filter((p) => p.monthly > 0).map((p) => [p.id, { rupees: p.monthly, label: p.name[0] + p.name.slice(1).toLowerCase() }]),
);

export function planCatalog() {
  return PAID_PLANS;
}

export function sellerFromEnv() {
  return {
    legalName: process.env.BILLING_LEGAL_NAME || 'Niyantran Consulting Pvt. Ltd.',
    tradeName: process.env.BILLING_TRADE_NAME || 'NIYANTRAN TERMINAL',
    address: process.env.BILLING_ADDRESS || '48, Vivekananda Park, Haridevpur, Kolkata, West Bengal, India – 700082',
    email: process.env.BILLING_EMAIL || 'niyantranai@gmail.com',
  };
}

/** One month of a paid plan, in rupees and paise. Unknown or free plans have no quote. */
export function computeQuote({ planId } = {}) {
  const id = String(planId || '').toLowerCase();
  const row = PAID_PLANS[id];
  if (!row) return null;
  return {
    planId: id,
    planLabel: row.label,
    period: 'monthly',
    currency: 'INR',
    total: row.rupees,
    amountPaise: row.rupees * 100,
  };
}

export function newInvoiceId() {
  return `inv_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const LABELS = Object.fromEntries(Object.entries(PAID_PLANS).map(([id, p]) => [id, p.label]));

const invoiceMark = `data:image/webp;base64,${readFileSync(new URL('../public/brand/logo-128.webp', import.meta.url)).toString('base64')}`;
function invoiceDate(value) {
  const parsed = new Date(value);
  return value && Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
}

/** Self-contained, printable invoice; financial facts come from the issued snapshot. */
export function renderInvoiceHtml(inv, seller) {
  const s = inv.seller || seller || sellerFromEnv();
  const label = inv.planLabel || LABELS[inv.planId] || inv.planId || 'Paid';
  const coverageStart = inv.action === 'upgrade' ? inv.issuedAt : inv.cycleStartsAt;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Invoice ${esc(inv.invoiceNo)}</title>
<style>
  *{box-sizing:border-box}body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f5f3;margin:0;padding:32px 20px}
  .toolbar{max-width:800px;margin:0 auto 16px;display:flex;justify-content:space-between;align-items:center;color:#686e78;font-size:12px}
  button{font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;border:1px solid #d8dce3;border-radius:8px;padding:10px 16px;color:#172033;cursor:pointer}
  button:focus-visible{outline:3px solid #4169e1;outline-offset:3px}.sheet{max-width:800px;margin:auto;background:#fff;padding:48px;border:1px solid #e1e3e7;border-radius:12px}
  header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:32px;border-bottom:2px solid #12389b}.brand{display:flex;align-items:center;gap:12px}.brand img{width:42px;height:42px;object-fit:contain}.brand strong{display:block;font-size:15px;letter-spacing:.14em}.brand span,.muted{color:#686e78;font-size:12px}
  h1{font-size:28px;line-height:1.2;margin:0 0 8px;letter-spacing:-.025em}.paid{display:inline-block;border:1px solid #b9dfce;background:#eef8f2;color:#24634b;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:650}
  .invoice-meta{display:flex;justify-content:space-between;gap:20px;margin:32px 0}.invoice-meta p{margin:0}.eyebrow{display:block;font-size:10px;font-weight:650;letter-spacing:.1em;text-transform:uppercase;color:#686e78;margin-bottom:8px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin:32px 0}.grid p{margin:0;overflow-wrap:anywhere}.grid strong{font-weight:600}.coverage{background:#f6f8fc;padding:12px 16px;border-radius:8px;font-size:12px;margin:24px 0}
  table{width:100%;border-collapse:collapse;margin-top:28px}th{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#686e78;font-weight:600}th,td{padding:14px 0;text-align:left;border-bottom:1px solid #e6e8ec}td.r,th.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.total{display:flex;align-items:center;justify-content:flex-end;gap:36px;padding:24px 0}.total strong{font-size:26px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
  .payment{border-top:1px solid #e6e8ec;padding-top:24px;font-size:12px;overflow-wrap:anywhere}.payment p{margin:4px 0}footer{margin-top:32px;border-top:1px solid #e6e8ec;padding-top:20px;font-size:11px;color:#686e78}
  @media(max-width:560px){body{padding:16px 10px}.sheet{padding:24px 20px}.grid{grid-template-columns:1fr;gap:24px}.brand strong{font-size:12px}header{align-items:flex-start}.invoice-meta{flex-wrap:wrap}h1{font-size:23px}.total strong{font-size:23px}}
  @page{size:A4;margin:16mm}@media print{body{background:#fff;padding:0}.sheet{border:0;border-radius:0;padding:0;max-width:none}.noprint{display:none}tr,.grid,.payment{break-inside:avoid}a{color:inherit;text-decoration:none}}
</style>
</head>
<body>
  <div class="toolbar noprint"><span>Invoice · ${esc(inv.invoiceNo)}</span><button type="button" onclick="window.print()">Print / Save PDF</button></div>
  <main class="sheet">
    <header><div class="brand"><img src="${invoiceMark}" alt="Niyantran logo"/><div><strong>NIYANTRAN</strong><span>TERMINAL</span></div></div><div><h1>Invoice</h1><span class="paid">Paid</span></div></header>
    <div class="invoice-meta"><p><span class="eyebrow">Invoice number</span><strong>${esc(inv.invoiceNo)}</strong></p><p><span class="eyebrow">Date issued</span>${esc(invoiceDate(inv.issuedAt))}</p><p><span class="eyebrow">Currency</span>INR · Indian rupees</p></div>
    <div class="grid"><div><span class="eyebrow">From</span><p><strong>${esc(s.legalName)}</strong><br/>${esc(s.tradeName)}<br/>${esc(s.address)}<br/>${esc(s.email)}<br/><span class="muted">Not registered under GST</span></p></div><div><span class="eyebrow">Bill to</span><p><strong>${esc(inv.buyerName || '—')}</strong><br/>${esc(inv.buyerEmail || inv.email || '')}</p></div></div>
    ${inv.cycleEndsAt ? `<p class="coverage"><strong>Service period</strong> &nbsp; ${esc(invoiceDate(coverageStart))} – ${esc(invoiceDate(inv.cycleEndsAt))}</p>` : ''}
    <table><thead><tr><th scope="col">Description</th><th scope="col" class="r">Amount</th></tr></thead><tbody><tr><td>${esc(inv.description || `${label} plan — one month`)}</td><td class="r">${inr(inv.total)}</td></tr></tbody></table>
    <div class="total"><span>Total paid</span><strong>${inr(inv.total)}</strong></div>
    <div class="payment"><span class="eyebrow">Payment details</span><p>Paid via ${esc(inv.provider || 'Razorpay')}${inv.paymentId ? ` · ${esc(inv.paymentId)}` : ''}</p>${inv.orderId ? `<p class="muted">Order reference: ${esc(inv.orderId)}</p>` : ''}<p class="muted">No GST has been charged. The supplier is not registered under GST.</p></div>
    <footer>This is a computer-generated invoice. Please contact ${esc(s.email)} for billing support.</footer>
  </main>
</body>
</html>`;
}
