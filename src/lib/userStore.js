import { DEFAULT_USER_TYPE, userTypeOf } from './userTypes.js';
import { dbPersona, frontendPersona } from './personaMap.js';
import { supabase } from './supabaseClient.js';

const EVENT = 'niy-users';
const SESSION_KEY = 'niyantranUser';

export { USER_TYPES, userTypeOf, desksForType, tabsForType, canOpenDesk, DEFAULT_USER_TYPE } from './userTypes.js';

export const SEED_USER = {
  id: 'seed-analyst',
  name: 'Lead Analyst',
  email: 'analyst@niyantran',
  password: '12345678#',
  plan: 'enterprise',
  planStatus: 'active',
  personaId: 'analyst',
  type: 'analyst',
  active: true,
  createdAt: '2026-01-15T00:00:00.000Z',
};

export const SEED_STUDENT = {
  id: 'seed-student',
  name: 'Student Desk',
  email: 'student@niyantran',
  password: '12345678#',
  plan: 'explorer',
  planStatus: 'free',
  personaId: 'student',
  type: 'student',
  active: true,
  createdAt: '2026-01-15T00:00:00.000Z',
};

function normalize(user) {
  if (!user || typeof user !== 'object') return null;
  const type = userTypeOf(user.type || user.personaId).id;
  const personaId = user.personaId || user.persona_id || type;
  const plan = String(user.plan || 'explorer').toLowerCase();
  return {
    ...user,
    email: String(user.email || '')
      .trim()
      .toLowerCase(),
    type,
    personaId,
    plan: plan === 'professional' ? 'pro' : plan,
    planStatus: user.planStatus || user.plan_status || (plan === 'explorer' ? 'free' : 'active'),
    trialEndsAt: user.trialEndsAt || user.trial_ends_at || null,
    billingYearly: Boolean(user.billingYearly ?? user.billing_yearly),
    googleSub: user.googleSub || user.google_sub || null,
    authProvider: user.authProvider || (user.googleSub || user.google_sub ? 'google' : 'password'),
    active: user.active !== false,
  };
}

function withSeeds(list) {
  let out = Array.isArray(list) ? list.map(normalize).filter(Boolean) : [];
  if (!out.some((u) => u.email === SEED_USER.email)) out = [SEED_USER, ...out];
  if (!out.some((u) => u.email === SEED_STUDENT.email)) out = [...out, SEED_STUDENT];
  return out.map(normalize).filter(Boolean);
}

// Protected data stays in memory and is invalidated on every Auth event.
// Legacy browser storage is never proof of identity or input to a bulk upload.
let usersCache = null;
let usersExpiresAt = 0;
let usersSnapshot = null;
let directoryMutationPending = false;
let directoryReadSequence = 0;
let directoryMutationVersion = 0;
let identityEpoch = 0;
let authWatched = false;
let locallySignedOut = false;
let observedId = null;
const identityListeners = new Set();

function identityChanged(id, event = null) {
  observedId = id;
  identityEpoch += 1;
  usersCache = null;
  usersSnapshot = null;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
  for (const listener of identityListeners) listener(id, event);
}

function watchIdentity() {
  if (authWatched) return;
  supabase.auth.onAuthStateChange((event, session) => {
    // Keep callbacks synchronous; never call another Auth method here.
    identityChanged(session?.user?.id || null, event);
  });
  authWatched = true;
}

export function subscribeLocalIdentity(listener) {
  watchIdentity();
  identityListeners.add(listener);
  return () => identityListeners.delete(listener);
}

function validSession(session) {
  return Boolean(session?.access_token && session.user?.id
    && Number.isFinite(session.expires_at) && session.expires_at * 1000 > Date.now());
}

export async function localIdentityIsCurrent(identity) {
  try {
    const result = await supabase.auth.getSession();
    const session = result.data?.session;
    if (!result.error && validSession(session) && identity.expiresAt > Date.now() && identity.epoch === identityEpoch
        && session.access_token === identity.token && session.user.id === identity.id) return true;
  } catch { /* fail closed */ }
  if (identity.epoch === identityEpoch) identityChanged(null);
  return false;
}

/** Verify identity and current profile before a local protected request. */
async function verifyLocalIdentity({ admin = false, resumeSession = null } = {}) {
  let epoch = identityEpoch;
  try {
    watchIdentity();
    epoch = identityEpoch;
    const initial = await supabase.auth.getSession();
    const session = initial.data?.session;
    if ((locallySignedOut && !resumeSession) || initial.error || !validSession(session)) throw new Error('No session');
    if (resumeSession && (session.access_token !== resumeSession.access_token || session.user.id !== resumeSession.user?.id)) throw new Error('Sign-in changed');
    const verified = await supabase.auth.getUser(session.access_token);
    const user = verified.data?.user;
    if (verified.error || user?.id !== session.user.id || !user.email?.trim()) throw new Error('Unverified');
    const profile = await supabase.rpc('get_my_profile');
    if (profile.error || profile.data?.user_id !== user.id || profile.data.status !== 'active') throw new Error('Inactive');
    if (admin) {
      const authority = await supabase.rpc('is_platform_admin');
      if (authority.error || authority.data !== true || profile.data.role !== 'admin') throw new Error('Not admin');
    }
    const identity = { id: user.id, email: user.email.trim().toLowerCase(), token: session.access_token, epoch, expiresAt: session.expires_at * 1000 };
    if (!await localIdentityIsCurrent(identity)) return null;
    if (observedId !== identity.id) {
      identityChanged(identity.id);
      identity.epoch = identityEpoch;
    }
    return identity;
  } catch {
    if (epoch === identityEpoch) identityChanged(null);
    return null;
  }
}

export async function verifiedLocalIdentity(options = {}) {
  return verifyLocalIdentity({ admin: options.admin === true });
}

/** Call only after a deliberate signInWithPassword success, passing its session.
 * Cached sessions and passive Auth events must never resume a local logout.
 * The supplied session is independently verified before the latch is reopened.
 */
export async function resumeLocalIdentityAfterSignIn(session) {
  if (!validSession(session)) return null;
  const identity = await verifyLocalIdentity({ resumeSession: session });
  if (identity) locallySignedOut = false;
  return identity;
}

function currentDirectory() {
  if (locallySignedOut || !usersSnapshot || usersSnapshot.rows !== usersCache
      || usersSnapshot.identity.epoch !== identityEpoch || usersExpiresAt <= Date.now()) return null;
  return usersSnapshot;
}

function directoryIsCurrent(snapshot, identity) {
  return currentDirectory() === snapshot && snapshot.identity.id === identity.id
    && snapshot.identity.epoch === identity.epoch;
}

export function loadUsers() {
  if (usersExpiresAt <= Date.now()) usersCache = null;
  return usersCache ? usersCache.map((user) => ({ ...user })) : withSeeds([]);
}

function publishUsers(users, identity) {
  usersExpiresAt = identity.expiresAt;
  usersCache = users.map((user) => toPublicUser(user)).filter(Boolean);
  usersSnapshot = { rows: usersCache, identity };
  window.dispatchEvent(new Event(EVENT));
  return loadUsers();
}

/** Pull the authoritative server list; hydration never writes or unions it. */
export async function hydrateUsersFromServer() {
  const readSequence = ++directoryReadSequence;
  const mutationVersion = directoryMutationVersion;
  const readIsCurrent = () => readSequence === directoryReadSequence
    && mutationVersion === directoryMutationVersion && !directoryMutationPending;
  if (!readIsCurrent()) return [];
  const identity = await verifiedLocalIdentity({ admin: true });
  if (!identity || !readIsCurrent()) return [];
  try {
    const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${identity.token}` } });
    if (!res.ok) throw new Error('Read failed');
    const body = await res.json();
    if (!body.ok || !Array.isArray(body.users)) throw new Error('Invalid users');
    if (!await localIdentityIsCurrent(identity) || !readIsCurrent()) return [];
    return publishUsers(body.users, identity);
  } catch {
    // An old failed read cannot invalidate a newer read or completed mutation.
    if (identity.epoch === identityEpoch && readIsCurrent()) identityChanged(null);
    return [];
  }
}

async function pushUsersToServer(users, snapshot) {
  let identity;
  try {
    identity = await verifiedLocalIdentity({ admin: true });
    // Verification may await an account switch, refresh or another directory
    // response. Never send a replacement derived from an invalidated snapshot.
    if (!identity || !directoryIsCurrent(snapshot, identity)) return { ok: false };
    const res = await fetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.token}` },
      body: JSON.stringify({ users }),
    });
    if (!res.ok) throw new Error('Write failed');
    const body = await res.json();
    if (!body.ok || !Array.isArray(body.users) || !await localIdentityIsCurrent(identity)
        || !directoryIsCurrent(snapshot, identity)) return { ok: false };
    publishUsers(body.users, identity);
    return { ok: true };
  } catch {
    if (identity?.epoch === identityEpoch) identityChanged(null);
    return { ok: false };
  } finally {
    directoryMutationPending = false;
  }
}

export function saveUsers(users, snapshot = currentDirectory()) {
  if (!snapshot || snapshot !== currentDirectory() || directoryMutationPending) return [];
  const list = users.map(normalize).filter(Boolean);
  directoryMutationPending = true;
  directoryMutationVersion += 1;
  void pushUsersToServer(list, snapshot);
  return list;
}

export function subscribeUsers(fn) {
  const on = () => fn(loadUsers());
  window.addEventListener(EVENT, on);
  window.addEventListener('storage', on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener('storage', on);
  };
}

export function toPublicUser(user, typeOverride) {
  const u = normalize(user);
  if (!u) return null;
  const { password: _pw, ...rest } = u;
  return {
    ...rest,
    type: userTypeOf(typeOverride || u.type).id,
  };
}

/**
 * Session bridge (foundation spec §A): a Supabase Auth user plus its
 * user_profiles row, mapped onto the public user shape every consumer of
 * this store already understands. Extras may supply presentation preferences;
 * account authority and entitlements come only from the matching profile.
 */
export function userFromSupabase(supabaseUser, profile, extras = {}) {
  if (!supabaseUser?.id) return null;
  const p = profile?.user_id === supabaseUser.id ? profile : {};
  const persona = frontendPersona(p.persona) || extras.personaId || DEFAULT_USER_TYPE;
  const type = userTypeOf(persona).id;
  const email = String(supabaseUser.email || p.email || '').trim().toLowerCase();
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || email.split('@')[0];
  return toPublicUser(
    {
      id: supabaseUser.id,
      name,
      email,
      plan: p.plan || 'explorer',
      planStatus: p.plan_status,
      trialEndsAt: p.trial_ends_at,
      billingYearly: p.billing_yearly,
      type,
      personaId: type,
      role: p.role || 'user',
      active: p.status === 'active',
      createdAt: p.created_at || supabaseUser.created_at || new Date().toISOString(),
      onboardingComplete: Boolean(p.onboarding_complete),
      supabase: true,
    },
    type,
  );
}

/**
 * Write the chosen persona to the signed-in user's profile.
 *
 * Choosing a persona only ever set sessionStorage, so user_profiles.persona
 * stayed null for every account. research-chat resolves the system prompt from
 * that column - `promptFile(row?.persona) ?? 'analyst.md'` - so the fallback
 * was answering for everyone, and the UPSC prompt shipped in the bundle was
 * unreachable however the reader identified themselves.
 *
 * The column, not update_my_onboarding_profile. That RPC assigns all five
 * onboarding fields unconditionally, so calling it to set one would blank
 * practice_area and jurisdiction and reset onboarding_complete. RLS already
 * limits the row to `user_id = auth.uid()` and the grant already limits the
 * columns, so a targeted update needs no wider privilege than the RPC.
 *
 * Anonymous callers are not an error: the chooser also runs before sign-in,
 * where the pick is provisional and lives on the device.
 *
 * Strict about the id. `userTypeOf` would fold an unrecognised one onto the
 * default, which writes 'corporate_affairs' for a typo and answers every later
 * turn as an analyst without anything saying so - the failure this function
 * exists to end. The marketing, USER_TYPES and personaMap ids are the same
 * strings, so a real pick maps directly and only a wrong one is refused.
 *
 * @param {string} personaId a USER_TYPES id
 * @returns {Promise<boolean>} whether the profile now carries it
 */
export async function persistPersona(personaId) {
  const persona = dbPersona(personaId);
  if (!persona) return false;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    if (!userId) return false;
    const { error } = await supabase.from('user_profiles').update({ persona }).eq('user_id', userId);
    return !error;
  } catch {
    return false;
  }
}

export function authenticateUser(loginId, password) {
  const needle = String(loginId || '').trim().toLowerCase();
  const pass = String(password || '');
  if (!needle) return { ok: false, reason: 'Unknown user ID.' };

  const users = loadUsers();
  const byEmail = users.filter((u) => String(u.email || '').toLowerCase() === needle);
  const byId = users.filter((u) => String(u.id || '').toLowerCase() === needle);
  const byLocal = users.filter((u) => {
    const em = String(u.email || '').toLowerCase();
    const at = em.indexOf('@');
    return at > 0 && em.slice(0, at) === needle;
  });
  const byName = users.filter((u) => String(u.name || '').trim().toLowerCase() === needle);

  let hit = byEmail[0] || byId[0] || (byLocal.length === 1 ? byLocal[0] : null);
  if (!hit && byName.length === 1) hit = byName[0];

  if (!hit) {
    return {
      ok: false,
      reason: 'Unknown user ID. Open Admin → Users and use that exact User ID, or try student@niyantran / 12345678#',
    };
  }
  if (!hit.active) return { ok: false, reason: 'This account is suspended.' };
  if (String(hit.password) !== pass) return { ok: false, reason: 'Invalid user ID or password.' };
  return { ok: true, user: hit };
}

export function createUser({ name, email, password, plan, type, personaId, planStatus, trialEndsAt, billingYearly }) {
  const snapshot = currentDirectory();
  if (!snapshot || directoryMutationPending) return { ok: false, reason: 'Reload the verified admin directory before editing.' };
  const users = snapshot.rows;
  const cleanEmail = String(email || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!cleanEmail || !password) return { ok: false, reason: 'User ID and password are required.' };
  if (cleanEmail.length < 2) return { ok: false, reason: 'User ID is too short.' };
  if (String(password).length < 6) return { ok: false, reason: 'Password must be at least 6 characters.' };
  if (users.some((u) => String(u.email).toLowerCase() === cleanEmail)) {
    return { ok: false, reason: 'That user ID already exists.' };
  }
  const role = userTypeOf(personaId || type).id;
  const planId = String(plan || 'explorer').toLowerCase();
  const next = normalize({
    id: `u-${Date.now()}`,
    name: String(name || '').trim() || cleanEmail.split('@')[0],
    email: cleanEmail,
    password: String(password),
    plan: planId,
    planStatus: planStatus || (planId === 'explorer' ? 'free' : 'active'),
    trialEndsAt: trialEndsAt || null,
    billingYearly: Boolean(billingYearly),
    type: role,
    personaId: role,
    active: true,
    createdAt: new Date().toISOString(),
  });
  saveUsers([next, ...users], snapshot);
  return { ok: true, user: next };
}

/**
 * Upsert a server-verified Google user into the local seat list.
 * Preserves existing plan/persona when the account already exists.
 */
export function upsertGoogleUser(remote) {
  const n = normalize(remote);
  if (!n?.email) return { ok: false, reason: 'Invalid Google user.' };
  const users = loadUsers();
  const idx = users.findIndex(
    (u) =>
      (n.googleSub && u.googleSub === n.googleSub) ||
      String(u.email).toLowerCase() === n.email,
  );
  if (idx >= 0) {
    const prev = users[idx];
    const merged = normalize({
      ...prev,
      ...n,
      // Never downgrade existing plan / persona from a Google return trip
      plan: prev.plan || n.plan,
      planStatus: prev.planStatus || n.planStatus,
      type: prev.type || n.type,
      personaId: prev.personaId || n.personaId,
      password: prev.password || '',
      googleSub: n.googleSub || prev.googleSub,
      authProvider: 'google',
      id: prev.id || n.id,
      email: prev.email || n.email,
    });
    const next = [...users];
    next[idx] = merged;
    saveUsers(next);
    return { ok: true, user: merged };
  }
  const created = normalize({
    ...n,
    plan: n.plan || 'explorer',
    planStatus: n.planStatus || 'free',
    type: n.type || 'analyst',
    personaId: n.personaId || 'analyst',
    password: '',
    authProvider: 'google',
    active: true,
    createdAt: n.createdAt || new Date().toISOString(),
  });
  saveUsers([created, ...users]);
  return { ok: true, user: created };
}

export function updateUser(id, patch) {
  const snapshot = currentDirectory();
  if (!snapshot || directoryMutationPending || !snapshot.rows.some((user) => user.id === id)) return { ok: false, reason: 'User not found in the current admin directory.' };
  const users = snapshot.rows.map((u) => {
    if (u.id !== id) return u;
    const next = { ...u, ...patch, id: u.id, email: u.email };
    if (patch.type != null || patch.personaId != null) {
      const role = userTypeOf(patch.personaId || patch.type || u.type).id;
      next.type = role;
      next.personaId = role;
    }
    return next;
  });
  saveUsers(users, snapshot);
  return { ok: true };
}

export function removeUser(id) {
  if (id === SEED_USER.id || id === SEED_STUDENT.id) {
    return { ok: false, reason: 'Seed accounts cannot be removed.' };
  }
  const snapshot = currentDirectory();
  if (!snapshot || directoryMutationPending || !snapshot.rows.some((user) => user.id === id)) return { ok: false, reason: 'User not found in the current admin directory.' };
  saveUsers(snapshot.rows.filter((u) => u.id !== id), snapshot);
  return { ok: true };
}

export function setSessionUser(user) {
  const pub = toPublicUser(user);
  sessionStorage.setItem('niyantranAuthed', '1');
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(pub));
  return pub;
}

export function sessionUser() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.email) return toPublicUser(parsed);
      if (typeof parsed === 'string') {
        const hit = loadUsers().find((u) => String(u.email).toLowerCase() === parsed.toLowerCase());
        return hit ? toPublicUser(hit) : toPublicUser({ ...SEED_USER, email: parsed });
      }
    }
  } catch {
    /* empty */
  }
  const email = sessionStorage.getItem(SESSION_KEY);
  if (email && !email.startsWith('{')) {
    const hit = loadUsers().find((u) => String(u.email).toLowerCase() === email.toLowerCase());
    return hit ? toPublicUser(hit) : toPublicUser({ ...SEED_USER, email });
  }
  return toPublicUser(SEED_USER);
}

/** Synchronous local invalidation; callers own their single SDK signOut call. */
export function invalidateLocalSession() {
  locallySignedOut = true;
  identityChanged(null);
  sessionStorage.removeItem('niyantranAuthed');
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem('niyantranLand');
}

export function clearSessionUser() {
  invalidateLocalSession();
  if (supabase) {
    supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }
}
