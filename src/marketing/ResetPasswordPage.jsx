import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

export default function ResetPasswordPage({ onLogin }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [validatingSession, setValidatingSession] = useState(true);
  const [sessionActive, setSessionActive] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    let mounted = true;

    async function checkRecoverySession() {
      // 1. Check if Supabase session is currently active
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        if (mounted) {
          setSessionActive(true);
          setValidatingSession(false);
        }
        return;
      }

      // 2. Check if recovery tokens are in hash
      const hash = window.location.hash || '';
      if (hash.includes('error=') || hash.includes('error_code=')) {
        if (mounted) {
          setSessionActive(false);
          setValidatingSession(false);
        }
        return;
      }

      if (hash.includes('access_token=')) {
        try {
          const hashQuery = hash.slice(hash.indexOf('access_token='));
          const params = new URLSearchParams(hashQuery);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          if (access_token && refresh_token) {
            const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
            if (!error && data?.session) {
              if (mounted) {
                setSessionActive(true);
                setValidatingSession(false);
              }
              return;
            }
          }
        } catch {
          /* continue to authListener fallback */
        }
      }

      if (hash.includes('type=recovery')) {
        const { data: authListener } = supabase.auth.onAuthStateChange((event, newSession) => {
          if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && newSession)) {
            if (mounted) {
              setSessionActive(true);
              setValidatingSession(false);
            }
          }
        });

        setTimeout(() => {
          if (mounted && validatingSession) {
            setValidatingSession(false);
          }
        }, 1500);

        return () => authListener?.subscription?.unsubscribe();
      }

      // If neither, recovery link is invalid or expired
      if (mounted) {
        setValidatingSession(false);
      }
    }

    checkRecoverySession();

    return () => {
      mounted = false;
    };
  }, [validatingSession]);

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

  // Password requirements calculation
  const hasMinLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const isMatch = password && password === confirmPassword;
  const isValid = hasMinLength && hasUpper && hasLower && (hasNumber || hasSymbol) && isMatch;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!isValid) {
      if (!isMatch) {
        setError('Passwords do not match.');
      } else {
        setError('Password does not meet the security criteria.');
      }
      return;
    }

    setPending(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        setError(updateError.message || 'Failed to update password.');
        setPending(false);
        return;
      }

      setSuccess(true);
      setPending(false);

      // Sign out recovery session to require fresh login with new password
      await supabase.auth.signOut();
    } catch (err) {
      setError(err?.message || 'An unexpected error occurred.');
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
        <div className="tag">CREDENTIAL RESET</div>

        {validatingSession ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: '#94a3b8' }}>
            <p>Validating secure recovery session…</p>
          </div>
        ) : !sessionActive && !success ? (
          <div style={{ textAlign: 'left', marginTop: '14px' }}>
            <div
              style={{
                padding: '14px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                color: '#f87171',
                fontSize: '13px',
                lineHeight: '1.5',
                marginBottom: '16px',
              }}
              role="alert"
            >
              <strong>Invalid or Expired Link</strong>
              <p style={{ margin: '6px 0 0 0', color: '#cbd5e1' }}>
                This password recovery link has either expired, already been used, or is invalid.
              </p>
            </div>
            <button
              type="button"
              className="mkt-cta"
              style={{ width: '100%' }}
              onClick={() => {
                window.location.hash = '#forgot-password';
              }}
            >
              Request New Reset Link
            </button>
            <div style={{ marginTop: '16px', textAlign: 'center' }}>
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
                }}
              >
                Return to Sign In
              </button>
            </div>
          </div>
        ) : success ? (
          <div style={{ textAlign: 'left', marginTop: '14px' }}>
            <div
              style={{
                padding: '16px',
                background: 'rgba(34, 197, 94, 0.12)',
                border: '1px solid rgba(34, 197, 94, 0.4)',
                borderRadius: '8px',
                color: '#4ade80',
                fontSize: '13px',
                lineHeight: '1.5',
                marginBottom: '18px',
              }}
              role="status"
            >
              <strong>✓ Password Updated Successfully!</strong>
              <p style={{ margin: '6px 0 0 0', color: '#cbd5e1' }}>
                Your account password has been updated. You can now sign in with your new password.
              </p>
            </div>
            <button
              type="button"
              className="mkt-cta"
              style={{ width: '100%' }}
              onClick={onLogin}
            >
              Continue to Sign In
            </button>
          </div>
        ) : (
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#f8fafc', margin: '14px 0 6px 0' }}>
              Reset your password
            </h2>
            <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: '1.5', margin: '0 0 16px 0' }}>
              Enter and confirm your new secure password.
            </p>

            <form onSubmit={handleSubmit} autoComplete="off">
              <label className="mkt-field">
                <span>New Password</span>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="newPassword"
                    required
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={pending}
                    style={{ width: '100%', paddingRight: '40px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>

              <label className="mkt-field" style={{ marginTop: '10px' }}>
                <span>Confirm New Password</span>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    name="confirmPassword"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={pending}
                    style={{ width: '100%', paddingRight: '40px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    {showConfirm ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>

              {/* Password Requirements Checklist */}
              <div
                style={{
                  fontSize: '11px',
                  color: '#94a3b8',
                  background: '#0f172a',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  margin: '12px 0',
                  lineHeight: '1.6',
                }}
              >
                <div style={{ color: hasMinLength ? '#4ade80' : '#94a3b8' }}>
                  {hasMinLength ? '✓' : '○'} At least 8 characters
                </div>
                <div style={{ color: hasUpper && hasLower ? '#4ade80' : '#94a3b8' }}>
                  {hasUpper && hasLower ? '✓' : '○'} Upper and lowercase letters
                </div>
                <div style={{ color: hasNumber || hasSymbol ? '#4ade80' : '#94a3b8' }}>
                  {hasNumber || hasSymbol ? '✓' : '○'} At least one number or special character
                </div>
                {confirmPassword && (
                  <div style={{ color: isMatch ? '#4ade80' : '#f87171' }}>
                    {isMatch ? '✓ Passwords match' : '✕ Passwords do not match'}
                  </div>
                )}
              </div>

              {error && (
                <div className="mkt-err" role="alert" style={{ marginBottom: '12px' }}>
                  {error}
                </div>
              )}

              <button
                className="mkt-cta"
                type="submit"
                disabled={pending || !isValid}
                style={{ width: '100%', marginTop: '6px' }}
              >
                {pending ? 'Updating password…' : 'Update password'}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
