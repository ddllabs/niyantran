import { useEffect, useMemo, useRef, useState } from 'react';
import { exportJson, GeoAi, GeoDossierChrome, GeoKv, GeoSources } from './GeoDossier.jsx';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { aiDragProps, openAiResearch } from '../lib/aiDrop.js';

const AI_SUMMARY =
  'The tracked cohort skews toward long-tenure strongmen (Putin 1999-, Xi 2012-, Erdogan 2014-). Democratic incumbents face fragmented parliaments and fiscal constraint. Watch succession/health risk in the Gulf and the impact of 2026 elections on Ukraine support.';

const PROMPTS = [
  [
    'Succession risk',
    'Which tracked leaders carry the highest succession or stability risk in the next 24 months, and why?',
  ],
  [
    'Alignment map',
    'Group these leaders by their real strategic alignment (US-led, China-Russia, non-aligned) with reasoning.',
  ],
  ['Elections ahead', 'Which upcoming elections most affect global geopolitics and how?'],
];

const SOURCES = [
  ['Wikidata', 'https://www.wikidata.org/'],
  ['CIA World Factbook', 'https://www.cia.gov/the-world-factbook/'],
  ['Government portals', 'https://www.gov.uk/'],
];

function isoOf(id) {
  return String(id || '')
    .replace(/\d+$/, '')
    .slice(0, 2)
    .toUpperCase();
}

function field(v, fallback = 'Not reported') {
  const s = String(v ?? '').trim();
  return s && s !== '—' ? s : fallback;
}

export default function LeadersDesk({ feed, selected, onSelect, vizFilter, onClearViz }) {
  const [tab, setTab] = useState('analytics');
  const [q, setQ] = useState('');
  const detailRef = useRef(null);
  const leaders = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (feed?.rows || [])
      .filter((r) => r.name && r.country)
      .filter((r) => applyVizFilter(r, vizFilter))
      .filter((r) => !n || `${r.name} ${r.country} ${r.role || ''}`.toLowerCase().includes(n));
  }, [feed, vizFilter, q]);
  const stats = feed?.meta?.stats || {};
  const asOf = feed?.meta?.asOf || '2026-07';
  const n = stats.tracked || leaders.length;
  const aut = stats.autocracies || 0;
  const selectedId = selected?.id || '';
  const current = selectedId ? leaders.find((l) => l.id === selectedId) || selected : null;

  useEffect(() => {
    if (!current || !detailRef.current) return;
    detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll only when the selected leader changes, not on every filter pass.
  }, [current?.id]);

  function goAsk(prompt) {
    openAiResearch({
      prompt: typeof prompt === 'string' ? prompt : PROMPTS[0][1],
      attachFeed: true,
      row: current || leaders[0] || undefined,
    });
  }

  return (
    <>
      <GeoDossierChrome
        title="HEADS OF STATE"
        tag="WORLD LEADERS"
        subtitle={`AS OF ${String(asOf).toUpperCase()} · ${n} PROFILES`}
        kpis={[
          [n, 'Leaders tracked', 'acc'],
          [aut, 'Autocracies', 'warn'],
          [stats.electionsThisYear ?? 0, 'Elections · this year'],
          [stats.avgTenure || '—', 'Avg tenure'],
          [leaders.length, 'Profiled'],
          ['24/7', 'Statement watch', 'acc'],
        ]}
        tab={tab}
        onTab={(t) => {
          if (t === 'ai') {
            goAsk(PROMPTS[0][1]);
            return;
          }
          setTab(t);
        }}
        onExport={() => exportJson('leaders', { asOf, stats, leaders })}
        onAsk={() => goAsk(PROMPTS[0][1])}
        tools={
          <>
            <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
            <TableFilterPop
              feed={feed}
              q={q}
              onQ={setQ}
              searchPlaceholder="Search leader or country"
              vizFilter={vizFilter}
              onClearViz={onClearViz}
            />
          </>
        }
      >
        <div className="geo-grid">
          <section className="geo-panel">
            <div className="geo-panel-h">
              <span>Leader profiles · {leaders.length}</span>
            </div>
            <p className="desk-note" style={{ padding: '8px 12px 0' }}>
              Click a card for the full profile on the right. Placeholder titles show as Not verified. This is not a ranking.
            </p>
            <div className="geo-panel-b">
              <div className="geo-egrid">
                {leaders.map((l) => {
                  const name = l.name || 'Not verified';
                  const unverified = /not verified/i.test(name);
                  return (
                    <button
                      key={l.id || l.country}
                      type="button"
                      className={`geo-e${selectedId === l.id ? ' on' : ''}`}
                      onClick={() => onSelect?.(selectedId === l.id ? null : l)}
                      {...aiDragProps({ kind: 'row', feature: feed?.feature, title: name, row: l })}
                    >
                      <div className="geo-e-h">
                        {l.flag ? <span className="geo-e-flag">{l.flag}</span> : null}
                        <span className="geo-mono">{l.iso || isoOf(l.id) || '?'}</span>
                        <div>
                          <div className="geo-e-nm">{name}</div>
                          <div className="geo-e-sub">
                            {l.country || '—'} · {l.office || l.role || 'Office not reported'}
                          </div>
                        </div>
                      </div>
                      <dl className="geo-e-meta">
                        <dt>Status</dt>
                        <dd>{l.status || (unverified ? 'Not verified' : 'Tracked')}</dd>
                        <dt>Term start</dt>
                        <dd>{l.term_start || l.since || 'Not reported'}</dd>
                        <dt>Next transition</dt>
                        <dd>{l.next_transition || 'Not reported'}</dd>
                        <dt>Last verified</dt>
                        <dd>{l.last_verified || asOf || 'Not reported'}</dd>
                        <dt>Authority</dt>
                        <dd>{l.authority || 'De jure (as listed)'}</dd>
                      </dl>
                      {l.latest ? <div className="geo-e-latest">{l.latest}</div> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
          <div>
            {current ? (
              <section className="geo-panel geo-leader-detail" ref={detailRef}>
                <div className="geo-panel-h">
                  <span>Selected profile</span>
                  <button type="button" className="geo-btn" onClick={() => onSelect?.(null)}>
                    Clear
                  </button>
                </div>
                <div className="geo-panel-b">
                  <div className="geo-e-h" style={{ marginBottom: 10 }}>
                    {current.flag ? <span className="geo-e-flag">{current.flag}</span> : null}
                    <span className="geo-mono">{current.iso || isoOf(current.id) || '?'}</span>
                    <div>
                      <div className="geo-e-nm" style={{ fontSize: 15 }}>
                        {field(current.name, 'Not verified')}
                      </div>
                      <div className="geo-e-sub">
                        {field(current.country)} · {field(current.office || current.role, 'Office not reported')}
                      </div>
                    </div>
                  </div>
                  <GeoKv
                    rows={[
                      ['Country', field(current.country)],
                      ['Name', field(current.name, 'Not verified')],
                      ['Office', field(current.office || current.role, 'Office not reported')],
                      [
                        'Status',
                        field(current.status, /not verified/i.test(current.name || '') ? 'Not verified' : 'Tracked'),
                      ],
                      ['Term start', field(current.term_start || current.since)],
                      ['Next transition', field(current.next_transition)],
                      ['Last verified', field(current.last_verified || asOf)],
                      ['Authority', field(current.authority, 'De jure (as listed)')],
                      ['Party', field(current.party)],
                      ['Ideology', field(current.ideology)],
                      ['Age', field(current.age)],
                      ['ISO', field(current.iso || isoOf(current.id))],
                    ]}
                  />
                  {current.latest ? (
                    <p className="geo-e-latest" style={{ marginTop: 10 }}>
                      {current.latest}
                    </p>
                  ) : null}
                  {current.source_url ? (
                    <div className="geo-src" style={{ marginTop: 10 }}>
                      <a href={current.source_url} target="_blank" rel="noopener noreferrer">
                        Source ↗
                      </a>
                    </div>
                  ) : null}
                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="geo-btn pri"
                      onClick={() => goAsk(`Brief profile context for ${current.name} (${current.country}).`)}
                    >
                      Ask AI about this profile
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <p className="desk-note" style={{ padding: '0 0 8px' }}>
                Select a leader card to inspect the full profile here.
              </p>
            )}
            <GeoAi summary={AI_SUMMARY} prompts={PROMPTS} onAsk={goAsk} />
            <section className="geo-panel">
              <div className="geo-panel-h">
                <span>By government type</span>
              </div>
              <div className="geo-panel-b">
                <GeoKv
                  rows={[
                    ['Democracies', n - aut],
                    ['Autocracies', aut],
                    ['Elections / yr', stats.electionsThisYear ?? 0],
                    ['Avg tenure', stats.avgTenure || '—'],
                  ]}
                />
              </div>
            </section>
            <GeoSources links={SOURCES} asOf={asOf} />
          </div>
        </div>
      </GeoDossierChrome>
    </>
  );
}
