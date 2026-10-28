import { useEffect, useRef, useState } from 'react';
import { publicCorpusCapability, observeCoverage } from '../lib/corpusCoverage.js';
import { documentKey } from '../lib/deskRows.js';
import CorpusCapability from './CorpusCapability.jsx';
import FeedLoader from './FeedLoader.jsx';
import { feedOverview } from '../lib/analytics.js';
import { fetchFeaturePage } from '../lib/featureFeed.js';
import { relatedRowsView } from '../lib/pagedFeatures.js';
import { resolveDataState, isTerminalState } from '../lib/dataState.js';
import { plainNote, plainSourceLine, technicalTitle } from '../lib/plainSourceNote.js';
import { LIVE_WAIT_TEXT, MODULE_UNAVAILABLE_TEXT, liveHoldState } from '../desks/moduleLiveRetry.js';
import { BarList, Heatmap, Sparkline, VizCard } from './AnalyticsViz.jsx';
import RecordDetail from './RecordDetail.jsx';
import { openAiResearch } from '../lib/aiDrop.js';
import { isAlliancesFeature } from '../lib/alliances.js';
import { isSanctionsFeature } from '../lib/sanctions.js';
import { isGlobalAidFeature } from '../lib/globalAid.js';
import { isNuclearWatchFeature } from '../lib/strategicAssets.js';
import { isGlobalResourcesTable } from '../lib/globalResources.js';
import { isGeonomicsTable } from '../lib/geonomics.js';
import { isNationalTable } from '../lib/national.js';
import NationalRecord from '../desks/NationalRecord.jsx';
import RecordPanel from './record/RecordPanel.jsx';
import { adapterFor } from './record/registry.js';
import { useRecordBrief } from './record/useRecordBrief.js';
import { useRecordPacks } from './record/packs.js';
import { todayInIndia } from './record/adapters/common.js';

/**
 * The rows an adapter lists beside the selected record. A paged module (F156) holds one page, so its
 * related rows (same sector or member) are asked for as one filtered page; others use the feed's rows.
 */
export function useRelatedRows(feed, selected) {
  const [related, setRelated] = useState({ key: '', rows: [] });
  const view = feed?.paged && selected ? relatedRowsView(feed.feature, selected) : null;
  const key = view ? JSON.stringify([feed.tier, feed.feature, view]) : '';
  useEffect(() => {
    if (!key) return undefined;
    const [tier, feature, wanted] = JSON.parse(key);
    const ac = new AbortController();
    fetchFeaturePage({ tier, feature, ...wanted, signal: ac.signal })
      .then((body) => {
        if (!ac.signal.aborted) setRelated({ key, rows: body?.rows || [] });
      })
      .catch(() => {});
    return () => ac.abort();
  }, [key]);
  if (!feed?.paged) return feed?.rows || [];
  return related.key === key ? related.rows : [];
}

/**
 * A record panel with its AI brief (F123; owner decisions 2026-10-15). Opening the panel asks for
 * the record's stored brief; the first viewer's request writes it from the record's fields at the
 * platform's cost (no user credits) and later viewers read it. A Quick exit button (F128) only
 * drafts its request in AI Research, with the record attached; nothing runs until the reader sends
 * it. `today` lets an adapter mark a stated deadline as passed.
 */
function RecordPanelWithBrief({ adapter, selected, feed, loading, onSelect }) {
  const brief = useRecordBrief({ feed, selected, loading });
  const packs = useRecordPacks(feed?.feature);
  const rows = useRelatedRows(feed, selected);
  const today = todayInIndia();
  const coverageKey = /parliamentary question/i.test(feed?.feature || '')
    ? documentKey(selected, feed?.tier, feed?.feature) : null;
  const [textCoverage, setTextCoverage] = useState({ key: null, value: null });
  useEffect(() => {
    if (!coverageKey) return undefined;
    return observeCoverage([coverageKey], () => {
      setTextCoverage({ key: coverageKey, value: publicCorpusCapability({ kind: 'row', document_key: coverageKey }) });
    }) || undefined;
  }, [coverageKey]);
  const coverage = textCoverage.key === coverageKey ? textCoverage.value : null;
  return (
    <RecordPanel
      model={adapter(selected, { rows, feed, packs, today, coverage })}
      brief={brief}
      onClose={() => onSelect?.(null)}
      onAsk={() => openAiResearch({ row: selected, attachFeed: true })}
      onQuick={(prompt) => openAiResearch({ row: selected, attachFeed: true, prompt })}
      onSelect={onSelect}
    />
  );
}

function isLocalDesk(feed) {
  if (String(feed?.tier || '').toLowerCase() === 'local') return true;
  const f = String(feed?.feature || '');
  return /booth|panchayat|municipal|hyperlocal|local governance|councillor|pradhan|mgnrega|gpdp|gram panchayat|bdo\/sdo|officer directory|swing booth|anchor booth|booth political|booth-level/i.test(
    f,
  );
}

function isCarbonDesk(feed) {
  if (/^(climate|carbon)$/i.test(String(feed?.tier || ''))) return true;
  return /carbon|climate|cbam|ccts|ets & tax/i.test(String(feed?.feature || ''));
}

/** Drop archive / data-check chrome from right-rail KPIs and notes (Local + Law + shared). */
function sanitizeRailOverview(overview, { carbon = false, feed = null } = {}) {
  if (!overview) return overview;
  const dropRe = /\barchiv(e|ed)|data check|last-known-good|stored snapshot|fallback|single record|one case|whole desk|verification\b/i;
  const kpis = (overview.kpis || [])
    .map((k) => {
      const label = String(k.label || '');
      const value = String(k.value ?? '');
      const sub = String(k.sub || '');
      if (/source|data source|feed state|verification|data check/i.test(label) && dropRe.test(`${value} ${sub}`)) {
        return { ...k, value: carbon ? 'Register' : 'Register', sub: 'rows in this view' };
      }
      if (/data check|verification/i.test(label)) return null;
      if (dropRe.test(sub)) {
        return { ...k, sub: sub.replace(dropRe, 'register').replace(/\s{2,}/g, ' ').trim() || 'rows in this view' };
      }
      if (dropRe.test(value)) {
        return { ...k, value: 'Register' };
      }
      return k;
    })
    .filter(Boolean)
    .filter((k) => !/data check|verification/i.test(`${k.label} ${k.value} ${k.sub}`));
  // F164: the overview's note is usually the feed's own source note; a reader gets it in plain
  // words (or a plain source line), and the original stays as the note's `title`. Board notes and
  // other notes written for readers keep the old check.
  const raw = String(overview.note || '');
  const isSourceNote = Boolean(raw) && raw === String(feed?.source?.note || '');
  const stored = feed?.fallback || feed?.served === 'archive';
  const plain = isSourceNote ? plainNote(raw, stored ? '' : plainSourceLine(feed)) : raw;
  const note = plain && !dropRe.test(plain) ? plain : '';
  const title = String(overview.title || '')
    .replace(/\bJudgments?\b/gi, 'Judgements')
    .replace(/\bJudgement\b/g, 'Judgements')
    .replace(/\barchiv(e|ed)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { ...overview, title, kpis, note, noteDetail: technicalTitle(raw, note) };
}

/** The side panel's container classes for a feed's Desk and Record tabs (index.css styles them). */
export function railClasses(feed) {
  return `right-rail${isLocalDesk(feed) ? ' right-rail-local' : ''}${isCarbonDesk(feed) ? ' right-rail-carbon' : ''}`;
}

/**
 * The side panel's Desk and Record tabs (docs/specs/2026-10-03-side-panel.md). `view` 'desk' shows
 * the module's snapshot; 'record' shows the selected row. Both carry the module's banners.
 */
export default function RailContent({ view, feed, selected: selectedRow, onSelect, loading, vizFilter }) {
  const selected = view === 'record' ? selectedRow : null;
  const bodyRef = useRef(null);
  const localDesk = isLocalDesk(feed);
  const carbonDesk = isCarbonDesk(feed);
  const dataState = resolveDataState(feed, { loading });
  const terminal = isTerminalState(dataState) || feed?.rows?.[0]?.status === 'source_status';
  const overview = (() => {
    if (terminal) return { title: feed?.feature || 'MODULE', kpis: [], charts: [] };
    try {
      // F156: a paged module's figures come with the page, worked out over the whole register.
      return sanitizeRailOverview(feed?.paged && feed.overview ? feed.overview : feedOverview(feed), { carbon: carbonDesk, feed });
    } catch {
      return { title: feed?.feature || 'MODULE', kpis: [], charts: [], note: 'Overview could not be built for this feed.' };
    }
  })();
  const status = feed?.rows?.[0]?.status === 'source_status';
  const alliances = isAlliancesFeature(feed?.feature);
  const sanctions = isSanctionsFeature(feed?.feature);
  const aid = isGlobalAidFeature(feed?.feature);
  const nuclear = isNuclearWatchFeature(feed?.feature);
  const indicators =
    /^infra$/i.test(feed?.feature || '') ||
    /^satellite infrastructure$/i.test(feed?.feature || '') ||
    isGlobalResourcesTable(feed?.feature) ||
    isGeonomicsTable(feed?.feature) ||
    isNationalTable(feed?.feature);
  const dossier = alliances || sanctions || aid || nuclear;
  // A source-status row ("Source offline or empty") is not a record, so it keeps the old view.
  const panelAdapter = selected?.status === 'source_status' ? null : adapterFor(feed?.feature, feed?.tier);
  // F164: plain words for the state banners; the original detail stays as their `title`.
  const fallbackBanner = plainNote(dataState.detail, 'Showing the latest stored records.');
  const terminalBanner = dataState.detail
    ? plainNote(String(dataState.detail).replace(/\bdata check\b/gi, ''), dataState.id === 'planned' ? 'This module has no records yet.' : 'The source isn\u2019t responding right now.')
    : 'No records were invented for this module.';
  const showFallbackBanner =
    !localDesk && !carbonDesk && feed?.fallback && dataState.id !== 'live' && !status && dataState.detail;

  // A new record or module starts at the top.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [selected, feed?.feature]);

  return (
      <div ref={bodyRef} className={`rail-body${loading ? ' is-loading' : ''}${selected ? ' rd-body' : ''}`}>
          {loading && <FeedLoader label={`Updating ${feed?.feature || 'module'}…`} />}
          {!feed && !loading && (
            <p className="banner">Select a module. Overview clears on every route change.</p>
          )}
          {showFallbackBanner ? (
            <p className="banner" title={technicalTitle(dataState.detail, fallbackBanner)}>
              {fallbackBanner}
            </p>
          ) : null}
          {terminal && liveHoldState(feed) ? (
            // F159: the module page is still asking for live data, or has stopped asking.
            <p className="banner">{liveHoldState(feed) === 'wait' ? LIVE_WAIT_TEXT : MODULE_UNAVAILABLE_TEXT}</p>
          ) : terminal && (
            <p className="banner" title={technicalTitle([dataState.detail, dataState.host && `Host: ${dataState.host}`].filter(Boolean).join(' · '), terminalBanner)}>
              {terminalBanner}
            </p>
          )}

          {selected && selected.status !== 'source_status' ? <div className="record-capability"><CorpusCapability row={selected} feed={feed} /></div> : null}
          {terminal && !selected ? (
            <div className="rail-empty">
              <p className="muted">Analytics stay empty until live or stored rows exist for this destination.</p>
            </div>
          ) : selected && panelAdapter ? (
            // F121/F124: modules with a record-panel adapter; National modules without one keep
            // NationalRecord and every other module keeps RecordDetail.
            <RecordPanelWithBrief adapter={panelAdapter} selected={selected} feed={feed} loading={loading} onSelect={onSelect} />
          ) : selected && isNationalTable(feed?.feature) ? (
            <NationalRecord
              row={selected}
              feature={feed?.feature}
              rows={feed?.rows || []}
              meta={feed?.meta}
              liveCount={(feed?.rows || []).filter((r) => r.status !== 'source_status').length}
              onClear={() => onSelect?.(null)}
              onAskAi={() => openAiResearch({ row: selected, attachFeed: true })}
              feed={feed}
              loading={loading}
            />
          ) : selected ? (
            <RecordDetail row={selected} feed={feed} onClear={() => onSelect?.(null)} />
          ) : !indicators ? (
            <p className="rail-empty">Select a row in the feed to inspect the record.</p>
          ) : null}

          {/* CR-15/16: when a row is selected, keep the record panel — do not stack feed-level auto charts under it. */}
          {!dossier && !(selected && isNationalTable(feed?.feature)) && !selected && (
            <>
              <div className="kpi-grid">
                {overview.kpis.slice(0, 4).map((k) => (
                  <article key={k.label} className={`kpi-card${k.tone === 'ok' ? ' ok' : k.tone === 'warn' ? ' warn' : k.tone === 'bad' ? ' bad' : ''}`}>
                    <h3>{k.label}</h3>
                    <strong>{k.value}</strong>
                    <span>{k.sub}</span>
                  </article>
                ))}
              </div>
              {overview.charts.map((c) => (
                <VizCard key={c.title} title={c.title} hint={c.hint}>
                  {c.type === 'matrix' && (
                    <Heatmap
                      matrix={c.matrix}
                      active={vizFilter}
                      rowFilterCol={c.rowFilterCol}
                      colFilterCol={c.colFilterCol}
                      colFilterMap={c.colFilterMap}
                      onPick={(it) => {
                        window.dispatchEvent(new CustomEvent('niy-viz-filter', { detail: it }));
                      }}
                    />
                  )}
                  {c.type === 'bars' && (
                    <BarList
                      items={c.items}
                      active={vizFilter}
                      onPick={(it) => {
                        window.dispatchEvent(new CustomEvent('niy-viz-filter', { detail: it }));
                      }}
                    />
                  )}
                  {c.type === 'spark' && (
                    <Sparkline series={c.series} peak={c.peak} from={c.from} through={c.through} />
                  )}
                  {c.type === 'note' && <p className="viz-foot">{c.hint}</p>}
                </VizCard>
              ))}
              {overview.note ? <p className="desk-note" title={overview.noteDetail}>{overview.note}</p> : null}
            </>
          )}
        </div>
  );
}
