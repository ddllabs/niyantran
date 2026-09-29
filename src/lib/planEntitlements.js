import { TABS } from '../desks/catalog.js';
import { serverEntitlement } from './entitlementStore.js';
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
 * The live entitlement for a signed-in user: status free | trial | active.
 *
 * Read only from the server (my_entitlement(), via entitlementStore.js),
 * for this user's id. Plan fields on the user record come from
 * sessionStorage and are ignored, so editing them unlocks nothing (F2).
 * Until the server has answered, the account is treated as free.
 */
export function entitlementOf(user) {
  const server = serverEntitlement(user?.id);
  const free = {
    plan: 'explorer',
    status: 'free',
    trialEndsAt: null,
    periodEnd: server?.periodEnd || null,
    trialExpired: false,
    trialUsed: Boolean(server?.trialUsed),
    loaded: Boolean(server),
  };
  if (!server) return free;
  const plan = normalizePlanId(server.plan);
  const status = ['free', 'trial', 'active'].includes(server.status) ? server.status : 'free';
  if (plan === 'explorer' || status === 'free') return free;
  // A period that ends while the terminal is open reads as free straight away,
  // as the server will on its next read.
  const end = server.periodEnd ? Date.parse(server.periodEnd) : NaN;
  if (Number.isFinite(end) && end <= Date.now()) {
    return { ...free, trialExpired: status === 'trial' };
  }
  return {
    ...free,
    plan,
    status,
    trialEndsAt: status === 'trial' ? server.periodEnd : null,
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
  const e = entitlementOf(user);
  if (e.status === 'trial') return false;
  if (e.status === 'free' || e.plan === 'explorer') return false;
  return true;
}

export function canCopy(user) {
  return canExport(user);
}

export function rowCapForUser(user) {
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
