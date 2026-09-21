import { useEffect, useMemo, useRef, useState } from 'react';
import { PERSONAS, applyPersonaForUser } from '../lib/personas.js';
import {
  createUser,
  hydrateUsersFromServer,
  setSessionUser,
  updateUser,
  upsertGoogleUser,
  userTypeOf,
} from '../lib/userStore.js';
import { trackProductEvent } from '../lib/productAnalytics.js';
import { startTrialFields, TRIAL_DAYS } from '../lib/planEntitlements.js';
import { loadPricing } from '../lib/pricingStore.js';
import { hydrateUserPrefs } from '../lib/userPrefsSync.js';
import { googleSignInEnabled } from '../lib/googleAuthClient.js';
import GoogleSignInButton, { exchangeGoogleCredential } from './GoogleSignInButton.jsx';

export default function SignupPage({ onSuccess, onLogin }) {
  const [step, setStep] = useState('account'); // account | plan | link
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [personaId, setPersonaId] = useState('');
  const [planId, setPlanId] = useState('explorer');
  const [draftUser, setDraftUser] = useState(null);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPass, setLinkPass] = useState('');
  const [pendingCredential, setPendingCredential] = useState('');
  const root = useRef(null);
  const plans = useMemo(() => loadPricing().filter((p) => p.id !== 'gov'), []);
  const googleOn = googleSignInEnabled();

  useEffect(() => {
    hydrateUsersFromServer().catch(() => {});
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

  async function enterTerminal(user, { source = 'signup', plan } = {}) {
    const type = userTypeOf(user.personaId || user.type).id;
    const seat = { ...user, type, personaId: type };
    applyPersonaForUser(seat);
    setSessionUser(seat);
    sessionStorage.setItem('niyantranLand', userTypeOf(type).startTab);
    trackProductEvent('persona_selected', { personaId: type, source, plan: plan || seat.plan });
    trackProductEvent('plan_selected', { plan: plan || seat.plan, status: seat.planStatus || 'free' });
    await hydrateUserPrefs(seat.email);
    onSuccess();
  }

  function goToPlanStep(user, { source = 'signup' } = {}) {
    setDraftUser({ user, source });
    setPlanId('explorer');
    setStep('plan');
    setPending(false);
    setError('');
  }

  async function applyPlanAndEnter() {
    if (!draftUser?.user?.id) return;
    setPending(true);
    setError('');
    const fields = startTrialFields(planId);
    updateUser(draftUser.user.id, {
      ...fields,
      // Keep persona chosen on the account step
      type: draftUser.user.type || draftUser.user.personaId,
      personaId: draftUser.user.personaId || draftUser.user.type,
    });
    const next = {
      ...draftUser.user,
      ...fields,
      type: draftUser.user.type || draftUser.user.personaId,
      personaId: draftUser.user.personaId || draftUser.user.type,
    };
    await enterTerminal(next, { source: draftUser.source || 'signup', plan: fields.plan });
  }

  async function completeGoogle(credential, linkPassword) {
    if (!personaId && !linkPassword) {
      setError('Choose who you are working as, then continue with Google.');
      return;
    }
    setPending(true);
    setError('');
    try {
      const out = await exchangeGoogleCredential(credential, { linkPassword });
      let up = upsertGoogleUser(out.user);
      if (!up.ok) throw new Error(up.reason || 'Could not store Google account.');

      // New Google seats: apply the persona picked on this page (server default is analyst).
      if (out.created && personaId) {
        const role = userTypeOf(personaId).id;
        updateUser(up.user.id, { type: role, personaId: role });
        up = { ok: true, user: { ...up.user, type: role, personaId: role } };
      }

      setPendingCredential('');
      setLinkEmail('');
      setLinkPass('');
      trackProductEvent('google_auth', { created: Boolean(out.created), linked: Boolean(out.linked) });

      if (out.created) {
        goToPlanStep(up.user, { source: 'google_signup' });
        return;
      }
      // Returning / linked accounts keep plan — enter terminal.
      await enterTerminal(up.user, {
        source: out.linked ? 'google_link' : 'google_login',
        plan: up.user.plan,
      });
    } catch (err) {
      if (err.code === 'NEEDS_LINK') {
        setPendingCredential(credential);
        setLinkEmail(err.email || '');
        setStep('link');
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

    try {
      await hydrateUsersFromServer();
    } catch {
      /* local-only */
    }

    // Account first on Explorer; plan is chosen on the next step.
    const res = createUser({
      name,
      email: user,
      password: pass,
      type: personaId,
      personaId,
      ...startTrialFields('explorer'),
    });
    if (!res.ok) {
      setError(res.reason || 'Could not create account.');
      setPending(false);
      return;
    }

    const type = userTypeOf(res.user.type).id;
    goToPlanStep({ ...res.user, type, personaId: type }, { source: 'signup' });
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
      <main className="mkt-login-card mkt-signup-card">
        <p className="live">
          <i /> SYS/READY
        </p>
        <div className="mark">
          <img src="/brand/logo.png?v=2" alt="" />
        </div>
        <h1>{step === 'plan' ? 'CHOOSE PLAN' : 'CREATE ACCESS'}</h1>
        <div className="tag">{step === 'plan' ? 'STEP 2 OF 2' : 'SIGN UP'}</div>

        {step === 'link' ? (
          <form className="mkt-google-link" onSubmit={handleLink} autoComplete="off">
            <p className="mkt-google-link-copy">
              An account already exists for <strong>{linkEmail}</strong>. Enter that password to link Google Sign-In.
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
              {pending ? 'Linking…' : 'Link Google and continue'}
            </button>
            <button
              type="button"
              className="mkt-google-cancel"
              onClick={() => {
                setPendingCredential('');
                setLinkPass('');
                setError('');
                setStep('account');
              }}
            >
              Cancel
            </button>
            <div className="mkt-err" role="alert">
              {error}
            </div>
          </form>
        ) : null}

        {step === 'plan' ? (
          <div className="mkt-signup-plan-step">
            <p className="mkt-signup-lead">
              Account ready{draftUser?.user?.email ? ` for ${draftUser.user.email}` : ''}. Pick a plan to continue —
              Explorer is free; Professional / Enterprise start a {TRIAL_DAYS}-day trial with no card.
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
            <button className="mkt-cta" type="button" disabled={pending} onClick={applyPlanAndEnter}>
              {pending
                ? 'Opening terminal…'
                : planId === 'explorer'
                  ? 'Continue free'
                  : `Start ${TRIAL_DAYS}-day trial`}
            </button>
            <div className="mkt-err" role="alert">
              {error}
            </div>
          </div>
        ) : null}

        {step === 'account' ? (
          <form onSubmit={handleSubmit} autoComplete="off">
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
              {pending ? 'Creating…' : 'Create account'}
            </button>
            <div className="mkt-err" role="alert">
              {error}
            </div>

            {googleOn ? (
              <div className="mkt-google-block mkt-google-below">
                <div className="mkt-auth-or" aria-hidden="true">
                  <span>or</span>
                </div>
                <GoogleSignInButton
                  text="signup_with"
                  disabled={pending}
                  onCredential={(cred) => completeGoogle(cred)}
                  onError={(err) => setError(err.message || 'Google Sign-In failed.')}
                />
                <p className="mkt-google-note">Pick a role above first. You’ll choose a plan on the next step.</p>
              </div>
            ) : null}
          </form>
        ) : null}

        {step !== 'plan' ? (
          <p className="mkt-auth-switch">
            Already have access?{' '}
            <button type="button" onClick={onLogin}>
              Sign in
            </button>
          </p>
        ) : null}
      </main>
    </div>
  );
}
