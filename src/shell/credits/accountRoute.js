/**
 * The credits page's address in the terminal (F184, docs/specs/2026-10-15-credits-page.md §1):
 * #/account/<section>, one per section, so back, forward and bookmarks work as they do for desks.
 * A plan chosen elsewhere (the public pricing page, the chat's Upgrade) is handed to the Plan and
 * invoices section once, in memory.
 */
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

export function accountHash(section) {
  return `#/account/${IDS.has(section) ? section : 'credits'}`;
}

let wantedPlan = null;

/** Opens a section of the credits page, optionally with a plan to preselect on Plan and invoices. */
export function goAccount(section, { plan = null } = {}) {
  if (plan !== null && plan !== undefined) wantedPlan = String(plan);
  if (typeof location !== 'undefined') location.hash = accountHash(section);
}

/** The plan handed over by goAccount, once. */
export function takeAccountPlan() {
  const plan = wantedPlan;
  wantedPlan = null;
  return plan;
}
