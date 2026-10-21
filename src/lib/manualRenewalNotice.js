import { PUBLIC_PLANS } from './publicPlans.js';

export const MANUAL_EXPIRY_COPY = 'Unless you choose Free, eligible paid model access may continue for up to 48 hours after paid expiry, with no new monthly credits. Without renewal, your account then returns to Free.';

export function billingDateTime(iso) {
  if (!Number.isFinite(Date.parse(iso))) return '—';
  const value = new Date(iso);
  const day = value.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const time = value.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toLowerCase();
  return `${day}, ${time} IST`;
}

// Presentation only. Never infer or extend access from the browser clock.
export function manualRenewalNotice(ent, now = Date.now()) {
  const product = PUBLIC_PLANS.find(p => p.id === ent?.plan && p.monthly > 0);
  const end = Date.parse(ent?.periodEnd);
  if (product && ent.status === 'active' && !ent.lapsed) {
    if (ent.inGrace === true && Number.isFinite(Date.parse(ent.graceUntil || ent.accessUntil))) {
      return { kind: 'grace', planId: product.id, deadline: ent.graceUntil || ent.accessUntil, product };
    }
    if (!Number.isFinite(end) || end <= now || end - now > 7 * 86400000) return null;
    return { kind: end - now <= 2 * 86400000 ? 'due-soon' : 'reminder', planId: product.id, deadline: ent.periodEnd, product };
  }
  if (ent?.lapsed && Number.isFinite(end)) return { kind: 'lapsed', deadline: ent.periodEnd };
  return null;
}
