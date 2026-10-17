import { TABS } from '../desks/tabs.js';
import { serverEntitlement } from './entitlementStore.js';
import { PUBLIC_PLANS, normalizePlanId } from './publicPlans.js';
import { userTypeOf } from './userTypes.js';

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
  return PUBLIC_PLANS.find((p) => p.id === id) || PUBLIC_PLANS[0];
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

export { normalizePlanId };

/**
 * The live entitlement for a signed-in user: status free | active.
 *
 * Read only from the server (my_entitlement(), via entitlementStore.js),
 * for this user's id. Plan fields on the user record come from
 * sessionStorage and are ignored, so editing them unlocks nothing (F2).
 * Until the server has answered, the account is treated as free.
 */
export function entitlementOf(user) {
  const server = serverEntitlement(user?.id);
  const free = {
    plan: 'free',
    status: 'free',
    periodEnd: server?.periodEnd || null,
    loaded: Boolean(server),
  };
  if (!server) return free;
  const plan = normalizePlanId(server.plan);
  if (plan === 'free' || server.status !== 'active') return free;
  // A period that ends while the terminal is open reads as free straight away,
  // as the server will on its next read.
  const end = server.periodEnd ? Date.parse(server.periodEnd) : NaN;
  if (Number.isFinite(end) && end <= Date.now()) return free;
  return { ...free, plan, status: 'active' };
}

export function isFree(user) {
  return entitlementOf(user).plan === 'free';
}

export function isPaidActive(user) {
  return entitlementOf(user).status === 'active';
}

/** Commercial desk access is free; the app verifies the session/profile. */
export function canAccessDesk(user, deskId) {
  return Boolean(user?.id && user.active !== false && TABS.some(tab => tab.id === deskId));
}

export function deskLocked(user, deskId) {
  return !canAccessDesk(user, deskId);
}

/** Every signed-in account can discover every terminal desk. */
export function navTabsForUser(user) {
  return TABS;
}

export function canExport(user) {
  return Boolean(user?.id && user.active !== false);
}

export function canCopy(user) {
  return canExport(user);
}

/** Source and pagination limits remain; there is no commercial row cap. */
export function rowCapForUser() {
  return null;
}

export function applyRowCap(feed) {
  return feed;
}
