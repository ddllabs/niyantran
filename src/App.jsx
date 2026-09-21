import { useEffect, useState } from 'react';
import MarketingSite from './marketing/MarketingSite.jsx';
import TerminalShell from './shell/TerminalShell.jsx';
import AdminApp from './admin/AdminApp.jsx';
import { startSiteHead } from './lib/siteHead.js';
import { hydrateAppFlags } from './lib/appFlagsStore.js';
import { applyPersonaForUser, readPersonaId } from './lib/personas.js';
import { sessionUser, userTypeOf } from './lib/userStore.js';
import './shell/onboarding.css';

function pathKey() {
  return location.pathname.replace(/\/+$/, '') || '/';
}

function isAdminPath() {
  return pathKey() === '/admin';
}

function isLegalPath() {
  const p = pathKey();
  return p === '/privacy' || p === '/terms';
}

function isMarketingOverlayPath() {
  const raw = String(location.hash || '')
    .replace(/^#/, '')
    .replace(/^\/+/, '')
    .toLowerCase();
  return raw.startsWith('pricing') || raw.startsWith('login') || raw.startsWith('signup');
}

function ensurePersonaFromSession() {
  if (readPersonaId()) return true;
  const user = sessionUser();
  if (!user) return false;
  const type = userTypeOf(user.personaId || user.type).id;
  applyPersonaForUser({ ...user, type, personaId: type });
  sessionStorage.setItem('niyantranLand', userTypeOf(type).startTab);
  return Boolean(readPersonaId());
}

export default function App() {
  const [admin, setAdmin] = useState(isAdminPath);
  const [legal, setLegal] = useState(isLegalPath);
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('niyantranAuthed') === '1');
  const [mktOverlay, setMktOverlay] = useState(isMarketingOverlayPath);
  const [personaReady, setPersonaReady] = useState(() => {
    if (sessionStorage.getItem('niyantranAuthed') !== '1') return Boolean(readPersonaId());
    return ensurePersonaFromSession();
  });

  useEffect(() => startSiteHead(), []);
  useEffect(() => {
    hydrateAppFlags().catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => {
      setAdmin(isAdminPath());
      setLegal(isLegalPath());
      setMktOverlay(isMarketingOverlayPath());
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  if (admin) return <AdminApp />;

  // A-10: pricing / login / signup hash must still resolve when already signed in.
  if (legal || !authed || mktOverlay) {
    return (
      <MarketingSite
        onAuthed={() => {
          setAuthed(true);
          setMktOverlay(false);
          setPersonaReady(ensurePersonaFromSession());
          const h = location.hash.toLowerCase();
          if (h.includes('login') || h.includes('signup') || h.includes('pricing')) {
            location.hash = '#/';
          }
        }}
      />
    );
  }

  // Persona is set at signup / restored on login — never prompt after sign-in.
  if (!personaReady) ensurePersonaFromSession();

  return (
    <TerminalShell
      onLogout={() => {
        setAuthed(false);
        setPersonaReady(false);
      }}
    />
  );
}
