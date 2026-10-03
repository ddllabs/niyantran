import { rowSelectionProps } from '../shell/rowSelection.js';
import { INDUSTRY_V1 } from '../data/nationalCurated.js';
import { applyVizFilter } from '../lib/nationalKpi.js';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { rowDragProps } from '../lib/aiDrop.js';

export default function IndustryDesk({ feed, statusRow, selected, onSelect, vizFilter, onClearViz }) {
  const rows = (feed?.rows || []).filter((r) => r.status !== 'source_status').filter((r) => applyVizFilter(r, vizFilter));
  const catalog = INDUSTRY_V1.map((r) => ({ ...r, title: r.label })).filter((r) => applyVizFilter(r, vizFilter));
  return (
    <div className="nat-panel">
      <div className="feed-head">
        <h1>INDUSTRY UPDATES</h1>
        <span className={`live-feed${rows.length ? ' on' : ''}`}>{rows.length ? 'WORLD BANK' : 'OFFLINE'}</span>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop feed={feed} vizFilter={vizFilter} onClearViz={onClearViz} />
      </div>
      <div className="desk-strip">
        <span>INDUSTRY MONITOR · WORLD BANK WDI</span>
        <span>V1 SERIES ONLY · NO MOODY’S</span>
      </div>
      {statusRow ? (
        <div className="source-status-card">
          <p className="source-status-kicker">Source status</p>
          <h2>{statusRow.title || 'World Bank unreachable'}</h2>
          <p>{statusRow.detail || statusRow.fail_reason || 'World Bank open-data API unreachable from this network — it will retry automatically.'}</p>
        </div>
      ) : null}
      <p className="desk-note">
        v1 list is fixed because each indicator is a separate ingester with its own licence. Fiscal deficit, forex, IIP and WPI are named
        not-wired. Implications of a move are not asserted.
      </p>
      <div className="table-wrap">
        <table className="feed-table">
          <thead>
            <tr>
              <th>Indicator</th>
              <th>Units</th>
              <th>Issuing authority</th>
              <th>Series</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((r) => (
              <tr
                key={r.id}
                className={selected?.id === r.id ? 'on' : ''}
                {...rowSelectionProps(() => onSelect?.(selected?.id === r.id ? null : r))}
                {...rowDragProps(r, { title: r.label, feature: 'Industry Updates' })}
              >
                <td>{r.label}</td>
                <td>{r.units}</td>
                <td>{r.authority}</td>
                <td>{r.indicator || 'not wired'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length ? (
        <>
          <h3 className="nat-subh">Live series rows</h3>
          <div className="table-wrap">
            <table className="feed-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Date</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((r, i) => (
                  <tr key={r.id || i} {...rowDragProps(r, { title: r.title || r.indicator, feature: feed?.feature })}>
                    <td>{r.title || r.indicator || '—'}</td>
                    <td>{r.date || r.year || '—'}</td>
                    <td className="num">{r.value ?? r.n ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
