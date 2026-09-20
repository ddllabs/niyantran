import { useEffect, useRef, useState } from 'react';
import { applyPersonaForUser } from '../lib/personas.js';
import {
  authenticateUser,
  hydrateUsersFromServer,
  setSessionUser,
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
  const demoMode =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('demo') === '1';

  const [verifiedNotice, setVerifiedNotice] = useState(() => {
    if (typeof location === 'undefined') return false;
    return location.href.includes('verified=true') || location.hash.includes('verified=true');
  });

  useEffect(() => {
    hydrateUsersFromServer().catch(() => {});
    const lastEmail = sessionStorage.getItem('lastRegisteredEmail');
    if (lastEmail && !demoMode) {
      setUserId(lastEmail);
    }
  }, []);

  useEffect(() => {
    if (!demoMode) return;
    setUserId('analyst@niyantran');
    setPass('12345678#');
  }, [demoMode]);

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

    // Try Supabase Auth first
    try {
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: user,
        password: pass,
      });

      if (authErr) {
        const msg = (authErr.message || '').toLowerCase();
        if (msg.includes('email not confirmed')) {
          setError('Please confirm your email address before logging in. Check your inbox for the confirmation link.');
          setPending(false);
          return;
        }
        if (!user.endsWith('@niyantran')) {
          setError(authErr.message || 'Invalid user ID or password.');
          setPending(false);
          return;
        }
      } else if (authData?.user) {
        if (!authData.user.email_confirmed_at && !authData.session) {
          setError('Please confirm your email address before logging in. Check your inbox for the confirmation link.');
          setPending(false);
          return;
        }

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', authData.user.id)
          .maybeSingle();

        const type = 'analyst';
        const name = profile?.first_name ? `${profile.first_name} ${profile.last_name || ''}`.trim() : user.split('@')[0];
        const persona = profile?.persona || type;
        applyPersonaForUser({ name, email: user, type: persona, personaId: persona });
        setSessionUser({ name, email: user, type: persona, personaId: persona });
        sessionStorage.setItem('niyantranLand', userTypeOf(persona).startTab);
        await hydrateUserPrefs(user);
        onSuccess();
        return;
      }
    } catch (err) {
      console.warn('Supabase login check:', err);
    }

    // Local fallback for demo seats
    try {
      await hydrateUsersFromServer();
    } catch {
      /* local-only */
    }
    const res = authenticateUser(user, pass);
    if (res.ok) {
      const type = userTypeOf(res.user.personaId || res.user.type).id;
      applyPersonaForUser({ ...res.user, type, personaId: type });
      setSessionUser({ ...res.user, type, personaId: type });
      sessionStorage.setItem('niyantranLand', userTypeOf(type).startTab);
      await hydrateUserPrefs(res.user.email);
      onSuccess();
      return;
    }
    setError(res.reason || 'Invalid user ID or password.');
    setPending(false);
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
        {demoMode ? (
          <div className="mkt-login-hint">Demo mode (?demo=1): analyst@niyantran / 12345678#</div>
        ) : null}
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
