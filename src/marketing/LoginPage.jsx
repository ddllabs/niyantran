import { useEffect, useRef, useState } from 'react';
import { applyPersonaForUser } from '../lib/personas.js';
import {
  localIdentityIsCurrent,
  resumeLocalIdentityAfterSignIn,
  subscribeLocalIdentity,
  verifiedLocalIdentity,
  setSessionUser,
  userFromSupabase,
  userTypeOf,
} from '../lib/userStore.js';
import { hydrateUserPrefs } from '../lib/userPrefsSync.js';
import { supabase } from '../lib/supabaseClient.js';

export default function LoginPage({ onSuccess, onSignup, onForgotPassword }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [userId, setUserId] = useState('');
  const [pass, setPass] = useState('');
  const root = useRef(null);
  const [verifiedNotice, setVerifiedNotice] = useState(() => {
    if (typeof location === 'undefined') return false;
    return location.href.includes('verified=true') || location.hash.includes('verified=true');
  });

  useEffect(() => {
    const lastEmail = sessionStorage.getItem('lastRegisteredEmail');
    if (lastEmail) {
      setUserId(lastEmail);
    }
  }, []);

  function onMove(e) {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / Math.max(1, r.width);
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    el.style.setProperty('--mx', `${(x * 100).toFixed(2)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(2)}%`);
    el.style.setProperty('--px', `${((x - 0.5) * 16).toFixed(2)}px`);
    el.style.setProperty('--py', `${((y - 0.5) * 10).toFixed(2)}px`);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const user = String(fd.get('user') || '').trim();
    const pass = String(fd.get('pass') || '');
    setPending(true);
    setError('');

    let cancelled = false;
    const observedAccounts = new Set();
    let expectedAccount;
    // A deliberate logout while password authentication is pending must not be
    // reopened by its late success, even if the SDK retains the old session.
    const unsubscribe = subscribeLocalIdentity((id, event) => {
      if (event === 'INITIAL_SESSION') return;
      if (!id || (expectedAccount && id !== expectedAccount)) cancelled = true;
      else observedAccounts.add(id);
    });
    try {
      const result = await supabase.auth.signInWithPassword({ email: user, password: pass });
      if (result.error) {
        const unconfirmed = String(result.error.message || '').toLowerCase().includes('email not confirmed');
        setError(unconfirmed
          ? 'Please confirm your email address before logging in. Check your inbox for the confirmation link.'
          : 'Sign-in failed. Check your email and password.');
        return;
      }
      const session = result.data?.session;
      if (cancelled || [...observedAccounts].some((id) => id !== session?.user?.id)
          || !session?.access_token || !session.user?.id
          || result.data?.user?.id !== session.user.id
          || !Number.isFinite(session.expires_at) || session.expires_at * 1000 <= Date.now()) {
        setError('Your session could not be verified. Sign in again.');
        return;
      }
      expectedAccount = session.user.id;
      const identity = await resumeLocalIdentityAfterSignIn(session);
      if (cancelled || !identity || identity.id !== session.user.id || identity.token !== session.access_token) {
        setError('Your session could not be verified. Sign in again.');
        return;
      }
      const profile = await supabase.from('user_profiles').select('*').eq('user_id', identity.id).maybeSingle();
      if (profile.error || profile.data?.user_id !== identity.id || profile.data.status !== 'active') {
        setError('This account does not have an active profile.');
        return;
      }
      if (!await localIdentityIsCurrent(identity) || cancelled) {
        setError('Your session changed. Sign in again.');
        return;
      }
      // Persona is a preference from the matching profile. Neither cached Auth
      // metadata nor a local demo seat supplies account authority.
      const pub = userFromSupabase({ id: identity.id, email: identity.email }, profile.data);
      await hydrateUserPrefs(identity.email);
      const current = await verifiedLocalIdentity();
      if (!current || current.id !== identity.id || current.token !== identity.token
          || !await localIdentityIsCurrent(identity) || cancelled) {
        setError('Your session changed. Sign in again.');
        return;
      }
      applyPersonaForUser(pub);
      setSessionUser(pub);
      sessionStorage.setItem('niyantranLand', userTypeOf(pub.type).startTab);
      onSuccess();
    } catch {
      setError('Unable to verify your account. Please try again.');
    } finally {
      unsubscribe();
      setPending(false);
    }
  }

  return (
    <div className="mkt-login mkt-login-globe" ref={root} onMouseMove={onMove}>
      <div className="mkt-login-art" aria-hidden="true">
        <img className="mkt-login-bg" src="/brand/bg.png?v=1" alt="" />
        <span className="mkt-pr-gridlines mkt-login-grid" />
        <div className="mkt-login-orb">
          <span className="mkt-halo" />
          <img className="mkt-globe mkt-globe-slow" src="/brand/globe.png?v=3" alt="" />
        </div>
        <span className="sh navy" />
        <span className="sh sand" />
        <span className="sh red" />
      </div>
      <main className="mkt-login-card">
        <p className="live">
          <i /> SYS/READY
        </p>
        <div className="mark">
          <img src="/brand/logo.png?v=2" alt="" />
        </div>
        <h1>TERMINAL</h1>
        <div className="tag">DESK ACCESS</div>

        {verifiedNotice && (
          <div style={{ padding: '12px 14px', background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34, 197, 94, 0.4)', borderRadius: '6px', color: '#4ade80', fontSize: '13px', lineHeight: '1.5', margin: '14px 0', textAlign: 'left' }} role="status">
            <strong>✓ Email verified successfully!</strong> Please enter your password to sign in.
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="off">
          <label className="mkt-field">
            <span>User ID</span>
            <input
              name="user"
              type="text"
              autoComplete="username"
              spellCheck="false"
              required
              autoFocus
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          </label>
          <label className="mkt-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Password</span>
              <button
                type="button"
                onClick={onForgotPassword || (() => { window.location.hash = '#forgot-password'; })}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#38bdf8',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'none',
                }}
              >
                Forgot password?
              </button>
            </div>
            <input
              name="pass"
              type="password"
              autoComplete="current-password"
              required
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </label>
          <button className="mkt-cta" type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="mkt-err" role="alert">
            {error}
            {error.includes('confirm your email') && (
              <div style={{ marginTop: '10px' }}>
                <a
                  href="https://mail.google.com"
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#ea4335',
                    color: '#ffffff',
                    padding: '8px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '600',
                    textDecoration: 'none',
                  }}
                >
                  Open Gmail ↗
                </a>
              </div>
            )}
          </div>
        </form>
        <p className="mkt-auth-switch">
          New here?{' '}
          <button type="button" onClick={onSignup}>
            Create an account
          </button>
        </p>
      </main>
    </div>
  );
}
