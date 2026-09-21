import { useEffect, useRef, useState } from 'react';
import { applyPersonaForUser } from '../lib/personas.js';
import {
  authenticateUser,
  hydrateUsersFromServer,
  setSessionUser,
  upsertGoogleUser,
  userTypeOf,
} from '../lib/userStore.js';
import { hydrateUserPrefs } from '../lib/userPrefsSync.js';
import { googleSignInEnabled } from '../lib/googleAuthClient.js';
import GoogleSignInButton, { exchangeGoogleCredential } from './GoogleSignInButton.jsx';

export default function LoginPage({ onSuccess, onSignup }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [userId, setUserId] = useState('');
  const [pass, setPass] = useState('');
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPass, setLinkPass] = useState('');
  const [pendingCredential, setPendingCredential] = useState('');
  const root = useRef(null);
  const demoMode =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('demo') === '1';
  const googleOn = googleSignInEnabled();

  useEffect(() => {
    hydrateUsersFromServer().catch(() => {});
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

  async function finishSession(user) {
    const type = userTypeOf(user.personaId || user.type).id;
    const seat = { ...user, type, personaId: type };
    applyPersonaForUser(seat);
    setSessionUser(seat);
    sessionStorage.setItem('niyantranLand', userTypeOf(type).startTab);
    await hydrateUserPrefs(seat.email);
    onSuccess();
  }

  async function completeGoogle(credential, linkPassword) {
    setPending(true);
    setError('');
    try {
      const out = await exchangeGoogleCredential(credential, { linkPassword });
      const up = upsertGoogleUser(out.user);
      if (!up.ok) throw new Error(up.reason || 'Could not store Google account.');
      setPendingCredential('');
      setLinkEmail('');
      setLinkPass('');
      await finishSession(up.user);
    } catch (err) {
      if (err.code === 'NEEDS_LINK') {
        setPendingCredential(credential);
        setLinkEmail(err.email || '');
        setError(err.message || 'Enter your existing password to link Google.');
        setPending(false);
        return;
      }
      setError(err.message || 'Google sign-in failed.');
      setPending(false);
    }
  }

  async function handleLink(e) {
    e.preventDefault();
    if (!pendingCredential || !linkPass) return;
    await completeGoogle(pendingCredential, linkPass);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const user = String(fd.get('user') || '').trim();
    const pass = String(fd.get('pass') || '');
    setPending(true);
    setError('');
    try {
      await hydrateUsersFromServer();
    } catch {
      /* local-only */
    }
    const res = authenticateUser(user, pass);
    if (res.ok) {
      await finishSession(res.user);
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

        {pendingCredential ? (
          <form className="mkt-google-link" onSubmit={handleLink} autoComplete="off">
            <p className="mkt-google-link-copy">
              An account already exists for <strong>{linkEmail}</strong>. Enter that password to link Google Sign-In.
              Plan and persona stay unchanged.
            </p>
            <label className="mkt-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={linkPass}
                onChange={(e) => setLinkPass(e.target.value)}
                autoFocus
              />
            </label>
            <button className="mkt-cta" type="submit" disabled={pending}>
              {pending ? 'Linking…' : 'Link Google and sign in'}
            </button>
            <button
              type="button"
              className="mkt-google-cancel"
              onClick={() => {
                setPendingCredential('');
                setLinkPass('');
                setError('');
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
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
              <span>Password</span>
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

            {googleOn ? (
              <div className="mkt-google-block mkt-google-below">
                <div className="mkt-auth-or" aria-hidden="true">
                  <span>or</span>
                </div>
                <GoogleSignInButton
                  disabled={pending}
                  onCredential={(cred) => completeGoogle(cred)}
                  onError={(err) => setError(err.message || 'Google Sign-In failed.')}
                />
              </div>
            ) : null}
          </form>
        )}

        <div className="mkt-err" role="alert">
          {error}
        </div>
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
