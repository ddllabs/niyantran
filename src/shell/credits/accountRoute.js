/**
 * The credits page's address in the terminal (F184, docs/specs/2026-10-15-credits-page.md §1):
 * #/account/<section>, one per section, so back, forward and bookmarks work as they do for desks.
 * A plan chosen elsewhere (the public pricing page) rides in the address: #/account/billing?plan=pro.
 */
import { parseDeskHash } from '../../lib/deskRoute.js';

export const ACCOUNT_SECTIONS = [
  { id: 'credits', label: 'Overview', question: 'How much do I have, and how fast am I using it?' },
  { id: 'usage', label: 'Usage', question: 'Where did my credits go?' },
  { id: 'activity', label: 'Activity', question: 'What did each answer cost?' },
  { id: 'billing', label: 'Plan and invoices', question: 'What am I paying for?' },
];
const IDS = new Set(ACCOUNT_SECTIONS.map((s) => s.id));

/** The section an address names, 'credits' for a bare or unknown one, or null when it is not the credits page. */
export function parseAccountHash(hash = typeof location !== 'undefined' ? location.hash : '') {
  const raw = String(hash || '').replace(/^#/, '').replace(/^\/+/, '').split('?')[0].toLowerCase();
  const [head, section = ''] = raw.split('/');
  if (head !== 'account') return null;
  return IDS.has(section) ? section : 'credits';
}

/**
 * The desk an address names, or null for the credits page, whose address leaves the desk underneath
 * as it was (TerminalShell's back and forward handling).
 */
export function deskRouteFor(hash = typeof location !== 'undefined' ? location.hash : '') {
  return parseAccountHash(hash) ? null : parseDeskHash(hash);
}

export function accountHash(section) {
  return `#/account/${IDS.has(section) ? section : 'credits'}`;
}

/** The plan an address hands to Plan and invoices (#/account/billing?plan=pro), or null. */
export function accountPlan(hash = typeof location !== 'undefined' ? location.hash : '') {
  const query = String(hash || '').split('?')[1] || '';
  const plan = new URLSearchParams(query).get('plan');
  return plan && /^[a-z]{2,20}$/.test(plan) ? plan : null;
}

/** Opens a section of the credits page, optionally with a plan to preselect on Plan and invoices. */
export function goAccount(section, { plan = null } = {}) {
  if (typeof location === 'undefined') return;
  const chosen = section === 'billing' && plan ? `?plan=${encodeURIComponent(plan)}` : '';
  location.hash = `${accountHash(section)}${chosen}`;
}
