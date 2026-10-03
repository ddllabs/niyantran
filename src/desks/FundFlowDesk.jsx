import { rowSelectionProps } from '../shell/rowSelection.js';
import { useMemo, useState } from 'react';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { rowDragProps } from '../lib/aiDrop.js';

function fmtCr(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

const PERIODS = [
  { key: 'actuals_2425', label: 'Actuals 2024–25' },
  { key: 'be_2526', label: 'BE 2025–26' },
  { key: 're_2526', label: 'RE 2025–26' },
  { key: 'be_2627', label: 'BE 2026–27' },
];

export function isFundFlowFeature(name) {
  return /centre[-–]?state fund flow/i.test(String(name || ''));
}

const NO_ROWS = [];

export default function FundFlowDesk({ feed, selected, onSelect, vizFilter, onClearViz }) {
  const [q, setQ] = useState('');
  const rows = Array.isArray(feed?.rows) ? feed.rows : NO_ROWS;
  const meta = feed?.meta || {};
  const profile = meta.profile || rows[0]?.profile || 'Expenditure Profile';
  const unit = meta.unit || '₹ crore';

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => String(r.category || r.title || '').toLowerCase().includes(needle));
  }, [rows, q]);

  const transfers = rows.find((r) => Number(r.line) === 5);
  const css = rows.find((r) => Number(r.line) === 6);
  const fc = rows.find((r) => Number(r.line) === 7);
  const totalBudget = rows.find((r) => Number(r.line) === 9);

  return (
    <div className="nat-panel fund-flow-desk">
      <div className="feed-head">
        <h1>CENTRE–STATE FUND FLOWS</h1>
        <span className="live-feed">LIVE · BUDGET XLSX</span>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
      </div>

      <div className="desk-strip">
        <span>{profile}</span>
        <span>STATEMENT 1 · SUMMARY OF EXPENDITURE · {String(unit).toUpperCase()}</span>
      </div>

      <p className="desk-note desk-sensitive-inline">
        Live extract from Union Budget <code>stat1.xlsx</code> (indiabudget.gov.in). Figures are ₹ crore as published —
        Revenue / Capital / Total for Actuals, BE, RE. Transfer lines (5–8) are the centre→state flow block. The published
        workbook remains authoritative.
      </p>

      <div className="fund-flow-kpis">
        <div className="fund-flow-kpi">
          <span className="fund-flow-kpi-label">Transfers (line 5) · BE 2026–27</span>
          <strong>{fmtCr(transfers?.be_2627_total)}</strong>
        </div>
        <div className="fund-flow-kpi">
          <span className="fund-flow-kpi-label">Centrally Sponsored · BE 2026–27</span>
          <strong>{fmtCr(css?.be_2627_total)}</strong>
        </div>
        <div className="fund-flow-kpi">
          <span className="fund-flow-kpi-label">Finance Commission · BE 2026–27</span>
          <strong>{fmtCr(fc?.be_2627_total)}</strong>
        </div>
        <div className="fund-flow-kpi">
          <span className="fund-flow-kpi-label">Total Budget Exp. · BE 2026–27</span>
          <strong>{fmtCr(totalBudget?.be_2627_total)}</strong>
        </div>
      </div>

      <div className="fund-flow-toolbar">
        <input
          type="search"
          className="fund-flow-search"
          placeholder="Filter ministry / line…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter fund-flow rows"
        />
        <span className="fund-flow-count">{filtered.length} lines</span>
      </div>

      <div className="table-wrap fund-flow-table-wrap">
        <table className="feed-table fund-flow-table">
          <thead>
            <tr>
              <th rowSpan={2} className="fund-flow-sticky">
                #
              </th>
              <th rowSpan={2} className="fund-flow-sticky fund-flow-cat">
                Ministry / category
              </th>
              {PERIODS.map((p) => (
                <th key={p.key} colSpan={3} className="fund-flow-period">
                  {p.label}
                </th>
              ))}
            </tr>
            <tr>
              {PERIODS.flatMap((p) => [
                <th key={`${p.key}-rev`} className="num">
                  Revenue
                </th>,
                <th key={`${p.key}-cap`} className="num">
                  Capital
                </th>,
                <th key={`${p.key}-tot`} className="num">
                  Total
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const active = selected && (selected.line === r.line || selected.title === r.title);
              const transferish = /transfers|sponsored|finance commission|other transfers/i.test(
                r.category || '',
              );
              return (
                <tr
                  key={r.line}
                  className={[
                    r.is_aggregate ? 'fund-flow-agg' : '',
                    transferish ? 'fund-flow-transfer' : '',
                    active ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  {...rowSelectionProps(() => onSelect?.(r))}
                  {...rowDragProps(r, {
                    title: r.category || r.title,
                    feature: 'Centre-State Fund Flow Tracker',
                  })}
                >
                  <td className="fund-flow-sticky num">{r.line}</td>
                  <td className="fund-flow-sticky fund-flow-cat">{r.category || r.title}</td>
                  {PERIODS.map((p) => (
                    <PeriodCells key={p.key} row={r} prefix={p.key} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeriodCells({ row, prefix }) {
  return (
    <>
      <td className="num">{fmtCr(row[`${prefix}_revenue`])}</td>
      <td className="num">{fmtCr(row[`${prefix}_capital`])}</td>
      <td className="num fund-flow-total">{fmtCr(row[`${prefix}_total`])}</td>
    </>
  );
}
