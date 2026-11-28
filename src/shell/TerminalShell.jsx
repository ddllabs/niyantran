import RecordFocus from './RecordFocus.jsx';
import { clearWorkspace, workspaceScopeKey, readWorkspace, writeWorkspace } from './workspaceState.js';
import { deskRowKey } from '../lib/deskRows.js';
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bucketsFor, catalogModules, modulesForTier, TABS } from '../desks/catalog.js';
const HomeDesk = lazy(() => import('../desks/HomeDesk.jsx'));
const DeskView = lazy(() => import('../desks/DeskView.jsx'));
const DeskLandingView = lazy(() => import('../desks/DeskLandingView.jsx'));
import DeskNav from './DeskNav.jsx';
import DeskRail from './DeskRail.jsx';
import DeskDirectory, { DeskLandingTabs } from './DeskDirectory.jsx';
import SidePanel, { useSidePanel } from './SidePanel.jsx';
import { deskHasRail, rowPicker } from './sidePanelModel.js';
import { Icon } from './Icons.jsx';
import { Folder, Moon, Sun } from 'lucide-react';
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
import { refreshEntitlement, watchEntitlementTransitions } from '../lib/entitlementStore.js';
import { OPEN_CONVERSATION_EVENT, clearCredits, refreshCredits } from '../lib/creditsStore.js';
import { setPageTitle } from '../lib/siteHead.js';
import { applyInterfaceLang } from './interfaceLang.js';
import { openInDesk, pendingDeskRow, takePendingDeskRow } from '../ai/openRowSource.js';
import OnboardingTour from './OnboardingTour.jsx';
import PersonaChooser from './PersonaChooser.jsx';
const CreditsPage = lazy(() => import('./credits/CreditsPage.jsx'));
const FileManagerShell = lazy(() => import('../fileManager/FileManagerShell.jsx'));
const PlanChangeDialog = lazy(() => import('./PlanChangeDialog.jsx'));
import LazyView from './LazyView.jsx';
import ProfileCredits from './credits/BalancePill.jsx';
import { ACCOUNT_SECTIONS, deskRouteFor, goAccount, parseAccountHash } from './credits/accountRoute.js';
import { OPEN_BILLING_EVENT } from '../ai/CreditBalance.jsx';
const LiveTvPage = lazy(() => import('./LiveTvPage.jsx'));
import { backFromLiveTv, goLiveTv, parseLiveTvHash, watchLiveTv } from './liveTvRoute.js';
import { clearPersonaPrefs } from '../lib/personas.js';
import { hydrateUserPrefs, startUserPrefsSync } from '../lib/userPrefsSync.js';
import './upgrade.css';
import './command-search.css';
import './deskCatalogueSearch.css';
const DeskCatalogueSearch = lazy(() => import('./DeskCatalogueSearch.jsx'));
import RestrictedDeskRoute from './RestrictedDeskRoute.jsx';
import { backFromRestrictedDesk, rememberDeskNavigation } from './deskRouteHistory.js';
import MobileBottomNav from './MobileBottomNav.jsx';
import MobileHeader from './MobileHeader.jsx';
import './mobileNav.css';

export default function TerminalShell({ onLogout }) {
  const start = parseDeskHash();
  const user = sessionUser();
  const [tab, setTab] = useState(start.tab);
  const [featureName, setFeatureName] = useState(start.feature);
  const workspace = workspaceScopeKey(user?.id || user?.email, `${start.tab}:${start.feature}`);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [lang, setLang] = useState('en');
  const [theme, setTheme] = useState('light');
  const [feed, setFeed] = useState(null);
  const [selected, setSelected] = useState(null);
  const [recordFocus, setRecordFocus] = useState(null);
  const onReveal = useCallback(row => setRecordFocus({ row }), []);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [vizFilter, setVizFilter] = useState(null);
  // Live TV (F359) is a page at #/livetv: open exactly while the address names it. Once visited it stays
  // mounted (drawing nothing while closed) so the chosen channel is kept.
  const [liveTvOpen, setLiveTvOpen] = useState(() => parseLiveTvHash());
  const [liveTvVisited, setLiveTvVisited] = useState(() => parseLiveTvHash());
  const [profileOpen, setProfileOpen] = useState(false);
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(() => typeof location !== 'undefined' && location.hash === '#/files');
  // The credits page (F184): its section while open (#/account/<section>), else null.
  const [account, setAccount] = useState(() => parseAccountHash());
  // F195: the desk rail on module pages, open (names, over the page; a drawer on phones) or not.
  const [railOpen, setRailOpen] = useState(false);
  const [aiMode, setAiMode] = useState('chat');
  const [userTick, setUserTick] = useState(0);
  const typeId = userTypeOf(user?.type).id;
  const typeMeta = userTypeOf(typeId);
  const ent = entitlementOf(user);
  const planMeta = planOf(ent.plan);
  const deskTabs = navTabsForUser(user);
  const lockedIds = useMemo(() => new Set(), []);

  const active = deskTabs.find((t) => t.id === tab) || TABS.find((t) => t.id === tab) || TABS[0];
  const hi = lang === 'hi';
  const restricted = !canAccessDesk(user, tab);

  // F192: saves and restores the lang that siteHead set; App's siteHead effect runs first because
  // the shell is lazy-loaded.
  useEffect(() => applyInterfaceLang(document.documentElement, lang), [lang]);


  useEffect(() => {
    startUserPrefsSync();
    hydrateUserPrefs().catch(() => {});
  }, []);

  // The credits page follows the address (F184): back, forward and bookmarks work as for desks.
  useEffect(() => {
    const sync = () => {
      setAccount(parseAccountHash());
      if (typeof location !== 'undefined') {
        setFilesOpen(location.hash === '#/files');
      }
    };
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

  // The plan comes from the server (F2). Re-read it when the terminal opens,
  // and re-render whenever it changes (a payment, a lapse).
  useEffect(() => {
    const unsubscribe = watchEntitlementTransitions(() => setUserTick((n) => n + 1), refreshCredits);
    refreshEntitlement();
    return unsubscribe;
  }, []);

  const onFeed = useCallback(body => setFeed(body), []);
  // F135: with the panel collapsed, picking the selected row again reopens its record.
  const pickRef = useRef({});
  const onSelect = useMemo(() => {
    const pick = rowPicker(() => pickRef.current, setSelected);
    return (row, options) => {
      if (row || options?.toggled) writeWorkspace(workspaceRef.current, 'selected', row ? deskRowKey(row) : '');
      pick(row, options);
    };
  }, []);
  const onLoading = useCallback((v) => setLoading(Boolean(v)), []);
  const onClearViz = useCallback(() => { writeWorkspace(workspaceRef.current, 'vizFilter', null); setVizFilter(null); }, []);
  const guideMode = tab !== 'home' && !String(featureName || '').trim();
  const v6Landing = guideMode && ['national', 'global', 'law', 'economics', 'carbon', 'sports', 'entertainment', 'state'].includes(tab);
  // Home is the default view: like a desk landing, it has no module row.
  // Live TV (F359) takes the work area as the credits page does: no module row, no rail.
  const moduleNavigation = !v6Landing && tab !== 'home' && !liveTvOpen;
  // F195 review: any change of page closes the rail, however it came (back, a category, search, the
  // credits page); an open overlay is not carried to the next page.
  const railRoute = `${tab}|${featureName || ''}|${account || ''}`;
  const [railSeen, setRailSeen] = useState(railRoute);
  if (railSeen !== railRoute) {
    setRailSeen(railRoute);
    setRailOpen(false);
  }
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
        writeWorkspace(workspaceRef.current, 'vizFilter', null);
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
          const result = out.length ? out : null;
          writeWorkspace(workspaceRef.current, 'vizFilter', result);
          return result;
        }
        const result = [...list, next];
        writeWorkspace(workspaceRef.current, 'vizFilter', result);
        return result;
      });
    }
    window.addEventListener('niy-viz-filter', onViz);
    return () => window.removeEventListener('niy-viz-filter', onViz);
  }, []);

  useEffect(() => {
    setRecordFocus(null);
    setVizFilter(readWorkspace(workspace, 'vizFilter', null));
    setFeed(null);
    setSelected(null);
  }, [tab, featureName, workspace]);

  useEffect(() => {
    const pane = document.querySelector('.main-col');
    if (!pane) return undefined;
    const save = event => {
      let node = event.target;
      const path = [];
      while (node && node !== pane) { path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node)); node = node.parentElement; }
      if (node !== pane) return;
      const positions = readWorkspace(workspace, 'scroll', {});
      writeWorkspace(workspace, 'scroll', { ...positions, [path.join('.')]: { top: event.target.scrollTop, left: event.target.scrollLeft } });
    };
    pane.addEventListener('scroll', save, { passive: true, capture: true });
    return () => pane.removeEventListener('scroll', save, true);
  }, [workspace]);

  useEffect(() => {
    if (!feed || loading || feed.feature !== featureName) return;
    const pane = document.querySelector('.main-col');
    if (pane) for (const [path, position] of Object.entries(readWorkspace(workspace, 'scroll', {}))) {
      const node = path ? path.split('.').reduce((parent, index) => parent?.children[Number(index)], pane) : pane;
      if (node) { node.scrollTop = position.top; node.scrollLeft = position.left; }
    }
    const key = readWorkspace(workspace, 'selected', '');
    const row = feed.rows?.find(row => deskRowKey(row) === key);
    if (row) setSelected(row);
  }, [workspace, feed, loading, featureName]);

  // A cited desk row's "Open in desk" (src/ai/openRowSource.js) routes here
  // through the hash and asks for the row to be selected once its feed lands.
  useEffect(() => {
    const pending = pendingDeskRow();
    const row = takePendingDeskRow(feed, tab);
    if (row) { setSelected(row); setRecordFocus({ row }); writeWorkspace(workspace, 'selected', deskRowKey(row)); }
    else if (pending && pending.tab === tab && pending.feature === feed?.feature && !feed.paged) setRecordFocus({ row: null });
  }, [feed, tab, workspace]);

  useEffect(() => {
    kickHomeRefreshIfDue();
    const id = setInterval(() => kickHomeRefreshIfDue(), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (liveTvOpen) {
      setPageTitle('Live TV');
      return;
    }
    if (account) {
      setPageTitle(`${ACCOUNT_SECTIONS.find((s) => s.id === account)?.label || 'Overview'} · Credits`);
      return;
    }
    const desk = active?.label || tab || 'Terminal';
    const feat = String(featureName || '').trim();
    setPageTitle(feat ? `${feat} · ${desk}` : desk === 'Home' ? 'Terminal' : desk);
  }, [liveTvOpen, account, tab, featureName, active?.label]);

  // The address #/livetv (or the old #livetv, or the nter:open-livetv event) opens the page; any other
  // address closes it. Leaving ends a running fact-check session (the hook sees open go false).
  useEffect(() => watchLiveTv((open) => {
    if (open) { setLiveTvVisited(true); setRailOpen(false); }
    setLiveTvOpen(open);
  }), []);

  useEffect(() => {
    const land = sessionStorage.getItem('niyantranLand');
    const intendedFeat = sessionStorage.getItem('niyantranFeature');
    if (land) sessionStorage.removeItem('niyantranLand');
    if (intendedFeat) sessionStorage.removeItem('niyantranFeature');
    const hash = typeof location !== 'undefined' ? location.hash : '';
    // On the credits page the desk underneath keeps what it had, whatever re-runs this (F184 review).
    if (parseAccountHash(hash)) return;
    const emptyHash = !hash || hash === '#' || hash === '#/';
    if (parseLiveTvHash(hash)) return; // likewise on Live TV
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
      // The credits page and Live TV have their own addresses; the desk underneath keeps what it had (F184, F359).
      const r = deskRouteFor();
      if (!r) return;
      if (parseLiveTvHash()) return; // Live TV is no desk either
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
    setLiveTvOpen(false);
    panel.act({ type: 'landing' });
    const r = resolveDeskRoute(id, '');
    setTab(r.tab);
    setFeatureName(r.feature);
    setSelected(null);
    rememberDeskNavigation(() => writeDeskHash(r.tab, r.feature));
  }

  function onFeature(name) {
    setAccount(null);
    setLiveTvOpen(false);
    const r = resolveDeskRoute(tab, name);
    setTab(r.tab);
    setFeatureName(r.feature);
    setSelected(null);
    rememberDeskNavigation(() => writeDeskHash(r.tab, r.feature));
  }

  function onOpen({ tab: nextTab, feature }) {
    setAccount(null);
    setLiveTvOpen(false);
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

  // F416: "Ask AI" from the file manager (niy-ai-open) opens the AI panel underneath the file manager's full-page overlay;
  // close the overlay so the panel is seen, and put the desk's address back with replaceState. Writing '#/' instead would
  // fire a hashchange, which clears the selection the panel was opened with.
  useEffect(() => {
    const onAiOpen = () => {
      if (typeof location !== 'undefined' && location.hash === '#/files') writeDeskHash(tab, featureName, { replace: true });
      setFilesOpen(false);
    };
    window.addEventListener('niy-ai-open', onAiOpen);
    return () => window.removeEventListener('niy-ai-open', onAiOpen);
  }, [tab, featureName]);

  useEffect(() => {
    const onAiMode = (e) => {
      const mode = e.detail?.mode;
      if (mode === 'chat' || mode === 'work') {
        setAiMode(mode);
        if (!panel.aiOpen) {
          openAi({ type: 'ai-open' });
        }
      }
    };
    window.addEventListener('niy-ai-mode', onAiMode);
    return () => window.removeEventListener('niy-ai-mode', onAiMode);
  }, [openAi, panel.aiOpen]);
  useEffect(() => {
    if (restricted) { setFeed(null); setSelected(null); setLoading(false); }
  }, [restricted]);
  const planLabel = planMeta?.name || String(ent.plan || 'free').toUpperCase();
  const statusLabel = ent.inGrace ? 'Renewal grace' : ent.status === 'active' ? 'Active' : 'Free';

  // Back from Live TV: one step back in history when the page was entered from inside the app, else the default desk.
  const onLiveTvBack = () => backFromLiveTv(() => onDesk('home'));

  function doLogout() {
    clearWorkspace();
    clearSessionUser();
    // The AI credit balance is this account's alone; nothing of it outlives the sign-out (F111 review R).
    clearCredits();
    clearPersonaPrefs();
    if (typeof location !== 'undefined') location.hash = '#/';
    onLogout?.();
  }

  return (
    <div className={`terminal with-v6-directory${moduleNavigation && !account ? ' with-module-navigation with-desk-rail' : ''}${account ? ' with-credits-page' : ''}${liveTvOpen ? ' with-livetv-page' : ''}${panel.aiOpen ? ' ai-open' : ''} theme-${theme}`}>
      <div className={`load-bar${loading ? ' on' : ''}`} />
      <MobileHeader
        activeMode={aiMode}
        onModeChange={(mode) => {
          setAiMode(mode);
          if (!panel.aiOpen) {
            openAi({ type: 'ai-open' });
          }
        }}
        onOpenNav={() => setRailOpen(true)}
        lang={lang}
      />
      <header className="topbar">
        <div className="brand" title="Niyantran Terminal">
          <img src="/brand/logo-128.webp" alt="" />
          <span>TERMINAL</span>
        </div>
        {/* F195: inside a desk the desks are the left rail; the header keeps them everywhere else. */}
        {moduleNavigation && !account ? null : <DeskLandingTabs tab={liveTvOpen ? null : tab} lang={lang} tabs={deskTabs} onDesk={onDesk}/>}
        <div className="shell-header-utilities">
        <DeskDirectory tab={liveTvOpen ? null : tab} lang={lang} tabs={deskTabs} lockedIds={lockedIds} onDesk={onDesk}/>
        <LazyView><DeskCatalogueSearch key={`${user?.id || user?.email || ""}:${userTick}`} tabs={deskTabs} recordTabs={searchTabs} lockedIds={[...lockedIds]}
          identity={`${user?.id || user?.email || ''}:${userTick}`} lang={lang}
          onOpen={hit => {
            onOpen({ tab: hit.tab, feature: hit.feature });
            if (hit.kind === 'record') {
              openInDesk({ ...hit, kind: 'row', tier: hit.tab });
              setReload(value => value + 1);
            }
          }} /></LazyView>
        <div className="top-actions">
          <button
            type="button"
            className="icon-btn"
            title={hi ? 'HI, इंटरफ़ेस अंग्रेज़ी में बदलें' : 'EN, switch the interface to Hindi'}
            aria-label={hi ? 'HI, इंटरफ़ेस अंग्रेज़ी में बदलें' : 'EN, switch the interface to Hindi'}
            onClick={() => setLang(hi ? 'en' : 'hi')}
          >
            {hi ? 'HI' : 'EN'}
          </button>
          <div className="tv-wrap">
            <button
              type="button"
              className="tv-btn"
              onClick={() => {
                setProfileOpen(false);
                goLiveTv();
              }}
              title="Open Live TV Intelligence Stream & Broadcasts"
              aria-current={liveTvOpen ? 'page' : undefined}
            >
              <span className="live-dot" />
              LIVE TV
            </button>
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
          <button
            type="button"
            className={`icon-btn${filesOpen ? ' on' : ''}`}
            onClick={() => {
              setFilesOpen((f) => {
                const next = !f;
                if (typeof location !== 'undefined') {
                  location.hash = next ? '#/files' : '#/';
                }
                return next;
              });
            }}
            title={hi ? 'निजी फ़ाइलें और ज्ञान' : 'Private Files & Knowledge'}
            aria-label="Private Files"
          >
            <Folder size={16} aria-hidden="true" />
          </button>
          <ProfileCredits user={user} open={profileOpen} setOpen={setProfileOpen} activePlan={ent.status === 'active' && !ent.lapsed ? ent.plan : null}>
            {(glance) => <>
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
                      {ent.inGrace && ent.graceUntil ? ` · access until ${new Date(ent.graceUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` : ent.status === 'active' && ent.periodEnd
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
                {glance}
                <div className="profile-pop-actions">
                  <button type="button" className="profile-pop-upgrade" onClick={() => { setProfileOpen(false); setPlanPickerOpen(true); }}>
                    Change plan
                  </button>
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
                    className="profile-pop-upgrade"
                    onClick={() => {
                      setProfileOpen(false);
                      setFilesOpen(true);
                      if (typeof location !== 'undefined') location.hash = '#/files';
                    }}
                  >
                    Files
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
            </>}
          </ProfileCredits>
          <button type="button" className="logout-btn" onClick={doLogout}>
            Log out
          </button>
        </div>
        </div>
      </header>
      {planPickerOpen ? <LazyView><PlanChangeDialog ent={ent} onClose={() => setPlanPickerOpen(false)} onReview={plan => {
        setPlanPickerOpen(false);
        goAccount('billing', { plan });
      }} /></LazyView> : null}
      {/* F184: the credits page takes the work area; the desk stays mounted underneath, hidden, so the
          AI panel keeps its thread, draft and any answer still streaming (SidePanel.jsx). */}
      {account ? <LazyView><CreditsPage section={account} user={user} ent={ent} /></LazyView> : null}
      {/* F359: Live TV takes the work area the same way; once visited it stays mounted and draws nothing
          while another page is open, so the video stops and the chosen channel is kept. */}
      {liveTvVisited ? <LazyView><LiveTvPage
        open={liveTvOpen}
        onClose={onLiveTvBack}
        onNavigateDesk={(deskTab, feature) => onOpen({ tab: deskTab, feature: feature || '' })}
      /></LazyView> : null}
      {filesOpen ? (
        <LazyView>
          <div className="files-workbench-overlay" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg-primary, #0c0d0e)' }}>
            <FileManagerShell onClose={() => {
              setFilesOpen(false);
              if (typeof location !== 'undefined' && location.hash === '#/files') {
                location.hash = '#/';
              }
            }} />
          </div>
        </LazyView>
      ) : null}
      {(railOpen || (moduleNavigation && !account)) && <DeskRail tab={tab} lang={lang} tabs={deskTabs} lockedIds={lockedIds} onDesk={onDesk}
        open={railOpen} onOpenChange={setRailOpen} />}
      {moduleNavigation && !account && <DeskNav
        tab={tab}
        featureName={featureName}
        lang={lang}
        onDesk={onDesk}
        onFeature={onFeature}
        tabs={deskTabs}
        lockedIds={lockedIds}
        desksOpen={railOpen}
        onOpenDesks={() => setRailOpen((open) => !open)}
      />}
      <div className={`workspace${restricted ? ' restricted-workspace' : ''}${tab === 'home' ? ' home' : ''}${guideMode ? ' desk-guide-mode' : ''}${isConflictsFeature(featureName) ? ' conflicts-holistic' : ''}${isChokepointsFeature(featureName) || isEnergyFeature(featureName) || isNationalFullscreen(featureName) ? ' choke-holistic' : ''}${isTransitFeature(featureName) ? ' transit-map' : ''}${isNationalFullscreen(featureName) ? ' pig-holistic' : ''}${billRecordOpen ? ' bill-record' : ''}${panel.aiOpen ? ' ai-open' : ''}${panel.collapsed ? ' panel-collapsed' : ''}`} style={panel.width ? { '--panel-chosen': `${panel.width}px` } : undefined} hidden={account || liveTvOpen ? true : undefined}>
        <main className="main-col">
          {restricted ? (
            <RestrictedDeskRoute desk={hi ? active.labelHi : active.label} feature={featureName} lang={lang}
              onAccess={doLogout}
              onBack={() => backFromRestrictedDesk(() => onDesk('home'))}/>
          ) : tab === 'home' ? (
            <LazyView><HomeDesk onOpen={onOpen} onFeed={onFeed} onSelect={onSelect} onLoading={onLoading} reload={reload} /></LazyView>
          ) : guideMode ? (
            <LazyView><DeskLandingView
              key={`${tab}:${reload}`}
              tab={tab}
              label={hi ? active.labelHi : active.label}
              buckets={deskBuckets}
              onFeature={onFeature}
              lang={lang}
            /></LazyView>
          ) : (
            <><RecordFocus focus={recordFocus} tier={feedTier} feature={featureName} onReturn={() => setRecordFocus(null)} /><div className="workspace-results" hidden={Boolean(recordFocus)}><LazyView><DeskView
              key={`${user?.id || user?.email || ''}:${feedTier}:${featureName}`}
              tier={feedTier}
              featureName={featureName}
              onFeed={onFeed}
              selected={selected}
              onSelect={onSelect}
              onLoading={onLoading}
              reload={reload}
              vizFilter={vizFilter}
              onClearViz={onClearViz}
              onReveal={onReveal}
              workspaceScope={workspace}
            /></LazyView></div></>
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
          aiMode={aiMode}
          onAiModeChange={setAiMode}
        />}
      </div>
      {!restricted && !account && !liveTvOpen && (tab === 'home' ? <OnboardingTour kind="home" /> : <OnboardingTour kind="desk" deskId={tab} />)}
      {personaOpen ? (
        <PersonaChooser
          onCancel={() => setPersonaOpen(false)}
          onDone={() => {
            setPersonaOpen(false);
            setUserTick((n) => n + 1);
          }}
        />
      ) : null}

      <MobileBottomNav
        activeTab={tab}
        aiOpen={Boolean(panel?.aiOpen)}
        filesOpen={Boolean(filesOpen)}
        accountOpen={Boolean(profileOpen || account)}
        onDesk={onDesk}
        onOpenDesks={() => setRailOpen((o) => !o)}
        onOpenAi={() => {
          if (!panel?.aiOpen) {
            panel.act({ type: 'ai-open' });
          } else {
            panel.act({ type: 'dismiss-ai' });
          }
        }}
        onOpenFiles={() => {
          setFilesOpen(true);
          if (typeof location !== 'undefined') location.hash = '#/files';
        }}
        onOpenAccount={() => {
          setProfileOpen((o) => !o);
        }}
        lang={lang}
      />
    </div>
  );
}
