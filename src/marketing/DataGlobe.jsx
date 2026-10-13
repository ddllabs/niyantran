import { useEffect, useRef } from 'react';
import { deskHash } from '../lib/deskRoute.js';
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
export default function DataGlobe({ onLogin }) {
  const globeRef = useRef(null);
  const loginRef = useRef(onLogin);
  loginRef.current = onLogin;
  useEffect(() => {
    import('./nterGlobe.js').catch(() => {});
    const el = globeRef.current;
    if (!el) return undefined;
    const onSelect = globeSelectHandler({
      storage: sessionStorage,
      signedIn: signedInNow,
      onLogin: () => (loginRef.current ? loginRef.current() : (location.hash = '#/login')),
    });
    el.addEventListener('data-select', onSelect);
    return () => el.removeEventListener('data-select', onSelect);
  }, []);
  return <div className="nter-globe-scene"><nter-data-globe ref={globeRef} /></div>;
}
