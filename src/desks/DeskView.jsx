import { rowSelectionProps } from '../shell/rowSelection.js';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { fetchFeature, fetchFeaturePage } from '../lib/featureFeed.js';
import { featureFeedApiEnabled } from '../lib/apiMode.js';
import { canonicalQ, isPagedFeature } from '../lib/pagedFeatures.js';
import { fetchPendingDeskRow } from '../ai/openRowSource.js';
import { openAiResearch, rowDragProps } from '../lib/aiDrop.js';
import { cellText, filterRows, isArticleHref, sortRows } from '../lib/normalise.js';
import { buildTableSearchIndex, searchTableRows, shouldIndexSearch } from '../lib/tableSearch.js';
import { formatCell, formatDate, formatStatus, getStatusToneClass, truncateTwoLines } from '../lib/format.js';
import { DATA_STATE, isTerminalState, resolveDataState } from '../lib/dataState.js';
import { LIVE_WAIT_TEXT, MODULE_UNAVAILABLE_TEXT, followUpLive, liveFailed, liveFollowUpKind, liveHoldState } from './moduleLiveRetry.js';
import { isGithubCsvRow } from '../lib/githubCsv.js';
import { cellOf, feedColumns } from '../lib/columns.js';
import { prepareDeskFeed } from '../lib/prepareDeskFeed.js';
import { sensitiveNoteFor } from '../lib/sensitiveData.js';
import { asOfLabel, completenessLabel, freshnessLabel, isStoreAnswer, isStoredAnswer, plainLabel, plainNote, plainSourceLine, technicalTitle } from '../lib/plainSourceNote.js';
import { isConflictsFeature } from '../lib/conflictsMonitor.js';
import { isTransitFeature } from '../lib/transit.js';
import { isAlliancesFeature } from '../lib/alliances.js';
import { isSanctionsFeature } from '../lib/sanctions.js';
import { isGlobalAidFeature } from '../lib/globalAid.js';
import { isChokepointsFeature, isNuclearWatchFeature } from '../lib/strategicAssets.js';
import { isGlobalResourcesTable, isHeadsOfStateFeature, isGlobalCommoditiesFeature } from '../lib/globalResources.js';
import { isEnergyFeature, isGeonomicsTable } from '../lib/geonomics.js';
import {
  featureMenuLabel,
  isBudgetFeature,
  isDelimitationFeature,
  isIndustryFeature,
  isManifestosFeature,
  isMorningBriefFeature,
  isMpCardsFeature,
  isNationalTable,
  isPolicyGraphFeature,
  isProjectsFeature,
  isStatementsFeature,
} from '../lib/national.js';
import PolicyGraphDesk from './PolicyGraphDesk.jsx';
import MpCardsDesk from './MpCardsDesk.jsx';
import DelimitationDesk from './DelimitationDesk.jsx';
import ManifestosDesk from './ManifestosDesk.jsx';
import BudgetDesk from './BudgetDesk.jsx';
import FundFlowDesk, { isFundFlowFeature } from './FundFlowDesk.jsx';
import ProjectsDesk from './ProjectsDesk.jsx';
import MorningBriefDesk from './MorningBriefDesk.jsx';
import StatementsDesk from './StatementsDesk.jsx';
import MlaStatePicker from './MlaStatePicker.jsx';
import { isMlaDirectory } from '../lib/mlaStates.js';
import ModulePicker from './ModulePicker.jsx';
import { modulePicker } from '../lib/modulePicker.js';
import IndustryDesk from './IndustryDesk.jsx';
import { tenderCloseBand, applyVizFilter } from '../lib/nationalKpi.js';
import FeedLoader from '../shell/FeedLoader.jsx';
import DeskStateShell from '../shell/DeskStateShell.jsx';
import ColumnChooser from '../shell/ColumnChooser.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import TableFilterPop, { choiceGroup, matchesChoice } from '../shell/TableFilterPop.jsx';
import ConflictsMonitor from './ConflictsMonitor.jsx';
import TransitDesk from './TransitDesk.jsx';
import AlliancesMonitor from './AlliancesMonitor.jsx';
import SanctionsMonitor from './SanctionsMonitor.jsx';
import GlobalAidMonitor from './GlobalAidMonitor.jsx';
import NuclearWatch from './NuclearWatch.jsx';
import ChokepointsDesk from './ChokepointsDesk.jsx';
import LeadersDesk from './LeadersDesk.jsx';
import CommoditiesDesk from './CommoditiesDesk.jsx';
import EnergyDesk from './EnergyDesk.jsx';

const LARGE_PAGE = 100;
// F156: on a paged module the search box asks the server once typing has stopped this long.
const SEARCH_WAIT_MS = 300;

/** F154: names stored rows shown while live data loads, and the moment live rows replace them. */
export function liveRefreshNote(feed) {
  if (feed?.refreshing) return 'Showing stored rows. Refreshing live data…';
  // F169 C4: an answer from the feed store replacing the archive is not "live"; its header says how old it is.
  if (feed?.updatedLive && !isStoreAnswer(feed)) return 'Updated live.';
  return null;
}

/**
 * F159 review: whether a failed load was the reader's network rather than the server. fetchFeature
 * reports an unreachable API as `feature-feed HTTP 404`, so the browser's own offline flag (and a raw
 * fetch failure, should one arrive) is what tells them apart.
 */
function readerOffline(error) {
  if (typeof navigator !== 'undefined' && navigator?.onLine === false) return true;
  return /^(Failed to fetch|NetworkError\b|Load failed$)/i.test(String(error?.message || ''));
}

// What the error card says under "This module couldn't load right now."
const SERVER_FAILED_DETAIL = 'The source did not respond. Try again.';
const OFFLINE_DETAIL = 'Check your connection and try again.';

function isParliamentaryQuestions(name) {
  return /parliamentary question/i.test(String(name || ''));
}

// No State or Table picked (DeskView's modulePick).
const NO_PICK = Object.freeze({ for: '', value: '' });

export default function DeskView({
  tier,
  featureName,
  onFeed,
  selected,
  onSelect,
  onLoading,
  reload,
  vizFilter,
  onClearViz,
}) {
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);
  const [sort, setSort] = useState({ key: '', dir: 'asc' });
  const [feed, setFeed] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [visibleKeys, setVisibleKeys] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [pageAt, setPageAt] = useState({ view: '', n: 0 });
  const [hasAnswerFilter, setHasAnswerFilter] = useState('');
  // F156: Bills and Questions ask the server for one page at a time; after a failed page they load
  // the whole module as before (pagedMode false).
  const [pagedMode, setPagedMode] = useState(() => isPagedFeature(featureName) && featureFeedApiEnabled());
  const [pagedQ, setPagedQ] = useState('');
  const [paging, setPaging] = useState(false);
  // F190: MLA Directory's State picker ('' is All states); F196: the handbook modules' and the Comparison
  // Engine's Table picker ('' is the module's first table). Only those modules read it (pickValue below).
  // The pick is kept with the module it was made on, so the next module's first request never carries it.
  const [modulePick, setModulePick] = useState(NO_PICK);
  // F159 review: a failed load says "check your connection" only when the reader is offline.
  const [errOffline, setErrOffline] = useState(false);
  const loadedFor = useRef('');
  const mounted = useRef(true);
  const lastPick = useRef('');
  const colsKey = featureName ? `niy-cols:${tier || ''}:${featureName}` : '';
  const filtersKey = featureName ? `niy-filters:${tier || ''}:${featureName}` : '';
  const questionsDesk = isParliamentaryQuestions(featureName);
  const mlaDesk = isMlaDirectory(tier, featureName);
  const picker = mlaDesk ? null : modulePicker(tier, featureName);
  const pickParam = mlaDesk ? 'state' : picker?.param || '';
  const pickFor = `${tier || ''}:${featureName || ''}`;
  const pickValue = pickParam && modulePick.for === pickFor ? modulePick.value : '';
  const setPick = (value) => setModulePick({ for: pickFor, value: String(value ?? '') });

  useEffect(() => {
    setQ('');
    setHasAnswerFilter('');
    setModulePick(NO_PICK);
    onSelect(null);
    if (!colsKey) {
      setVisibleKeys(null);
      return;
    }
    try {
      const raw = localStorage.getItem(colsKey);
      setVisibleKeys(raw ? JSON.parse(raw) : null);
    } catch {
      setVisibleKeys(null);
    }
    if (filtersKey) {
      try {
        const saved = JSON.parse(localStorage.getItem(filtersKey) || 'null');
        if (saved && typeof saved === 'object') {
          if (typeof saved.q === 'string') setQ(saved.q);
          if (saved.hasAnswer != null) setHasAnswerFilter(saved.hasAnswer);
        }
      } catch {
        /* ignore */
      }
    }
  }, [tier, featureName, onSelect, colsKey, filtersKey]);

  useEffect(() => {
    if (!filtersKey || !questionsDesk) return;
    try {
      localStorage.setItem(filtersKey, JSON.stringify({ q, hasAnswer: hasAnswerFilter }));
    } catch {
      /* ignore quota */
    }
  }, [filtersKey, questionsDesk, q, hasAnswerFilter]);

  function persistVisibleKeys(keys) {
    setVisibleKeys(keys);
    if (!colsKey) return;
    try {
      if (!keys) localStorage.removeItem(colsKey);
      else localStorage.setItem(colsKey, JSON.stringify(keys));
    } catch {
      /* ignore quota */
    }
  }

  useEffect(() => {
    if (!featureName) return undefined;
    if (isTransitFeature(featureName)) {
      return undefined;
    }
    if (
      isStatementsFeature(featureName) ||
      isMorningBriefFeature(featureName) ||
      isDelimitationFeature(featureName) ||
      isManifestosFeature(featureName)
    ) {
      setLoading(false);
      onLoading?.(false);
      return undefined;
    }
    if (pagedMode) return undefined;
    const params = pickValue ? { [pickParam]: pickValue } : undefined;
    // F190: the other state's (or table's) list must not stay on screen or in the shell (an AI attachment,
    // the side panel) while this one loads.
    if (lastPick.current !== pickValue) {
      lastPick.current = pickValue;
      setFeed(null);
      onFeed(null);
      onSelect(null);
    }
    const ac = new AbortController();
    setLoading(true);
    onLoading?.(true);
    setErr('');
    const show = (body) => {
      if (ac.signal.aborted) return;
      const prepared = prepareDeskFeed(body);
      setFeed(prepared);
      onFeed(prepared);
    };
    // F159: an answer from stored records while live data loads is asked for again; leaving the
    // module aborts `ac`, which stops it.
    let following = false;
    const follow = (body) => {
      if (following || ac.signal.aborted || !liveFollowUpKind(body)) return;
      following = true;
      followUpLive({
        first: body,
        signal: ac.signal,
        publish: show,
        refetch: () => fetchFeature({ tier, feature: featureName, signal: ac.signal, params }),
      });
    };
    // F154: the stored archive shows as soon as it is in; live rows replace it when they arrive.
    const onUpdate = (body) => {
      show(body);
      follow(body);
    };
    fetchFeature({ tier, feature: featureName, signal: ac.signal, onUpdate, params })
      .then((body) => {
        if (ac.signal.aborted) return;
        show(body);
        onSelect(null);
        follow(body);
      })
      .catch((e) => {
        if (e.name === 'AbortError' || ac.signal.aborted) return;
        // F159: the reason is for debugging; the page says it in plain words.
        console.warn(`[${featureName}] module failed to load:`, e.message || String(e));
        setErrOffline(readerOffline(e));
        setErr(MODULE_UNAVAILABLE_TEXT);
        setFeed(null);
        onFeed(null);
      })
      .finally(() => {
        if (ac.signal.aborted) return;
        setLoading(false);
        onLoading?.(false);
      });
    return () => ac.abort();
  }, [tier, featureName, onFeed, onSelect, onLoading, reload, reloadTick, pagedMode, pickParam, pickValue]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!pagedMode) return undefined;
    const timer = setTimeout(() => setPagedQ(canonicalQ(q)), SEARCH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [q, pagedMode]);

  // One page per view: a new search, sort, filter, MLA state or table starts again at its first page.
  const viewKey = JSON.stringify([featureName, pagedMode ? pagedQ : deferredQ, sort, vizFilter, hasAnswerFilter, ...(pickValue ? [pickValue] : [])]);
  const page = pageAt.view === viewKey ? pageAt.n : 0;
  const setPage = (next) =>
    setPageAt((at) => ({ view: viewKey, n: typeof next === 'function' ? next(at.view === viewKey ? at.n : 0) : next }));

  // F156: the page on screen, asked of the server; the first answer of a load stands in for the
  // whole-module load above (loading state, onFeed, a cleared selection, a cited row).
  useEffect(() => {
    if (!pagedMode || !featureName) return undefined;
    const ac = new AbortController();
    const loadKey = `${reload}|${reloadTick}`;
    const fresh = loadedFor.current !== loadKey;
    if (fresh) {
      setLoading(true);
      onLoading?.(true);
      setErr('');
    } else {
      setPaging(true);
    }
    const view = { tier, feature: featureName, q: pagedQ, sort: sort.key, dir: sort.dir, filter: vizFilter, answer: questionsDesk ? hasAnswerFilter : '' };
    fetchFeaturePage({ ...view, page: page + 1, signal: ac.signal })
      .catch((e) => {
        if (e?.name === 'AbortError') throw e;
        return null;
      })
      .then((body) => {
        if (ac.signal.aborted) return;
        setPaging(false);
        if (!body) {
          // The API is not on this host or failed: the whole module, browsed here, as before.
          setPagedMode(false);
          return;
        }
        loadedFor.current = loadKey;
        setFeed(body);
        onFeed(body);
        if (!fresh) return;
        onSelect(null);
        setLoading(false);
        onLoading?.(false);
        fetchPendingDeskRow(body, (key) => fetchFeaturePage({ tier, feature: featureName, key }).then((b) => b?.rows))
          .then((row) => {
            if (row && mounted.current) onSelect(row);
          })
          .catch(() => {});
      }, () => {});
    return () => ac.abort();
  }, [pagedMode, tier, featureName, page, pagedQ, sort, vizFilter, hasAnswerFilter, questionsDesk, onFeed, onSelect, onLoading, reload, reloadTick]);

  const searchIndex = useMemo(() => {
    const rows = feed?.rows || [];
    if (!shouldIndexSearch(rows.length)) return null;
    return buildTableSearchIndex(rows);
  }, [feed]);

  const filtered = useMemo(() => {
    // A paged answer is already searched, filtered and sorted by the server.
    if (feed?.paged) return feed.rows || [];
    const base = feed?.rows || [];
    let rows = shouldIndexSearch(base.length)
      ? searchTableRows(base, searchIndex, deferredQ)
      : filterRows(base, deferredQ);
    rows = rows.filter((r) => applyVizFilter(r, vizFilter));
    if (questionsDesk && hasAnswerFilter) {
      rows = rows.filter((r) => matchesChoice(hasAnswerFilter, r.has_answer_key || 'unknown'));
    }
    return sortRows(rows, sort.key || undefined, sort.dir);
  }, [feed, deferredQ, sort, vizFilter, searchIndex, questionsDesk, hasAnswerFilter]);

  // Rows matching the view, and in the register: the server counts them for a paged answer.
  const matchCount = feed?.paged ? feed.total : filtered.length;
  const registerCount = feed?.paged ? feed.totalAll : feed?.rows?.length;
  const usePaging = matchCount > LARGE_PAGE;
  const pageCount = Math.max(1, Math.ceil(matchCount / LARGE_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(() => {
    if (!usePaging || feed?.paged) return filtered;
    const start = safePage * LARGE_PAGE;
    return filtered.slice(start, start + LARGE_PAGE);
  }, [filtered, usePaging, safePage, feed]);

  const allCols = useMemo(
    () => (feed?.paged && Array.isArray(feed.columns) ? feed.columns : feedColumns(feed?.feature || featureName, filtered)),
    [feed, featureName, filtered],
  );
  const cols = useMemo(() => {
    if (!allCols.length) return allCols;
    const defaults = allCols.filter((c) => c.default !== false).slice(0, 7).map((c) => c.key);
    const keys = Array.isArray(visibleKeys) && visibleKeys.length ? visibleKeys : defaults;
    const picked = allCols.filter((c) => keys.includes(c.key));
    return picked.length ? picked : allCols.slice(0, 7);
  }, [allCols, visibleKeys]);

  const questionFilterGroups = useMemo(() => {
    if (!questionsDesk) return [];
    return [
      choiceGroup(
        'Has answer',
        [
          { value: 'yes', label: 'Has answer' },
          { value: 'no', label: 'No answer' },
          { value: 'unknown', label: 'Not reported' },
        ],
        hasAnswerFilter,
        setHasAnswerFilter,
      ),
    ];
  }, [questionsDesk, hasAnswerFilter]);

  const statusRow = !loading && feed?.rows?.length === 1 && feed.rows[0]?.status === 'source_status' ? feed.rows[0] : null;
  // F159: no records yet because live data is still loading on the server (retried), or given up.
  const hold = loading ? null : liveHoldState(feed);
  const liveWait = hold === 'wait';
  const liveGaveUp = hold === 'gaveUp';
  const liveHold = liveWait || liveGaveUp;
  const dataState = liveGaveUp
    ? {
      ...DATA_STATE.error,
      // F159 review: a live source that failed is not "taking longer".
      detail: liveFailed(feed)
        ? 'The live source isn’t responding. Try again in a moment.'
        : 'Live data is taking longer than usual. Try again in a moment.',
    }
    : resolveDataState(feed, { loading: loading || liveWait, error: err });
  const liveOn = dataState.id === 'live';
  const shellState = isTerminalState(dataState) || (err && !feed) || statusRow || liveHold;

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  function retry() {
    setReloadTick((n) => n + 1);
  }

  if (isTransitFeature(featureName)) {
    return <TransitDesk onFeed={onFeed} onSelect={onSelect} onLoading={onLoading} reload={reload} />;
  }

  if (isAlliancesFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide alliances-desk">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading alliance register…" />}
          {!loading && (
            <AlliancesMonitor
              feed={feed}
              selected={selected}
              onSelect={onSelect}
              flags={feed?.meta?.memberFlags || {}}
              vizFilter={vizFilter}
              onClearViz={onClearViz}
            />
          )}
        </div>
      </div>
    );
  }

  if (isSanctionsFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide alliances-desk">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading sanctions register…" />}
          {!loading && <SanctionsMonitor feed={feed} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />}
        </div>
      </div>
    );
  }

  if (isGlobalAidFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide alliances-desk">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading aid register…" />}
          {!loading && <GlobalAidMonitor feed={feed} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />}
        </div>
      </div>
    );
  }

  if (isNuclearWatchFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide nww-desk">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading nuclear register…" />}
          {!loading && <NuclearWatch feed={feed} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />}
        </div>
      </div>
    );
  }

  if (isChokepointsFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide cpd-desk">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading chokepoint dossier…" />}
          {!loading && <ChokepointsDesk feed={feed} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} onAsk={(q) => openAiResearch({ prompt: q, attachFeed: true, row: selected })} />}
        </div>
      </div>
    );
  }

  if (isEnergyFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide cpd-desk">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading energy dossier…" />}
          {!loading && <EnergyDesk feed={feed} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} onAsk={(q) => openAiResearch({ prompt: q, attachFeed: true, row: selected })} />}
        </div>
      </div>
    );
  }

  if (isPolicyGraphFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide desk-res pig-host">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading policy graph…" />}
          {!loading && <PolicyGraphDesk feed={feed} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />}
        </div>
      </div>
    );
  }

  if (isDelimitationFeature(featureName)) {
    return (
      <div className="desk desk-wide desk-res">
        <DelimitationDesk selected={selected} onFeed={onFeed} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />
      </div>
    );
  }

  if (isManifestosFeature(featureName)) {
    return (
      <div className="desk desk-wide desk-res">
        <ManifestosDesk selected={selected} onFeed={onFeed} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />
      </div>
    );
  }

  if (isFundFlowFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide desk-res">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Downloading Budget Statement 1…" />}
          {!loading && (
            <FundFlowDesk
              feed={feed}
              selected={selected}
              onSelect={onSelect}
              vizFilter={vizFilter}
              onClearViz={onClearViz}
            />
          )}
        </div>
      </div>
    );
  }

  if (isBudgetFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide desk-res">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading budget figures…" />}
          {!loading && (
            <BudgetDesk
              selected={selected}
              onSelect={onSelect}
              onFeed={onFeed}
              vizFilter={vizFilter}
              onClearViz={onClearViz}
            />
          )}
        </div>
      </div>
    );
  }

  if (isProjectsFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide desk-res">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading programmes…" />}
          {!loading && <ProjectsDesk selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />}
        </div>
      </div>
    );
  }

  if (isMorningBriefFeature(featureName)) {
    return (
      <div className="desk desk-wide desk-res">
        <MorningBriefDesk onFeed={onFeed} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />
      </div>
    );
  }

  if (isStatementsFeature(featureName)) {
    return (
      <div className="desk desk-wide desk-res">
        <StatementsDesk onFeed={onFeed} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />
      </div>
    );
  }

  if (isMpCardsFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide desk-res">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading MP roster…" />}
          {!loading && <MpCardsDesk feed={feed} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />}
        </div>
      </div>
    );
  }

  if (isIndustryFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide desk-res">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading industry series…" />}
          {!loading && <IndustryDesk feed={feed} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />}
        </div>
      </div>
    );
  }

  if (isIndustryFeature(featureName) && statusRow && !liveHold) {
    return (
      <div className="desk desk-wide desk-res">
        {err && <p className="banner warn">{err}</p>}
        <IndustryDesk feed={feed} statusRow={statusRow} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />
      </div>
    );
  }

  if (isHeadsOfStateFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide gld-desk">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading leader register…" />}
          {!loading && <LeadersDesk feed={feed} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />}
        </div>
      </div>
    );
  }

  if (isGlobalCommoditiesFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide gld-desk">
        {err && <p className="banner warn">{err}</p>}
        <div className={`alliances-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading commodity board…" />}
          {!loading && <CommoditiesDesk feed={feed} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />}
        </div>
      </div>
    );
  }

  if (isConflictsFeature(featureName) && !statusRow && !liveHold) {
    return (
      <div className="desk desk-wide conflicts-desk">
        {err && <p className="banner warn">{err}</p>}
        <div className={`conflicts-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label="Loading conflict monitor…" />}
          {!loading && <ConflictsMonitor feed={feed} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />}
        </div>
      </div>
    );
  }

  const displayTitle = (() => {
    const raw = featureMenuLabel({ htmlFeature: featureName }) || featureName || 'FEED';
    return String(raw)
      .replace(/\bJudgments?\b/gi, 'Judgements')
      .replace(/\bJudgement\b/g, 'Judgements')
      .replace(/\bOrder Archive\b/gi, 'Orders by Topic')
      .replace(/\barchiv(e|ed)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  })();
  const isCarbonDesk =
    /^(climate|carbon)$/i.test(String(tier || '')) ||
    /carbon|climate|cbam|ccts|ets & tax/i.test(String(featureName || ''));
  const isGlobalIntelligence = /global intelligence/i.test(String(featureName || ''));
  // F164: notes from the feed reach the page in plain words; the original stays as a `title`.
  const fallbackBanner = plainNote(dataState.detail, 'Showing the latest stored records.');
  const metaNote = (() => {
    const raw = String(feed?.meta?.note || '');
    if (!raw) return '';
    // A technical note is replaced by a plain source line, followed by any plain sentences it had.
    const stored = feed?.fallback || feed?.served === 'archive';
    return plainNote(raw, stored ? '' : plainSourceLine(feed)).replace(/\bJudgments?\b/gi, 'Judgements');
  })();
  const coverageLabel = (() => {
    if (loading || liveWait) return 'Fetching…';
    if (shellState) return dataState.coverage || 'No live rows';
    const n = matchCount;
    const total = registerCount;
    if (/open fronts/i.test(featureName || '')) {
      const through = formatDate(feed?.coverage?.through) || feed?.coverage?.through || '';
      return `${n} conflict${n === 1 ? '' : 's'}${through ? ` · through ${through}` : ''}`;
    }
    // F165: "complete list" and "updated …" / "stored copy" in place of "exhaustive" and "sync …".
    const complete = completenessLabel(feed, total || n);
    // F169 T9: a stored answer says how old its records are; a live one keeps its freshness.
    // F169 C4: an answer from the scheduled feed store says when its items were fetched ("updated 5 min ago").
    const fresh = isStoredAnswer(feed)
      ? `stored copy · ${asOfLabel(feed)}`
      : isStoreAnswer(feed)
        ? asOfLabel(feed)
        : dataState.lastSync ? freshnessLabel(feed) : '';
    return `${n}${total && n !== total ? ` / ${total}` : ''} rows${complete ? ` · ${complete}` : ''}${
      usePaging ? ` · page ${safePage + 1}/${pageCount}` : ''
    }${fresh ? ` · ${fresh}` : ''}`;
  })();

  return (
    <div
      className={`desk desk-wide${isGlobalResourcesTable(featureName) || isGeonomicsTable(featureName) || isNationalTable(featureName) ? ' desk-res' : ''}${
        tier === 'economics' ? ' desk-economics' : ''
      }${isCarbonDesk ? ' desk-carbon' : ''}${
        /cabinet decisions/i.test(String(featureName || '')) ? ' desk-cabinet' : ''
      }`}
    >
      <div className="feed-col compact">
        <div className="feed-head">
          <h1>
            {displayTitle}
            {dataState.label && !dataState.hideBadge && !/archiv/i.test(dataState.label) ? (
              <span className={`live-feed data-state-${dataState.id}${liveOn ? ' on' : ''}`}>{dataState.label}</span>
            ) : null}
          </h1>
          <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
          {!shellState && (
            <TableFilterPop
              feed={feed}
              q={q}
              onQ={setQ}
              searchPlaceholder={questionsDesk ? 'Search questions, members, ministries…' : 'Search this table'}
              vizFilter={vizFilter}
              onClearViz={onClearViz}
              disabled={loading}
              extraGroups={questionFilterGroups}
            />
          )}
          {!shellState && (
            <ColumnChooser
              allCols={allCols}
              visibleKeys={cols.map((c) => c.key)}
              onChange={persistVisibleKeys}
              disabled={loading}
            />
          )}
          <span className="muted" aria-live={mlaDesk || picker ? 'polite' : undefined}>{coverageLabel}</span>
        </div>
        {mlaDesk ? <MlaStatePicker value={pickValue} onChange={setPick} /> : picker ? <ModulePicker picker={picker} value={pickValue} onChange={setPick} /> : null}
        {!shellState && liveRefreshNote(feed) ? (
          <p className="desk-note" role="status">
            {liveRefreshNote(feed)}
          </p>
        ) : null}
        {feed?.fallback && dataState.id !== 'live' && !shellState && dataState.detail && tier !== 'local' && !isCarbonDesk ? (
          // F164: the detail is often the archive's own note; the reader gets plain words.
          <p className="banner" title={technicalTitle(dataState.detail, fallbackBanner)}>{fallbackBanner}</p>
        ) : null}
        {(() => {
          const note = sensitiveNoteFor(featureName);
          if (!note || shellState) return null;
          return (
            <div className="banner warn desk-sensitive" role="note">
              <strong>{note.title}</strong>
              <span>{note.body}</span>
            </div>
          );
        })()}
        {feed?.meta?.newsDedupRemoved > 0 && !shellState && (
          <p className="desk-note">
            Showing {filtered.length} stories after removing {feed.meta.newsDedupRemoved} repeat
            headline{feed.meta.newsDedupRemoved === 1 ? '' : 's'}.
          </p>
        )}
        {feed?.meta?.boardNote && !shellState && (
          <p className="desk-note desk-quality" role="note">
            {feed.meta.boardNote}
          </p>
        )}
        {/* Data-check banners removed per product feedback */}
        {feed?.meta?.section && !shellState && (
          <div className="desk-strip">
            <span>
              {plainLabel(
                String(feed.meta.section)
                  .replace(/\bJudgments?\b/gi, 'Judgements')
                  .replace(/\bCLIMATE NEWSWIRE\b/gi, 'Climate wire')
                  .replace(/\bREGISTRY WIRE\b/gi, 'Registry wire')
                  .replace(/\barchiv(e|ed)\b/gi, '')
                  .replace(/\s{2,}/g, ' ')
                  .trim(),
              )}
            </span>
            {feed.meta.status &&
            plainLabel(feed.meta.status) &&
            !/\barchiv(e|ed)|data check\b/i.test(String(feed.meta.status)) ? (
              <span>{plainLabel(feed.meta.status)}</span>
            ) : null}
          </div>
        )}
        {feed?.meta?.note &&
          !feed?.meta?.sensitive &&
          !shellState &&
          // The backup pack's own note ("Exhaustive shipped backup …") is internal; the banner above says it in plain words.
          !/\barchiv(e|ed)|data check\b|exhaustive shipped backup/i.test(String(feed.meta.note)) &&
          metaNote && (
          <p className="desk-note" title={technicalTitle(feed.meta.note, metaNote)}>{metaNote}</p>
        )}
        {isGlobalIntelligence && !shellState && (
          <p className="desk-note desk-trivia" role="note">
            Field note: intelligence rows are reporting context, not threat ratings. Open a record to inspect its source and date.
          </p>
        )}
        <div className={`table-wrap${loading || paging ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label={`Loading ${featureName || 'feed'}…`} />}
          {liveWait ? (
            <div className="feed-loader" role="status">
              <i className="spinner" />
              <div className="feed-loader-copy">
                <span>{LIVE_WAIT_TEXT}</span>
              </div>
            </div>
          ) : !loading && shellState ? (
            <DeskStateShell
              state={err && !feed ? { ...dataState, id: 'error', label: 'ERROR', detail: errOffline ? OFFLINE_DETAIL : SERVER_FAILED_DETAIL } : dataState}
              featureName={featureName}
              onRetry={retry}
              expectedSources={feed?.source?.links || []}
            />
          ) : (
            <table className={`feed-table${/bill passage/i.test(String(featureName || '')) ? ' feed-bills' : ''}`}>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th
                      key={c.key}
                      aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={
                        /^(house|sector|current_stage|date_introduced)$/i.test(c.key) ? 'col-meta' : undefined
                      }
                    >
                      <button type="button" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        {sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && !filtered.length ? (
                  <tr>
                    <td colSpan={Math.max(cols.length, 1)} className="load-cell">
                      Fetching rows…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={cols.length || 1}>
                      No rows in this view.
                      {(q || vizFilter || hasAnswerFilter) && (
                        <>
                          {' '}
                          <button
                            type="button"
                            className="ghost-btn tiny"
                            onClick={() => {
                              setQ('');
                              setHasAnswerFilter('');
                              onClearViz?.();
                            }}
                          >
                            Clear filters
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row, i) => {
                      const rowId = `${cellOf(row, cols[0] || { key: 'title' })}|${safePage}|${i}`;
                      const on =
                        selected === row ||
                        (selected &&
                          (selected.conflict_name || selected.title || selected.subject) &&
                          (selected.conflict_name || selected.title || selected.subject) ===
                            (row.conflict_name || row.title || row.subject));
                      const close = /central tender/i.test(featureName) ? tenderCloseBand(row) : null;
                      const rowClass = [on ? 'on' : '', close?.tone ? `close-${close.tone}` : ''].filter(Boolean).join(' ');
                      return (
                        <tr
                          key={rowId}
                          className={rowClass}
                          {...rowSelectionProps(() => (on ? onSelect(null, { toggled: row }) : onSelect(row)))}
                          {...rowDragProps(row, {
                            feature: featureName,
                            title: cellOf(row, cols[0] || { key: 'title' }) || row.title || row.name || 'Row',
                          })}
                        >
                          {cols.map((c, ci) => {
                            const raw = c.key === '_closes' ? tenderCloseBand(row).label : cellOf(row, c);
                            const text = formatCell(raw, c) || '-';
                            const pillText = c.pill && text !== '-' ? formatStatus(raw) : text;
                            const display = ci === 0 ? truncateTwoLines(text, 160) : cellText(c.pill ? pillText : text);
                            const href =
                              isArticleHref(row.source_url) && row.status !== 'source_status' && !isGithubCsvRow(row)
                                ? row.source_url
                                : '';
                            return (
                              <td
                                key={c.key}
                                title={raw || text}
                                className={
                                  [
                                    c.num || c.pct || c.inr ? 'num' : '',
                                    c.key === 'station' ? 'station-cell' : '',
                                    c.key === 'jurisdiction' ? 'jurisdiction-cell' : '',
                                    /^(house|sector|current_stage|date_introduced)$/i.test(c.key) ? 'col-meta' : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ') || undefined
                                }
                              >
                                {ci === 0 ? (
                                  <span className="name-cell">
                                    <i className="status-dot" />
                                    {href ? (
                                      <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                                        {display}
                                      </a>
                                    ) : (
                                      <span className="name-link">{display}</span>
                                    )}
                                  </span>
                                ) : c.pill && text !== '-' ? (
                                  <span className={`soft-pill ${getStatusToneClass(raw || display)}`}>{display}</span>
                                ) : (
                                  display
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          )}
        </div>
          {!loading && !shellState && usePaging ? (
            <div className="desk-pager" role="navigation" aria-label="Table pages">
              <button type="button" className="ghost-btn tiny" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Previous
              </button>
              <span className="muted">
                {safePage * LARGE_PAGE + 1}-{Math.min(matchCount, (safePage + 1) * LARGE_PAGE)} of{' '}
                {matchCount.toLocaleString('en-IN')}
                {shouldIndexSearch(registerCount) ? ' · search index' : ''}
              </span>
              <button
                type="button"
                className="ghost-btn tiny"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Next
              </button>
            </div>
          ) : null}
      </div>
    </div>
  );
}
