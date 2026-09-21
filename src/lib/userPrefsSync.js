/**
 * A-15 — sync watchlist / AI chats / tours to SQLite via /api/user-prefs.
 * LocalStorage remains the working copy; server is the cross-device backup.
 */
import { verifiedLocalIdentity, localIdentityIsCurrent, subscribeLocalIdentity } from './userStore.js';
import { loadWatchlist, applyWatchlistFromServer, setWatchlistOwner, preferenceRevisions, acknowledgePreferenceEdits } from './watchlistStore.js';
import { loadAiState, applyAiStateFromServer, setAiChatOwner } from './aiChatStore.js';
import { readToursState, applyToursFromServer, setToursOwner } from './onboarding.js';

const DIRTY = 'niy-prefs-dirty';
let pushTimer = null;
let hydrating = false;
let owner = null;
let generation = 0;
let subscribed = false;

let expiryTimer = null;
let resumeTimer = null;
let readyToPush = false;
let pendingOwnerId = null;
let pushing = false;
let queuedWhilePushing = false;

function bindStores(identity) {
  setWatchlistOwner(identity);
  setAiChatOwner(identity);
  setToursOwner(identity);
}

function unbindAccount(keepPendingId = null) {
  pendingOwnerId = keepPendingId;
  queuedWhilePushing = false;
  generation += 1;
  clearTimeout(pushTimer);
  clearTimeout(expiryTimer);
  clearTimeout(resumeTimer);
  hydrating = false;
  readyToPush = false;
  owner = null;
  bindStores(null);
}

function bindAccount(identity) {
  owner = identity;
  bindStores(identity);
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => {
    if (owner === identity) unbindAccount();
  }, Math.max(0, identity.expiresAt - Date.now()));
}

function watchAccount() {
  if (subscribed) return;
  subscribeLocalIdentity((id, event) => {
    const pending = id && owner?.id === id && pendingOwnerId === id ? id : null;
    unbindAccount(pending);
    // Auth callbacks stay synchronous. A refreshed session must be independently
    // verified before showing owned data again; this deferred operation only GETs.
    if (id && event && prefsSyncStarted) resumeTimer = setTimeout(() => { void hydrateUserPrefs(); }, 0);
  });
  subscribed = true;
}

function slimAiChats(state) {
  const chats = (state?.chats || []).slice(0, 40).map((c) => ({
    id: c.id,
    title: c.title,
    roleId: c.roleId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messages: (c.messages || []).slice(-100).map((m) => ({
      id: m.id,
      role: m.role,
      content: String(m.content || '').slice(0, 24000),
      at: m.at,
      model: m.model,
      error: m.error,
    })),
    attachments: (c.attachments || []).slice(0, 12).map((a) => {
      const { dataUrl, file, bytes, ...rest } = a || {};
      return rest;
    }),
  }));
  const activeId = chats.some((c) => c.id === state?.activeId) ? state.activeId : chats[0]?.id || '';
  return { chats, activeId };
}

function collectLocalPrefs() {
  return {
    watchlist: loadWatchlist(),
    aiChats: slimAiChats(loadAiState()),
    tours: readToursState(),
  };
}

export function schedulePrefsPush() {
  if (!owner) return;
  pendingOwnerId = owner.id;
  if (hydrating || !readyToPush) return;
  clearTimeout(pushTimer);
  const expected = owner;
  const version = generation;
  pushTimer = setTimeout(() => {
    if (version === generation && owner === expected) void pushPrefs();
  }, 600);
}

export async function pushPrefs() {
  watchAccount();
  const expected = owner;
  const version = generation;
  if (!expected || hydrating || !readyToPush) return { ok: false, reason: 'not-ready' };
  if (pushing) {
    queuedWhilePushing = true;
    return { ok: false, reason: 'busy' };
  }
  pushing = true;
  queuedWhilePushing = false;
  let saved = false;
  try {
    const identity = await verifiedLocalIdentity();
    if (!identity || version !== generation || owner !== expected || identity.id !== expected.id
        || identity.email !== expected.email) return { ok: false, reason: 'session-changed' };
    bindAccount(identity);
    const revisions = preferenceRevisions(identity.id);
    const local = collectLocalPrefs();
    // Partial PUTs cannot erase another preference kind that has not hydrated.
    const prefs = Object.fromEntries(Object.entries(local).filter(([kind]) => revisions[kind].dirty));
    if (!Object.keys(prefs).length) return { ok: true, source: 'clean' };
    const res = await fetch('/api/user-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.token}` },
      body: JSON.stringify(prefs),
    });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    if (!await localIdentityIsCurrent(identity) || version !== generation) return { ok: false, reason: 'session-changed' };
    acknowledgePreferenceEdits(identity.id, revisions);
    saved = true;
    if (!Object.values(preferenceRevisions(identity.id)).some((value) => value.dirty)) pendingOwnerId = null;
    return { ok: true };
  } catch {
    return { ok: false, reason: 'offline' };
  } finally {
    const resumeQueued = queuedWhilePushing;
    pushing = false;
    queuedWhilePushing = false;
    // Resume a newer verified generation whose debounce was blocked by this PUT.
    // A failed request alone never starts a retry loop.
    if ((resumeQueued || (saved && version === generation)) && readyToPush && owner
        && pendingOwnerId === owner.id && Object.values(preferenceRevisions(owner.id)).some((value) => value.dirty)) schedulePrefsPush();
  }
}

/** Hydrate clean fields; resume only recorded edits of this verified owner. */
export async function hydrateUserPrefs(emailOverride) {
  watchAccount();
  const identity = await verifiedLocalIdentity();
  if (!identity) return { ok: false, reason: 'no-session' };
  if (emailOverride != null && String(emailOverride).trim().toLowerCase() !== identity.email) {
    return { ok: false, reason: 'wrong-account' };
  }
  const version = ++generation;
  clearTimeout(pushTimer);
  hydrating = true;
  readyToPush = false;
  // Existing owned cache remains readable if the network request fails.
  // New accounts see only their defaults; legacy unowned keys are never read.
  bindAccount(identity);
  const initialRevisions = preferenceRevisions(identity.id);
  try {
    const res = await fetch('/api/user-prefs', { headers: { Authorization: `Bearer ${identity.token}` } });
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const body = await res.json();
    if (!await localIdentityIsCurrent(identity) || version !== generation) return { ok: false, reason: 'session-changed' };
    if (!body.ok || body.email !== identity.email || !body.prefs || typeof body.prefs !== 'object') return { ok: false, reason: 'invalid-response' };
    const prefs = body.prefs;
    const currentRevisions = preferenceRevisions(identity.id);
    const unchanged = (kind) => !initialRevisions[kind].dirty && !currentRevisions[kind].dirty
      && initialRevisions[kind].revision === currentRevisions[kind].revision;
    if (unchanged('watchlist') && Array.isArray(prefs.watchlist)) applyWatchlistFromServer(prefs.watchlist);
    if (unchanged('aiChats') && prefs.aiChats && Array.isArray(prefs.aiChats.chats)) applyAiStateFromServer(prefs.aiChats);
    if (unchanged('tours') && prefs.tours) applyToursFromServer(prefs.tours);
    readyToPush = true;
    if (Object.values(preferenceRevisions(identity.id)).some((value) => value.dirty)) pendingOwnerId = identity.id;
    return { ok: true, source: 'server' };
  } catch {
    return { ok: false, reason: 'offline' };
  } finally {
    if (version === generation) {
      hydrating = false;
      if (readyToPush && pendingOwnerId === owner?.id) schedulePrefsPush();
    }
  }
}

/** Call once after app boot when authed. */
let prefsSyncStarted = false;
export function startUserPrefsSync() {
  watchAccount();
  if (!prefsSyncStarted) {
    prefsSyncStarted = true;
    window.addEventListener(DIRTY, () => schedulePrefsPush());
  }
  if (!owner && !hydrating) void hydrateUserPrefs();
}

export function markPrefsDirty(kind) {
  window.dispatchEvent(new CustomEvent(DIRTY, { detail: { kind } }));
}
