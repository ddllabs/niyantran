import { TABS } from '../desks/catalog.js';
import { isTestingPhase } from './appFlagsStore.js';
import { loadPricing } from './pricingStore.js';
import { userTypeOf } from './userTypes.js';

export const TRIAL_DAYS = 14;
export const TRIAL_ROW_CAP = 25;
export const FREE_ROW_CAP = 40;

/** Persona → 5 core desks (always includes home). */
const CORE_BY_PERSONA = {
  policy: ['home', 'national', 'state', 'law', 'economics'],
  journalist: ['home', 'national', 'global', 'law', 'economics'],
  student: ['home', 'national', 'state', 'law', 'global'],
  analyst: ['home', 'national', 'economics', 'global', 'law'],
  lawyer: ['home', 'law', 'national', 'state', 'global'],
  academic: ['home', 'national', 'law', 'global', 'economics'],
};

export function planOf(id) {
  const plans = loadPricing();
  return plans.find((p) => p.id === id) || plans.find((p) => p.id === 'explorer');
}

export function coreDesksForPersona(typeId) {
  const type = userTypeOf(typeId).id;
  const pick = CORE_BY_PERSONA[type] || CORE_BY_PERSONA.analyst;
  const known = new Set(TABS.map((t) => t.id));
  const out = [];
  for (const id of pick) {
    if (known.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= 5) break;
  }
  if (!out.includes('home')) out.unshift('home');
  return out.slice(0, 5);
}

export function normalizePlanId(plan) {
  const id = String(plan || 'explorer').toLowerCase();
  if (id === 'professional') return 'pro';
  if (id === 'government' || id === 'govt') return 'gov';
  if (['explorer', 'pro', 'enterprise', 'gov'].includes(id)) return id;
  return 'explorer';
}

/**
 * Derive live entitlement from a user record.
 * status: free | trial | active
 */
export function entitlementOf(user) {
  const plan = normalizePlanId(user?.plan);
  let status = String(user?.planStatus || '').toLowerCase();
  if (!status) {
    if (plan === 'explorer') status = 'free';
    else status = 'active';
  }
  const trialEndsAt = user?.trialEndsAt || null;
  if (status === 'trial' && trialEndsAt) {
    const end = Date.parse(trialEndsAt);
    if (Number.isFinite(end) && end < Date.now()) {
      return {
        plan: 'explorer',
        status: 'free',
        trialEndsAt,
        trialExpired: true,
        yearly: Boolean(user?.billingYearly),
      };
    }
  }
  return {
    plan,
    status: status === 'trial' || status === 'active' || status === 'free' ? status : plan === 'explorer' ? 'free' : 'active',
    trialEndsAt,
    trialExpired: false,
    yearly: Boolean(user?.billingYearly),
  };
}

export function isTrial(user) {
  return entitlementOf(user).status === 'trial';
}

export function isFree(user) {
  return entitlementOf(user).status === 'free' || entitlementOf(user).plan === 'explorer';
}

export function isPaidActive(user) {
  const e = entitlementOf(user);
  return e.status === 'active' && e.plan !== 'explorer';
}

export function canAccessDesk(user, deskId) {
  if (isTestingPhase()) return true;
  const e = entitlementOf(user);
  if (deskId === 'home') return true;
  if (e.status === 'active' || e.status === 'trial') return true;
  return coreDesksForPersona(user?.personaId || user?.type).includes(deskId);
}

export function deskLocked(user, deskId) {
  return !canAccessDesk(user, deskId);
}

/** Nav shows every terminal desk; locks apply for free seats. */
export function navTabsForUser(user) {
  return TABS;
}

export function canExport(user) {
  if (isTestingPhase()) return true;
  const e = entitlementOf(user);
  if (e.status === 'trial') return false;
  if (e.status === 'free' || e.plan === 'explorer') return false;
  return true;
}

export function canCopy(user) {
  return canExport(user);
}

export function rowCapForUser(user) {
  if (isTestingPhase()) return null;
  const e = entitlementOf(user);
  if (e.status === 'trial') return TRIAL_ROW_CAP;
  if (e.status === 'free' || e.plan === 'explorer') return FREE_ROW_CAP;
  return null;
}

export function applyRowCap(feed, user) {
  const cap = rowCapForUser(user);
  if (!feed || !cap || !Array.isArray(feed.rows)) return feed;
  const total = feed.rows.length;
  if (total <= cap) return feed;
  return {
    ...feed,
    rows: feed.rows.slice(0, cap),
    note: [feed.note, `Showing ${cap} of ${total} rows — upgrade for full coverage.`]
      .filter(Boolean)
      .join(' '),
    _planCapped: true,
    _planCap: cap,
    _planTotal: total,
  };
}

export function trialDaysLeft(user) {
  const e = entitlementOf(user);
  if (e.status !== 'trial' || !e.trialEndsAt) return 0;
  const ms = Date.parse(e.trialEndsAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / 86400000);
}

export function startTrialFields(planId) {
  const plan = normalizePlanId(planId);
  if (plan === 'explorer' || plan === 'gov') {
    return { plan: plan === 'gov' ? 'gov' : 'explorer', planStatus: plan === 'gov' ? 'active' : 'free', trialEndsAt: null };
  }
  const end = new Date();
  end.setDate(end.getDate() + TRIAL_DAYS);
  return {
    plan,
    planStatus: 'trial',
    trialEndsAt: end.toISOString(),
  };
}

export function paidFields(planId, yearly = false) {
  return {
    plan: normalizePlanId(planId),
    planStatus: 'active',
    trialEndsAt: null,
    billingYearly: Boolean(yearly),
  };
}
