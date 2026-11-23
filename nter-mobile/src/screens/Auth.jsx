// Sign in, create an account, confirm the email, reset the password: the same Supabase accounts
// as nter.pro, so a member signs in with the login they already have.
import { useEffect, useState } from 'react';
import { useApp } from '../state/app.jsx';
import { api } from '../services/index.js';
import { PERSONAS, personaByDb } from '../data/personas.js';
import { Header } from '../ui/kit.jsx';
import Icon from '../ui/Icon.jsx';
import { asset } from '../lib/asset.js';
import { isNative } from '../lib/platform.js';
import { GOOGLE_ON_PHONE } from '../lib/config.js';

// Google sign-in needs pro.nter.app://auth/callback in NTER's redirect list, which is not added
// (NTER stays unchanged), so the phone apps offer email and password only unless a build turns it on.
const showGoogle = () => !isNative() || GOOGLE_ON_PHONE;

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function Brand({ k = 'DESK ACCESS' }) {
  return (
    <div className="lead" style={{ textAlign: 'center', paddingTop: 4 }}>
      <img src={asset('/brand/logo-128.webp')} alt="" style={{ width: 58, height: 58, objectFit: 'contain' }} />
      <div style={{ fontSize: 15, letterSpacing: '.28em', fontWeight: 700, marginTop: 8 }}>TERMINAL</div>
      <div className="k" style={{ marginTop: 4 }}>{k}</div>
    </div>
  );
}

function GoogleButton() {
  const { toast } = useApp();
  return (
    <button type="button" className="pbtn sec" onClick={() => api.signInWithGoogle().catch((e) => toast(e.message))}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
      Continue with Google
    </button>
  );
}

function Foot() {
  const open = (path) => import('@capacitor/browser').then(({ Browser }) => Browser.open({ url: `https://www.nter.pro${path}` })).catch(() => window.open(`https://www.nter.pro${path}`, '_blank'));
  return (
    <span className="k">
      <button type="button" onClick={() => open('/terms')}>TERMS</button> · <button type="button" onClick={() => open('/privacy')}>PRIVACY</button> · SAME ACCOUNT AS THE WEBSITE
    </span>
  );
}

export function SignIn() {
  const { signIn, setStage, authEmail, setAuthEmail } = useApp();
  const [email, setEmail] = useState(authEmail || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email)) { setError('Enter the email you use on nter.pro.'); return; }
    if (!password) { setError('Enter your password.'); return; }
    setBusy(true); setError('');
    try { await signIn(email, password); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="view">
      <Header back onBack={() => setStage('welcome')} />
      <div className="body" style={{ display: 'flex', flexDirection: 'column' }}>
        <Brand />
        <form className="form" onSubmit={submit} noValidate>
          <label>Email<input type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" /></label>
          {error ? <div className="err" role="alert">{error}</div> : null}
          <button type="button" className="link" onClick={() => { setAuthEmail(email); setStage('forgot'); }}>Forgot password?</button>
          <button type="submit" className="pbtn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {showGoogle() ? <><div className="or">OR</div><GoogleButton /></> : null}
        </form>
        <div className="signfoot">
          <button type="button" onClick={() => { setAuthEmail(email); setStage('signup'); }}>New to nter.pro? <b>Create an account</b></button>
          <Foot />
        </div>
      </div>
    </div>
  );
}

export function SignUp() {
  const { signUp, setStage, authEmail } = useApp();
  let preset = null;
  try { preset = personaByDb(sessionStorage.getItem('nter.pickPersona')); } catch { preset = null; }
  const [form, setForm] = useState({ firstName: '', lastName: '', email: authEmail || '', password: '', persona: preset });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (!form.firstName.trim()) { setError('Enter your first name.'); return; }
    if (!EMAIL_RE.test(form.email)) { setError('Enter a valid email address.'); return; }
    if (form.password.length < 6) { setError('Use at least 6 characters for the password.'); return; }
    if (!form.persona) { setError('Choose the role that fits you best.'); return; }
    setBusy(true); setError('');
    try { await signUp(form); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="view">
      <Header back onBack={() => setStage('welcome')} />
      <div className="body">
        <Brand k="CREATE YOUR ACCOUNT" />
        <form className="form" onSubmit={submit} noValidate>
          <div className="two">
            <label>First name<input autoComplete="given-name" value={form.firstName} onChange={set('firstName')} /></label>
            <label>Last name<input autoComplete="family-name" value={form.lastName} onChange={set('lastName')} /></label>
          </div>
          <label>Email<input type="email" inputMode="email" autoComplete="email" value={form.email} onChange={set('email')} /></label>
          <label>Password<input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} placeholder="At least 6 characters" /></label>
          <div className="k" style={{ marginTop: 4 }}>I AM A…</div>
          <div className="pwrap" style={{ padding: 0 }}>
            {PERSONAS.map((p) => (
              <button key={p.id} type="button" className={`pcard ${form.persona?.id === p.id ? 'on' : ''}`} onClick={() => setForm((f) => ({ ...f, persona: p }))}>
                <span className="ic"><Icon name={p.icon} /></span>
                <span style={{ flex: 1, minWidth: 0 }}><b>{p.name}</b><span>{p.tag}</span></span>
                <span className="tick">{form.persona?.id === p.id ? <Icon name="check" /> : null}</span>
              </button>
            ))}
          </div>
          {error ? <div className="err" role="alert">{error}</div> : null}
          <button type="submit" className="pbtn" disabled={busy}>{busy ? 'Creating your account…' : 'Create account'}</button>
          {showGoogle() ? <><div className="or">OR</div><GoogleButton /></> : null}
        </form>
        <div className="signfoot">
          <button type="button" onClick={() => setStage('signin')}>Already a member? <b>Sign in</b></button>
          <Foot />
        </div>
      </div>
    </div>
  );
}

export function Verify() {
  const { setStage, authEmail } = useApp();
  const [left, setLeft] = useState(60);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const resend = async () => {
    try { await api.resendConfirmation(authEmail); setMsg('Sent again. Check your inbox and spam folder.'); setLeft(60); } catch (e) { setMsg(e.message); }
  };
  return (
    <div className="view">
      <Header back onBack={() => setStage('welcome')} />
      <div className="body">
        <Brand k="CONFIRM YOUR EMAIL" />
        <div className="form">
          <p style={{ textAlign: 'center', lineHeight: 1.5, margin: '4px 0 8px' }}>We sent a confirmation link to <b>{authEmail}</b>. Open it on this phone or any device, then sign in here.</p>
          {msg ? <div className="ok" role="status">{msg}</div> : null}
          <button type="button" className="pbtn" onClick={() => setStage('signin')}>I’ve confirmed — sign in</button>
          <button type="button" className="pbtn sec" disabled={left > 0} onClick={resend}>{left > 0 ? `Resend in ${left}s` : 'Resend the email'}</button>
        </div>
      </div>
    </div>
  );
}

export function Forgot() {
  const { setStage, authEmail } = useApp();
  const [email, setEmail] = useState(authEmail || '');
  const [state, setState] = useState({ busy: false, done: false, error: '' });
  const submit = async (e) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email)) { setState({ busy: false, done: false, error: 'Enter the email you signed up with.' }); return; }
    setState({ busy: true, done: false, error: '' });
    try { await api.forgotPassword(email); setState({ busy: false, done: true, error: '' }); } catch (err) { setState({ busy: false, done: false, error: err.message }); }
  };
  return (
    <div className="view">
      <Header back onBack={() => setStage('signin')} />
      <div className="body">
        <Brand k="RESET YOUR PASSWORD" />
        <form className="form" onSubmit={submit} noValidate>
          <label>Email<input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {state.error ? <div className="err" role="alert">{state.error}</div> : null}
          {state.done ? <div className="ok" role="status">If an account exists for {email}, a reset link is on its way. The link opens nter.pro, where you choose the new password.</div> : null}
          <button type="submit" className="pbtn" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send reset link'}</button>
          <button type="button" className="link" onClick={() => setStage('signin')}>Back to sign in</button>
        </form>
      </div>
    </div>
  );
}
