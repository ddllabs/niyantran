import { useMemo, useState, Fragment } from 'react';
import { energyStatusOf } from '../lib/geonomics.js';
import GeoDotsMap from './GeoDotsMap.jsx';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { aiDragProps } from '../lib/aiDrop.js';
import { downloadJson, withExportProvenance } from '../lib/exportProvenance.js';

const AI_SUMMARY =
  'The geoeconomic story is refining concentration, not just mining: China controls ~90% of rare-earth processing and near-monopoly on gallium/germanium — direct leverage in the chip war. Energy prices carry a persistent Middle-East risk premium. Uranium is re-rating on the nuclear revival.';

const PROMPTS = [
  [
    'Choke leverage',
    'Which critical mineral gives China the most usable coercive leverage over the West, and how fast can it be diversified?',
  ],
  [
    'Energy shock',
    'Trace how a Hormuz or Red Sea shock would flow through to Indian inflation and the rupee.',
  ],
  [
    'Friend-shoring',
    'Where is Western friend-shoring of critical minerals actually working vs. stalling?',
  ],
];

const SOURCES = [
  ['EIA', 'https://www.eia.gov/'],
  ['IEA critical minerals', 'https://www.iea.org/topics/critical-minerals'],
  ['USGS Mineral Commodity Summaries', 'https://www.usgs.gov/centers/national-minerals-information-center'],
  ['Trading Economics', 'https://tradingeconomics.com/commodities'],
];

export default function EnergyDesk({ feed, selected, onSelect, onAsk, vizFilter, onClearViz }) {
  const rawMinerals = useMemo(
    () => (feed?.rows || []).filter((r) => r.id && r.name).sort((a, b) => (b.intensity || 0) - (a.intensity || 0)),
    [feed],
  );
  const minerals = useMemo(() => rawMinerals.filter((r) => applyVizFilter(r, vizFilter)), [rawMinerals, vizFilter]);
  const commodities = feed?.meta?.commodities || [];
  const stats = feed?.meta?.stats || {};
  const asOf = feed?.meta?.asOf || '2026-07';
  const weaponised = minerals.filter((m) => m.status === 'escalating').length;
  const selectedId = selected?.id || minerals[0]?.id || '';
  const [openId, setOpenId] = useState('');

  const mapPts = minerals.map((m) => {
    const s = energyStatusOf(m.status);
    return {
      id: m.id,
      name: m.name,
      lat: m.lat,
      lon: m.lon,
      intensity: m.intensity,
      color: s.c,
      statusL: s.l,
    };
  });

  function exportJson() {
    downloadJson('niyantran-energy-minerals.json', {
      asOf,
      stats,
      commodities: withExportProvenance(commodities, { feature: feed?.feature || 'Energy' }),
      minerals: withExportProvenance(minerals, { feature: feed?.feature || 'Energy' }),
    });
  }

  if (!rawMinerals.length) return <div className="alw-empty-page">Energy register is unavailable.</div>;

  return (
    <div className="cpd">
      <div className="geo-top">
        <span className="geo-risk">ENERGY & CRITICAL MINERALS</span>
        <span className="geo-asof">AS OF {String(asOf).toUpperCase()} · GEOECONOMIC LEVERAGE</span>
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
      <div className="geo-kpis">
        {[
          [stats.brent || '—', 'Brent (price)', 'warn'],
          [stats.wti || '—', 'WTI (price)', 'warn'],
          [stats.ttfGas || '—', 'EU gas TTF (price)', 'warn'],
          [minerals.length, 'Minerals tracked', 'acc'],
          [weaponised, 'Supply risk flags', 'bad'],
          [String(asOf), 'As of', ''],
        ].map(([v, k, tone]) => (
          <div key={k} className="geo-kpi">
            <div className={`geo-kpi-v${tone ? ` ${tone}` : ''}`}>{v}</div>
            <div className="geo-kpi-k">{k}</div>
          </div>
        ))}
      </div>
      <p className="desk-note" style={{ padding: '0 16px 8px' }}>
        Prices, capacity/production notes, and supply-risk minerals are shown in separate sections so unlike quantities are not
        treated as one comparable board. Unit and as-of sit on each price row when present.
      </p>
      <GeoDotsMap
        points={mapPts}
        legend={[
          ['#4a90e2', 'Escalating'],
          ['#ff6f6f', 'Concentrated'],
        ]}
        onPick={(d) => {
          const hit = minerals.find((m) => m.id === d.id);
          if (hit) {
            onSelect?.(hit);
            setOpenId(hit.id);
          }
        }}
        ariaLabel="Critical mineral concentrations"
      />
      <div className="geo-grid">
        <div>
          <section className="geo-panel">
            <div className="geo-panel-h">
              <span>Market prices · unit + as-of</span>
            </div>
            <div className="geo-panel-b">
              {!commodities.length ? (
                <p className="desk-note">No price benchmarks in this feed.</p>
              ) : (
                commodities.map((c) => {
                  const up = String(c.chg || '').startsWith('+');
                  const unit = c.unit || c.u || '';
                  return (
                    <div key={c.k} className="geo-bar">
                      <span className="geo-bar-l">
                        {c.k}
                        {unit ? ` (${unit})` : ''}
                      </span>
                      <span className="geo-bar-t">
                        <i
                          style={{
                            width: `${Math.max(2, Math.min(100, c.pct || 2))}%`,
                            background: up ? '#48d17f' : '#ff6f6f',
                          }}
                        />
                      </span>
                      <span className="geo-bar-v">
                        {c.v}
                        {c.chg ? `  ${c.chg}` : ''}
                        <small style={{ display: 'block', opacity: 0.7 }}>As of {c.as_of || asOf}</small>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>
          <section className="geo-panel">
            <div className="geo-panel-h">
              <span>Capacity / production / policy risk</span>
            </div>
            <div className="geo-panel-b">
              <p className="desk-note" style={{ padding: 0, marginBottom: 8 }}>
                These are supply-risk and refining notes — not prices. Do not read intensity as a market quote.
              </p>
              {minerals.map((m) => {
                const s = energyStatusOf(m.status);
                const on = openId === m.id || m.id === selectedId;
                return (
                  <div key={m.id} className={`geo-card${on && openId === m.id ? ' open' : ''}${m.id === selectedId ? ' hl' : ''}`}>
                    <button
                      type="button"
                      className="geo-card-h"
                      onClick={() => {
                        onSelect?.(m);
                        setOpenId((id) => (id === m.id ? '' : m.id));
                      }}
                      {...aiDragProps({ kind: 'row', feature: feed?.feature, title: m.name, row: m })}
                    >
                      <span className="geo-card-dot" style={{ color: s.c, background: s.c }} />
                      <span className="geo-card-nm">{m.name}</span>
                      <span className="geo-card-st" style={{ background: `${s.c}22`, color: s.c }}>
                        {s.l}
                      </span>
                      <span className="geo-card-int" title="Relative supply-risk intensity, not a price">
                        risk {m.intensity ?? '—'}
                      </span>
                    </button>
                    {on && openId === m.id && (
                      <div className="geo-card-b">
                        <dl className="geo-fields">
                          <dt>Use</dt>
                          <dd>{m.use || 'Not reported'}</dd>
                          <dt>Region</dt>
                          <dd>{m.region || 'Not reported'}</dd>
                          <dt>Top producers</dt>
                          <dd>{m.topProducers || 'Not reported'}</dd>
                          <dt>China share</dt>
                          <dd>{m.chinaShare || 'Not reported'}</dd>
                          <dt>As of</dt>
                          <dd>{asOf}</dd>
                          <dt>Source</dt>
                          <dd>{Array.isArray(m.sources) && m.sources[0] ? m.sources[0][0] : 'See sources list'}</dd>
                        </dl>
                        <div className="geo-card-latest">{m.note || m.latest || ''}</div>
                        {Array.isArray(m.sources) && m.sources.length ? (
                          <div className="geo-src">
                            {m.sources.map((pair) => (
                              <a key={pair[1]} href={pair[1]} target="_blank" rel="noopener noreferrer">
                                {pair[0]} ↗
                              </a>
                            ))}
                          </div>
                        ) : null}
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
          <section className="geo-panel">
            <div className="geo-panel-h">
              <span>Benchmark levels</span>
            </div>
            <div className="geo-panel-b">
              <dl className="geo-kv">
                {commodities.slice(0, 3).map((c) => (
                  <Fragment key={c.k}>
                    <dt>{c.k}</dt>
                    <dd>{c.v}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          </section>
          <section className="geo-panel">
            <div className="geo-panel-h">
              <span>Sources & Methodology</span>
            </div>
            <div className="geo-panel-b">
              <div className="geo-src">
                {SOURCES.map(([label, href]) => (
                  <a key={href} href={href} target="_blank" rel="noopener noreferrer">
                    {label} ↗
                  </a>
                ))}
              </div>
              <p className="gld-src-note">
                Prices and supply-risk minerals are separate. {stats.note || 'Illustrative levels — swaps to EIA/Trading Economics live.'}{' '}
                As of {asOf}.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
