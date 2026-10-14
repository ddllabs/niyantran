import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bucketsFor, catalogModules, modulesForTier, TABS } from '../desks/catalog.js';
import HomeDesk from '../desks/HomeDesk.jsx';
import DeskView from '../desks/DeskView.jsx';
import DeskLandingView from '../desks/DeskLandingView.jsx';
import DeskNav from './DeskNav.jsx';
import DeskDirectory, { DeskLandingTabs } from './DeskDirectory.jsx';
import SidePanel, { useSidePanel } from './SidePanel.jsx';
import { deskHasRail, rowPicker } from './sidePanelModel.js';
import { Icon } from './Icons.jsx';
import { Moon, Sun } from 'lucide-react';
import { isConflictsFeature } from '../lib/conflictsMonitor.js';
import { isTransitFeature } from '../lib/transit.js';
import { isChokepointsFeature } from '../lib/strategicAssets.js';
import { isEnergyFeature } from '../lib/geonomics.js';
import { isNationalFullscreen, isImpactRecordFeature } from '../lib/national.js';
import { isGithubCsvRow } from '../lib/githubCsv.js';
import { deskHash, parseDeskHash, resolveDeskRoute, writeDeskHash } from '../lib/deskRoute.js';
import { kickHomeRefreshIfDue } from '../lib/homeCache.js';
import { clearSessionUser, sessionUser, userTypeOf } from '../lib/userStore.js';
import {
  canAccessDesk,
  entitlementOf,
  navTabsForUser,
  planOf,
} from '../lib/planEntitlements.js';
import { refreshEntitlement, subscribeEntitlement } from '../lib/entitlementStore.js';
import { OPEN_CONVERSATION_EVENT, OPEN_USAGE_EVENT, clearCredits } from '../lib/creditsStore.js';
import { setPageTitle } from '../lib/siteHead.js';
import { openInDesk, takePendingDeskRow } from '../ai/openRowSource.js';
import OnboardingTour from './OnboardingTour.jsx';
import PersonaChooser from './PersonaChooser.jsx';
import CreditsPage from './credits/CreditsPage.jsx';
import BalancePill from './credits/BalancePill.jsx';
import { ACCOUNT_SECTIONS, deskRouteFor, goAccount, parseAccountHash } from './credits/accountRoute.js';
import { OPEN_BILLING_EVENT } from '../ai/CreditBalance.jsx';
import LiveTvModal from './LiveTvModal.jsx';
import { clearPersonaPrefs } from '../lib/personas.js';
import { hydrateUserPrefs, startUserPrefsSync } from '../lib/userPrefsSync.js';
import './upgrade.css';
import DeskCatalogueSearch from './DeskCatalogueSearch.jsx';
import RestrictedDeskRoute from './RestrictedDeskRoute.jsx';
import { backFromRestrictedDesk, rememberDeskNavigation } from './deskRouteHistory.js';

export default function TerminalShell({ onLogout }) {
  const start = parseDeskHash();
  const [tab, setTab] = useState(start.tab);
  const [featureName, setFeatureName] = useState(start.feature);
  const [lang, setLang] = useState('en');
  const [theme, setTheme] = useState('light');
  const [feed, setFeed] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [vizFilter, setVizFilter] = useState(null);
  const [liveTvOpen, setLiveTvOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  // The credits page (F184): its section while open (#/account/<section>), else null.
  const [account, setAccount] = useState(() => parseAccountHash());
  const [userTick, setUserTick] = useState(0);
  const profileRef = useRef(null);
  const user = sessionUser();
  const typeId = userTypeOf(user?.type).id;
  const typeMeta = userTypeOf(typeId);
  const ent = entitlementOf(user);
  const planMeta = planOf(ent.plan);
  const deskTabs = navTabsForUser(user);
  const lockedIds = useMemo(() => new Set(), []);

  const active = deskTabs.find((t) => t.id === tab) || TABS.find((t) => t.id === tab) || TABS[0];
  const hi = lang === 'hi';
  const restricted = !canAccessDesk(user, tab);


  useEffect(() => {
    if (!profileOpen) return undefined;
    function onDoc(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setProfileOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [profileOpen]);

  useEffect(() => {
    startUserPrefsSync();
    hydrateUserPrefs().catch(() => {});
  }, []);

  // The credits page follows the address (F184): back, forward and bookmarks work as for desks.
  useEffect(() => {
    const sync = () => setAccount(parseAccountHash());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  // A plan chosen on the public pricing page while signed in opens Plan and invoices with it.
  useEffect(() => {
    const plan = sessionStorage.getItem('niyOpenBilling');
    if (plan === null) return;
    sessionStorage.removeItem('niyOpenBilling');
    goAccount('billing', { plan: plan || null });
  }, []);

  // The chat's Upgrade and Buy credits buttons open Plan and invoices (F111, F184).
  useEffect(() => {
    const onOpenBilling = (event) => goAccount('billing', { plan: event.detail?.plan ?? null });
    window.addEventListener(OPEN_BILLING_EVENT, onOpenBilling);
    return () => window.removeEventListener(OPEN_BILLING_EVENT, onOpenBilling);
  }, []);

  // The chat's Credits link opens the credits page's Overview (F153, F184).
  useEffect(() => {
    const onOpenUsage = () => goAccount('credits');
    window.addEventListener(OPEN_USAGE_EVENT, onOpenUsage);
    return () => window.removeEventListener(OPEN_USAGE_EVENT, onOpenUsage);
  }, []);

  // The plan comes from the server (F2). Re-read it when the terminal opens,
  // and re-render whenever it changes (a payment, a lapse).
  useEffect(() => {
    const unsubscribe = subscribeEntitlement(() => setUserTick((n) => n + 1));
    refreshEntitlement();
    return unsubscribe;
  }, []);

  const onFeed = useCallback(body => setFeed(body), []);
  // F135: with the panel collapsed, picking the selected row again reopens its record.
  const pickRef = useRef({});
  const onSelect = useMemo(() => rowPicker(() => pickRef.current, setSelected), []);
  const onLoading = useCallback((v) => setLoading(Boolean(v)), []);
  const onClearViz = useCallback(() => setVizFilter(null), []);
  const guideMode = tab !== 'home' && !String(featureName || '').trim();
  const v6Landing = guideMode && ['national', 'global', 'law', 'economics', 'carbon', 'sports', 'entertainment', 'state'].includes(tab);
  // Home is the default view: like a desk landing, it has no module row.
  const moduleNavigation = !v6Landing && tab !== 'home';
  const deskBuckets = useMemo(
    () => (tab === 'home' ? [] : bucketsFor(modulesForTier(active.tier), active.tier)),
    [tab, active.tier],
  );
  const activeModule = useMemo(() => {
    if (!featureName || tab === 'home') return null;
    return (
      modulesForTier(active.tier).find((m) => m.htmlFeature === featureName) ||
      catalogModules().find((m) => m.htmlFeature === featureName) ||
      null
    );
  }, [tab, active.tier, featureName]);
  const feedTier = activeModule?.htmlTier || active.tier;

  useEffect(() => {
    function onViz(e) {
      const it = e.detail;
      if (!it?.filterCol) {
        setVizFilter(null);
        return;
      }
      setVizFilter((prev) => {
        const next = {
          col: it.filterCol,
          value: it.filterValue || it.label,
          values: it.filterValues,
          map: it.filterMap,
        };
        const list = Array.isArray(prev) ? prev : prev?.col ? [prev] : [];
        const i = list.findIndex(
          (x) =>
            x.col === next.col &&
            String(x.value) === String(next.value) &&
            String(x.map || '') === String(next.map || ''),
        );
        if (i >= 0) {
          const out = list.filter((_, j) => j !== i);
          return out.length ? out : null;
        }
        return [...list, next];
      });
    }
    window.addEventListener('niy-viz-filter', onViz);
    return () => window.removeEventListener('niy-viz-filter', onViz);
  }, []);

  useEffect(() => {
    setVizFilter(null);
    setFeed(null);
    setSelected(null);
  }, [tab, featureName]);

  // A cited desk row's "Open in desk" (src/ai/openRowSource.js) routes here
  // through the hash and asks for the row to be selected once its feed lands.
  useEffect(() => {
    const row = takePendingDeskRow(feed, tab);
    if (row) setSelected(row);
  }, [feed, tab]);

  useEffect(() => {
    kickHomeRefreshIfDue();
    const id = setInterval(() => kickHomeRefreshIfDue(), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (account) {
      setPageTitle(`${ACCOUNT_SECTIONS.find((s) => s.id === account)?.label || 'Overview'} · Credits`);
      return;
    }
    const desk = active?.label || tab || 'Terminal';
    const feat = String(featureName || '').trim();
    setPageTitle(feat ? `${feat} · ${desk}` : desk === 'Home' ? 'Terminal' : desk);
  }, [account, tab, featureName, active?.label]);

  useEffect(() => {
    function onOpenLiveTv() {
      setLiveTvOpen(true);
    }
    function checkLiveTvHash() {
      if (typeof window !== 'undefined' && window.location.hash === '#livetv') {
        setLiveTvOpen(true);
      }
    }
    window.addEventListener('nter:open-livetv', onOpenLiveTv);
    window.addEventListener('hashchange', checkLiveTvHash);
    checkLiveTvHash();
    return () => {
      window.removeEventListener('nter:open-livetv', onOpenLiveTv);
      window.removeEventListener('hashchange', checkLiveTvHash);
    };
  }, []);

  useEffect(() => {
    if (!liveTvOpen) return undefined;
    function onDoc(e) {
      if (e.target?.closest?.('.tv-wrap') || e.target?.closest?.('.ltv-modal')) return;
      setLiveTvOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setLiveTvOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [liveTvOpen]);

  useEffect(() => {
    const land = sessionStorage.getItem('niyantranLand');
    const intendedFeat = sessionStorage.getItem('niyantranFeature');
    if (land) sessionStorage.removeItem('niyantranLand');
    if (intendedFeat) sessionStorage.removeItem('niyantranFeature');
    const hash = typeof location !== 'undefined' ? location.hash : '';
    // On the credits page the desk underneath keeps what it had, whatever re-runs this (F184 review).
    if (parseAccountHash(hash)) return;
    const emptyHash = !hash || hash === '#' || hash === '#/';
    let r = parseDeskHash();
    if (land && canAccessDesk(user, land) && emptyHash) {
      r = resolveDeskRoute(land, intendedFeat || '');
    }
    setTab(r.tab);
    setFeatureName(r.feature);
    if (r.tab === 'home' && emptyHash && r.tab === parseDeskHash().tab) return;
    writeDeskHash(r.tab, r.feature, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId, userTick]);

  useEffect(() => {
    function onPop() {
      // The credits page has its own address; the desk underneath keeps what it had (F184).
      const r = deskRouteFor();
      if (!r) return;
      setTab(r.tab);
      setFeatureName(r.feature);
      setSelected(null);
      setVizFilter(null);
    }
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    };
  }, [typeId]);

  const searchTabs = deskTabs;

  function onDesk(id) {
    setAccount(null);
    panel.act({ type: 'landing' });
    const r = resolveDeskRoute(id, '');
    setTab(r.tab);
    setFeatureName(r.feature);
    setSelected(null);
    rememberDeskNavigation(() => writeDeskHash(r.tab, r.feature));
  }

  function onFeature(name) {
    setAccount(null);
    const r = resolveDeskRoute(tab, name);
    setTab(r.tab);
    setFeatureName(r.feature);
    setSelected(null);
    rememberDeskNavigation(() => writeDeskHash(r.tab, r.feature));
  }

  function onOpen({ tab: nextTab, feature }) {
    setAccount(null);
    const r = resolveDeskRoute(nextTab, feature);
    setTab(r.tab);
    setFeatureName(r.feature);
    setSelected(null);
    rememberDeskNavigation(() => writeDeskHash(r.tab, r.feature));
  }

  const billRecordOpen = (isImpactRecordFeature(featureName) || isGithubCsvRow(selected)) && selected;
  const hasRail = deskHasRail({ restricted, tab, guideMode, featureName });
  const panel = useSidePanel({ hasRail, selected, featureName, tab, landing: guideMode || tab === 'home' });
  pickRef.current = { selected, panel };
  // An answer chosen on the credits page opens its conversation (F149): this shows the AI panel, wherever it was
  // (collapsed, on another tab, never opened); the research thread inside it selects the chat. From the
  // credits page it first goes back to the desk that was open, where the panel lives (F184).
  const openAi = panel.act;
  useEffect(() => {
    const onOpenConversation = () => {
      if (parseAccountHash()) {
        setAccount(null);
        location.hash = deskHash(tab, featureName);
      }
      openAi({ type: 'ai-open' });
    };
    window.addEventListener(OPEN_CONVERSATION_EVENT, onOpenConversation);
    return () => window.removeEventListener(OPEN_CONVERSATION_EVENT, onOpenConversation);
  }, [openAi, tab, featureName]);
  useEffect(() => {
    if (restricted) { setFeed(null); setSelected(null); setLoading(false); }
  }, [restricted]);
  const planLabel = planMeta?.name || String(ent.plan || 'free').toUpperCase();
  const statusLabel = ent.status === 'active' ? 'Active' : 'Free';

  function doLogout() {
    clearSessionUser();
    // The AI credit balance is this account's alone; nothing of it outlives the sign-out (F111 review R).
    clearCredits();
    clearPersonaPrefs();
    if (typeof location !== 'undefined') location.hash = '#/';
    onLogout?.();
  }

  return (
    <div className={`terminal with-v6-directory${moduleNavigation && !account ? ' with-module-navigation' : ''}${account ? ' with-credits-page' : ''} theme-${theme}`}>
      <div className={`load-bar${loading ? ' on' : ''}`} />
      <header className="topbar">
        <div className="brand" title="Niyantran Terminal">
          <img src="/brand/logo-128.webp" alt="" />
          <span>TERMINAL</span>
        </div>
        <DeskLandingTabs tab={tab} lang={lang} tabs={deskTabs} onDesk={onDesk}/>
        <div className="shell-header-utilities">
        <DeskDirectory tab={tab} lang={lang} tabs={deskTabs} lockedIds={lockedIds} onDesk={onDesk}/>
        <DeskCatalogueSearch key={`${user?.id || user?.email || ""}:${userTick}`} tabs={deskTabs} recordTabs={searchTabs} lockedIds={[...lockedIds]}
          identity={`${user?.id || user?.email || ''}:${userTick}`} lang={lang}
          onOpen={hit => {
            onOpen({ tab: hit.tab, feature: hit.feature });
            if (hit.kind === 'record') {
              openInDesk({ ...hit, kind: 'row', tier: hit.tab });
              setReload(value => value + 1);
            }
          }} />
        <div className="top-actions">
          <button type="button" className="icon-btn" onClick={() => setLang(hi ? 'en' : 'hi')}>
            {hi ? 'HI' : 'EN'}
          </button>
          <div className="tv-wrap">
            <button
              type="button"
              className="tv-btn"
              onClick={() => {
                setProfileOpen(false);
                setLiveTvOpen((v) => !v);
              }}
              title="Open Live TV Intelligence Stream & Broadcasts"
              aria-expanded={liveTvOpen}
            >
              <span className="live-dot" />
              LIVE TV
            </button>
            <LiveTvModal
              open={liveTvOpen}
              onClose={() => setLiveTvOpen(false)}
              onNavigateDesk={(deskTab, feature) => onOpen({ tab: deskTab, feature: feature || '' })}
            />
          </div>
          {/* Owner 2026-10-13: the same header on every page. A landing's refresh remounts it, so its
              summaries are requested again. */}
          <button
            type="button"
            className={`icon-btn${loading ? ' spin' : ''}`}
            onClick={() => setReload((n) => n + 1)}
            title={v6Landing ? 'Refresh desk summaries' : 'Refresh feed'}
            aria-label={v6Landing ? 'Refresh desk summaries' : 'Refresh feed'}
          >
            <Icon name="refresh" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title={theme === 'light' ? hi ? 'डार्क मोड पर जाएँ' : 'Switch to dark mode' : hi ? 'लाइट मोड पर जाएँ' : 'Switch to light mode'}
            aria-label={theme === 'light' ? hi ? 'डार्क मोड पर जाएँ' : 'Switch to dark mode' : hi ? 'लाइट मोड पर जाएँ' : 'Switch to light mode'}
          >
            {theme === 'light' ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
          </button>
          <BalancePill user={user} />
          <div className="profile-wrap" ref={profileRef}>
            <button
              type="button"
              className={`avatar-btn${profileOpen ? ' on' : ''}`}
              onClick={() => {
                setLiveTvOpen(false);
                setProfileOpen((v) => !v);
              }}
              aria-expanded={profileOpen}
              aria-haspopup="dialog"
              title={user?.name || user?.email || 'Profile'}
            >
              <span className="avatar">{(user?.name || user?.email || 'A').charAt(0).toUpperCase()}</span>
            </button>
            {profileOpen ? (
              <div className="profile-pop" role="dialog" aria-label="Account">
                <div className="profile-pop-head">
                  <span className="avatar lg">{(user?.name || user?.email || 'A').charAt(0).toUpperCase()}</span>
                  <div className="profile-pop-id">
                    <strong>{user?.name || 'Analyst'}</strong>
                    <span>{user?.email || '—'}</span>
                  </div>
                </div>
                <dl className="profile-pop-meta">
                  <div>
                    <dt>Persona</dt>
                    <dd>{typeMeta.label}</dd>
                  </div>
                  <div>
                    <dt>Package</dt>
                    <dd>
                      {planLabel}
                      {ent.status === 'active' && ent.periodEnd
                        ? ` · to ${new Date(ent.periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                        : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{statusLabel}</dd>
                  </div>
                  {user?.authProvider ? (
                    <div>
                      <dt>Sign-in</dt>
                      <dd>{user.authProvider === 'google' ? 'Google' : 'Email'}</dd>
                    </div>
                  ) : null}
                </dl>
                {planMeta?.tag ? <p className="profile-pop-tag">{planMeta.tag}</p> : null}
                <div className="profile-pop-actions">
                  <button
                    type="button"
                    className="profile-pop-upgrade"
                    onClick={() => {
                      setProfileOpen(false);
                      goAccount('credits');
                    }}
                  >
                    Credits
                  </button>
                  <button
                    type="button"
                    className="profile-pop-persona"
                    onClick={() => {
                      setProfileOpen(false);
                      setPersonaOpen(true);
                    }}
                  >
                    Change persona
                  </button>
                  <button type="button" className="logout-btn" onClick={doLogout}>
                    Log out
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <button type="button" className="logout-btn" onClick={doLogout}>
            Log out
          </button>
        </div>
        </div>
      </header>
      {/* F184: the credits page takes the work area; the desk stays mounted underneath, hidden, so the
          AI panel keeps its thread, draft and any answer still streaming (SidePanel.jsx). */}
      {account ? <CreditsPage section={account} user={user} ent={ent} /> : null}
      {moduleNavigation && !account && <DeskNav
        tab={tab}
        featureName={featureName}
        lang={lang}
        onDesk={onDesk}
        onFeature={onFeature}
        tabs={deskTabs}
        lockedIds={lockedIds}
      />}
      <div className={`workspace${restricted ? ' restricted-workspace' : ''}${tab === 'home' ? ' home' : ''}${guideMode ? ' desk-guide-mode' : ''}${isConflictsFeature(featureName) ? ' conflicts-holistic' : ''}${isChokepointsFeature(featureName) || isEnergyFeature(featureName) || isNationalFullscreen(featureName) ? ' choke-holistic' : ''}${isTransitFeature(featureName) ? ' transit-map' : ''}${isNationalFullscreen(featureName) ? ' pig-holistic' : ''}${billRecordOpen ? ' bill-record' : ''}${panel.aiOpen ? ' ai-open' : ''}${panel.collapsed ? ' panel-collapsed' : ''}`} style={panel.width ? { '--panel-chosen': `${panel.width}px` } : undefined} hidden={account ? true : undefined}>
        <main className="main-col">
          {restricted ? (
            <RestrictedDeskRoute desk={hi ? active.labelHi : active.label} feature={featureName} lang={lang}
              onAccess={doLogout}
              onBack={() => backFromRestrictedDesk(() => onDesk('home'))}/>
          ) : tab === 'home' ? (
            <HomeDesk onOpen={onOpen} onFeed={onFeed} onSelect={onSelect} onLoading={onLoading} reload={reload} />
          ) : guideMode ? (
            <DeskLandingView
              key={`${tab}:${reload}`}
              tab={tab}
              label={hi ? active.labelHi : active.label}
              buckets={deskBuckets}
              onFeature={onFeature}
              lang={lang}
            />
          ) : (
            <DeskView
              key={`${feedTier}:${featureName}`}
              tier={feedTier}
              featureName={featureName}
              onFeed={onFeed}
              selected={selected}
              onSelect={onSelect}
              onLoading={onLoading}
              reload={reload}
              vizFilter={vizFilter}
              onClearViz={onClearViz}
            />
          )}
        </main>
        {!restricted && <SidePanel
          panel={panel}
          hasRail={hasRail}
          feed={feed}
          selected={selected}
          onSelect={onSelect}
          lang={lang}
          loading={loading}
          vizFilter={vizFilter}
          tab={tab}
          featureName={featureName}
        />}
      </div>
      {!restricted && !account && (tab === 'home' ? <OnboardingTour kind="home" /> : <OnboardingTour kind="desk" deskId={tab} />)}
      {personaOpen ? (
        <PersonaChooser
          onCancel={() => setPersonaOpen(false)}
          onDone={() => {
            setPersonaOpen(false);
            setUserTick((n) => n + 1);
          }}
        />
      ) : null}

    </div>
  );
}
