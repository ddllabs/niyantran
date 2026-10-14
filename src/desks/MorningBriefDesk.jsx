import { useEffect, useState } from 'react';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { rowDragProps } from '../lib/aiDrop.js';
import { dedupeNewsRows } from '../lib/newsDedup.js';
import { applyRecordChecklistToFeed } from '../lib/recordChecklist.js';
import { liveApiEnabled } from '../lib/apiMode.js';
import { plainNote, technicalTitle } from '../lib/plainSourceNote.js';

const GDELT_GAP_MS = 5500;
// F164: what a section says when its source could not be reached.
const SECTION_DOWN = 'This section couldn\u2019t load right now.';

function parseRssItems(xml, source = 'RSS') {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('item')]
    .map((it) => {
      const g = (k) => it.querySelector(k)?.textContent?.trim() || '';
      return { title: g('title'), source_url: g('link'), date: g('pubDate'), source };
    })
    .filter((x) => x.title);
}

function gdelt(query) {
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&sort=datedesc&timespan=3d&maxrecords=12`;
}

function newsSearch(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
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

function mapArts(j) {
  return dedupeNewsRows(
    (j?.articles || []).map((a) => ({
      title: a.title,
      date: a.seendate,
      source_url: a.url,
      source: a.domain || a.sourceCountry || 'GDELT',
      reporting_search: 'GDELT DOC 2.0 — news reporting search, not an official dataset',
    })),
  );
}

export default function MorningBriefDesk({ onSelect, onFeed, vizFilter, onClearViz }) {
  const [top, setTop] = useState({ rows: [], err: '' });
  const [pib, setPib] = useState({ rows: [], err: '' });
  const [eco, setEco] = useState({ rows: [], err: '' });
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    if (!liveApiEnabled()) {
      const msg = 'Live RSS proxy is not deployed on this host.';
      setTop({ rows: [], err: msg });
      setPib({ rows: [], err: msg });
      setEco({ rows: [], err: msg });
      setLoading(false);
      return () => ac.abort();
    }

    (async () => {
      setLoading(true);
      // 1) PIB first (not GDELT) — avoids burning the rate budget.
      try {
        const xml = await proxyText('https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', ac.signal);
        const rows = dedupeNewsRows(parseRssItems(xml, 'PIB'));
        if (!rows.length) throw new Error('empty');
        setPib({ rows, err: '' });
      } catch (e) {
        if (e?.name === 'AbortError') return;
        setPib({
          rows: [],
          err: 'PIB releases arrive through the backend (/api/rss) and it is not reachable.',
        });
      }

      // 2) Top of Day — one GDELT call, then News RSS if needed.
      try {
        const text = await proxyText(gdelt('sourcecountry:IN (India OR government OR parliament)'), ac.signal);
        const rows = mapArts(JSON.parse(text));
        if (!rows.length) throw new Error('empty');
        setTop({ rows, err: '' });
      } catch (e) {
        if (e?.name === 'AbortError') return;
        try {
          const xml = await proxyText(newsSearch('India government OR parliament when:3d'), ac.signal);
          const rows = dedupeNewsRows(parseRssItems(xml, 'Google News'));
          if (!rows.length) throw new Error('empty');
          setTop({ rows, err: '' });
        } catch (e2) {
          if (e2?.name === 'AbortError') return;
          setTop({ rows: [], err: 'GDELT wire unreachable from this network — it will retry automatically.' });
        }
      }

      // 3) Economy — wait for GDELT gap, then one call (or News RSS).
      try {
        await sleep(GDELT_GAP_MS, ac.signal);
        const text = await proxyText(gdelt('(economy OR RBI OR rupee OR markets) sourcecountry:IN'), ac.signal);
        const rows = mapArts(JSON.parse(text));
        if (!rows.length) throw new Error('empty');
        setEco({ rows, err: '' });
      } catch (e) {
        if (e?.name === 'AbortError') return;
        try {
          const xml = await proxyText(newsSearch('India (RBI OR economy OR markets OR rupee) when:3d'), ac.signal);
          const rows = dedupeNewsRows(parseRssItems(xml, 'Google News'));
          if (!rows.length) throw new Error('empty');
          setEco({ rows, err: '' });
        } catch (e2) {
          if (e2?.name === 'AbortError') return;
          setEco({ rows: [], err: 'GDELT wire unreachable from this network — it will retry automatically.' });
        }
      }

      if (!ac.signal.aborted) setLoading(false);
    })();

    return () => ac.abort();
  }, []);

  useEffect(() => {
    // Each item keeps the section it came from (F124), so its record panel can name it.
    const tag = (list, section) => list.map((r) => ({ ...r, section }));
    const rows = dedupeNewsRows([...tag(top.rows, 'Top of the Day'), ...tag(pib.rows, 'Government Wire'), ...tag(eco.rows, 'Economy')]);
    const anyLive = rows.length > 0;
    onFeed?.(
      applyRecordChecklistToFeed({
        ok: true,
        tier: 'national',
        feature: 'National Morning Brief (Auto-digest)',
        rows,
        source: {
          adapter: 'news-search',
          gdelt: !top.err || !eco.err,
          note: anyLive
            ? `Morning Brief live — Top ${top.rows.length} · PIB ${pib.rows.length} · Economy ${eco.rows.length}.`
            : 'Panel offline. PIB labelled offline when unreachable.',
        },
        coverage: { through: '3d' },
        fallback: false,
        meta: {
          heading: 'MORNING BRIEF',
          items: rows.length,
          pib: pib.err ? 'OFFLINE' : String(pib.rows.length),
          ministries: pib.rows.length ? 'PIB window' : 'PIB offline',
          status: anyLive ? 'LIVE' : 'OFFLINE',
        },
      }),
    );
  }, [top, pib, eco, onFeed]);

  function match(r) {
    if (!applyVizFilter(r, vizFilter)) return false;
    if (!q.trim()) return true;
    return `${r.title || ''} ${r.source || ''} ${r.outlet || ''}`.toLowerCase().includes(q.trim().toLowerCase());
  }

  function Block({ title, section, pack, why }) {
    const rows = dedupeNewsRows(pack.rows || []).filter(match);
    return (
      <section className="nat-brief-sec">
        <h2>{title}</h2>
        <p className="desk-note">{why}</p>
        {pack.err ? (
          // F164: the reason stays in the banner's title; the reader gets plain words.
          <p className="banner warn" title={technicalTitle(pack.err, plainNote(pack.err, SECTION_DOWN))}>
            {plainNote(pack.err, SECTION_DOWN)}
          </p>
        ) : null}
        {!pack.err && !rows.length ? <p className="banner">No items in this section right now.</p> : null}
        <ul>
          {rows.slice(0, 12).map((r, i) => {
            // F165: "GDELT" names the search, not an outlet; the reader sees "News search".
            const source = String(r.outlet || r.source || '').replace(/^GDELT$/i, 'News search') || (r.source_url ? 'Link' : '—');
            const published = r.published || r.date || '—';
            return (
              <li key={r.source_url || i}>
                <button
                  type="button"
                  onClick={() =>
                    onSelect?.({
                      ...r,
                      section,
                      headline: r.title,
                      topic: section,
                      region: r.region || 'India',
                    })
                  }
                  {...rowDragProps(r, { title: r.title, feature: title })}
                >
                  <span className="nat-brief-kicker">
                    {section} · {source} · {published}
                    {r.related_count > 0 ? ` · +${r.related_count} related` : ''}
                  </span>
                  <span className="nat-brief-headline">{r.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  const merged = dedupeNewsRows([...top.rows, ...pib.rows, ...eco.rows]);
  const items = merged.length;
  const offlineBits = [top.err && 'Top of the Day', pib.err && 'PIB', eco.err && 'Economy'].filter(Boolean);

  return (
    <div className="nat-panel">
      <div className="feed-head">
        <h1>MORNING BRIEF</h1>
        <span className={`live-feed${items ? ' on' : ''}`}>
          {loading ? 'LOADING' : items ? `${items} ITEMS` : 'OFFLINE'}
        </span>
        <VizFilterChip vizFilter={vizFilter} onClear={onClearViz} />
        <TableFilterPop
          feed={{ feature: 'National Morning Brief (Auto-digest)', rows: merged }}
          q={q}
          onQ={setQ}
          searchPlaceholder="Search headlines"
          vizFilter={vizFilter}
          onClearViz={onClearViz}
        />
      </div>
      <p className="desk-note">
        Each item shows Section · Headline · Source · Published. Repeat headlines are collapsed. Items appear because they matched
        this section’s wire (India government / PIB / economy) — not a personalised ranking.
      </p>
      {offlineBits.length ? (
        <p className="banner warn">
          Not available right now: {offlineBits.join(', ')}. Other sections still show what arrived.
        </p>
      ) : null}
      <Block
        title="Top of the Day — India"
        section="Top of the Day"
        pack={top}
        why="Recent stories on India's government and parliament from the last 3 days."
      />
      <Block
        title="Government Wire — PIB"
        section="Government Wire"
        pack={pib}
        why="The latest releases from the Press Information Bureau."
      />
      <Block
        title="Economy — India"
        section="Economy"
        pack={eco}
        why="Recent stories on India's economy and markets from the last 3 days."
      />
    </div>
  );
}
