import { useEffect, useRef, useState } from 'react';
import FeedLoader from './FeedLoader.jsx';
import { feedOverview } from '../lib/analytics.js';
import { resolveDataState, isTerminalState } from '../lib/dataState.js';
import { BarList, Heatmap, Sparkline, VizCard } from './AnalyticsViz.jsx';
import RecordDetail from './RecordDetail.jsx';
import { openAiResearch } from '../lib/aiDrop.js';
import AlliancesAnalytics from '../desks/AlliancesAnalytics.jsx';
import SanctionsAnalytics from '../desks/SanctionsAnalytics.jsx';
import GlobalAidAnalytics from '../desks/GlobalAidAnalytics.jsx';
import NuclearAnalytics from '../desks/NuclearAnalytics.jsx';
import { isAlliancesFeature } from '../lib/alliances.js';
import { isSanctionsFeature } from '../lib/sanctions.js';
import { isGlobalAidFeature } from '../lib/globalAid.js';
import { isNuclearWatchFeature } from '../lib/strategicAssets.js';
import { isGlobalResourcesTable } from '../lib/globalResources.js';
import { isGeonomicsTable } from '../lib/geonomics.js';
import { isNationalTable } from '../lib/national.js';
import NationalRecord from '../desks/NationalRecord.jsx';

function recordLabel(row) {
  return String(row?.conflict_name || row?.title || row?.bill_name || row?.name || '').trim();
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
function sanitizeRailOverview(overview, { carbon = false } = {}) {
  if (!overview) return overview;
  const dropRe = /\barchiv(e|ed)|data check|last-known-good|stored snapshot|fallback|single record|one case|whole desk|verification\b/i;
  const kpis = (overview.kpis || [])
    .map((k) => {
      const label = String(k.label || '');
      const value = String(k.value ?? '');
      const sub = String(k.sub || '');
      if (/source|data source|feed state|gdelt|verification|data check/i.test(label) && dropRe.test(`${value} ${sub}`)) {
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
  const note = overview.note && !dropRe.test(overview.note) ? overview.note : '';
  const title = String(overview.title || '')
    .replace(/\bJudgments?\b/gi, 'Judgements')
    .replace(/\bJudgement\b/g, 'Judgements')
    .replace(/\barchiv(e|ed)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { ...overview, title, kpis, note };
}

export default function RightRail({ feed, selected, onSelect, lang, loading, vizFilter }) {
  const [tab, setTab] = useState('analytics');
  const bodyRef = useRef(null);
  const hi = lang === 'hi';
  const localDesk = isLocalDesk(feed);
  const carbonDesk = isCarbonDesk(feed);
  const dataState = resolveDataState(feed, { loading });
  const terminal = isTerminalState(dataState) || feed?.rows?.[0]?.status === 'source_status';
  const overview = (() => {
    if (terminal) return { title: feed?.feature || 'MODULE', kpis: [], charts: [] };
    try {
      return sanitizeRailOverview(feedOverview(feed), { carbon: carbonDesk });
    } catch {
      return { title: feed?.feature || 'MODULE', kpis: [], charts: [], note: 'Overview could not be built for this feed.' };
    }
  })();
  const gdelt = Boolean(feed?.source?.gdelt);
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
  const analyticsTitle = dossier ? 'Event analytics' : overview.title;
  const showFallbackBanner =
    !localDesk && !carbonDesk && feed?.fallback && dataState.id !== 'live' && !status && dataState.detail;

  useEffect(() => {
    setTab('analytics');
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [selected, feed?.feature]);

  return (
    <aside className={`right-rail${localDesk ? ' right-rail-local' : ''}${carbonDesk ? ' right-rail-carbon' : ''}`} key={feed?.feature || 'empty'}>
      <div className="rail-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'analytics'}
          className={tab === 'analytics' ? 'on' : ''}
          onClick={() => setTab('analytics')}
          title={selected ? recordLabel(selected) : overview.title}
        >
          {analyticsTitle}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={false}
          disabled={terminal}
          onClick={() => openAiResearch({ attachFeed: true, row: selected || undefined })}
        >
          {hi ? 'एआई अनुसंधान' : 'AI research'}
        </button>
      </div>
      <div ref={bodyRef} className={`rail-body${loading ? ' is-loading' : ''}${selected ? ' rd-body' : ''}`}>
          {loading && <FeedLoader label={`Updating ${feed?.feature || 'module'}…`} />}
          {!feed && !loading && (
            <p className="banner">Select a module. Overview clears on every route change.</p>
          )}
          {gdelt && !terminal && <p className="banner warn">GDELT reporting search - not an official dataset.</p>}
          {showFallbackBanner ? (
            <p className="banner">
              {String(dataState.detail).replace(/\barchiv(e|ed)\b/gi, 'stored snapshot')}
            </p>
          ) : null}
          {terminal && (
            <p className="banner">
              {String(dataState.detail || 'No records were invented for this module.')
                .replace(/\barchiv(e|ed)\b/gi, 'stored pack')
                .replace(/\bdata check\b/gi, '')}
              {dataState.host ? ` Configured host: ${dataState.host}.` : ''}
            </p>
          )}

          {terminal && !selected ? (
            <div className="rail-empty">
              <p className="muted">Analytics stay empty until live or stored rows exist for this destination.</p>
            </div>
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
          ) : selected && alliances ? (
            <AlliancesAnalytics
              row={selected}
              rows={feed?.rows || []}
              flags={feed?.meta?.memberFlags || {}}
              onSelect={onSelect}
              onResearch={() => openAiResearch({ row: selected, attachFeed: true })}
              feed={feed}
              loading={loading}
            />
          ) : selected && sanctions ? (
            <SanctionsAnalytics
              row={selected}
              onResearch={() => openAiResearch({ row: selected, attachFeed: true })}
              feed={feed}
              loading={loading}
            />
          ) : selected && aid ? (
            <GlobalAidAnalytics
              row={selected}
              rows={feed?.rows || []}
              onSelect={onSelect}
              onResearch={() => openAiResearch({ row: selected, attachFeed: true })}
              feed={feed}
              loading={loading}
            />
          ) : selected && nuclear ? (
            <NuclearAnalytics
              row={selected}
              rows={feed?.rows || []}
              onSelect={onSelect}
              onResearch={() => openAiResearch({ row: selected, attachFeed: true })}
              feed={feed}
              loading={loading}
            />
          ) : selected && !indicators ? (
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
              {overview.note ? <p className="desk-note">{overview.note}</p> : null}
            </>
          )}
        </div>
    </aside>
  );
}
