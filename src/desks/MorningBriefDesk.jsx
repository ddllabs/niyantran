import { useWorkspaceState } from '../shell/workspaceState.js';
import { useEffect, useState } from 'react';
import { applyVizFilter } from '../lib/nationalKpi.js';
import TableFilterPop from '../shell/TableFilterPop.jsx';
import { VizFilterChip } from '../shell/AnalyticsViz.jsx';
import { rowDragProps } from '../lib/aiDrop.js';
import CorpusCapability from '../shell/CorpusCapability.jsx';
import { dedupeNewsRows } from '../lib/newsDedup.js';
import { applyRecordChecklistToFeed } from '../lib/recordChecklist.js';
import { fetchFeature } from '../lib/featureFeed.js';
import { technicalTitle } from '../lib/plainSourceNote.js';

// F164: what a section says when its source could not be reached.
const SECTION_DOWN = 'This section couldn\u2019t load right now.';
const FEATURE = 'National Morning Brief (Auto-digest)';
// F169 T3 (F166): the server builds all three sections (PIB and two news searches). The page used
// to fetch them through /api/rss, which only the local dev server has, so it never loaded live.
const SECTIONS = { top: 'Top of the Day', pib: 'Government Wire', eco: 'Economy' };

/** The feed's real rows for one section, as { rows, err } for that section's block. */
export function briefSection(feed, section) {
  const real = (feed?.rows || []).filter((r) => r && r.status !== 'source_status');
  const rows = dedupeNewsRows(real.filter((r) => r.section === section));
  if (rows.length) return { rows, err: '' };
  // F159 review: `source.diagnostic` is for the console (logged below), not the banner's title.
  return { rows: [], err: real.length ? '' : (feed?.source?.note || 'no rows') };
}

export default function MorningBriefDesk({ workspaceScope = '', onSelect, onFeed, vizFilter, onClearViz }) {
  const [top, setTop] = useState({ rows: [], err: '' });
  const [pib, setPib] = useState({ rows: [], err: '' });
  const [eco, setEco] = useState({ rows: [], err: '' });
  const [q, setQ] = useWorkspaceState('MorningBriefDesk.q', '', workspaceScope);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    fetchFeature({ tier: 'national', feature: FEATURE, signal: ac.signal })
      .catch((e) => (e?.name === 'AbortError' ? null : { rows: [], source: { note: String(e?.message || e) } }))
      .then((feed) => {
        if (!feed || ac.signal.aborted) return;
        if (feed.source?.diagnostic) console.warn(`[${FEATURE}] stored or unavailable:`, feed.source.diagnostic);
        setTop(briefSection(feed, SECTIONS.top));
        setPib(briefSection(feed, SECTIONS.pib));
        setEco(briefSection(feed, SECTIONS.eco));
        setLoading(false);
      });
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
        feature: FEATURE,
        rows,
        source: {
          adapter: 'news-search',
          note: anyLive
            ? `Morning Brief: top stories ${top.rows.length}, PIB ${pib.rows.length}, economy ${eco.rows.length}.`
            : 'Morning Brief: no section could load right now.',
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
          // F169 T3 review: the reader sees only the plain sentence; the reason stays in the title.
          <p className="banner warn" title={technicalTitle(pack.err, SECTION_DOWN)}>
            {SECTION_DOWN}
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
                  <span className="nat-brief-headline">{r.title}<CorpusCapability row={{...r,section,headline:r.title,topic:section,region:r.region || 'India'}} feed={{tier:'national',feature:FEATURE}} /></span>
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
