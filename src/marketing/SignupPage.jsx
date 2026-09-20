import { useEffect, useMemo, useRef, useState } from 'react';
import { PERSONAS, applyPersonaForUser } from '../lib/personas.js';
import {
  createUser,
  hydrateUsersFromServer,
  setSessionUser,
  userTypeOf,
} from '../lib/userStore.js';
import { trackProductEvent } from '../lib/productAnalytics.js';
import { normalizePlanId, startTrialFields, TRIAL_DAYS } from '../lib/planEntitlements.js';
import { loadPricing } from '../lib/pricingStore.js';
import { hydrateUserPrefs } from '../lib/userPrefsSync.js';

function planFromRoute() {
  const raw = String(location.hash || '')
    .replace(/^#/, '')
    .replace(/^\/+/, '')
    .toLowerCase();
  const q = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
  const params = new URLSearchParams(q);
  const fromQuery = params.get('plan');
  if (fromQuery) return normalizePlanId(fromQuery);
  const parts = raw.split(/[/?#]/).filter(Boolean);
  if (parts[0] === 'signup' && parts[1]) return normalizePlanId(parts[1]);
  return 'explorer';
}

export default function SignupPage({ onSuccess, onLogin }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [personaId, setPersonaId] = useState('');
  const [planId, setPlanId] = useState(() => planFromRoute());
  const [verificationSentEmail, setVerificationSentEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const root = useRef(null);
  const plans = useMemo(() => loadPricing().filter((p) => p.id !== 'gov'), []);

  useEffect(() => {
    if (cooldown > 0) {
      const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [cooldown]);

  async function handleResend() {
    if (!verificationSentEmail || cooldown > 0) return;
    setResending(true);
    setResendStatus('');
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verificationSentEmail }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setResendStatus(`Failed to resend: ${data.error || 'Unknown error'}`);
      } else {
        setResendStatus('Verification email resent successfully! Please check your inbox and spam folder.');
        setCooldown(60);
      }
    } catch {
      setResendStatus('Could not resend verification email right now.');
    } finally {
      setResending(false);
    }
  }

  useEffect(() => {
    hydrateUsersFromServer().catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => setPlanId(planFromRoute());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
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
    const name = String(fd.get('name') || '').trim();
    const user = String(fd.get('user') || '').trim();
    const pass = String(fd.get('pass') || '');
    const pass2 = String(fd.get('pass2') || '');
    setPending(true);
    setError('');

    if (!personaId) {
      setError('Choose who you are working as.');
      setPending(false);
      return;
    }
    if (pass !== pass2) {
      setError('Passwords do not match.');
      setPending(false);
      return;
    }

    // Call Server-Side Supabase Auth + Resend Confirmation
    try {
      const nameParts = name.split(' ');
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(' ') || '';
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user,
          password: pass,
          firstName,
          lastName,
        }),
      });
      const authRes = await response.json();
      if (!response.ok || !authRes.ok) {
        setError(authRes.error || 'Failed to create account. Please check your details.');
        setPending(false);
        return;
      }
    } catch (authErr) {
      console.warn('Backend auth signup error:', authErr);
      setError('Network error connecting to authentication server. Please try again.');
      setPending(false);
      return;
    }

    try {
      await hydrateUsersFromServer();
    } catch {
      /* local-only */
    }

    const planFields = startTrialFields(planId);
    const res = createUser({
      name,
      email: user,
      password: pass,
      type: personaId,
      personaId,
      ...planFields,
    });

    sessionStorage.setItem('lastRegisteredEmail', user);
    setVerificationSentEmail(user);
    setPending(false);
  }

  return (
    <div className="mkt-login mkt-login-globe mkt-signup" ref={root} onMouseMove={onMove}>
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
      {verificationSentEmail ? (
        <main className="mkt-login-card mkt-signup-card">
          <p className="live">
            <i /> SYS/READY
          </p>
          <div className="mark">
            <img src="/brand/logo.png?v=2" alt="" />
          </div>
          <h1>VERIFY GMAIL</h1>
          <div className="tag">ACTIVATION LINK DISPATCHED</div>

          <div style={{ marginTop: '20px', textAlign: 'left' }}>
            <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: '8px', fontWeight: '700', textTransform: 'uppercase' }}>
              Verify your Gmail
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                readOnly
                value={verificationSentEmail}
                style={{
                  flex: 1,
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  borderRadius: '6px',
                  padding: '12px 14px',
                  color: '#f8fafc',
                  fontSize: '14px',
                  fontWeight: '500',
                  outline: 'none',
                }}
              />
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
                  padding: '12px 16px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                Open Gmail ↗
              </a>
            </div>
          </div>

          <div style={{ margin: '20px 0', padding: '14px', background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '8px', color: '#cbd5e1', fontSize: '13px', lineHeight: '1.6', textAlign: 'left' }}>
            <strong style={{ color: '#38bdf8', display: 'block', marginBottom: '4px' }}>Check your inbox:</strong>
            A verification link was sent. Click the direct link in the email to activate your account, then sign in.
          </div>

          <button
            type="button"
            className="mkt-cta"
            onClick={onLogin}
            style={{ width: '100%', marginTop: '8px' }}
          >
            Proceed to Sign In →
          </button>

          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || resending}
              style={{ background: 'none', border: 'none', color: cooldown > 0 ? '#64748b' : '#38bdf8', cursor: cooldown > 0 ? 'default' : 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              {resending ? 'Resending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend verification email'}
            </button>
            <button
              type="button"
              onClick={() => setVerificationSentEmail('')}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
            >
              Use different email
            </button>
          </div>
          {resendStatus && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: resendStatus.includes('success') ? '#4ade80' : '#f87171' }}>
              {resendStatus}
            </div>
          )}
        </main>
      ) : (
        <main className="mkt-login-card mkt-signup-card">
          <p className="live">
            <i /> SYS/READY
          </p>
          <div className="mark">
            <img src="/brand/logo.png?v=2" alt="" />
          </div>
          <h1>CREATE ACCESS</h1>
          <div className="tag">SIGN UP</div>

          <form onSubmit={handleSubmit} autoComplete="off">
            <div className="mkt-signup-block">
              <h2 className="mkt-signup-label">Plan</h2>
              <p className="mkt-signup-lead">
                Explorer is free (5 core desks). Professional / Enterprise start a {TRIAL_DAYS}-day trial with no card —
                capped data, no copy/export, upgrade prompts until you buy.
              </p>
              <div className="mkt-signup-plan-grid" role="radiogroup" aria-label="Plan">
                {plans.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={planId === p.id}
                    className={`mkt-signup-plan${planId === p.id ? ' on' : ''}`}
                    onClick={() => setPlanId(p.id)}
                  >
                    <strong>{p.name}</strong>
                    <span>
                      {p.id === 'explorer'
                        ? 'Free · 5 core desks'
                        : `$${p.monthly}/mo · ${TRIAL_DAYS}-day trial, no card`}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mkt-signup-block">
              <h2 className="mkt-signup-label">Who are you working as?</h2>
              <p className="mkt-signup-lead">Sets your free-tier core desks and start desk.</p>
              <div className="mkt-signup-persona-grid" role="radiogroup" aria-label="Working as">
                {PERSONAS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={personaId === p.id}
                    className={`mkt-signup-persona tone-${p.tone}${personaId === p.id ? ' on' : ''}`}
                    onClick={() => setPersonaId(p.id)}
                  >
                    <strong>{p.label}</strong>
                    <span>{p.blurb}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="mkt-field">
              <span>Name</span>
              <input name="name" type="text" autoComplete="name" required />
            </label>
            <label className="mkt-field">
              <span>User ID</span>
              <input
                name="user"
                type="text"
                autoComplete="username"
                spellCheck="false"
                required
                placeholder="you@org or handle"
              />
            </label>
            <label className="mkt-field">
              <span>Password</span>
              <input name="pass" type="password" autoComplete="new-password" required minLength={6} />
            </label>
            <label className="mkt-field">
              <span>Confirm password</span>
              <input name="pass2" type="password" autoComplete="new-password" required minLength={6} />
            </label>
            <button className="mkt-cta" type="submit" disabled={pending}>
              {pending
                ? 'Creating…'
                : planId === 'explorer'
                  ? 'Create free account'
                  : `Start ${TRIAL_DAYS}-day trial`}
            </button>
            <div className="mkt-err" role="alert">
              {error}
            </div>
          </form>

          <p className="mkt-auth-switch">
            Already have access?{' '}
            <button type="button" onClick={onLogin}>
              Sign in
            </button>
          </p>
        </main>
      )}
    </div>
  );
}
