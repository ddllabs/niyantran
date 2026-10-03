import { rowSelectionProps } from '../shell/rowSelection.js';
import { useEffect } from 'react';
import { BUDGET_KEY, BUDGET_SCHEMES } from '../data/nationalCurated.js';
import { applyVizFilter } from '../lib/nationalKpi.js';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { rowDragProps } from '../lib/aiDrop.js';

const FY = '2025–26';

export default function BudgetDesk({ selected, onSelect, onFeed, vizFilter, onClearViz }) {
  const all = BUDGET_SCHEMES.map(([scheme, allocation_cr]) => ({
    scheme,
    ministry: '—',
    fy: FY,
    be_cr: allocation_cr,
    re_cr: null,
    actual_cr: null,
    utilization_pct: null,
    allocation_cr,
    title: scheme,
    type: 'scheme_be',
    note: 'Budget Estimate (BE) allocation only — approximate. Not RE, not Actual, not utilisation.',
    source: 'indiabudget.gov.in (verify PDF)',
  }));

  const keyRows = BUDGET_KEY.map(([measure, value, note]) => ({
    scheme: measure,
    title: measure,
    measure,
    value,
    note,
    fy: FY,
    type: 'key_number',
    be_cr: null,
    re_cr: null,
    actual_cr: null,
    utilization_pct: null,
    source: 'indiabudget.gov.in (verify PDF)',
  }));

  const schemeRows = all.filter((r) => applyVizFilter(r, vizFilter));
  const feed = { feature: 'Budget Utilisation Tracker', rows: [...keyRows, ...all] };

  useEffect(() => {
    onFeed?.({
      ok: true,
      tier: 'national',
      feature: 'Budget Utilisation Tracker',
      rows: [...keyRows, ...all],
      kind: 'curated',
      source: {
        adapter: 'embedded',
        note: `CURATED · Union Budget ${FY} · BE allocations only · PDF is authoritative`,
      },
      coverage: { from: FY, through: FY, exhaustive: false },
      meta: {
        section: `UNION BUDGET ${FY}`,
        status: 'CURATED · BE ONLY · NO RE / ACTUAL / UTILISATION',
        heading: 'BUDGET & SCHEMES',
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onFeed]);

  return (
    <div className="nat-panel">
      <div className="feed-head">
        <h1>BUDGET & SCHEMES</h1>
        <span className="live-feed">CURATED</span>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop feed={feed} vizFilter={vizFilter} onClearViz={onClearViz} />
      </div>
      <div className="desk-strip">
        <span>UNION BUDGET {FY} — KEY NUMBERS</span>
        <span>CURATED · VERIFY AGAINST INDIABUDGET.GOV.IN · PDF IS AUTHORITATIVE</span>
      </div>
      <p className="desk-note desk-sensitive-inline">
        This page shows Budget Estimates (BE) only. Revised Estimates (RE), Actuals, and Utilisation % are not in this dataset —
        they are not invented on screen. Value and Note for key lines open in the side panel when you select a row.
      </p>

      <h3 className="nat-subh">Key budget lines · {FY}</h3>
      <div className="table-wrap">
        <table className="feed-table">
          <thead>
            <tr>
              <th>Scheme / Measure</th>
              <th>FY</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {keyRows.map((r) => (
              <tr
                key={r.measure}
                className={selected?.measure === r.measure ? 'on' : ''}
                {...rowSelectionProps(() => onSelect?.(selected?.measure === r.measure ? null : r))}
                {...rowDragProps(r, { title: r.measure, feature: 'Budget Utilisation Tracker' })}
              >
                <td>{r.measure}</td>
                <td>{r.fy}</td>
                <td>Key number</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="nat-subh">Major scheme allocations · {FY} BE (₹ crore, approx.)</h3>
      <p className="desk-note">
        Columns: Scheme · FY · BE. RE / Actual / Utilisation stay “Not reported” until a fiscal series is connected.
      </p>
      <div className="table-wrap">
        <table className="feed-table">
          <thead>
            <tr>
              <th>Scheme / Measure</th>
              <th>Ministry</th>
              <th>FY</th>
              <th>BE (₹ cr)</th>
              <th>RE</th>
              <th>Actual</th>
              <th>Utilization %</th>
            </tr>
          </thead>
          <tbody>
            {schemeRows.map((r) => (
              <tr
                key={r.scheme}
                className={selected?.scheme === r.scheme && selected?.type === 'scheme_be' ? 'on' : ''}
                {...rowSelectionProps(() => onSelect?.(selected?.scheme === r.scheme && selected?.type === 'scheme_be' ? null : r))}
                {...rowDragProps(r, { title: r.scheme, feature: 'Budget Utilisation Tracker' })}
              >
                <td>{r.scheme}</td>
                <td>{r.ministry}</td>
                <td>{r.fy}</td>
                <td className="num">~{Number(r.be_cr).toLocaleString('en-IN')}</td>
                <td className="num">Not reported</td>
                <td className="num">Not reported</td>
                <td className="num">Not reported</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
