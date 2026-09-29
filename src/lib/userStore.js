import { DEFAULT_USER_TYPE, userTypeOf } from './userTypes.js';
import { dbPersona, frontendPersona } from './personaMap.js';
import { supabase } from './supabaseClient.js';

const EVENT = 'niy-users';
const SESSION_KEY = 'niyantranUser';
// Written by SignupPage before the Google redirect; read once on the return.
export const PENDING_PERSONA_KEY = 'preferredPersona';

export { USER_TYPES, userTypeOf, desksForType, tabsForType, canOpenDesk, DEFAULT_USER_TYPE } from './userTypes.js';

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
    googleSub: user.googleSub || user.google_sub || null,
    authProvider: user.authProvider || (user.googleSub || user.google_sub ? 'google' : 'password'),
    active: user.active !== false,
  };
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
// F13: the kind of the last failed identity check, for the caller's message.
let lastFailure = null;

/**
 * 'transient' when the last identity check could not be answered (network,
 * 5xx), 'authoritative' when the answer was no, null after a success.
 */
export function lastIdentityFailure() {
  return lastFailure;
}

export const CONNECTION_PROBLEM = 'Connection problem. Try again.';

/** The message for a refused identity check: a connection problem, or the caller's sign-in text. */
export function identityRefusalMessage(signInMessage) {
  return lastFailure === 'transient' ? CONNECTION_PROBLEM : signInMessage;
}

/** A failure that asked nothing: the identity is unknown, not gone. */
class TransientIdentityError extends Error {}

function transientStatus(status) {
  const code = Number(status);
  return Number.isInteger(code) && (code === 0 || code === 408 || code === 429 || code >= 500);
}

/** A thrown or returned error that means "could not ask", never "the answer was no". */
function isTransient(error, status) {
  if (!error) return false;
  if (error instanceof TransientIdentityError) return true;
  if (['TypeError', 'AbortError', 'TimeoutError', 'AuthRetryableFetchError'].includes(error.name)) return true;
  return transientStatus(status ?? error.status);
}

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
    if (isTransient(result.error)) {
      lastFailure = 'transient';
      return false;
    }
  } catch (error) {
    // Fail closed either way; only a real answer announces a signed-out identity.
    if (isTransient(error)) {
      lastFailure = 'transient';
      return false;
    }
  }
  lastFailure = 'authoritative';
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
    if (isTransient(initial.error)) throw new TransientIdentityError('Session unavailable');
    if ((locallySignedOut && !resumeSession) || initial.error || !validSession(session)) throw new Error('No session');
    if (resumeSession && (session.access_token !== resumeSession.access_token || session.user.id !== resumeSession.user?.id)) throw new Error('Sign-in changed');
    const verified = await supabase.auth.getUser(session.access_token);
    if (isTransient(verified.error)) throw new TransientIdentityError('User check unavailable');
    const user = verified.data?.user;
    if (verified.error || user?.id !== session.user.id || !user.email?.trim()) throw new Error('Unverified');
    const profile = await supabase.rpc('get_my_profile');
    if (isTransient(profile.error, profile.status)) throw new TransientIdentityError('Profile check unavailable');
    if (profile.error || profile.data?.user_id !== user.id || profile.data.status !== 'active') throw new Error('Inactive');
    if (admin) {
      const authority = await supabase.rpc('is_platform_admin');
      if (isTransient(authority.error, authority.status)) throw new TransientIdentityError('Admin check unavailable');
      if (authority.error || authority.data !== true || profile.data.role !== 'admin') throw new Error('Not admin');
    }
    const identity = { id: user.id, email: user.email.trim().toLowerCase(), token: session.access_token, epoch, expiresAt: session.expires_at * 1000 };
    if (!await localIdentityIsCurrent(identity)) return null;
    if (observedId !== identity.id) {
      identityChanged(identity.id);
      identity.epoch = identityEpoch;
    }
    lastFailure = null;
    return identity;
  } catch (error) {
    // Both kinds refuse this request; only an authoritative answer signs out.
    if (isTransient(error)) {
      lastFailure = 'transient';
      return null;
    }
    lastFailure = 'authoritative';
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

/**
 * Publish the session user for an identity that arrived without a login form
 * (the Google OAuth redirect). Same checks as a password sign-in: a verified
 * session, an active profile row owned by that user, and still the current
 * session when the profile answers. A local sign-out is never resumed.
 */
export async function publishVerifiedSessionUser() {
  const identity = await verifiedLocalIdentity();
  if (!identity) return null;
  try {
    const profile = await supabase.from('user_profiles').select('*').eq('user_id', identity.id).maybeSingle();
    if (profile.error || profile.data?.user_id !== identity.id || profile.data.status !== 'active') return null;
    if (!await localIdentityIsCurrent(identity)) return null;
    const row = await withPendingPersona(profile.data);
    return setSessionUser(userFromSupabase({ id: identity.id, email: identity.email }, row));
  } catch {
    return null;
  }
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
  return usersCache ? usersCache.map((user) => ({ ...user })) : [];
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
    if (transientStatus(res.status)) throw new TransientIdentityError('Directory unavailable');
    if (!res.ok) throw new Error('Read failed');
    let body;
    try {
      body = await res.json();
    } catch {
      throw new TransientIdentityError('Directory unreadable');
    }
    if (!body.ok || !Array.isArray(body.users)) throw new Error('Invalid users');
    if (!await localIdentityIsCurrent(identity) || !readIsCurrent()) return [];
    return publishUsers(body.users, identity);
  } catch (error) {
    // A network error or 5xx says nothing about the identity; keep it.
    if (isTransient(error)) return [];
    // An old failed read cannot invalidate a newer read or completed mutation.
    if (identity.epoch === identityEpoch && readIsCurrent()) identityChanged(null);
    return [];
  }
}

const RELOAD_DIRECTORY = 'Reload the verified admin directory before editing.';

/**
 * One narrow admin edit (PATCH /api/users/:id), then a fresh directory read.
 * Refused unless the directory on screen is still the verified admin's
 * current snapshot and contains the target; one mutation at a time.
 */
async function patchUser(id, change) {
  const snapshot = currentDirectory();
  if (!snapshot || directoryMutationPending || !snapshot.rows.some((user) => user.id === id)) {
    return { ok: false, reason: RELOAD_DIRECTORY };
  }
  directoryMutationPending = true;
  directoryMutationVersion += 1;
  let identity;
  try {
    identity = await verifiedLocalIdentity({ admin: true });
    // Verification may await an account switch, refresh or another directory
    // response. Never send an edit derived from an invalidated snapshot.
    if (!identity || !directoryIsCurrent(snapshot, identity)) return { ok: false, reason: RELOAD_DIRECTORY };
    const res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.token}` },
      body: JSON.stringify(change),
    });
    const body = await res.json().catch(() => null);
    if (res.status === 401 && identity.epoch === identityEpoch) identityChanged(null);
    if (!res.ok || !body?.ok) {
      return { ok: false, reason: typeof body?.error === 'string' && body.error ? body.error : 'The change was not saved.' };
    }
  } catch {
    return { ok: false, reason: 'The change could not be sent. Check the connection and try again.' };
  } finally {
    directoryMutationPending = false;
  }
  await hydrateUsersFromServer();
  return { ok: true };
}

/** Suspend (false) or reactivate (true) an account. Resolves to { ok, reason? }. */
export function setUserActive(id, active) {
  return patchUser(id, { active: Boolean(active) });
}

/** Change an account's persona type (a USER_TYPES id). Resolves to { ok, reason? }. */
export function setUserType(id, type) {
  return patchUser(id, { type: String(type || '') });
}

/**
 * Grant a plan (pro or enterprise) until planEnd, open-ended when null, or
 * revoke with explorer. The server records it as a manual grant (F2).
 * Resolves to { ok, reason? }.
 */
export function setUserPlan(id, plan, planEnd = null) {
  return patchUser(id, { plan: String(plan || ''), planEnd: planEnd || null });
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
      // The stored plan, for display only. Entitlements come from the server
      // (entitlementStore.js); nothing reads plan fields from this record.
      plan: p.plan || 'explorer',
      type,
      personaId: type,
      role: p.role || 'user',
      active: p.status === 'active',
      createdAt: p.created_at || supabaseUser.created_at || new Date().toISOString(),
      onboardingComplete: Boolean(p.onboarding_complete),
      // Whether the profile itself holds a persona, not the fallback type:
      // App asks an account without one to choose (plan C5).
      personaSaved: Boolean(frontendPersona(p.persona)),
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
/**
 * A Google sign-up cannot carry user metadata, so SignupPage keeps the pick in
 * sessionStorage ('preferredPersona') across the redirect. Save it to a
 * profile that has no persona yet; a persona the profile already has wins.
 * The key is spent either way, so an old pick never lands on a later account.
 */
async function withPendingPersona(profile) {
  let pick = null;
  try {
    pick = sessionStorage.getItem(PENDING_PERSONA_KEY);
    sessionStorage.removeItem(PENDING_PERSONA_KEY);
  } catch {
    return profile;
  }
  if (!pick || profile.persona || !dbPersona(pick)) return profile;
  return await persistPersona(pick) ? { ...profile, persona: dbPersona(pick) } : profile;
}

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

export function setSessionUser(user) {
  const pub = toPublicUser(user);
  sessionStorage.setItem('niyantranAuthed', '1');
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(pub));
  return pub;
}

/** The signed-in user published by sign-in, or null. There is no fallback account. */
export function sessionUser() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.email) return toPublicUser(parsed);
  } catch {
    /* unreadable or legacy value: no user */
  }
  return null;
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
