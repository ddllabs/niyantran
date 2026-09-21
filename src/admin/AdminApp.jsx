import { useEffect, useRef, useState } from 'react';
import AdminLogin from './AdminLogin.jsx';
import { createAdminSession } from './adminSession.js';
import { supabase } from '../lib/supabaseClient.js';
import { ApisPage, OverviewPage, PricingAdminPage, UsersPage } from './AdminPages.jsx';
import { AiModelsPage } from './AiModelsPage.jsx';
import { AiPersonasPage } from './AiPersonasPage.jsx';
import { PrivacyAdminPage, SiteSettingsPage, TermsAdminPage } from './AdminSitePages.jsx';
import { hydrateUsersFromServer, loadUsers } from '../lib/userStore.js';
import { isDue, loadRefreshCfg, refreshProgress } from '../lib/refreshStore.js';
import { sweepApis } from '../lib/refreshFeeds.js';
import './admin.css';

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'apis', label: 'API status' },
  { id: 'users', label: 'Users' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'ai', label: 'AI models' },
  { id: 'personas', label: 'AI personas' },
  { id: 'site', label: 'Website' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Terms' },
];

function viewFromHash() {
  const raw = String(location.hash || '')
    .replace(/^#/, '')
    .replace(/^\/+/, '')
    .toLowerCase();
  if (NAV.some((n) => n.id === raw)) return raw;
  return 'overview';
}

export default function AdminApp() {
  const [access, setAccess] = useState({ status: 'checking', user: null });
  const adminSession = useRef(null);
  const verifiedUserId = useRef(null);
  const authed = access.status === 'verified';
  const [view, setView] = useState(viewFromHash);
  const [users, setUsers] = useState([]);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const session = createAdminSession(supabase, (state) => {
      verifiedUserId.current = state.status === 'verified' ? state.user.id : null;
      setAccess(state);
      if (state.status !== 'verified') {
        setUsers([]);
        setNavOpen(false);
      }
    });
    adminSession.current = session;
    const recheck = () => { void session.refresh(); };
    recheck();
    window.addEventListener('focus', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      session.dispose();
      adminSession.current = null;
      verifiedUserId.current = null;
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('adm-doc');
    document.body.classList.add('adm-doc');
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => {
      document.documentElement.classList.remove('adm-doc');
      document.body.classList.remove('adm-doc');
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  useEffect(() => {
    if (!authed) return undefined;
    let alive = true;
    hydrateUsersFromServer().then((list) => {
      if (alive && verifiedUserId.current === access.user.id) setUsers(list);
    });
    return () => {
      alive = false;
    };
  }, [authed, access.user?.id]);

  useEffect(() => {
    if (!authed) return undefined;
    function tick() {
      const cfg = loadRefreshCfg();
      if (!cfg.auto) return;
      if (refreshProgress().running) return;
      if (isDue()) sweepApis({ scope: 'live' });
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [authed, access.user?.id]);

  useEffect(() => {
    if (!navOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') setNavOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  function go(id) {
    const hash = `#${id}`;
    if (location.hash !== hash) location.hash = hash;
    else setView(id);
    setNavOpen(false);
  }

  function refreshUsers() {
    if (authed && verifiedUserId.current === access.user.id) setUsers(loadUsers());
  }

  if (!authed) return <AdminLogin
    checking={access.status === 'checking'}
    message={access.message}
    onOk={() => { void adminSession.current?.resume(); }}
  />;

  return (
    <div className={`adm${navOpen ? ' nav-open' : ''}`}>
      <div className="adm-bg" aria-hidden="true">
        <span className="blob navy" />
        <span className="blob sand" />
        <span className="blob purple" />
        <span className="blob red" />
      </div>
      <span className="adm-scan" aria-hidden="true" />
      <button type="button" className="adm-scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />
      <aside className="adm-side">
        <div className="adm-brand">
          <img src="/brand/logo.png?v=2" alt="" />
          <div>
            <b>TERMINAL</b>
            <span>CONTROL PLANE</span>
          </div>
        </div>
        <nav className="adm-nav">
          {NAV.map((n) => (
            <button key={n.id} type="button" className={view === n.id ? 'on' : ''} onClick={() => go(n.id)}>
              <i />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="adm-side-foot">
          <button
            type="button"
            onClick={() => { void adminSession.current?.signOut(); }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="adm-main">
        <header className="adm-top">
          <button type="button" className="adm-menu-btn" aria-label="Open menu" aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <p className="adm-kicker">
            <span className="live">● LIVE</span>
            ADMIN
            <span className="sys">SYS/READY_</span>
          </p>
          <div className="adm-top-nav">
            {NAV.map((n) => (
              <button key={n.id} type="button" className={`adm-chip${view === n.id ? ' on' : ''}`} onClick={() => go(n.id)}>
                {n.label}
              </button>
            ))}
          </div>
          <span className="adm-top-meta">{users.filter((u) => u.active).length} issued seats</span>
        </header>
        <div className="adm-body">
          {view === 'overview' && <OverviewPage users={users} />}
          {view === 'apis' && <ApisPage />}
          {view === 'users' && <UsersPage users={users} onChange={refreshUsers} />}
          {view === 'pricing' && <PricingAdminPage />}
          {view === 'ai' && <AiModelsPage />}
          {view === 'personas' && <AiPersonasPage />}
          {view === 'site' && <SiteSettingsPage />}
          {view === 'privacy' && <PrivacyAdminPage />}
          {view === 'terms' && <TermsAdminPage />}
        </div>
      </div>
    </div>
  );
}
