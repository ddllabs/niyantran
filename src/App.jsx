import { lazy, Suspense, useEffect, useState } from 'react';
import MarketingSite from './marketing/MarketingSite.jsx';
import { isLegalPathname } from './marketing/legalRoutes.js';
import './shell/terminalStyles.js';
import { startSiteHead } from './lib/siteHead.js';
import { applyPersonaForUser, readPersonaId } from './lib/personas.js';
import { publishVerifiedSessionUser, sessionUser, subscribeLocalIdentity, userTypeOf } from './lib/userStore.js';
import { loadTerminal } from './lib/loadTerminal.js';
import './shell/onboarding.css';

// F145: the terminal, admin and persona chooser load on demand, so a signed-out visitor does not
// download them. Their stylesheets stay in the entry (terminalStyles.js), so the cascade is unchanged.
const TerminalShell = lazy(loadTerminal);
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));
const PersonaChooser = lazy(() => import('./shell/PersonaChooser.jsx'));
const loading = <div className="app-loading" aria-busy="true" />;

function pathKey() {
  return location.pathname.replace(/\/+$/, '') || '/';
}

function isAdminPath() {
  return pathKey() === '/admin';
}

function isLegalPath() {
  return isLegalPathname(pathKey());
}

function isMarketingOverlayPath() {
  const raw = String(location.hash || '')
    .replace(/^#/, '')
    .replace(/^\/+/, '')
    .toLowerCase();
  return (
    raw.startsWith('pricing') ||
    raw.startsWith('login') ||
    raw.startsWith('signup') ||
    raw.startsWith('forgot-password') ||
    raw.startsWith('reset-password') ||
    raw.includes('type=recovery') ||
    raw.includes('error_code=')
  );
}

/** Signed in means the session flag is set and a signed-in user is stored. */
function isSignedIn() {
  return sessionStorage.getItem('niyantranAuthed') === '1' && sessionUser() !== null;
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
  const [authed, setAuthed] = useState(isSignedIn);
  const [mktOverlay, setMktOverlay] = useState(isMarketingOverlayPath);
  // An account whose profile has no saved persona chooses one once; the
  // chooser saves it to the profile, so the question is not asked again.
  const needsPersona = () => isSignedIn() && sessionUser()?.personaSaved === false;
  const [choosingPersona, setChoosingPersona] = useState(needsPersona);
  const [personaReady, setPersonaReady] = useState(() => {
    if (!isSignedIn()) return Boolean(readPersonaId());
    return ensurePersonaFromSession();
  });
  useEffect(() => startSiteHead(), []);
  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeLocalIdentity((id) => {
      if (id) {
        setAuthed(true);
        setPersonaReady(ensurePersonaFromSession());
        // A Google OAuth return has a verified identity but no login form to
        // publish the session user. Leave the Auth callback first: calling Auth
        // methods from inside it can deadlock the client.
        if (!sessionUser()) {
          setTimeout(() => {
            publishVerifiedSessionUser().then((user) => {
              if (!mounted || !user) return;
              setAuthed(true);
              setChoosingPersona(needsPersona());
              setPersonaReady(ensurePersonaFromSession());
            });
          }, 0);
        }
      } else {
        setAuthed(false);
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
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

  if (admin) return <Suspense fallback={loading}><AdminApp /></Suspense>;

  // A-10: pricing / login / signup hash must still resolve when already signed in.
  if (legal || !authed || !isSignedIn() || mktOverlay) {
    return (
      <MarketingSite
        onAuthed={() => {
          setAuthed(true);
          setMktOverlay(false);
          setChoosingPersona(needsPersona());
          setPersonaReady(ensurePersonaFromSession());
          const h = location.hash.toLowerCase();
          if (h.includes('login') || h.includes('signup') || h.includes('pricing') || h.includes('forgot') || h.includes('reset')) {
            location.hash = '#/';
          }
        }}
      />
    );
  }

  if (choosingPersona) {
    return (
      <Suspense fallback={loading}>
        <PersonaChooser
          onDone={() => {
            setChoosingPersona(false);
            setPersonaReady(ensurePersonaFromSession());
          }}
        />
      </Suspense>
    );
  }

  // Persona is set at signup / restored on login, or chosen once above.
  if (!personaReady) ensurePersonaFromSession();

  return (
    <Suspense fallback={loading}>
      <TerminalShell
        onLogout={() => {
          setAuthed(false);
          setPersonaReady(false);
        }}
      />
    </Suspense>
  );
}
