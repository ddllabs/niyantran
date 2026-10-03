import { rowSelectionProps } from '../shell/rowSelection.js';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { fetchFeature } from '../lib/featureFeed.js';
import { openAiResearch, rowDragProps } from '../lib/aiDrop.js';
import { cellText, filterRows, isArticleHref, sortRows } from '../lib/normalise.js';
import { buildTableSearchIndex, searchTableRows, shouldIndexSearch } from '../lib/tableSearch.js';
import { formatCell, formatDate, formatStatus, getStatusToneClass, truncateTwoLines } from '../lib/format.js';
import { isTerminalState, resolveDataState } from '../lib/dataState.js';
import { isGithubCsvRow } from '../lib/githubCsv.js';
import { cellOf, feedColumns } from '../lib/columns.js';
import { prepareDeskFeed } from '../lib/prepareDeskFeed.js';
import { sensitiveNoteFor } from '../lib/sensitiveData.js';
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

function isParliamentaryQuestions(name) {
  return /parliamentary question/i.test(String(name || ''));
}

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
  const [page, setPage] = useState(0);
  const [hasAnswerFilter, setHasAnswerFilter] = useState('');
  const colsKey = featureName ? `niy-cols:${tier || ''}:${featureName}` : '';
  const filtersKey = featureName ? `niy-filters:${tier || ''}:${featureName}` : '';
  const questionsDesk = isParliamentaryQuestions(featureName);

  useEffect(() => {
    setQ('');
    setPage(0);
    setHasAnswerFilter('');
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
    const ac = new AbortController();
    setLoading(true);
    onLoading?.(true);
    setErr('');
    fetchFeature({ tier, feature: featureName, signal: ac.signal })
      .then((body) => {
        if (ac.signal.aborted) return;
        const prepared = prepareDeskFeed(body);
        setFeed(prepared);
        onFeed(prepared);
        onSelect(null);
      })
      .catch((e) => {
        if (e.name === 'AbortError' || ac.signal.aborted) return;
        setErr(e.message || String(e));
        setFeed(null);
        onFeed(null);
      })
      .finally(() => {
        if (ac.signal.aborted) return;
        setLoading(false);
        onLoading?.(false);
      });
    return () => ac.abort();
  }, [tier, featureName, onFeed, onSelect, onLoading, reload, reloadTick]);

  const searchIndex = useMemo(() => {
    const rows = feed?.rows || [];
    if (!shouldIndexSearch(rows.length)) return null;
    return buildTableSearchIndex(rows);
  }, [feed]);

  const filtered = useMemo(() => {
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

  useEffect(() => {
    setPage(0);
  }, [deferredQ, sort, vizFilter, hasAnswerFilter, featureName]);

  const usePaging = filtered.length > LARGE_PAGE;
  const pageCount = Math.max(1, Math.ceil(filtered.length / LARGE_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(() => {
    if (!usePaging) return filtered;
    const start = safePage * LARGE_PAGE;
    return filtered.slice(start, start + LARGE_PAGE);
  }, [filtered, usePaging, safePage]);

  const allCols = useMemo(() => feedColumns(feed?.feature || featureName, filtered), [feed, featureName, filtered]);
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
  const dataState = resolveDataState(feed, { loading, error: err });
  const liveOn = dataState.id === 'live';
  const shellState = isTerminalState(dataState) || (err && !feed) || statusRow;

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  function retry() {
    setReloadTick((n) => n + 1);
  }

  if (isTransitFeature(featureName)) {
    return <TransitDesk onFeed={onFeed} onSelect={onSelect} onLoading={onLoading} reload={reload} />;
  }

  if (isAlliancesFeature(featureName) && !statusRow) {
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

  if (isSanctionsFeature(featureName) && !statusRow) {
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

  if (isGlobalAidFeature(featureName) && !statusRow) {
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

  if (isNuclearWatchFeature(featureName) && !statusRow) {
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

  if (isChokepointsFeature(featureName) && !statusRow) {
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

  if (isEnergyFeature(featureName) && !statusRow) {
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

  if (isPolicyGraphFeature(featureName) && !statusRow) {
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

  if (isFundFlowFeature(featureName) && !statusRow) {
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

  if (isBudgetFeature(featureName) && !statusRow) {
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

  if (isProjectsFeature(featureName) && !statusRow) {
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

  if (isMpCardsFeature(featureName) && !statusRow) {
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

  if (isIndustryFeature(featureName) && !statusRow) {
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

  if (isIndustryFeature(featureName) && statusRow) {
    return (
      <div className="desk desk-wide desk-res">
        {err && <p className="banner warn">{err}</p>}
        <IndustryDesk feed={feed} statusRow={statusRow} selected={selected} onSelect={onSelect} vizFilter={vizFilter} onClearViz={onClearViz} />
      </div>
    );
  }

  if (isHeadsOfStateFeature(featureName) && !statusRow) {
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

  if (isGlobalCommoditiesFeature(featureName) && !statusRow) {
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

  if (isConflictsFeature(featureName) && !statusRow) {
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
  const coverageLabel = (() => {
    if (loading) return 'Fetching…';
    if (shellState) return dataState.coverage || 'No live rows';
    const n = filtered.length;
    const total = feed?.rows?.length;
    if (/open fronts/i.test(featureName || '')) {
      const through = formatDate(feed?.coverage?.through) || feed?.coverage?.through || '';
      return `${n} conflict${n === 1 ? '' : 's'}${through ? ` · through ${through}` : ''}`;
    }
    return `${n}${total && n !== total ? ` / ${total}` : ''} rows${feed?.coverage?.exhaustive ? ' · exhaustive' : ''}${
      usePaging ? ` · page ${safePage + 1}/${pageCount}` : ''
    }${dataState.lastSync ? ` · sync ${dataState.lastSync}` : ''}`;
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
          <span className="muted">{coverageLabel}</span>
        </div>
        {feed?.fallback && dataState.id !== 'live' && !shellState && dataState.detail && tier !== 'local' && !isCarbonDesk ? (
          <p className="banner">{String(dataState.detail).replace(/\barchiv(e|ed)\b/gi, 'stored snapshot')}</p>
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
              {String(feed.meta.section)
                .replace(/\bJudgments?\b/gi, 'Judgements')
                .replace(/\bCLIMATE NEWSWIRE\b/gi, 'Climate wire')
                .replace(/\bREGISTRY WIRE\b/gi, 'Registry wire')
                .replace(/\barchiv(e|ed)\b/gi, '')
                .replace(/\s{2,}/g, ' ')
                .trim()}
            </span>
            {feed.meta.status &&
            String(feed.meta.status).trim() &&
            !/\barchiv(e|ed)|data check\b/i.test(String(feed.meta.status)) ? (
              <span>{String(feed.meta.status)}</span>
            ) : null}
          </div>
        )}
        {feed?.meta?.note &&
          !feed?.meta?.sensitive &&
          !shellState &&
          !/\barchiv(e|ed)|data check\b/i.test(String(feed.meta.note)) && (
          <p className="desk-note">{String(feed.meta.note).replace(/\bJudgments?\b/gi, 'Judgements')}</p>
        )}
        {isGlobalIntelligence && !shellState && (
          <p className="desk-note desk-trivia" role="note">
            Field note: intelligence rows are reporting context, not threat ratings. Open a record to inspect its source and date.
          </p>
        )}
        <div className={`table-wrap${loading ? ' is-loading' : ''}`}>
          {loading && <FeedLoader label={`Loading ${featureName || 'feed'}…`} />}
          {!loading && shellState ? (
            <DeskStateShell
              state={err && !feed ? { ...dataState, id: 'error', label: 'ERROR', detail: err } : dataState}
              featureName={featureName}
              onRetry={retry}
              expectedSources={(feed?.source?.links || []).join(', ')}
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
                      Fetching rows from the feature feed…
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
                          {...rowSelectionProps(() => onSelect(on ? null : row))}
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
                {safePage * LARGE_PAGE + 1}-{Math.min(filtered.length, (safePage + 1) * LARGE_PAGE)} of{' '}
                {filtered.length.toLocaleString('en-IN')}
                {shouldIndexSearch(feed?.rows?.length) ? ' · search index' : ''}
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
