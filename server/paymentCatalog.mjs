import { PUBLIC_PLANS } from '../src/lib/publicPlans.js';

export const CREDIT_UNIT = 'credit-paise-v2';
export const TOPUP_PACKS = Object.freeze([
  [20000, 499], [50000, 1199], [100000, 2299], [200000, 4399], [500000, 10499],
].map(([credits, rupees]) => Object.freeze({ productId: `topup-${credits}`, kind: 'topup', credits,
  amountPaise: rupees * 100, currency: 'INR', creditUnit: CREDIT_UNIT,
  version: '2026-10-18', label: `${credits.toLocaleString('en-IN')} AI credits`, validMonths: 12 })));
const ALLOWANCES = { plus: 20000, pro: 65000, max: 750000 };
export function paymentProduct(id) {
  const pack = TOPUP_PACKS.find(p => p.productId === id);
  if (pack) return { ...pack };
  const plan = PUBLIC_PLANS.find(p => p.monthly > 0 && (p.id === id || `plan-${p.id}` === id));
  return plan ? { productId: `plan-${plan.id}`, kind: 'plan', planId: plan.id, credits: ALLOWANCES[plan.id],
    amountPaise: plan.monthly * 100, currency: 'INR', creditUnit: CREDIT_UNIT,
    version: '2026-10-18', label: `${plan.name} plan — one month`, period: 'monthly' } : null;
}
