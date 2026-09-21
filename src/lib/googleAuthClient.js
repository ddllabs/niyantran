/**
 * Client helpers for Google Identity Services → /api/auth/google.
 */

export function googleClientId() {
  try {
    return String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  } catch {
    return '';
  }
}

export function googleSignInEnabled() {
  return Boolean(googleClientId());
}

let gsiPromise = null;

export function loadGoogleScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-niy-gsi]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google));
      existing.addEventListener('error', () => reject(new Error('Google script failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.dataset.niyGsi = '1';
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error('Google script failed to load'));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

/**
 * Exchange a Google ID token for a NTER session user (server-verified).
 * @param {string} credential
 * @param {{ linkPassword?: string, mode?: 'signin'|'signup' }} [opts]
 */
export async function exchangeGoogleCredential(credential, { linkPassword, mode } = {}) {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credential,
      linkPassword: linkPassword || undefined,
      mode: mode === 'signup' ? 'signup' : 'signin',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.ok) {
    const err = new Error(body?.error || `Google sign-in failed (${res.status})`);
    err.code = body?.code || 'VERIFY_FAILED';
    err.email = body?.email || '';
    throw err;
  }
  return body;
}
