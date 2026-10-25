import { useWorkspaceState } from '../shell/workspaceState.js';
import { LS18_FACTS } from '../data/nationalCurated.js';
import { applyVizFilter } from '../lib/nationalKpi.js';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { rowDragProps } from '../lib/aiDrop.js';

function metric(row, keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v != null && String(v).trim() !== '' && String(v).trim() !== '0') return String(v).trim();
  }
  return null;
}

function MetricLine({ label, value }) {
  return (
    <li>
      <span>{label}</span>
      <b className={value ? '' : 'nr'}>{value || 'Not reported'}</b>
    </li>
  );
}

export default function MpCardsDesk({ workspaceScope = '', feed, selected, onSelect, vizFilter, onClearViz }) {
  const rows = feed?.rows || [];
  const [q, setQ] = useWorkspaceState('MpCardsDesk.q', '', workspaceScope);
  const filtered = rows.filter((r) => {
    if (!applyVizFilter(r, vizFilter)) return false;
    if (!q.trim()) return true;
    const hay = `${r.mp_name || ''} ${r.constituency || ''} ${r.party || ''} ${r.state || ''}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <div className="nat-mp">
      <div className="feed-head">
        <h1>MP REPORT CARDS</h1>
        <span className="live-feed">{filtered.length} members</span>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop
          feed={feed}
          q={q}
          onQ={setQ}
          searchPlaceholder="Search name or constituency"
          vizFilter={vizFilter}
          onClearViz={onClearViz}
        />
      </div>
      <div className="desk-strip">
        <span>PARLIAMENT — MEMBER REGISTER (LOK SABHA AND RAJYA SABHA)</span>
        <span>CURATED · PUBLIC RECORD · AS OF THE 2024 ELECTION · NOT A RANKING</span>
      </div>
      <div className="nat-facts">
        {LS18_FACTS.map(([m, v, n]) => (
          <article key={m}>
            <h3>{m}</h3>
            <strong>{v}</strong>
            <span>{n}</span>
          </article>
        ))}
      </div>
      <p className="desk-note">
        Cards are not ranked. Missing metrics say “Not reported” — never zero. Attendance, debates, and MPLADS utilisation need
        sources this register does not carry yet.
      </p>
      <div className="nat-mp-grid">
        {filtered.slice(0, 400).map((r, i) => {
          const name = r.mp_name || r.name || r.title || 'Member';
          const on = selected === r;
          const questions = metric(r, ['questions_asked', 'questions']);
          const debates = metric(r, ['debates', 'debate_count']);
          const attendance = metric(r, ['attendance_pct', 'attendance']);
          const mplads = metric(r, ['mplads', 'mplads_utilization', 'fund_utilization']);
          const committees = metric(r, ['committees']);
          const coverage = metric(r, ['coverage_through', 'as_of']) || '2024 election register';
          return (
            <button
              key={r.id || `${name}|${i}`}
              type="button"
              className={`nat-mp-card${on ? ' on' : ''}`}
              onClick={() => onSelect?.(r)}
              {...rowDragProps(r, { title: name, feature: 'MP Report Cards' })}
            >
              <strong>{name}</strong>
              <span>{[r.party, r.constituency || r.state].filter(Boolean).join(' · ') || r.house || '—'}</span>
              <ul className="nat-mp-metrics">
                <MetricLine label="Attendance" value={attendance} />
                <MetricLine label="Questions" value={questions} />
                <MetricLine label="Debates" value={debates} />
                <MetricLine label="MPLADS" value={mplads} />
                <MetricLine label="Committees" value={committees ? String(committees).split(';')[0] : null} />
                <MetricLine label="Coverage through" value={coverage} />
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}
