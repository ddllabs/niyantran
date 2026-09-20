import { useRef, useState } from 'react';

export default function ForgotPasswordPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const root = useRef(null);

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
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    if (cooldown > 0) return;

    setPending(true);
    setError('');
    setSuccessNotice('');

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });

      const data = await res.json();
      // Anti-enumeration: always display friendly confirmation
      setSuccessNotice(
        data.message || 'If an account exists for this email address, a password reset link has been sent.'
      );
      setCooldown(60);
      const timer = setInterval(() => {
        setCooldown((c) => {
          if (c <= 1) {
            clearInterval(timer);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } catch {
      // Even on network error, maintain friendly message
      setSuccessNotice(
        'If an account exists for this email address, a password reset link has been sent.'
      );
    } finally {
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
        <div className="tag">RECOVERY ACCESS</div>

        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#f8fafc', margin: '14px 0 6px 0' }}>
          Forgot your password?
        </h2>
        <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: '1.5', margin: '0 0 18px 0' }}>
          Enter the email address associated with your account and we&apos;ll send you a secure password reset link.
        </p>

        {successNotice ? (
          <div
            style={{
              padding: '14px',
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '8px',
              color: '#38bdf8',
              fontSize: '13px',
              lineHeight: '1.5',
              marginBottom: '18px',
              textAlign: 'left',
            }}
            role="status"
          >
            <strong>✓ Reset request received</strong>
            <div style={{ marginTop: '4px', color: '#cbd5e1' }}>{successNotice}</div>
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8' }}>
              Check your inbox and spam folder.
            </div>
            {email.toLowerCase().includes('gmail.com') && (
              <div style={{ marginTop: '12px' }}>
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
        ) : (
          <form onSubmit={handleSubmit} autoComplete="off">
            <label className="mkt-field">
              <span>Email Address</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                spellCheck="false"
                required
                autoFocus
                placeholder="you@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
              />
            </label>

            {error && (
              <div className="mkt-err" role="alert" style={{ marginBottom: '12px' }}>
                {error}
              </div>
            )}

            <button
              className="mkt-cta"
              type="submit"
              disabled={pending || cooldown > 0}
              style={{ width: '100%', marginTop: '6px' }}
            >
              {pending
                ? 'Sending reset link…'
                : cooldown > 0
                ? `Wait ${cooldown}s`
                : 'Send reset link'}
            </button>
          </form>
        )}

        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={onLogin}
            style={{
              background: 'none',
              border: 'none',
              color: '#38bdf8',
              fontSize: '13px',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: '6px',
            }}
          >
            ← Back to sign in
          </button>
        </div>
      </main>
    </div>
  );
}
