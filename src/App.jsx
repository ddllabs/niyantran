import { useEffect, useState } from 'react';
import MarketingSite from './marketing/MarketingSite.jsx';
import TerminalShell from './shell/TerminalShell.jsx';
import AdminApp from './admin/AdminApp.jsx';
import { startSiteHead } from './lib/siteHead.js';
import { applyPersonaForUser, readPersonaId } from './lib/personas.js';
import PersonaChooser from './shell/PersonaChooser.jsx';
import { publishVerifiedSessionUser, sessionUser, subscribeLocalIdentity, userTypeOf } from './lib/userStore.js';
import { refreshEntitlement, serverEntitlement } from './lib/entitlementStore.js';
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
  // The terminal opens once the server has said which plan this account has
  // (F2): its desk routing would otherwise treat a paid account as free for
  // the first render and move it off a desk it may open.
  const [planReady, setPlanReady] = useState(() => Boolean(serverEntitlement(sessionUser()?.id)));

  useEffect(() => {
    if (!authed || planReady) return undefined;
    let live = true;
    refreshEntitlement().finally(() => {
      if (live) setPlanReady(true);
    });
    return () => {
      live = false;
    };
  }, [authed, planReady]);

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
        setPlanReady(false);
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

  if (admin) return <AdminApp />;

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
      <PersonaChooser
        onDone={() => {
          setChoosingPersona(false);
          setPersonaReady(ensurePersonaFromSession());
        }}
      />
    );
  }

  if (!planReady) {
    return (
      <div className="niy-plan-wait" role="status" aria-live="polite">
        Opening terminal…
      </div>
    );
  }

  // Persona is set at signup / restored on login, or chosen once above.
  if (!personaReady) ensurePersonaFromSession();

  return (
    <TerminalShell
      onLogout={() => {
        setAuthed(false);
        setPersonaReady(false);
        setPlanReady(false);
      }}
    />
  );
}
