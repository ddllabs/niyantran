import { useEffect, useRef, useState } from 'react';
import { PERSONAS, applyPersonaForUser } from '../lib/personas.js';
import {
  PENDING_PERSONA_KEY,
  setSessionUser,
  userTypeOf,
} from '../lib/userStore.js';
import { trackProductEvent } from '../lib/productAnalytics.js';
import { entitlementOf } from '../lib/planEntitlements.js';
import { refreshEntitlement } from '../lib/entitlementStore.js';
import { hydrateUserPrefs } from '../lib/userPrefsSync.js';
import { supabase } from '../lib/supabaseClient.js';
import { signupErrorMessage } from '../lib/signupErrors.js';
import { nextSignupStep } from '../lib/signupFlow.js';
import GoogleSignInButton from './GoogleSignInButton.jsx';
import AuthEarth from './AuthEarth.jsx';

export default function SignupPage({ onSuccess, onLogin }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [personaId, setPersonaId] = useState('');
  const [verificationSentEmail, setVerificationSentEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const root = useRef(null);

  useEffect(() => {
    if (cooldown > 0) {
      const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [cooldown]);

  function chooseRadio(e, options, index, select) {
    let next;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    select(options[next].id);
    e.currentTarget.parentElement.querySelectorAll('[role="radio"]')[next]?.focus();
  }

  async function handleResend() {
    if (!verificationSentEmail || cooldown > 0) return;
    setResending(true);
    setResendStatus('');
    try {
      const { error: resendErr } = await supabase.auth.resend({
        type: 'signup',
        email: verificationSentEmail,
      });
      if (resendErr) {
        setResendStatus(`Failed to resend: ${resendErr.message || 'Unknown error'}`);
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

  async function enterTerminal(user, { source = 'signup' } = {}) {
    const type = userTypeOf(user.personaId || user.type).id;
    const seat = { ...user, type, personaId: type };
    applyPersonaForUser(seat);
    setSessionUser(seat);
    sessionStorage.setItem('niyantranLand', userTypeOf(type).startTab);
    // Preserve the server's subscription facts; desk access is free.
    refreshEntitlement().catch(() => {});
    const ent = entitlementOf(seat);
    trackProductEvent('persona_selected', { personaId: type, source, plan: ent.plan });
    trackProductEvent('plan_selected', { plan: ent.plan, status: ent.status });
    await hydrateUserPrefs(seat.email);
    onSuccess();
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

    // Call native Supabase Auth
    try {
      const nameParts = name.split(' ');
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(' ') || '';
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: user,
        password: pass,
        options: {
          data: {
            name,
            first_name: firstName,
            last_name: lastName,
            personaId,
            // Legacy plan URLs must not start a trial during free signup.
            plan: 'explorer',
          },
        },
      });
      if (signUpError) {
        setError(signupErrorMessage(signUpError));
        setPending(false);
        return;
      }
      const step = nextSignupStep({ hasSession: Boolean(signUpData?.session) });
      if (step !== 'verify') {
        const seat = { id: signUpData.session.user?.id, name, email: user, type: personaId, personaId };
        await enterTerminal(seat);
        return;
      }
    } catch (authErr) {
      console.warn('Native auth signup error:', authErr);
      setError('Network error connecting to authentication server. Please try again.');
      setPending(false);
      return;
    }

    sessionStorage.setItem('lastRegisteredEmail', user);
    setVerificationSentEmail(user);
    setPending(false);
  }

  return (
    <div className="mkt-login mkt-login-globe mkt-signup" ref={root} onMouseMove={onMove}>
      <aside className="mkt-signup-context" aria-labelledby="signup-context-title">
        <div className="mkt-signup-illustration"><AuthEarth persona={personaId} onPersona={setPersonaId} /></div>
        <h2 id="signup-context-title">A world of records.<br />Your own perspective.</h2>
        <p>Explore legislation, global affairs, markets and the courts with the source always in view.</p>
        <div className="mkt-signup-context-desks">Eight desks · One research workspace</div>
      </aside>

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
            <label style={{ display: 'block', fontSize: '11px', letterSpacing: '0.08em', color: '#5c564e', marginBottom: '8px', fontWeight: '700', textTransform: 'uppercase' }}>
              Verify your Gmail
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                readOnly
                value={verificationSentEmail}
                style={{
                  flex: 1,
                  background: '#f8f5f0',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  borderRadius: '6px',
                  padding: '12px 14px',
                  color: '#131313',
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

          <div style={{ margin: '20px 0', padding: '14px', background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '8px', color: '#3d3a36', fontSize: '13px', lineHeight: '1.6', textAlign: 'left' }}>
            <strong style={{ color: '#012ea1', display: 'block', marginBottom: '4px' }}>Check your inbox:</strong>
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
              style={{ background: 'none', border: 'none', color: cooldown > 0 ? '#64748b' : '#012ea1', cursor: cooldown > 0 ? 'default' : 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              {resending ? 'Resending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend verification email'}
            </button>
            <button
              type="button"
              onClick={() => setVerificationSentEmail('')}
              style={{ background: 'none', border: 'none', color: '#5c564e', cursor: 'pointer', padding: 0 }}
            >
              Use different email
            </button>
          </div>
          {resendStatus && (
            <div style={{ marginTop: '10px', fontSize: '12px', color: resendStatus.includes('success') ? '#176b55' : '#b42318' }}>
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
                <h2 className="mkt-signup-label">Who are you working as?</h2>
                <p className="mkt-signup-lead">Sets your starting desk and research perspective. All desks are available.</p>
                <div className="mkt-signup-persona-grid" role="radiogroup" aria-label="Working as">
                  {PERSONAS.map((p, index) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={personaId === p.id}
                      tabIndex={personaId === p.id || (!personaId && index === 0) ? 0 : -1}
                      onKeyDown={(e) => chooseRadio(e, PERSONAS, index, setPersonaId)}
                      className={`mkt-signup-persona tone-${p.tone}${personaId === p.id ? ' on' : ''}`}
                      style={{ '--persona-img': `url(${p.img})` }}
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
                <span>Email address</span>
                <input name="user" type="email" autoComplete="email" required />
              </label>
              <label className="mkt-field">
                <span>Password</span>
                <input name="pass" type="password" autoComplete="new-password" required minLength={6} />
              </label>
              <label className="mkt-field">
                <span>Confirm password</span>
                <input name="pass2" type="password" autoComplete="new-password" required minLength={6} />
              </label>
              <p className="mkt-signup-legal">
                By creating an account you agree to the{' '}
                <a href="#/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
                {' '}and acknowledge the{' '}
                <a href="#/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
              </p>
              <button className="mkt-cta" type="submit" disabled={pending}>
                {pending ? 'Creating…' : 'Create account'}
              </button>
              <div className="mkt-err" role="alert">
                {error}
              </div>

              <div className="mkt-google-block mkt-google-below">
                <div className="mkt-auth-or" aria-hidden="true">
                  <span>or</span>
                </div>
                <GoogleSignInButton
                  text="signup_with"
                  disabled={pending}
                  onClick={() => {
                    if (personaId) {
                      sessionStorage.setItem(PENDING_PERSONA_KEY, personaId);
                    }
                  }}
                  onError={(err) => setError(err.message || 'Google Sign-In failed.')}
                />
                <p className="mkt-google-note">Pick a role above first. Every desk is included with your account.</p>
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
