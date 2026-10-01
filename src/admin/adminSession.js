import {
  invalidateLocalSession, localIdentityIsCurrent, resumeLocalIdentityAfterSignIn,
  lastIdentityFailure, subscribeLocalIdentity, verifiedLocalIdentity,
} from '../lib/userStore.js';
import { supabase } from '../lib/supabaseClient.js';

const closed = (status, message = '') => ({ status, user: null, message });
const unavailable = () => closed('error', 'Unable to verify admin access. Please try again.');
const denied = () => closed('denied', 'This account does not have active internal admin access.');

/** UI gate only. Every protected backend operation must authorize independently. */
export async function verifyAdminSession(client = supabase, now = Date.now) {
  try {
    const initial = await client.auth.getSession();
    if (initial.error) return unavailable();
    const session = initial.data?.session;
    if (!session) return closed('signedOut');
    if (!session.access_token || !session.user?.id || !Number.isFinite(session.expires_at)
        || session.expires_at * 1000 <= now()) {
      return closed('signedOut', 'Your session has expired. Sign in again.');
    }

    // getSession supplies the token, but its cached user is not authority.
    const verified = await client.auth.getUser(session.access_token);
    if (verified.error || !verified.data?.user || verified.data.user.id !== session.user.id) {
      return closed('signedOut', 'Your session could not be verified. Sign in again.');
    }
    const [authority, profile] = await Promise.all([
      client.rpc('is_platform_admin'),
      client.rpc('get_my_profile'),
    ]);
    if (authority.error || profile.error) return unavailable();
    if (authority.data !== true || profile.data?.user_id !== verified.data.user.id
        || profile.data.role !== 'admin' || profile.data.status !== 'active') {
      return denied();
    }

    // RPCs use the shared client's current session. Do not combine an earlier
    // user's identity with authority returned after an account/token change.
    const current = await client.auth.getSession();
    const active = current.data?.session;
    if (current.error || active?.access_token !== session.access_token
        || active?.user?.id !== session.user.id || !Number.isFinite(active?.expires_at)
        || Math.min(active.expires_at, session.expires_at) * 1000 <= now()) {
      return closed('signedOut', 'Your session changed. Sign in again.');
    }
    return {
      status: 'verified',
      user: { id: verified.data.user.id, email: verified.data.user.email || '' },
      expiresAt: Math.min(active.expires_at, session.expires_at) * 1000,
      message: '',
    };
  } catch {
    return unavailable();
  }
}

export async function signInAdmin(email, password, client = supabase, now = Date.now) {
  let cancelled = false;
  const observedAccounts = new Set();
  let expectedAccount;
  const unsubscribe = subscribeLocalIdentity((id, event) => {
    if (event === 'INITIAL_SESSION') return;
    if (!id || (expectedAccount && id !== expectedAccount)) cancelled = true;
    else observedAccounts.add(id);
  });
  try {
    const result = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (cancelled || result.error || !result.data?.session
        || [...observedAccounts].some((id) => id !== result.data.session.user?.id)) {
      return closed('signedOut', 'Sign-in failed. Check your email and password.');
    }
    expectedAccount = result.data.session.user?.id;
    const verified = await verifyAdminSession(client, now);
    if (cancelled || (verified.status === 'verified' && verified.user.id !== result.data.session.user?.id)) {
      return closed('signedOut', 'Your session changed. Sign in again.');
    }
    if (verified.status !== 'verified') return verified;
    const identity = await resumeLocalIdentityAfterSignIn(result.data.session);
    if (cancelled || !identity || identity.id !== verified.user.id
        || identity.token !== result.data.session.access_token) {
      return closed('signedOut', 'Your session changed. Sign in again.');
    }
    const current = await verifiedLocalIdentity({ admin: true });
    if (!current && lastIdentityFailure() === 'transient') return unavailable();
    if (!current || current.id !== identity.id || current.token !== identity.token
        || !await localIdentityIsCurrent(identity) || cancelled) {
      return closed('signedOut', 'Your session changed. Sign in again.');
    }
    return verified;
  } catch {
    return unavailable();
  } finally {
    unsubscribe();
  }
}

/** Invalidates synchronously; ignores checks completed after logout or a switch. */
export function createAdminSession(client, onChange, now = Date.now) {
  let generation = 0;
  let disposed = false;
  let signedOut = false;
  let timer;

  function invalidate(state) {
    generation += 1;
    clearTimeout(timer);
    if (!disposed) onChange(state);
    return generation;
  }

  // The admin verified last; a recheck of that same account keeps the panel up.
  let verifiedUserId = null;

  async function verify(version) {
    const state = await verifyAdminSession(client, now);
    if (disposed || version !== generation) return closed('signedOut');
    verifiedUserId = state.status === 'verified' ? state.user.id : null;
    onChange(state);
    if (state.status === 'verified') {
      timer = setTimeout(() => { void recheck(); }, Math.max(0, state.expiresAt - now()));
    }
    return state;
  }

  async function refresh() {
    if (disposed || signedOut) return closed('signedOut');
    verifiedUserId = null;
    return verify(invalidate(closed('checking')));
  }

  /**
   * Re-verify the admin already verified without first closing the panel: window focus, the
   * same-user SIGNED_IN supabase-js emits on refocus, a token refresh, and the expiry timer.
   * Closing first unmounted every page, so an upload in progress was lost. Pending checks are
   * still invalidated, and any failed result still closes access; the server authorises every
   * protected operation itself, so the panel staying up for the length of one check grants
   * nothing. With no verified admin it is a full refresh.
   */
  async function recheck() {
    if (disposed || signedOut) return closed('signedOut');
    if (!verifiedUserId) return refresh();
    generation += 1;
    clearTimeout(timer);
    return verify(generation);
  }

  const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
    if (disposed || signedOut) return;
    // Auth callbacks must remain synchronous; defer SDK calls until the
    // callback has returned to avoid nested Auth lock acquisition.
    if (session && verifiedUserId && session.user?.id === verifiedUserId) {
      generation += 1;
      clearTimeout(timer);
      timer = setTimeout(() => { void recheck(); }, 0);
      return;
    }
    // No session, or a different account: access is cleared synchronously.
    verifiedUserId = null;
    invalidate(closed(session ? 'checking' : 'signedOut'));
    if (session) timer = setTimeout(() => { void refresh(); }, 0);
  });

  return {
    refresh,
    recheck,
    resume() {
      signedOut = false;
      return refresh();
    },
    async signOut() {
      signedOut = true;
      verifiedUserId = null;
      invalidateLocalSession();
      const version = invalidate(closed('checking', 'Signing out…'));
      let message = '';
      try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) message = 'Admin access cleared. Sign-out could not be completed.';
      } catch {
        message = 'Admin access cleared. Sign-out could not be completed.';
      }
      if (!disposed && version === generation) onChange(closed('signedOut', message));
    },
    dispose() {
      disposed = true;
      generation += 1;
      clearTimeout(timer);
      subscription.unsubscribe();
    },
  };
}
