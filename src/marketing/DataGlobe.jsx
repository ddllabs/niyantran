import { useEffect, useRef, useState } from 'react';
import { deskHash } from '../lib/deskHash.js';
import { sessionUser } from '../lib/userStore.js';
import { openGlobeDestination } from './globeDestinations.js';
import './nterGlobe.css';

/**
 * A label pick on the globe opens its desk or module (globeDestinations.js). The marketing pages are
 * shown signed out, so the visitor signs in first; a signed-in session (as on Pricing) goes straight
 * there through the hash.
 */
export function globeSelectHandler({ storage, signedIn, onLogin, setHash = (h) => { location.hash = h; } }) {
  return (e) => openGlobeDestination(e.detail?.key, {
    storage,
    signedIn: signedIn(),
    onLogin,
    navigate: (tab, feature) => setHash(deskHash(tab, feature)),
  });
}

const signedInNow = () => sessionStorage.getItem('niyantranAuthed') === '1' && Boolean(sessionUser());

/**
 * F141 (owner 2026-10-14): the client's orbiting data globe (F140), the one globe of the marketing
 * site. Its module loads after first paint. `onLogin` is where a signed-out label pick goes; by default
 * the sign-in page (the sign-in and sign-up pages pass their own, as the visitor is already there).
 */
/** Loads the globe module (after first paint) and listens for label picks; returns the detach. */
export function attachGlobe(el, { onSelect, importGlobe = () => import('./nterGlobe.js') }) {
  importGlobe().catch(() => {});
  el.addEventListener('data-select', onSelect);
  return () => el.removeEventListener('data-select', onSelect);
}

export default function DataGlobe({ onLogin }) {
  const globeRef = useRef(null);
  const loginRef = useRef(onLogin);
  loginRef.current = onLogin;
  // The globe moves on its own for longer than five seconds, so it keeps a pause control (WCAG 2.2.2),
  // as the old globe did; hover, focus, reduced motion and a hidden tab also pause it.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = globeRef.current;
    if (!el) return undefined;
    return attachGlobe(el, {
      onSelect: globeSelectHandler({
        storage: sessionStorage,
        signedIn: signedInNow,
        onLogin: () => (loginRef.current ? loginRef.current() : (location.hash = '#/login')),
      }),
    });
  }, []);
  const label = paused ? 'Resume globe' : 'Pause globe';
  return (
    <div className="nter-globe-scene">
      <nter-data-globe ref={globeRef} paused={paused ? '' : undefined} />
      <button type="button" className="data-globe-pause" aria-label={label} aria-pressed={paused} title={label} onClick={() => setPaused((v) => !v)}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
          {paused ? <path d="M3 1.5v9l7.5-4.5z" /> : <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" />}
        </svg>
      </button>
    </div>
  );
}
