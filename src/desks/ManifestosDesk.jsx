import { rowSelectionProps } from '../shell/rowSelection.js';
import { useEffect, useMemo, useState } from 'react';
import { MANIFESTO_LIBRARY, UNION_PROMISES } from '../data/nationalCurated.js';
import { applyVizFilter } from '../lib/nationalKpi.js';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import TableFilterPop, { choiceGroup, matchesChoice } from '../shell/TableFilterPop.jsx';
import { rowDragProps } from '../lib/aiDrop.js';
import { getStatusToneClass } from '../lib/format.js';

const STATUS_HELP = {
  Verifiable: 'Can be checked against a public document or official release.',
  'Partly verifiable': 'Some parts can be checked; others need more evidence.',
  'Not yet verifiable': 'No clear public evidence attached in this tracker yet.',
  Aspirational: 'Direction or intent — not a measurable delivery claim in this row.',
};

function curatedRows() {
  return UNION_PROMISES.map(([promise, domain, verifiable_status]) => ({
    promise,
    domain,
    verifiable_status,
    title: promise,
    party: 'Union / national cycle',
    year: '2024',
    cycle: '2024',
    latest_evidence: 'Not attached in this curated row — use manifesto library links.',
    verified: 'Curated status only · verify against Gazette / PIB',
    methodology:
      'Status is about whether a claim can be checked, not whether it is fulfilled or broken. No automatic verdict on a named party.',
  }));
}

export default function ManifestosDesk({ selected, onSelect, onFeed, vizFilter, onClearViz }) {
  const rows = useMemo(() => curatedRows(), []);
  const [domain, setDomain] = useState('all');
  const [year, setYear] = useState('2024');
  const domains = useMemo(() => [...new Set(rows.map((r) => r.domain).filter(Boolean))], [rows]);
  const filtered = rows.filter(
    (r) =>
      applyVizFilter(r, vizFilter) &&
      matchesChoice(domain, r.domain, 'all') &&
      (year === 'all' || String(r.cycle || '2024') === year),
  );

  useEffect(() => {
    onFeed?.({
      ok: true,
      tier: 'national',
      feature: 'LS Manifestos & Promises Tracker',
      rows,
      kind: 'curated',
      source: {
        adapter: 'embedded',
        note: 'CURATED · AS OF JAN 2026 · VERIFY AGAINST GAZETTE / PIB. Verifiable status, not fulfilled/broken.',
      },
      coverage: { from: '2024', through: '2024', exhaustive: false },
      fallback: false,
      meta: {
        section: 'UNION MANIFESTO TRACKER — 2024',
        status: 'CURATED · VERIFY AGAINST GAZETTE / PIB',
        heading: 'MANIFESTOS & PROMISES',
      },
    });
  }, [onFeed, rows]);

  return (
    <div className="nat-panel">
      <div className="feed-head">
        <h1>MANIFESTOS & PROMISES</h1>
        <span className="live-feed">CURATED</span>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop
          feed={{ feature: 'LS Manifestos & Promises Tracker', rows }}
          vizFilter={vizFilter}
          onClearViz={onClearViz}
          extraGroups={[choiceGroup('Domain', domains, domain, setDomain, { allValue: 'all', allLabel: 'All domains' })]}
        />
      </div>
      <div className="desk-strip">
        <span>UNION MANIFESTO TRACKER — 2024 PROMISES</span>
        <span>CURATED · AS OF JAN 2026 · VERIFY AGAINST GAZETTE / PIB</span>
      </div>
      <div className="banner warn desk-sensitive" role="note">
        <strong>Sources & methodology</strong>
        <span>
          Status answers “can this be checked?”, not “was it kept?”. Fulfilled / Broken badges are not used. Primary evidence
          links per promise are not in this curated set yet — use the manifesto library below and the side panel when a row is
          selected.
        </span>
      </div>
      <div className="nls-chips">
        <button type="button" className={`nls-chip${year === '2024' ? ' on' : ''}`} onClick={() => setYear('2024')}>
          2024
        </button>
        <button type="button" className="nls-chip" disabled title="Only one national cycle is in this tracker">
          Other years
        </button>
      </div>
      <div className="table-wrap">
        <table className="feed-table">
          <thead>
            <tr>
              <th>Party / cycle</th>
              <th>Year</th>
              <th>Promise</th>
              <th>Domain</th>
              <th>Verifiable status</th>
              <th>Latest evidence</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr
                key={r.promise || i}
                className={selected?.promise === r.promise ? 'on' : ''}
                {...rowSelectionProps(() => onSelect?.(selected?.promise === r.promise ? null : r))}
                {...rowDragProps(r, { title: r.promise || r.title, feature: 'Manifestos' })}
              >
                <td>{r.party}</td>
                <td>{r.year}</td>
                <td>{r.promise || r.title}</td>
                <td>{r.domain}</td>
                <td title={STATUS_HELP[r.verifiable_status] || ''}>
                  <span className={`soft-pill ${getStatusToneClass(r.verifiable_status || r.status)}`}>
                    {r.verifiable_status || r.status || '—'}
                  </span>
                </td>
                <td>{r.latest_evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="nat-subh">Manifesto library (primary documents)</h3>
      <ul className="nat-lib">
        {MANIFESTO_LIBRARY.map(([lab, href]) => (
          <li key={href}>
            <a href={href} target="_blank" rel="noreferrer">
              {lab}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
