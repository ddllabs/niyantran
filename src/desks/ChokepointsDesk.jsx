import { useEffect, useMemo, useState } from 'react';
import { chokeStatusOf, hydrateAsset } from '../lib/strategicAssets.js';
import GeoDotsMap from './GeoDotsMap.jsx';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { aiDragProps } from '../lib/aiDrop.js';
import { downloadJson, withExportProvenance } from '../lib/exportProvenance.js';
import { liveApiEnabled } from '../lib/apiMode.js';

const AI_SUMMARY =
  'Bab-el-Mandeb and Hormuz are the acute risks: Houthi strikes have already rerouted Suez traffic around the Cape (+10-14 days), and any Hormuz disruption removes ~1/5 of world oil with no bypass. Panama’s constraint is climate, not conflict.';

const PROMPTS = [
  ['Closure scenario', 'Model the global price and supply-chain impact if the Strait of Hormuz were closed for 30 days.'],
  ['Reroute cost', 'Quantify the cost of the Red Sea / Bab-el-Mandeb disruption on Asia-Europe shipping.'],
  ['China exposure', 'How exposed is China to the Malacca dilemma and what is it doing to hedge it?'],
];

export default function ChokepointsDesk({ feed, selected, onSelect, onAsk, vizFilter, onClearViz }) {
  const allList = useMemo(
    () => (feed?.rows || []).map((r) => hydrateAsset(r, 'chokepoint')).filter((p) => p?.id),
    [feed],
  );
  const list = useMemo(() => allList.filter((p) => applyVizFilter(p.row || p, vizFilter)), [allList, vizFilter]);
  const ranked = useMemo(() => [...list].sort((a, b) => (b.row?.intensity || 0) - (a.row?.intensity || 0)), [list]);
  const stats = feed?.meta?.stats || {};
  const asOf = feed?.meta?.asOf || '2026-07';
  const escalating = list.filter((p) => p.status === 'escalating').length;
  const selectedId = selected?.id || selected?.__saId || ranked[0]?.id || '';
  const [liveOpen, setLiveOpen] = useState(false);
  const [live, setLive] = useState(null);
  const [liveErr, setLiveErr] = useState('');
  const [openId, setOpenId] = useState('');

  const mapPts = ranked.map((p) => {
    const s = chokeStatusOf(p.status);
    return {
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      intensity: p.row?.intensity,
      color: s.c,
      statusL: s.l,
    };
  });

  useEffect(() => {
    if (!ranked.length) return;
    if (selected && ranked.some((p) => p.id === (selected.id || selected.__saId))) return;
    onSelect?.(ranked[0].row);
  }, [ranked, selected, onSelect]);

  useEffect(() => {
    if (!liveOpen) return undefined;
    if (!liveApiEnabled()) {
      setLiveErr('Live PortWatch API is not deployed on this host.');
      return undefined;
    }
    const ac = new AbortController();
    setLiveErr('');
    fetch('/api/portwatch', { signal: ac.signal })
      .then((r) => r.json())
      .then((body) => {
        if (ac.signal.aborted) return;
        if (!body?.ok && !body?.rows?.length) throw new Error(body?.error || 'empty');
        setLive(body);
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setLiveErr(e.message || String(e));
      });
    return () => ac.abort();
  }, [liveOpen]);

  function exportJson() {
    downloadJson('niyantran-chokepoints.json', {
      asOf,
      stats,
      points: withExportProvenance(
        list.map((p) => p.row),
        { feature: feed?.feature || 'Maritime Choke-Points' },
      ),
    });
  }

  if (!allList.length) return <div className="alw-empty-page">Chokepoint register is unavailable.</div>;

  const liveRows = live?.rows || [];

  return (
    <div className="cpd">
      <div className="geo-top">
        <span className="geo-risk">MARITIME CHOKEPOINTS</span>
        <span className="geo-asof">
          AS OF {String(asOf).toUpperCase()} · {list.length} TRACKED
        </span>
        <button type="button" className="geo-btn live" onClick={() => setLiveOpen((v) => !v)}>
          LATEST ↗
        </button>
        <span className="geo-actions">
          <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
          <TableFilterPop feed={feed} vizFilter={vizFilter} onClearViz={onClearViz} />
          <button type="button" className="geo-btn" onClick={exportJson}>
            Export JSON
          </button>
          <button type="button" className="geo-btn pri" onClick={() => onAsk?.(PROMPTS[0][1])}>
            Ask AI
          </button>
        </span>
      </div>
      {liveOpen && (
        <aside className="alw-live cpd-live" aria-label="IMF PortWatch">
          <div className="alw-live-head">
            <span className="alw-live-dot" />
            <strong>IMF PortWatch</strong>
            <button type="button" className="alw-live-x" onClick={() => setLiveOpen(false)} aria-label="Close live feed">
              ✕
            </button>
          </div>
          <p className="alw-live-meta">
            {liveErr
              ? 'Live source unreachable'
              : live?.date
                ? `Transit day ${String(live.date).slice(0, 10)} · ${liveRows.length} chokepoints`
                : 'Loading…'}
          </p>
          <div className="alw-live-list">
            {liveRows.map((x) => (
              <div key={x.title} className="alw-live-link">
                <label>{x.transits} transits</label>
                <span>{x.title}</span>
              </div>
            ))}
          </div>
        </aside>
      )}
      <div className="geo-kpis">
        {[
          [stats.chokepoints || list.length, 'Chokepoints', 'acc'],
          [stats.oilTransitMbd || '—', 'Oil transit', 'warn'],
          [stats.atRisk || 0, 'At extreme risk', 'bad'],
          [stats.tradeSharePct || '—', 'Of global trade'],
          [escalating, 'Escalating', 'warn'],
          ['Live', 'AIS-linkable', 'acc'],
        ].map(([v, k, tone]) => (
          <div key={k} className="geo-kpi">
            <div className={`geo-kpi-v${tone ? ` ${tone}` : ''}`}>{v}</div>
            <div className="geo-kpi-k">{k}</div>
          </div>
        ))}
      </div>
      <GeoDotsMap
        points={mapPts}
        legend={[
          ['#ff6f6f', 'Active'],
          ['#4a90e2', 'Escalating'],
          ['#7fb0ff', 'Watch'],
        ]}
        onPick={(d) => {
          const hit = list.find((p) => p.id === d.id);
          if (hit) {
            onSelect?.(hit.row);
            setOpenId(hit.id);
          }
        }}
        ariaLabel="Maritime chokepoints"
      />
      <div className="geo-grid">
        <div>
          <section className="geo-panel">
            <div className="geo-panel-h">
              <span>Strategic risk ranking</span>
            </div>
            <div className="geo-panel-b">
              {ranked.map((p) => {
                const s = chokeStatusOf(p.status);
                const n = p.row?.intensity || 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`geo-bar cpd-rank${p.id === selectedId ? ' on' : ''}`}
                    onClick={() => onSelect?.(p.row)}
                    {...aiDragProps({ kind: 'row', feature: feed?.feature, title: p.name, row: p.row || p })}
                  >
                    <span className="geo-bar-l">{p.name}</span>
                    <span className="geo-bar-t">
                      <i style={{ width: `${Math.max(2, Math.min(100, n))}%`, background: s.c }} />
                    </span>
                    <span className="geo-bar-v">{n}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="geo-panel">
            <div className="geo-panel-h">
              <span>Chokepoint dossiers · {list.length}</span>
            </div>
            <div className="geo-panel-b">
              {ranked.map((p) => {
                const s = chokeStatusOf(p.status);
                const on = openId === p.id || p.id === selectedId;
                return (
                  <div key={p.id} className={`geo-card${on && openId === p.id ? ' open' : ''}${p.id === selectedId ? ' hl' : ''}`}>
                    <button type="button" className="geo-card-h" onClick={() => { onSelect?.(p.row); setOpenId((id) => (id === p.id ? '' : p.id)); }} {...aiDragProps({ kind: 'row', feature: feed?.feature, title: p.name, row: p.row || p })}>
                      <span className="geo-card-dot" style={{ color: s.c, background: s.c }} />
                      <span className="geo-card-nm">{p.name}</span>
                      <span className="geo-card-st" style={{ background: `${s.c}22`, color: s.c }}>
                        {s.l}
                      </span>
                      <span className="geo-card-int">{p.row?.intensity}</span>
                    </button>
                    {on && openId === p.id && (
                      <div className="geo-card-b">
                        <dl className="geo-fields">
                          <dt>Region</dt>
                          <dd>{p.region}</dd>
                          <dt>Oil transit</dt>
                          <dd>{p.oil}</dd>
                          <dt>Narrowest</dt>
                          <dd>{p.width}</dd>
                          <dt>Operators</dt>
                          <dd>{p.operators}</dd>
                          <dt>Risk</dt>
                          <dd>{p.risk}</dd>
                        </dl>
                        <div className="geo-card-latest">{p.note}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
        <div>
          <div className="geo-ai">
            <h4>◆ AI Intelligence Summary</h4>
            <p>{AI_SUMMARY}</p>
            <div className="geo-ai-q">
              {PROMPTS.map(([label, q]) => (
                <button key={label} type="button" onClick={() => onAsk?.(q)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
