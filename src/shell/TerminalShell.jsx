import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bucketsFor, catalogModules, modulesForTier, TABS } from '../desks/catalog.js';
import HomeDesk from '../desks/HomeDesk.jsx';
import DeskView from '../desks/DeskView.jsx';
import DeskLandingView from '../desks/DeskLandingView.jsx';
import DeskNav from './DeskNav.jsx';
import DeskRail from './DeskRail.jsx';
import DeskDirectory, { DeskLandingTabs } from './DeskDirectory.jsx';
import SidePanel, { useSidePanel } from './SidePanel.jsx';
import UpgradeModal from './UpgradeModal.jsx';
import { Icon } from './Icons.jsx';
import { isConflictsFeature } from '../lib/conflictsMonitor.js';
import { isTransitFeature } from '../lib/transit.js';
import { isChokepointsFeature } from '../lib/strategicAssets.js';
import { isGeoResourceDossier } from '../lib/globalResources.js';
import { isEnergyFeature } from '../lib/geonomics.js';
import { isNationalFullscreen, isImpactRecordFeature } from '../lib/national.js';
import { isGithubCsvRow } from '../lib/githubCsv.js';
import { parseDeskHash, resolveDeskRoute, writeDeskHash } from '../lib/deskRoute.js';
import { kickHomeRefreshIfDue } from '../lib/homeCache.js';
import { clearSessionUser, sessionUser, userTypeOf } from '../lib/userStore.js';
import {
  applyRowCap,
  canAccessDesk,
  canCopy,
  canExport,
  deskLocked,
  entitlementOf,
  isTrial,
  navTabsForUser,
  planOf,
  trialDaysLeft,
} from '../lib/planEntitlements.js';
import { refreshEntitlement, subscribeEntitlement } from '../lib/entitlementStore.js';
import { setPageTitle } from '../lib/siteHead.js';
import { openInDesk, takePendingDeskRow } from '../ai/openRowSource.js';
import OnboardingTour from './OnboardingTour.jsx';
import PersonaChooser from './PersonaChooser.jsx';
import LiveTvModal from './LiveTvModal.jsx';
import { clearPersonaPrefs } from '../lib/personas.js';
import { hydrateUserPrefs, startUserPrefsSync } from '../lib/userPrefsSync.js';
import './upgrade.css';
import DeskCatalogueSearch from './DeskCatalogueSearch.jsx';
import RestrictedDeskRoute from './RestrictedDeskRoute.jsx';
import { backFromRestrictedDesk, rememberDeskNavigation } from './deskRouteHistory.js';
import { isEditableCopy } from './copyPolicy.js';

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
  const [userTick, setUserTick] = useState(0);
  const [upgrade, setUpgrade] = useState(null);
  const profileRef = useRef(null);
  const user = sessionUser();
  const typeId = userTypeOf(user?.type).id;
  const typeMeta = userTypeOf(typeId);
  const ent = entitlementOf(user);
  const planMeta = planOf(ent.plan);
  const deskTabs = navTabsForUser(user);
  const lockedIds = useMemo(
    () => new Set(deskTabs.filter((t) => deskLocked(user, t.id)).map((t) => t.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id, user?.personaId, user?.type, userTick],
  );

  const active = deskTabs.find((t) => t.id === tab) || TABS.find((t) => t.id === tab) || TABS[0];
  const hi = lang === 'hi';
  const restricted = !canAccessDesk(user, tab);

  const openUpgrade = useCallback((reason = 'desk', deskLabel = '') => {
    setUpgrade({ reason, deskLabel });
  }, []);

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

  // The plan comes from the server (F2). Re-read it when the terminal opens,
  // and re-render whenever it changes (a trial, a payment, a lapse).
  useEffect(() => {
    const unsubscribe = subscribeEntitlement(() => setUserTick((n) => n + 1));
    refreshEntitlement();
    return unsubscribe;
  }, []);

  useEffect(() => {
    window.__niyExportGate = () => {
      if (canExport(sessionUser())) return true;
      openUpgrade('export');
      return false;
    };
    return () => {
      delete window.__niyExportGate;
    };
  }, [openUpgrade, userTick]);

  useEffect(() => {
    if (canCopy(user)) {
      document.body.classList.remove('plan-no-copy');
      return undefined;
    }
    document.body.classList.add('plan-no-copy');
    function onCopy(e) {
      if (isEditableCopy(e) || canCopy(sessionUser())) return;
      e.preventDefault();
      openUpgrade('copy');
    };
    document.addEventListener('copy', onCopy, true);
    return () => {
      document.body.classList.remove('plan-no-copy');
      document.removeEventListener('copy', onCopy, true);
    };
  }, [user, openUpgrade, userTick]);

  const onFeed = useCallback(
    (body) => {
      setFeed(applyRowCap(body, sessionUser()));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionUser() is read outside React; userTick is its change signal.
    [userTick],
  );
  const onSelect = useCallback((row) => setSelected(row), []);
  const onLoading = useCallback((v) => setLoading(Boolean(v)), []);
  const onClearViz = useCallback(() => setVizFilter(null), []);
  const guideMode = tab !== 'home' && !String(featureName || '').trim();
  const v6Landing = guideMode && ['national', 'global', 'law', 'economics', 'carbon', 'sports', 'entertainment'].includes(tab);
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
    const desk = active?.label || tab || 'Terminal';
    const feat = String(featureName || '').trim();
    setPageTitle(feat ? `${feat} · ${desk}` : desk === 'Home' ? 'Terminal' : desk);
  }, [tab, featureName, active?.label]);

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
      const r = parseDeskHash();
      if (!canAccessDesk(sessionUser(), r.tab)) {
        openUpgrade('desk', TABS.find((t) => t.id === r.tab)?.label || r.tab);
      } else if (isTrial(sessionUser()) && r.tab !== 'home') {
        openUpgrade('trial');
      }
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
  }, [typeId, openUpgrade]);

  const searchTabs = useMemo(() => deskTabs.filter(t => canAccessDesk(user, t.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entitlement store updates are signalled by userTick.
    [deskTabs, user, userTick]);

  function onDesk(id) {
    if (!canAccessDesk(sessionUser(), id)) {
      openUpgrade('desk', TABS.find((t) => t.id === id)?.label || id);
    }
    if (isTrial(sessionUser()) && id !== 'home') openUpgrade('trial');
    const r = resolveDeskRoute(id, '');
    setTab(r.tab);
    setFeatureName(r.feature);
    setSelected(null);
    rememberDeskNavigation(() => writeDeskHash(r.tab, r.feature));
  }

  function onFeature(name) {
    if (!canAccessDesk(sessionUser(), tab)) openUpgrade('desk', active.label);
    else if (isTrial(sessionUser())) openUpgrade('trial');
    const r = resolveDeskRoute(tab, name);
    setTab(r.tab);
    setFeatureName(r.feature);
    setSelected(null);
    rememberDeskNavigation(() => writeDeskHash(r.tab, r.feature));
  }

  function onOpen({ tab: nextTab, feature }) {
    if (!canAccessDesk(sessionUser(), nextTab)) {
      openUpgrade('desk', TABS.find((t) => t.id === nextTab)?.label || nextTab);
    }
    if (isTrial(sessionUser()) && nextTab !== 'home') openUpgrade('trial');
    const r = resolveDeskRoute(nextTab, feature);
    setTab(r.tab);
    setFeatureName(r.feature);
    setSelected(null);
    rememberDeskNavigation(() => writeDeskHash(r.tab, r.feature));
  }

  const billRecordOpen = (isImpactRecordFeature(featureName) || isGithubCsvRow(selected)) && selected;
  // Desks whose side panel has Desk and Record tabs; the others show it only for AI research.
  const hasRail =
    !restricted && tab !== 'home' &&
    !guideMode &&
    !isConflictsFeature(featureName) &&
    !isChokepointsFeature(featureName) &&
    !isEnergyFeature(featureName) &&
    !isGeoResourceDossier(featureName) &&
    !isNationalFullscreen(featureName);
  const panel = useSidePanel({ hasRail, selected, featureName });
  useEffect(() => {
    if (restricted) { setFeed(null); setSelected(null); setLoading(false); }
  }, [restricted]);
  const trialLeft = trialDaysLeft(user);
  const planLabel = planMeta?.name || String(ent.plan || 'explorer').toUpperCase();
  const statusLabel =
    ent.status === 'trial'
        ? trialLeft
          ? `Trial · ${trialLeft}d left`
          : 'Trial'
        : ent.status === 'free' || ent.plan === 'explorer'
          ? 'Free'
          : 'Active';
  const canUpgrade =
    (ent.status === 'trial' || ent.status === 'free' || ent.plan === 'explorer');

  function doLogout() {
    clearSessionUser();
    clearPersonaPrefs();
    if (typeof location !== 'undefined') location.hash = '#/';
    onLogout?.();
  }

  return (
    <div className={`terminal ${v6Landing ? 'with-v6-directory' : 'with-desk-rail'} theme-${theme}`}>
      <div className={`load-bar${loading ? ' on' : ''}`} />
      <header className="topbar">
        <div className="brand" title="Niyantran Terminal">
          <img src="/brand/logo.png?v=2" alt="" />
          <span>TERMINAL</span>
        </div>
        {v6Landing && <DeskDirectory tab={tab} lang={lang} tabs={deskTabs} lockedIds={lockedIds} onDesk={onDesk}/>}
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
          <button type="button" className="icon-btn" disabled title="Notifications not configured (Beta)">
            <Icon name="bell" />
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
          <button
            type="button"
            className={`icon-btn${loading ? ' spin' : ''}`}
            onClick={() => setReload((n) => n + 1)}
            title="Refresh feed"
          >
            <Icon name="refresh" />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title="Theme"
          >
            <Icon name="info" />
          </button>
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
                  {canUpgrade ? (
                    <button
                      type="button"
                      className="profile-pop-upgrade"
                      onClick={() => {
                        setProfileOpen(false);
                        openUpgrade(ent.status === 'trial' ? 'trial' : 'desk');
                      }}
                    >
                      {ent.status === 'trial' ? 'Upgrade plan' : 'View plans'}
                    </button>
                  ) : null}
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
      </header>
      {v6Landing && <DeskLandingTabs tab={tab} lang={lang} tabs={deskTabs} lockedIds={lockedIds} onDesk={onDesk}/>}
      {!v6Landing && <DeskRail tab={tab} lang={lang} tabs={deskTabs} lockedIds={lockedIds} onDesk={onDesk} />}
      {!v6Landing && <DeskNav
        tab={tab}
        featureName={featureName}
        lang={lang}
        onDesk={onDesk}
        onFeature={onFeature}
        tabs={deskTabs}
        lockedIds={lockedIds}
      />}
      <div className={`workspace${restricted ? ' restricted-workspace' : ''}${tab === 'home' ? ' home' : ''}${guideMode ? ' desk-guide-mode' : ''}${isConflictsFeature(featureName) ? ' conflicts-holistic' : ''}${isChokepointsFeature(featureName) || isEnergyFeature(featureName) || isNationalFullscreen(featureName) ? ' choke-holistic' : ''}${isGeoResourceDossier(featureName) ? ' geo-holistic' : ''}${isTransitFeature(featureName) ? ' transit-map' : ''}${isNationalFullscreen(featureName) ? ' pig-holistic' : ''}${billRecordOpen ? ' bill-record' : ''}${panel.aiOpen ? ' ai-open' : ''}${panel.collapsed ? ' panel-collapsed' : ''}`} style={panel.width ? { '--panel-chosen': `${panel.width}px` } : undefined}>
        <main className="main-col">
          {restricted ? (
            <RestrictedDeskRoute desk={hi ? active.labelHi : active.label} feature={featureName} lang={lang}
              onAccess={() => openUpgrade('desk', active.label)}
              onBack={() => backFromRestrictedDesk(() => onDesk('home'))}/>
          ) : tab === 'home' ? (
            <HomeDesk onOpen={onOpen} onFeed={onFeed} onSelect={onSelect} onLoading={onLoading} reload={reload} />
          ) : guideMode ? (
            <DeskLandingView
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
      {!restricted && (tab === 'home' ? <OnboardingTour kind="home" /> : <OnboardingTour kind="desk" deskId={tab} />)}
      {personaOpen ? (
        <PersonaChooser
          onCancel={() => setPersonaOpen(false)}
          onDone={() => {
            setPersonaOpen(false);
            setUserTick((n) => n + 1);
          }}
        />
      ) : null}
      <UpgradeModal
        open={Boolean(upgrade)}
        reason={upgrade?.reason || 'desk'}
        deskLabel={upgrade?.deskLabel || ''}
        onClose={() => setUpgrade(null)}
        onUpgraded={() => {
          setUserTick((n) => n + 1);
          setUpgrade(null);
        }}
      />
    </div>
  );
}
