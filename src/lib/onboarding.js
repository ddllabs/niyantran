import { markPreferenceEdit } from './watchlistStore.js';
/** Account-bound tours. Legacy keys are retained without reading or migrating them. */
export const HOME_TOUR_KEY = 'niyOnboardHomeDone';
const KEY = 'niyTours';
let owner = null;
let ephemeral = { home: false, desks: {} };

export function setToursOwner(identity) {
  const next = typeof identity?.id === 'string' && identity.id && Number.isFinite(identity.expiresAt) && identity.expiresAt > Date.now()
    ? { id: identity.id, expiresAt: identity.expiresAt } : null;
  if (owner?.id !== next?.id) ephemeral = { home: false, desks: {} };
  owner = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('niy-tours'));
}

function accountKey() {
  if (owner && owner.expiresAt <= Date.now()) setToursOwner(null);
  return owner ? `${KEY}:user:${encodeURIComponent(owner.id)}` : null;
}

function emitDirty() {
  try {
    window.dispatchEvent(new CustomEvent('niy-prefs-dirty', { detail: { kind: 'tours' } }));
  } catch { /* non-browser */ }
}

export function readToursState() {
  const key = accountKey();
  if (!key) return ephemeral;
  try {
    const state = JSON.parse(localStorage.getItem(key) || 'null');
    if (state && typeof state === 'object') {
      return { home: state.home === true, desks: state.desks && typeof state.desks === 'object' && !Array.isArray(state.desks) ? state.desks : {} };
    }
  } catch { /* invalid owned cache */ }
  return { home: false, desks: {} };
}

function writeTours(state, dirty = true) {
  const key = accountKey();
  if (key) {
    if (dirty) markPreferenceEdit(owner.id, 'tours');
    localStorage.setItem(key, JSON.stringify(state));
  }
  else ephemeral = state;
  return state;
}

/** Union only within the currently verified account; never import legacy tours. */
export function applyToursFromServer(tours) {
  const local = readToursState();
  if (!accountKey() || !tours || typeof tours !== 'object') return local;
  return writeTours({ home: Boolean(tours.home || local.home), desks: { ...local.desks, ...(tours.desks || {}) } }, false);
}

export function isHomeTourDone() {
  return readToursState().home;
}

export function markHomeTourDone() {
  writeTours({ ...readToursState(), home: true });
  emitDirty();
}

export function isDeskTourDone(deskId) {
  const id = String(deskId || '').trim();
  if (!id || id === 'home') return true;
  const desks = readToursState().desks;
  return Object.hasOwn(desks, id) && Boolean(desks[id]);
}

export function markDeskTourDone(deskId) {
  const id = String(deskId || '').trim();
  if (!id) return;
  const state = readToursState();
  writeTours({ ...state, desks: { ...state.desks, [id]: true } });
  emitDirty();
}

export const HOME_TOUR_STEPS = [
  {
    title: 'Home brief',
    body: 'Hot topics, markets and latest rows land here. Open any card to jump into a desk.',
  },
  {
    title: 'Desk strip',
    body: 'National, Law, Global and the rest live on the top strip. Each desk opens modules from its dropdowns.',
  },
  {
    title: 'Ask AI',
    body: 'Drag a row into Ask AI, or open the dock from the corner. Provenance stays on the record.',
  },
];

export const DESK_TOUR_STEPS = [
  {
    title: 'Pick a module',
    body: 'Use the dropdown pills on this desk to open one feed at a time.',
  },
  {
    title: 'Work the table',
    body: 'Search, filter and select a row. The right rail shows evidence for the selection.',
  },
  {
    title: 'Keep provenance',
    body: 'Source labels stay on the feed. The terminal shows the record — it does not tell you what to conclude.',
  },
];
