import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  checkoutPlans,
  completeCheckout,
  fetchBillingConfig,
  fetchGstQuote,
  formatInr,
  openInvoice,
} from '../lib/billing.js';
import { entitlementOf, trialDaysLeft } from '../lib/planEntitlements.js';
import { sessionUser } from '../lib/userStore.js';

export default function UpgradeModal({
  open,
  reason = 'desk',
  deskLabel = '',
  onClose,
  onUpgraded,
  forcePlan = null,
}) {
  const user = sessionUser();
  const ent = entitlementOf(user);
  const [yearly, setYearly] = useState(false);
  const [planId, setPlanId] = useState(forcePlan || (ent.plan === 'explorer' ? 'pro' : ent.plan === 'pro' ? 'enterprise' : 'pro'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [quote, setQuote] = useState(null);
  const [states, setStates] = useState([]);
  const [buyerGstin, setBuyerGstin] = useState('');
  const [buyerStateCode, setBuyerStateCode] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const plans = useMemo(() => checkoutPlans().filter((p) => p.id !== 'explorer'), []);

  useEffect(() => {
    if (!open) return undefined;
    setErr('');
    setMsg('');
    setInvoice(null);
    setPlanId(forcePlan || (ent.plan === 'explorer' ? 'pro' : 'enterprise'));
    fetchBillingConfig().then((cfg) => {
      setStates(Array.isArray(cfg.states) ? cfg.states : []);
      if (!buyerStateCode && cfg.sellerStateCode) setBuyerStateCode(cfg.sellerStateCode);
    });
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, forcePlan, ent.plan, onClose]);

  useEffect(() => {
    if (!open || !planId) return undefined;
    let cancelled = false;
    fetchGstQuote({ planId, yearly, buyerGstin, buyerStateCode }).then((res) => {
      if (cancelled) return;
      if (res.ok) setQuote(res.quote);
      else setQuote(null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, planId, yearly, buyerGstin, buyerStateCode]);

  if (!open) return null;

  const picked = plans.find((p) => p.id === planId) || plans[0];
  const price = picked ? (yearly && picked.yearly != null ? picked.yearly : picked.monthly) : 0;
  const trialLeft = trialDaysLeft(user);

  const title =
    reason === 'export'
      ? 'Export needs a paid plan'
      : reason === 'copy'
        ? 'Copy is limited on this plan'
        : reason === 'trial'
          ? 'You are on a free trial'
          : reason === 'data'
            ? 'Full data needs an upgrade'
            : deskLabel
              ? `Unlock ${deskLabel}`
              : 'Upgrade your access';

  const lead =
    reason === 'trial'
      ? `Trial seats show a capped record set and block copy/export. ${trialLeft ? `${trialLeft} day${trialLeft === 1 ? '' : 's'} left.` : 'Trial ended.'} Buy a plan to keep working without prompts.`
      : reason === 'export' || reason === 'copy'
        ? 'Explorer and trial seats cannot copy or export records. Upgrade to Professional or Enterprise to download with provenance.'
        : 'Explorer includes 5 core desks for your persona. Upgrade to open every desk and full coverage.';

  async function onPay() {
    setBusy(true);
    setErr('');
    setMsg('');
    setInvoice(null);
    const res = await completeCheckout({
      planId: picked?.id || 'pro',
      yearly,
      user,
      billing: { buyerGstin, buyerStateCode, buyerAddress, buyerName: user?.name },
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.reason || 'Checkout failed.');
      return;
    }
    if (res.invoice) setInvoice(res.invoice);
    if (res.quote) setQuote(res.quote);
    if (res.mode === 'demo') {
      setMsg(res.reason || 'Demo gateway — seat upgraded. GST invoice saved.');
    } else if (res.mode === 'razorpay') {
      setMsg('Payment verified. GST tax invoice issued.');
    } else {
      setMsg('Plan updated.');
    }
    onUpgraded?.(res.user);
    if (!res.invoice) {
      setTimeout(() => onClose?.(), res.mode === 'demo' ? 1200 : 700);
    }
  }

  return createPortal(
    <div className="plan-up-root" role="presentation">
      <button type="button" className="plan-up-scrim" aria-label="Close" onClick={onClose} />
      <div className="plan-up-card" role="dialog" aria-modal="true" aria-labelledby="plan-up-title">
        <header className="plan-up-head">
          <div>
            <p className="plan-up-kicker">BILLING · INR + GST</p>
            <h2 id="plan-up-title">{title}</h2>
          </div>
          <button type="button" className="plan-up-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <p className="plan-up-lead">{lead}</p>

        <div className="plan-up-bill">
          <button type="button" className={!yearly ? 'on' : ''} onClick={() => setYearly(false)}>
            Monthly
          </button>
          <button type="button" className={yearly ? 'on' : ''} onClick={() => setYearly(true)}>
            Yearly · save 17%
          </button>
        </div>

        <div className="plan-up-plans" role="radiogroup" aria-label="Plan">
          {plans.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={planId === p.id}
              className={`plan-up-plan${planId === p.id ? ' on' : ''}${p.popular ? ' pop' : ''}`}
              onClick={() => setPlanId(p.id)}
            >
              {p.popular ? <em>Popular</em> : null}
              <strong>{p.name}</strong>
              <span className="amt">
                ${yearly && p.yearly != null ? p.yearly : p.monthly}
                <small>{p.unit}</small>
              </span>
              <span className="who">{p.who}</span>
            </button>
          ))}
        </div>

        <div className="plan-up-gst">
          <label>
            <span>GSTIN (optional)</span>
            <input
              value={buyerGstin}
              onChange={(e) => {
                const v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15);
                setBuyerGstin(v);
                if (v.length >= 2) setBuyerStateCode(v.slice(0, 2));
              }}
              placeholder="22AAAAA0000A1Z5"
              autoComplete="off"
              spellCheck="false"
            />
          </label>
          <label>
            <span>Place of supply (state)</span>
            <select value={buyerStateCode} onChange={(e) => setBuyerStateCode(e.target.value)}>
              <option value="">Select state</option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            <span>Billing address (optional)</span>
            <input
              value={buyerAddress}
              onChange={(e) => setBuyerAddress(e.target.value)}
              placeholder="Address for the tax invoice"
            />
          </label>
        </div>

        {quote ? (
          <div className="plan-up-tax">
            <div>
              <span>Taxable (INR)</span>
              <b>{formatInr(quote.taxable)}</b>
            </div>
            {quote.taxSplit === 'cgst_sgst' ? (
              <>
                <div>
                  <span>CGST 9%</span>
                  <b>{formatInr(quote.cgst)}</b>
                </div>
                <div>
                  <span>SGST 9%</span>
                  <b>{formatInr(quote.sgst)}</b>
                </div>
              </>
            ) : (
              <div>
                <span>IGST 18%</span>
                <b>{formatInr(quote.igst)}</b>
              </div>
            )}
            <div className="tot">
              <span>Total payable</span>
              <b>{formatInr(quote.total)}</b>
            </div>
            <p className="plan-up-tax-note">
              List ${price} × FX {quote.usdToInr} → INR exclusive of GST (SAC {quote.sac}). Charged in INR via
              Razorpay.
            </p>
          </div>
        ) : null}

        <div className="plan-up-actions">
          <button type="button" className="plan-up-pay" disabled={busy || !picked} onClick={onPay}>
            {busy
              ? 'Opening checkout…'
              : quote
                ? `Pay ${formatInr(quote.total)} · ${picked?.name || 'Pro'}`
                : `Upgrade to ${picked?.name || 'Pro'} · $${price}${picked?.unit || ''}`}
          </button>
          <button type="button" className="plan-up-later" onClick={onClose}>
            Not now
          </button>
        </div>
        {msg ? <p className="plan-up-ok">{msg}</p> : null}
        {invoice ? (
          <p className="plan-up-inv">
            Invoice <b>{invoice.invoiceNo}</b>{' '}
            <button
              type="button"
              className="plan-up-inv-link"
              onClick={async () => {
                const opened = await openInvoice(invoice.id);
                if (!opened.ok) setErr(opened.reason);
              }}
            >
              View / print GST invoice
            </button>
          </p>
        ) : null}
        {err ? (
          <p className="plan-up-err" role="alert">
            {err}
          </p>
        ) : null}
        <p className="plan-up-note">
          Checkout runs through <b>Razorpay</b> (INR + 18% GST). Set seller <code>BILLING_GSTIN</code> and address in{' '}
          <code>.env</code>. Without Razorpay keys, checkout is off on the live site; a local dev server issues a demo invoice.
        </p>
      </div>
    </div>,
    document.body,
  );
}
