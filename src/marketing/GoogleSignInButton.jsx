import { useEffect, useRef, useState } from 'react';
import {
  exchangeGoogleCredential,
  googleClientId,
  googleSignInEnabled,
  loadGoogleScript,
} from '../lib/googleAuthClient.js';

/**
 * Official GIS button. Parent handles success / needs-link via callbacks.
 */
export default function GoogleSignInButton({ onCredential, onError, text = 'signin_with', disabled }) {
  const host = useRef(null);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState('');
  const enabled = googleSignInEnabled();
  const clientId = googleClientId();
  const cbRef = useRef(onCredential);
  const errRef = useRef(onError);
  cbRef.current = onCredential;
  errRef.current = onError;

  useEffect(() => {
    if (!enabled || disabled) return undefined;
    let cancelled = false;
    (async () => {
      try {
        await loadGoogleScript();
        if (cancelled || !host.current || !window.google?.accounts?.id) return;
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
          context: 'signin',
          ux_mode: 'popup',
        });
        window.google.accounts.id.renderButton(host.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 320,
        });
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) {
          setBlocked(err.message || 'Google Sign-In unavailable');
          errRef.current?.(err);
        }
      }
    })();
    return () => {
      cancelled = true;
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
      <div ref={host} className={`mkt-google-btn${ready ? ' on' : ''}`} aria-label="Sign in with Google" />
      {blocked ? (
        <p className="mkt-google-off" role="alert">
          {blocked}
        </p>
      ) : null}
    </div>
  );
}

export { exchangeGoogleCredential };
