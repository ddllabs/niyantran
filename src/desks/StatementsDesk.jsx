import { rowSelectionProps } from '../shell/rowSelection.js';
import { useEffect, useState } from 'react';
import { STATEMENT_LEADERS } from '../data/nationalCurated.js';
import { Sparkline, VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { rowDragProps } from '../lib/aiDrop.js';
import { dedupeNewsRows } from '../lib/newsDedup.js';
import { applyRecordChecklistToFeed } from '../lib/recordChecklist.js';
import { liveApiEnabled } from '../lib/apiMode.js';

const GDELT_GAP_MS = 5500;

function gdeltDoc(q) {
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${q}" sourcecountry:IN`)}&mode=artlist&format=json&sort=datedesc&timespan=3d&maxrecords=40`;
}
function gdeltVol(q) {
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${q}" sourcecountry:IN`)}&mode=TimelineVol&format=json&timespan=7d`;
}
function newsRss(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`"${q}" India`)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function proxyText(url, signal) {
  if (!liveApiEnabled()) throw new Error('unreachable');
  const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}`, { signal });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (/please limit requests|too many requests/i.test(text)) throw new Error('GDELT rate limited');
  return text;
}

async function proxyJson(url, signal) {
  const text = await proxyText(url, signal);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('not json');
  }
}

function parseRssItems(xml) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const tag = (name) => {
      const r = new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${name}>`, 'i');
      const hit = r.exec(block);
      return hit ? (hit[1] || hit[2] || '').trim() : '';
    };
    const href =
      /<link>([^<]+)<\/link>/i.exec(block)?.[1]?.trim() ||
      /href="([^"]+)"/i.exec(block)?.[1] ||
      '';
    const title = tag('title');
    if (title) {
      items.push({
        title,
        date: tag('pubDate') || tag('updated') || '',
        source_url: href,
        source: 'Google News',
        reporting_search: 'Google News RSS — media mentions, not an official statement archive',
      });
    }
    if (items.length >= 40) break;
  }
  return items;
}

export default function StatementsDesk({ onSelect, onFeed, vizFilter, onClearViz }) {
  const [i, setI] = useState(0);
  const [rows, setRows] = useState([]);
  const [vol, setVol] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
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

    (async () => {
      let mapped = [];
      let series = null;
      let note = 'Coverage volume, not statements. No contradiction verdict.';
      let adapter = 'news-search';

      try {
        // One GDELT call at a time — DOC then TimelineVol after ≥5.5s (GDELT rate limit).
        const doc = await proxyJson(gdeltDoc(person), ac.signal);
        const arts = doc?.articles || doc?.article || [];
        mapped = dedupeNewsRows(
          (Array.isArray(arts) ? arts : []).map((a) => ({
            title: a.title || a.seendate,
            date: a.seendate || a.date,
            source_url: a.url,
            source: a.domain || a.sourceCountry,
            reporting_search: 'GDELT DOC 2.0 — news reporting search, not an official dataset',
          })),
        );
        note = `Live GDELT DOC 2.0 media mentions for "${person}". Coverage volume, not statements. No contradiction verdict.`;
        try {
          await sleep(GDELT_GAP_MS, ac.signal);
          const timeline = await proxyJson(gdeltVol(person), ac.signal);
          series = (((timeline && timeline.timeline && timeline.timeline[0] && timeline.timeline[0].data) || [])).map((p) => {
            const d = String(p.date || '');
            return { year: d.length >= 8 ? `${d.slice(4, 6)}/${d.slice(6, 8)}` : d, n: +p.value || 0 };
          });
          if (!series.length) series = null;
        } catch (e) {
          if (e?.name === 'AbortError') throw e;
          /* volume chart is optional */
        }
      } catch (e) {
        if (e?.name === 'AbortError') return;
        try {
          const xml = await proxyText(newsRss(person), ac.signal);
          mapped = dedupeNewsRows(parseRssItems(xml));
          note = `Live Google News RSS for "${person}" (GDELT unavailable). Coverage mentions only — no contradiction verdict.`;
          adapter = 'news-search';
        } catch (e2) {
          if (e2?.name === 'AbortError') return;
          mapped = [];
          note = 'GDELT wire unreachable from this network — it will retry automatically.';
          setErr(note);
        }
      }

      if (ac.signal.aborted) return;
      setRows(mapped);
      setVol(series);
      onFeed?.(
        applyRecordChecklistToFeed({
          ok: true,
          tier: 'national',
          feature: 'Statement & Quote Tracker with Contradiction Detection',
          rows: mapped,
          source: { adapter, gdelt: /GDELT/i.test(note), note },
          coverage: { from: '', through: '3d', exhaustive: false },
          fallback: false,
          meta: {
            heading: 'PUBLIC-FIGURE MEDIA MENTION MONITOR',
            section: 'MEDIA MENTIONS — GDELT 2.0',
            status: mapped.length ? (series ? 'GDELT 2.0 · LIVE' : 'LIVE · MENTIONS') : 'OFFLINE',
            volume: series || [],
            person,
          },
        }),
      );
      setLoading(false);
    })();

    return () => ac.abort();
  }, [person, onFeed]);

  return (
    <div className="nat-panel">
      <div className="feed-head">
        <h1>PUBLIC-FIGURE MEDIA MENTION MONITOR</h1>
        <span className={`live-feed${rows.length ? ' on' : ''}`}>{loading ? 'LOADING' : rows.length ? 'LIVE' : 'OFFLINE'}</span>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop
          feed={{ feature: 'Statement & Quote Tracker with Contradiction Detection', rows }}
          q={q}
          onQ={setQ}
          searchPlaceholder="Search headlines"
          vizFilter={vizFilter}
          onClearViz={onClearViz}
        />
      </div>
      <p className="desk-note">
        Media mention volume for named public figures — not a statement archive and not a contradiction detector. No TRUE / FALSE /
        MISLEADING badges. {STATEMENT_LEADERS.length} personas tracked.
      </p>
      <div className="nls-chips">
        {STATEMENT_LEADERS.map((name, idx) => (
          <button key={name} type="button" className={`nls-chip${i === idx ? ' on' : ''}`} onClick={() => setI(idx)}>
            {name}
          </button>
        ))}
      </div>
      {err ? <p className="banner warn">{err}</p> : null}
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
            {person} · media volume · 7 days · GDELT TimelineVol
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
                  {...rowDragProps(r, { title: r.title, feature: 'Statement & Quote Tracker with Contradiction Detection' })}
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
