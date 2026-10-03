import { rowSelectionProps } from '../shell/rowSelection.js';
import { FLAGSHIP_PROGRAMMES } from '../data/nationalCurated.js';
import { applyVizFilter } from '../lib/nationalKpi.js';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { rowDragProps } from '../lib/aiDrop.js';

export default function ProjectsDesk({ selected, onSelect, vizFilter, onClearViz }) {
  const all = FLAGSHIP_PROGRAMMES.map(([programme, domain, verifiable_status, activity]) => ({
    programme,
    domain,
    verifiable_status,
    activity,
    title: programme,
  }));
  const rows = all.filter((r) => applyVizFilter(r, vizFilter));
  const feed = { feature: 'Centre-sanctioned Projects Monitor', rows: all };
  return (
    <div className="nat-panel">
      <div className="feed-head">
        <h1>CENTRAL PROJECTS</h1>
        <span className="live-feed">CURATED</span>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop feed={feed} vizFilter={vizFilter} onClearViz={onClearViz} />
      </div>
      <div className="desk-strip">
        <span>FLAGSHIP PROGRAMMES · CURATED REFERENCE</span>
        <span>CURATED · AS OF JAN 2026 · VERIFY AGAINST MINISTRY DASHBOARDS</span>
      </div>
      <p className="desk-note">
        A reference list, not a project register. Per-project cost and schedule are not in this source (PAIMANA not wired). Winning bidder
        is dropped, not merely missing: PAIMANA does not carry it and there is no OCDS publisher for India.
      </p>
      <div className="table-wrap">
        <table className="feed-table">
          <thead>
            <tr>
              <th>Programme</th>
              <th>Domain</th>
              <th>Verifiable status</th>
              <th>Activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.programme} className={selected?.programme === r.programme ? 'on' : ''} {...rowSelectionProps(() => onSelect?.(r))} {...rowDragProps(r, { title: r.programme, feature: 'Centre-sanctioned Projects Monitor' })}>
                <td>{r.programme}</td>
                <td>{r.domain}</td>
                <td>{r.verifiable_status}</td>
                <td>
                  <span className={`nat-act ${r.activity === 'Active' ? 'on' : 'off'}`}>{r.activity}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
