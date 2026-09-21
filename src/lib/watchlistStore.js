/**
 * Home "MY WATCHLIST" — per-user pins (local + SQLite sync via userPrefsSync).
 */
const KEY = 'niyWatchlist';
const EVENT = 'niy-watchlist';
let owner = null;
let ephemeral = null;

/** Called only by the verified preference coordinator; never reads legacy KEY. */
export function setWatchlistOwner(identity) {
  const next = typeof identity?.id === 'string' && identity.id && Number.isFinite(identity.expiresAt) && identity.expiresAt > Date.now()
    ? { id: identity.id, expiresAt: identity.expiresAt } : null;
  if (owner?.id !== next?.id) ephemeral = null;
  owner = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

function accountKey() {
  if (owner && owner.expiresAt <= Date.now()) setWatchlistOwner(null);
  return owner ? `${KEY}:user:${encodeURIComponent(owner.id)}` : null;
}


export const DEFAULT_WATCHLIST = [
  { tab: 'global', feature: 'Open Fronts', label: 'Open Fronts' },
  { tab: 'national', feature: 'Bill Passage Probability Index', label: 'Bill Passage' },
  { tab: 'economics', feature: 'NSE/BSE Delayed Market Feed', label: 'Markets' },
];

// Shared persistence helpers for the three account-owned stores. These contain
// no Auth dependency; only an already bound store can mark an edit.
const PREF_KINDS = ['watchlist', 'aiChats', 'tours'];
function revisionKey(id, kind) { return `niyPrefsRevision:user:${encodeURIComponent(id)}:${kind}`; }

export function preferenceRevisions(id) {
  return Object.fromEntries(PREF_KINDS.map((kind) => {
    let value;
    try { value = JSON.parse(localStorage.getItem(revisionKey(id, kind)) || 'null'); } catch { /* missing */ }
    return [kind, typeof value?.revision === 'string' ? value : { revision: null, dirty: false }];
  }));
}

export function markPreferenceEdit(id, kind) {
  localStorage.setItem(revisionKey(id, kind), JSON.stringify({ revision: globalThis.crypto.randomUUID(), dirty: true }));
}

export function acknowledgePreferenceEdits(id, sent) {
  const current = preferenceRevisions(id);
  for (const kind of PREF_KINDS) {
    if (sent[kind]?.dirty && current[kind].revision === sent[kind].revision) {
      localStorage.setItem(revisionKey(id, kind), JSON.stringify({ revision: sent[kind].revision, dirty: false }));
    }
  }
}

function normalizeItem(it) {
  if (!it || typeof it !== 'object') return null;
  const feature = String(it.feature || '').trim();
  if (!feature) return null;
  return {
    tab: String(it.tab || 'home').trim() || 'home',
    feature,
    label: String(it.label || feature).trim() || feature,
  };
}

function readLocal() {
  try {
    const key = accountKey();
    if (!key) return ephemeral;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const list = parsed.map(normalizeItem).filter(Boolean);
    return list;
  } catch {
    return null;
  }
}

function writeLocal(list, dirty = true) {
  const key = accountKey();
  const next = (list || []).map(normalizeItem).filter(Boolean).slice(0, 24);
  if (key !== accountKey()) return loadWatchlist();
  if (key) {
    if (dirty) markPreferenceEdit(owner.id, 'watchlist');
    localStorage.setItem(key, JSON.stringify(next));
  }
  else ephemeral = next;
  window.dispatchEvent(new Event(EVENT));
  return next;
}

export function loadWatchlist() {
  return readLocal() || DEFAULT_WATCHLIST.map((x) => ({ ...x }));
}

export function saveWatchlist(list) {
  const next = writeLocal(list);
  try {
    window.dispatchEvent(new CustomEvent('niy-prefs-dirty', { detail: { kind: 'watchlist' } }));
  } catch {
    /* ignore */
  }
  return next;
}

/** Replace from server hydrate without re-pushing. */
export function applyWatchlistFromServer(list) {
  if (!accountKey() || !Array.isArray(list)) return loadWatchlist();
  return writeLocal(list, false);
}

export function subscribeWatchlist(fn) {
  const on = () => fn(loadWatchlist());
  window.addEventListener(EVENT, on);
  window.addEventListener('storage', on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener('storage', on);
  };
}

export function addWatchlistItem(item) {
  const n = normalizeItem(item);
  if (!n) return loadWatchlist();
  const cur = loadWatchlist();
  if (cur.some((x) => x.feature === n.feature && x.tab === n.tab)) return cur;
  return saveWatchlist([n, ...cur]);
}

export function removeWatchlistItem(feature, tab) {
  const cur = loadWatchlist();
  return saveWatchlist(cur.filter((x) => !(x.feature === feature && (!tab || x.tab === tab))));
}
