import { useEffect, useRef, useState } from 'react';
import {
  exchangeGoogleCredential,
  googleClientId,
  googleSignInEnabled,
  loadGoogleScript,
} from '../lib/googleAuthClient.js';

function GoogleMark() {
  return (
    <svg className="mkt-google-mark" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * Official GIS button over a site-styled facade (click target stays Google’s control).
 */
export default function GoogleSignInButton({
  onCredential,
  onError,
  text = 'signin_with',
  disabled,
  label,
}) {
  const host = useRef(null);
  const shell = useRef(null);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState('');
  const enabled = googleSignInEnabled();
  const clientId = googleClientId();
  const cbRef = useRef(onCredential);
  const errRef = useRef(onError);
  cbRef.current = onCredential;
  errRef.current = onError;

  const facadeLabel =
    label ||
    (text === 'signup_with' ? 'Sign up with Google' : text === 'continue_with' ? 'Continue with Google' : 'Sign in with Google');

  useEffect(() => {
    if (!enabled || disabled) return undefined;
    let cancelled = false;
    let ro;

    const mount = async () => {
      try {
        await loadGoogleScript();
        if (cancelled || !host.current || !window.google?.accounts?.id) return;

        const paint = () => {
          if (cancelled || !host.current || !shell.current) return;
          const w = Math.max(240, Math.floor(shell.current.getBoundingClientRect().width || 320));
          host.current.innerHTML = '';
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: (response) => {
              const cred = response?.credential;
              if (!cred) {
                errRef.current?.(new Error('Google did not return a credential.'));
                return;
              }
              cbRef.current?.(cred);
            },
            auto_select: false,
            cancel_on_tap_outside: true,
            context: text === 'signup_with' ? 'signup' : 'signin',
            ux_mode: 'popup',
          });
          window.google.accounts.id.renderButton(host.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text,
            shape: 'rectangular',
            logo_alignment: 'left',
            width: w,
          });
          if (!cancelled) setReady(true);
        };

        paint();
        if (typeof ResizeObserver !== 'undefined' && shell.current) {
          let t;
          ro = new ResizeObserver(() => {
            clearTimeout(t);
            t = setTimeout(paint, 120);
          });
          ro.observe(shell.current);
        }
      } catch (err) {
        if (!cancelled) {
          setBlocked(err.message || 'Google Sign-In unavailable');
          errRef.current?.(err);
        }
      }
    };

    mount();
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [enabled, clientId, text, disabled]);

  if (!enabled) {
    return (
      <p className="mkt-google-off" role="note">
        Google Sign-In is not configured for this build.
      </p>
    );
  }

  return (
    <div className="mkt-google-wrap">
      <div
        ref={shell}
        className={`mkt-google-shell${ready ? ' on' : ''}${disabled ? ' is-disabled' : ''}`}
      >
        <div className="mkt-google-facade" aria-hidden="true">
          <GoogleMark />
          <span>{facadeLabel}</span>
        </div>
        <div ref={host} className="mkt-google-hit" aria-label={facadeLabel} />
      </div>
      {blocked ? (
        <p className="mkt-google-off" role="alert">
          {blocked}
        </p>
      ) : null}
    </div>
  );
}

export { exchangeGoogleCredential };
