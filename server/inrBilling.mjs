/**
 * INR plan quotes and invoices (open-work F109).
 *
 * Paid plans are Plus, Pro and Max, billed monthly in Indian rupees at the
 * prices on the public pricing page (src/lib/publicPlans.js, the one source of
 * plan prices). The seller is not registered under GST, so no GST is collected
 * (CGST Act s.32) and invoices are plain invoices, not tax invoices.
 */
import crypto from 'crypto';
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

/** Printable invoice HTML. */
export function renderInvoiceHtml(inv, seller) {
  const s = inv.seller || seller || sellerFromEnv();
  const label = inv.planLabel || LABELS[inv.planId] || inv.planId;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Invoice ${esc(inv.invoiceNo)}</title>
<style>
  body{font:14px/1.45 system-ui,Segoe UI,sans-serif;color:#131313;margin:32px;max-width:820px}
  h1{font-size:20px;margin:0 0 4px;letter-spacing:.04em}
  .muted{color:#666;font-size:12px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:20px 0}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  th,td{border:1px solid #ddd;padding:8px 10px;text-align:left}
  th{background:#f6f4f0;font-size:12px}
  td.r,th.r{text-align:right}
  .tot{font-weight:700;font-size:15px}
  .stamp{margin-top:28px;font-size:12px;color:#444}
  @media print{body{margin:12px} .noprint{display:none}}
</style>
</head>
<body>
  <p class="muted noprint"><button onclick="window.print()">Print / Save PDF</button></p>
  <h1>INVOICE</h1>
  <p class="muted">${esc(inv.invoiceNo)} · ${esc(inv.issuedAt?.slice(0, 10) || '')} · INR</p>
  <div class="grid">
    <div>
      <strong>From</strong><br/>
      ${esc(s.legalName)}<br/>
      ${esc(s.tradeName)}<br/>
      ${esc(s.address)}<br/>
      ${esc(s.email)}<br/>
      <span class="muted">Not registered under GST</span>
    </div>
    <div>
      <strong>Bill to</strong><br/>
      ${esc(inv.buyerName || '—')}<br/>
      ${esc(inv.buyerEmail || inv.email || '')}
    </div>
  </div>
  ${inv.cycleEndsAt ? `<p class="muted">Covered period: ${esc(inv.action === 'upgrade' ? inv.issuedAt : inv.cycleStartsAt)} – ${esc(inv.cycleEndsAt)}</p>` : ''}
  <table>
    <thead><tr><th>#</th><th>Description</th><th class="r">Amount</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>${esc(inv.description || `${label} plan — one month`)}</td><td class="r">${inr(inv.total)}</td></tr>
      <tr class="tot"><td></td><td>Total paid (INR)</td><td class="r">${inr(inv.total)}</td></tr>
    </tbody>
  </table>
  <p class="muted">No GST has been charged: the supplier is not registered under GST. Payment via ${esc(inv.provider || 'razorpay')}${inv.paymentId ? ` · ${esc(inv.paymentId)}` : ''}.</p>
  <p class="stamp">This is a computer-generated invoice. Amounts in Indian rupees.</p>
</body>
</html>`;
}
