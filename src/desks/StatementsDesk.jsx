import { useWorkspaceState } from '../shell/workspaceState.js';
import { rowSelectionProps } from '../shell/rowSelection.js';
import { useEffect, useState } from 'react';
import { STATEMENT_LEADERS } from '../data/nationalCurated.js';
import { Sparkline, VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { rowDragProps } from '../lib/aiDrop.js';
import { dedupeNewsRows } from '../lib/newsDedup.js';
import { applyRecordChecklistToFeed } from '../lib/recordChecklist.js';
import { fetchFeature } from '../lib/featureFeed.js';
import { technicalTitle } from '../lib/plainSourceNote.js';

// F164: what the page says when no mentions could be fetched.
const MENTIONS_DOWN = 'Media mentions couldn\u2019t load right now.';
const FEATURE = 'Statement & Quote Tracker with Contradiction Detection';

/**
 * F169 T3 (F166): mentions per day over the last 7 days, counted from the rows' dates (the server's
 * Google News search). Null when fewer than two days have a date.
 */
export function mentionVolume(rows, now = Date.now()) {
  const days = new Map();
  for (let d = 6; d >= 0; d -= 1) {
    const at = new Date(now - d * 86_400_000);
    days.set(at.toISOString().slice(0, 10), 0);
  }
  for (const r of rows || []) {
    const t = Date.parse(r?.date || '');
    if (!Number.isFinite(t)) continue;
    const key = new Date(t).toISOString().slice(0, 10);
    if (days.has(key)) days.set(key, days.get(key) + 1);
  }
  const series = [...days].map(([key, n]) => ({ year: `${key.slice(5, 7)}/${key.slice(8, 10)}`, n }));
  return series.filter((p) => p.n > 0).length >= 2 ? series : null;
}

export default function StatementsDesk({ workspaceScope = '', onSelect, onFeed, vizFilter, onClearViz }) {
  const [i, setI] = useWorkspaceState('StatementsDesk.i', 0, workspaceScope);
  const [rows, setRows] = useState([]);
  const [vol, setVol] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useWorkspaceState('StatementsDesk.q', '', workspaceScope);
  const person = STATEMENT_LEADERS[i];
  const shown = rows.filter((r) => {
    if (!applyVizFilter(r, vizFilter)) return false;
    if (!q.trim()) return true;
    return `${r.title || ''} ${r.source || ''}`.toLowerCase().includes(q.trim().toLowerCase());
  });

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setErr('');
    setVol(null);
    // F169 T3 (F166): the server's Google News search for the selected leader.
    fetchFeature({ tier: 'national', feature: FEATURE, signal: ac.signal, params: { person } })
      .catch((e) => (e?.name === 'AbortError' ? null : { rows: [], source: { note: String(e?.message || e) } }))
      .then((feed) => {
        if (!feed || ac.signal.aborted) return;
        const mapped = dedupeNewsRows((feed.rows || []).filter((r) => r && r.status !== 'source_status'))
          .map((r) => ({ ...r, source: r.publisher || r.source || '' }));
        const series = mentionVolume(mapped);
        const note = feed.source?.note || '';
        setRows(mapped);
        setVol(series);
        // F159 review: `source.diagnostic` is for the console, not the banner's title.
        if (feed.source?.diagnostic) console.warn(`[${FEATURE}] stored or unavailable:`, feed.source.diagnostic);
        if (!mapped.length) setErr(note || 'no mentions');
        onFeed?.(
          applyRecordChecklistToFeed({
            ok: true,
            tier: 'national',
            feature: FEATURE,
            rows: mapped,
            source: { adapter: 'news-search', note },
            coverage: { from: '', through: '7d', exhaustive: false },
            fallback: false,
            meta: {
              heading: 'PUBLIC-FIGURE MEDIA MENTION MONITOR',
              section: 'MEDIA MENTIONS',
              status: mapped.length ? 'LIVE · MENTIONS' : 'OFFLINE',
              volume: series || [],
              person,
            },
          }),
        );
        setLoading(false);
      });

    return () => ac.abort();
  }, [person, onFeed]);

  return (
    <div className="nat-panel">
      <div className="feed-head">
        <h1>PUBLIC-FIGURE MEDIA MENTION MONITOR</h1>
        <span className={`live-feed${rows.length ? ' on' : ''}`}>{loading ? 'LOADING' : rows.length ? 'LIVE' : 'OFFLINE'}</span>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop
          feed={{ feature: FEATURE, rows }}
          q={q}
          onQ={setQ}
          searchPlaceholder="Search headlines"
          vizFilter={vizFilter}
          onClearViz={onClearViz}
        />
      </div>
      <p className="desk-note">
        Media mention volume for named public figures — not a record of statements and not a contradiction detector. No TRUE / FALSE /
        MISLEADING badges. {STATEMENT_LEADERS.length} personas tracked.
      </p>
      <div className="nls-chips">
        {STATEMENT_LEADERS.map((name, idx) => (
          <button key={name} type="button" className={`nls-chip${i === idx ? ' on' : ''}`} onClick={() => setI(idx)}>
            {name}
          </button>
        ))}
      </div>
      {err ? (
        // F164: the reason stays in the banner's title; the reader gets plain words.
        // F169 T3 review: the reader sees only the plain sentence; the reason stays in the title.
        <p className="banner warn" title={technicalTitle(err, MENTIONS_DOWN)}>
          {MENTIONS_DOWN}
        </p>
      ) : null}
      {vol?.length ? (
        <section className="viz-card">
          <header>
            <h3>Coverage volume — 7 days</h3>
          </header>
          <Sparkline
            series={vol}
            peak={vol.reduce((a, b) => (b.n > a.n ? b : a), vol[0])}
            from={vol[0]?.year}
            through={vol[vol.length - 1]?.year}
          />
          <p className="viz-foot">
            {person} · mentions per day · 7 days · news search
          </p>
        </section>
      ) : null}
      <div className="table-wrap">
        <table className="feed-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Headline</th>
              <th>Outlet</th>
              <th>Topic</th>
              <th>Published</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length ? (
              <tr>
                <td colSpan={5}>loading…</td>
              </tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={5}>No coverage rows in this window.</td>
              </tr>
            ) : (
              shown.map((r, n) => (
                <tr
                  key={r.source_url || n}
                  {...rowSelectionProps(() => onSelect?.({ ...r, person, topic: '—' }))}
                  {...rowDragProps(r, { title: r.title, feature: FEATURE })}
                >
                  <td>{person}</td>
                  <td>
                    {r.source_url ? (
                      <a href={r.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        {r.title}
                      </a>
                    ) : (
                      r.title
                    )}
                  </td>
                  <td>{r.source || '—'}</td>
                  <td>—</td>
                  <td>{r.date || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
