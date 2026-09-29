import { useEffect, useMemo, useState } from 'react';
import { PIG_SEC_META } from '../data/nationalCurated.js';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import {
  buildPigModel,
  pigEdgeTone,
  pigLayout,
  pigNodeStyle,
  pigStageDead,
  pigStagePassed,
  pigYearCounts,
} from '../lib/pigModel.js';

const NO_ROWS = [];

export default function PolicyGraphDesk({ feed, selected, onSelect, vizFilter, onClearViz }) {
  const rows = feed?.rows || NO_ROWS;
  const model = useMemo(() => buildPigModel(rows), [rows]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [picked, setPicked] = useState('india');
  const [query, setQuery] = useState('');
  const [yearRange, setYearRange] = useState(null);
  const [stageFilter, setStageFilter] = useState('all');
  const [drag, setDrag] = useState(null);
  const { years, counts, maxC } = useMemo(() => pigYearCounts(model), [model]);
  const vis = useMemo(() => pigLayout(model, expanded, yearRange), [model, expanded, yearRange]);
  const node = model.nodes[picked];
  const q = query.trim().toLowerCase();

  const stageOpts = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const s = String(r.current_stage || r.stage || '').trim();
      if (s) set.add(s);
    });
    return ['all', ...[...set].sort()];
  }, [rows]);

  useEffect(() => {
    if (!years.length || years.length <= 8) return;
    setYearRange((prev) => {
      if (prev) return prev;
      const hi = years[years.length - 1];
      const lo = years[Math.max(0, years.length - 6)];
      return [lo, hi];
    });
  }, [years]);

  function stageOk(n) {
    if (stageFilter === 'all') return true;
    if (n.level !== 3) return true;
    const s = String(n.stage || n.raw?.current_stage || n.raw?.stage || '').trim();
    return s === stageFilter;
  }

  function clickNode(id) {
    const n = model.nodes[id];
    if (!n) return;
    const next = new Set(expanded);
    if (n.level === 1) {
      if (next.has(id)) {
        next.delete(id);
        n.children.forEach((d) => next.delete(d));
      } else {
        model.sectorIds.forEach((s) => {
          if (s !== id) {
            next.delete(s);
            model.nodes[s].children.forEach((d) => next.delete(d));
          }
        });
        next.add(id);
      }
    } else if (n.level === 2) {
      if (next.has(id)) next.delete(id);
      else {
        model.nodes[`sec:${n.sector}`].children.forEach((d) => {
          if (d !== id) next.delete(d);
        });
        next.add(id);
      }
    }
    setExpanded(next);
    setPicked(id);
    if (n.raw) onSelect?.(n.raw);
  }

  function reset() {
    setExpanded(new Set());
    setPicked('india');
    setQuery('');
    setYearRange(null);
    setStageFilter('all');
    onSelect?.(null);
  }

  function idxAt(clientX, el) {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(years.length - 1, Math.floor(((clientX - r.left) / r.width) * years.length)));
  }

  const parentOf = (id, n) => {
    if (id === 'india') return null;
    if (id.startsWith('bill:')) return `dom:${n.domain}`;
    if (id.startsWith('dom:')) return `sec:${n.sector}`;
    return 'india';
  };

  return (
    <div className="pig-wrap">
      <div className="pig-top">
        <div className="pig-title">
          <b>Policy Intelligence Graph</b>
        </div>
        <div className="pig-sub">
          {model.billTotal.toLocaleString('en-IN')} bills · {model.domainCount} domains · live
        </div>
        <TableFilterPop
          feed={feed}
          q={query}
          onQ={setQuery}
          searchPlaceholder="Search bills"
          vizFilter={vizFilter}
          onClearViz={onClearViz}
        />
        <button type="button" className="pig-chip" onClick={reset}>
          Reset view
        </button>
      </div>
      <p className="desk-note pig-method">
        Edges mean sector → domain → bill from the bill register (sourced rows). Colour is stage tone only — not a hidden score.
        Start with a recent year window; Reset view clears filters and collapse.
      </p>
      <div className="nls-chips pig-stage-chips">
        <span className="desk-note" style={{ padding: 0, margin: 0 }}>
          Stage
        </span>
        {stageOpts.slice(0, 10).map((s) => (
          <button
            key={s}
            type="button"
            className={`nls-chip${stageFilter === s ? ' on' : ''}`}
            onClick={() => setStageFilter(s)}
          >
            {s === 'all' ? 'All stages' : s}
          </button>
        ))}
      </div>
      <div className="pig-body">
        <div className="pig-left">
          <div className="pig-rail-h">Economic sectors</div>
          {model.sectorIds.map((id) => {
            const s = model.nodes[id];
            const meta = PIG_SEC_META[s.sector];
            const on = expanded.has(id) || picked === id;
            const bar = s.billCount ? Math.round((100 * s.passed) / s.billCount) : 0;
            return (
              <button key={id} type="button" className={`pig-sec-card${on ? ' on' : ''}`} onClick={() => clickNode(id)}>
                <div className="n">
                  {meta.label}
                  <span className="imp">{meta.gdp}</span>
                </div>
                <div className="meta">
                  <div>
                    <span className="k">GDP</span>
                    <span className="v">{meta.gdp}%</span>
                  </div>
                  <div>
                    <span className="k">Bills</span>
                    <span className="v">{s.billCount}</span>
                  </div>
                  <div>
                    <span className="k">Passed</span>
                    <span className="v">{s.passed}</span>
                  </div>
                </div>
                <div className="bar">
                  <i style={{ width: `${bar}%` }} />
                </div>
              </button>
            );
          })}
        </div>
        <div className="pig-canvas">
          <div className="pig-graph">
            <svg viewBox="0 0 1000 724" preserveAspectRatio="xMidYMid meet">
              <defs>
                <radialGradient id="pigIndia" cx="40%" cy="35%">
                  <stop offset="0%" stopColor="#8a6a2e" />
                  <stop offset="100%" stopColor="#4a3a1a" />
                </radialGradient>
              </defs>
              {Object.keys(vis).map((id) => {
                if (id === 'india') return null;
                const n = model.nodes[id];
                const parent = parentOf(id, n);
                if (!vis[parent]) return null;
                const p = vis[parent];
                const c = vis[id];
                const d = `M${p.x.toFixed(1)} ${p.y.toFixed(1)} Q${((p.x + c.x) / 2).toFixed(1)} ${((p.y + c.y) / 2).toFixed(1)} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
                return <path key={`${parent}>${id}`} d={d} className="pig-edge" style={{ stroke: pigEdgeTone(n), strokeWidth: n.level === 1 ? 2.2 : n.level === 2 ? 1.5 : 1 }} />;
              })}
              {Object.keys(vis).map((id) => {
                const n = model.nodes[id];
                const v = vis[id];
                const st = pigNodeStyle(n);
                const dim =
                  (q && n.level === 3 && !n.label.toLowerCase().includes(q) && !(n.raw?.bill_name || '').toLowerCase().includes(q)) ||
                  (n.raw && !applyVizFilter(n.raw, vizFilter)) ||
                  !stageOk(n);
                const showLabel = n.level <= 2 || picked === id;
                const label = n.level === 3 ? (n.label.length > 26 ? `${n.label.slice(0, 24)}…` : n.label) : n.label;
                return (
                  <g
                    key={id}
                    className={`pig-node${picked === id ? ' sel' : ''}${dim ? ' dim' : ''}`}
                    transform={`translate(${v.x.toFixed(1)},${v.y.toFixed(1)})`}
                    onClick={() => clickNode(id)}
                  >
                    <circle r={st.r} fill={id === 'india' ? 'url(#pigIndia)' : st.fill} stroke={st.stroke} strokeWidth={n.level === 1 ? 2 : 1.2} />
                    {showLabel ? (
                      <text
                        fontSize={n.level === 0 ? 14 : n.level === 1 ? 12 : n.level === 2 ? 10.5 : 9.5}
                        textAnchor={v.x < 496 ? 'end' : 'start'}
                        x={v.x < 496 ? -(st.r + 5) : st.r + 5}
                        y={3.5}
                        fontWeight={n.level <= 1 ? 700 : 500}
                        fill="#e8e4d8"
                      >
                        {label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
            <div className="pig-hint">Click a node to expand · select for briefing</div>
            <div className="pig-legend">
              <span>
                <i style={{ background: '#647C3C' }} />
                likely / passed
              </span>
              <span>
                <i style={{ background: '#B18A42' }} />
                uncertain
              </span>
              <span>
                <i style={{ background: '#982F2F' }} />
                unlikely / dead
              </span>
              <span className="pig-legend-edge">Lines = register path (sector → domain → bill)</span>
            </div>
          </div>
          <div className="pig-timeline">
            <div className="pig-tl-head">
              <span>Bills introduced by year — drag to filter</span>
              <span>
                {yearRange ? `${yearRange[0]}–${yearRange[1]} · filtered` : `${model.yearMin}–${model.yearMax} · all years`}
              </span>
            </div>
            <div
              className="pig-tl-bars"
              onPointerDown={(e) => {
                const i = idxAt(e.clientX, e.currentTarget);
                setDrag({ el: e.currentTarget, a: i });
                setYearRange([years[i], years[i]]);
              }}
              onPointerMove={(e) => {
                if (!drag) return;
                const b = idxAt(e.clientX, drag.el);
                const lo = Math.min(drag.a, b);
                const hi = Math.max(drag.a, b);
                setYearRange([years[lo], years[hi]]);
              }}
              onPointerUp={() => setDrag(null)}
              onClick={(e) => {
                if (drag) return;
                if (e.detail === 2) setYearRange(null);
              }}
            >
              {years.map((y) => (
                <div
                  key={y}
                  className={`pig-tl-bar${yearRange && y >= yearRange[0] && y <= yearRange[1] ? ' in' : ''}`}
                  title={`${y}: ${counts[y] || 0} bills`}
                  style={{ height: `${Math.max(2, Math.round(((counts[y] || 0) / maxC) * 100))}%` }}
                />
              ))}
            </div>
            <div className="pig-tl-axis">
              <span>{model.yearMin}</span>
              <span>{Math.round((model.yearMin + model.yearMax) / 2)}</span>
              <span>{model.yearMax}</span>
            </div>
          </div>
        </div>
        <div className="pig-right">
          <PigPanel node={node} model={model} onGo={clickNode} selected={selected} />
        </div>
      </div>
    </div>
  );
}

function PigPanel({ node, model, onGo }) {
  if (!node || node.id === 'india') {
    return (
      <div className="pig-empty">
        <p>Select any node to open its intelligence briefing.</p>
        <p className="muted">
          {model.billTotal.toLocaleString('en-IN')} bills · {model.domainCount} policy domains. Passed counts come from current_stage, not a
          passing date.
        </p>
      </div>
    );
  }
  if (node.level === 3) {
    const stage = node.stage || '—';
    const tone = pigStagePassed(stage) ? 'g' : pigStageDead(stage) ? 'r' : 'a';
    return (
      <div className="pig-panel">
        <div className="pig-p-kicker">
          {node.sector} · {node.domain} · BILL
        </div>
        <div className="pig-p-title">{node.raw.bill_name || node.label}</div>
        <div className="pig-p-badges">
          <span className={`pig-badge ${tone}`}>{stage}</span>
          {node.raw.house ? <span className="pig-badge">{node.raw.house}</span> : null}
        </div>
        <div className="pig-metric-row">
          <div className="pig-metric">
            <div className="k">Passage probability</div>
            <div className="v grad">{node.passage != null ? `${node.passage}%` : '—'}</div>
          </div>
          <div className="pig-metric">
            <div className="k">Introduced</div>
            <div className="v">{String(node.raw.date_introduced || '').slice(0, 10) || '—'}</div>
          </div>
        </div>
        <p className="desk-note">Stored column, not a live model. AI briefing needs /api/askai — degrades without a backend.</p>
      </div>
    );
  }
  if (node.level === 2) {
    const passed = node.bills.filter((b) => pigStagePassed(b.stage)).length;
    return (
      <div className="pig-panel">
        <div className="pig-p-kicker">{node.sector} · POLICY DOMAIN</div>
        <div className="pig-p-title">{node.label}</div>
        <div className="pig-metric-row">
          <div className="pig-metric">
            <div className="k">Bills tracked</div>
            <div className="v grad">{node.bills.length}</div>
          </div>
          <div className="pig-metric">
            <div className="k">Passed / enacted</div>
            <div className="v">{passed}</div>
          </div>
        </div>
        <div className="pig-sec-h">Top bills</div>
        <ul className="pig-list">
          {node.bills.slice(0, 8).map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => onGo(b.id)}>
                {b.label.slice(0, 60)}
              </button>
              <span className="st">{b.stage}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const meta = PIG_SEC_META[node.sector];
  return (
    <div className="pig-panel">
      <div className="pig-p-kicker">ECONOMIC SECTOR</div>
      <div className="pig-p-title">{meta.label} Sector</div>
      <p className="muted">{meta.blurb}</p>
        <div className="pig-metric-row">
        <div className="pig-metric">
          <div className="k">Bills touching sector</div>
          <div className="v">{node.billCount}</div>
        </div>
        <div className="pig-metric">
          <div className="k">Passed</div>
          <div className="v">{node.passed}</div>
        </div>
      </div>
      <p className="desk-note">Passed counts use current_stage on the tracker, not a passing date.</p>
      <div className="pig-sec-h">Policy domains ({node.domainCount})</div>
      <ul className="pig-list">
        {node.children.map((dId) => {
          const d = model.nodes[dId];
          return (
            <li key={dId}>
              <button type="button" onClick={() => onGo(dId)}>
                {d.label}
              </button>
              <span className="st">{d.bills.length} bills</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
