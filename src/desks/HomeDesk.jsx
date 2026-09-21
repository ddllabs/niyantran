import { useEffect, useRef, useState } from 'react';
import zine from '../data/home-zine.json';
import {
  homeCacheHasRows,
  isHomeCacheFresh,
  kickHomeRefreshIfDue,
  loadHomeCache,
  saveHomeCache,
} from '../lib/homeCache.js';
import { homeLatestFromStatic, homeMarketsFromStatic, homePulseFromStatic } from '../lib/homeStatic.js';
import { homeLiveApiEnabled, liveApiEnabled } from '../lib/apiMode.js';
import { loadRefreshCfg } from '../lib/refreshStore.js';
import { aiDragProps } from '../lib/aiDrop.js';
import { dedupeNewsRows } from '../lib/newsDedup.js';
import { applyRecordChecklistToFeed } from '../lib/recordChecklist.js';
import { prepareHomeMarketQuotes } from '../lib/homeMarkets.js';
import { loadHomeTickerItems } from '../lib/homeTicker.js';
import { trackProductEvent } from '../lib/productAnalytics.js';
import { loadWatchlist, subscribeWatchlist } from '../lib/watchlistStore.js';

async function getJson(path, signal) {
  const route = String(path).split('?')[0];
  const homeRoute = route.startsWith('/api/home/') || route === '/api/ohlc';
  const tryApi = homeRoute ? homeLiveApiEnabled() : liveApiEnabled();
  if (tryApi) {
    try {
      const res = await fetch(path, { signal });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        /* fall through to static */
      } else if (route === '/api/home/latest') {
        // Empty rows is a valid nter.news state (waiting for ingest).
        if (body.ok !== false) return body;
      } else if (Array.isArray(body.rows) && body.rows.length) {
        return body;
      } else if (body.last != null) {
        return body;
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
  }
  if (route === '/api/home/markets') return homeMarketsFromStatic(signal);
  if (route === '/api/home/latest') return homeLatestFromStatic(signal);
  if (route === '/api/home/pulse') return homePulseFromStatic(signal);
  throw new Error(`HTTP ${route} unavailable`);
}

function fmtPx(n) {
  if (n == null || Number.isNaN(Number(n))) return '…';
  const v = Number(n);
  return v.toLocaleString('en-IN', { maximumFractionDigits: v > 999 ? 0 : 2 });
}

function chClass(n) {
  if (n == null) return '';
  return n >= 0 ? 'up' : 'dn';
}

function chText(n, digits = 2) {
  if (n == null || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  return `${v >= 0 ? '▲' : '▼'}${Math.abs(v).toFixed(digits)}%`;
}

function Spark({ values, up }) {
  const c = (values || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (c.length < 2) return null;
  const w = 56;
  const h = 16;
  const min = Math.min(...c);
  const max = Math.max(...c);
  const r = max - min || 1;
  const pts = c
    .map((v, i) => `${((i / (c.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / r) * (h - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none" aria-hidden="true" className="nh-spark">
      <polyline points={pts} fill="none" stroke={up ? '#72C36B' : '#C1524B'} strokeWidth="1.4" opacity="0.9" />
    </svg>
  );
}

function SnapshotBadge({ ageH, archive }) {
  if (archive) {
    return <span className="nh-agent" title="Stored snapshot — not live ticks">snapshot · not live</span>;
  }
  if (ageH == null || !Number.isFinite(Number(ageH))) {
    return <span className="nh-agent" title="Delayed / snapshot quotes">snapshot</span>;
  }
  const label = ageH < 1 ? '<1h' : `${Math.round(ageH)}h`;
  return <span className="nh-agent" title="Quote age from last successful pull">snapshot · {label} ago</span>;
}

export default function HomeDesk({ onOpen, onFeed, onSelect, onLoading, reload }) {
  const boot = loadHomeCache();
  const [markets, setMarkets] = useState(boot?.markets?.rows || []);
  const [latest, setLatest] = useState(boot?.latest?.rows || []);
  const [pulse, setPulse] = useState(boot?.pulse?.rows || []);
  const [meta, setMeta] = useState({
    markets: boot?.markets || null,
    latest: boot?.latest || null,
    pulse: boot?.pulse || null,
  });
  const [loading, setLoading] = useState(!homeCacheHasRows(boot));
  const [topics, setTopics] = useState([]);
  const [watchlist, setWatchlist] = useState(() => loadWatchlist());
  const prevReload = useRef(reload);

  useEffect(() => subscribeWatchlist(setWatchlist), []);

  const featured = zine[0];
  const latestShown = dedupeNewsRows(
    (latest || []).map((r) => ({
      title: r.title,
      source_url: r.link,
      date: r.pub || r.ago,
      outlet: r.src,
      link: r.link,
      src: r.src,
      ago: r.ago,
      dek: r.dek,
      pub: r.pub,
    })),
  ).map((r) => ({
    title: r.title,
    link: r.link || r.source_url,
    src: r.src || r.outlet,
    ago: r.ago,
    dek: r.dek,
    pub: r.pub || r.published || r.date,
    related_count: r.related_count,
  }));
  const pulseShown = dedupeNewsRows(
    (pulse || []).map((r) => ({
      title: r.title,
      source_url: r.link,
      date: r.time,
      region: r.region,
      link: r.link,
      time: r.time,
      dek: r.dek,
    })),
  ).map((r) => ({
    ...r,
    link: r.link || r.source_url,
    time: r.time || r.published || r.date,
  }));

  useEffect(() => {
    let alive = true;
    loadHomeTickerItems().then((items) => {
      if (alive) setTopics(items);
    });
    return () => {
      alive = false;
    };
  }, [reload]);

  useEffect(() => {
    trackProductEvent('home_open', {});
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const force = prevReload.current !== reload;
    prevReload.current = reload;
    const hours = loadRefreshCfg().intervalHours;
    const cached = loadHomeCache();
    const hasCache = homeCacheHasRows(cached);

    function applyFeed(marketsBody, latestBody, pulseBody) {
      if (latestBody?.rows?.length) {
        const rows = dedupeNewsRows(
          latestBody.rows.map((r) => ({ title: r.title, source_url: r.link, date: r.pub, status: '' })),
        );
        onFeed(
          applyRecordChecklistToFeed({
            feature: 'Home',
            rows,
            source: { adapter: 'nter.news', note: latestBody.note, gdelt: false },
            fallback: Boolean(latestBody.archive),
          }),
        );
      } else if (pulseBody?.rows?.length) {
        const rows = dedupeNewsRows(
          pulseBody.rows.map((r) => ({ title: r.title, source_url: r.link, date: r.time, status: '' })),
        );
        onFeed(
          applyRecordChecklistToFeed({
            feature: 'Conflict Pulse',
            rows,
            source: {
              adapter: pulseBody.gdelt ? 'news-search' : 'embedded',
              note: pulseBody.note,
              gdelt: Boolean(pulseBody.gdelt),
            },
            fallback: Boolean(pulseBody.archive),
          }),
        );
      }
      onSelect(null);
    }

    function paintCache(c) {
      if (!c) return;
      setMarkets(c.markets?.rows || []);
      setLatest(c.latest?.rows || []);
      setPulse(c.pulse?.rows || []);
      setMeta({ markets: c.markets, latest: c.latest, pulse: c.pulse });
      setLoading(false);
      onLoading?.(false);
    }

    async function pullSnapshots(fresh) {
      const q = `maxAgeH=${encodeURIComponent(hours)}${fresh ? '&fresh=1' : ''}`;
      const [m, l, p] = await Promise.allSettled([
        getJson(`/api/home/markets?${q}`, ac.signal),
        getJson(`/api/home/latest?${q}`, ac.signal),
        getJson(`/api/home/pulse?${q}`, ac.signal),
      ]);
      if (ac.signal.aborted) return;
      const marketsBody = m.status === 'fulfilled' ? m.value : null;
      const latestBody = l.status === 'fulfilled' ? l.value : null;
      const pulseBody = p.status === 'fulfilled' ? p.value : null;
      if (marketsBody?.rows) setMarkets(marketsBody.rows);
      if (latestBody?.rows) setLatest(latestBody.rows);
      if (pulseBody?.rows) setPulse(pulseBody.rows);
      setMeta({ markets: marketsBody, latest: latestBody, pulse: pulseBody });
      saveHomeCache({ markets: marketsBody, latest: latestBody, pulse: pulseBody });
      applyFeed(marketsBody, latestBody, pulseBody);
    }

    if (hasCache) {
      paintCache(cached);
      applyFeed(cached.markets, cached.latest, cached.pulse);
    } else {
      setLoading(true);
      onLoading?.(true);
    }

    const cfg = loadRefreshCfg();
    const skipLive = !force && hasCache && (!cfg.auto || isHomeCacheFresh(hours, cached));

    (async () => {
      try {
        if (!skipLive && !force && hasCache) await kickHomeRefreshIfDue();
        if (ac.signal.aborted) return;
        await pullSnapshots(force);
      } catch (err) {
        if (err?.name === 'AbortError') return;
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false);
          onLoading?.(false);
        }
      }
      try {
        if (ac.signal.aborted || force) return;
        const saved = loadHomeCache();
        if ((saved?.markets?.rows?.length || 0) < 9) {
          await new Promise((r) => setTimeout(r, 20000));
          if (ac.signal.aborted) return;
          await pullSnapshots(false);
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    })();

    return () => ac.abort();
  }, [onFeed, onSelect, onLoading, reload]);

  const quotes = prepareHomeMarketQuotes(markets.length ? markets : TICKER_PLACEHOLDERS);

  return (
    <div className="nh">
      {topics.length ? (
        <div className="nh-topics" aria-label="Hot topics">
          <div className="nh-topics-label">
            <i className="nh-topics-pulse" aria-hidden="true" />
            <span>Hot topics</span>
          </div>
          <div className="nh-topics-viewport">
            <div className="nh-topics-track">
              {[0, 1].map((copy) =>
                topics.map((it, i) => (
                  <button
                    key={`${copy}-${it.key}-${i}`}
                    type="button"
                    className="nh-topic"
                    aria-hidden={copy === 1 || undefined}
                    onClick={() => onOpen({ tab: it.tab, feature: it.feature })}
                  >
                    <span className={`nh-topic-cat cat-${it.key}`}>{it.cat}</span>
                    <span className="nh-topic-text">{it.text}</span>
                  </button>
                )),
              )}
            </div>
          </div>
        </div>
      ) : null}
      <div className="nh-strip" aria-label="Market quotes">
        <div className="nh-strip-track">
          {[0, 1].map((copy) =>
            quotes.map((q) => (
              <div key={`${copy}-${q.name}`} className="nh-q" aria-hidden={copy === 1 || undefined}>
                <b>{q.name}</b>
                <span>{fmtPx(q.last)}</span>
                <span className={chClass(q.chg)} title={q.changeWindow ? `${q.changeWindow} change` : 'Change'}>
                  {chText(q.chg)}
                </span>
                {(q.asOf || q.as_of) && (
                  <span className="muted" style={{ fontSize: '0.65rem', marginLeft: 4 }} title={`As of ${q.asOf || q.as_of}`}>
                    as of {String(q.asOf || q.as_of).slice(0, 10)}
                  </span>
                )}
              </div>
            )),
          )}
        </div>
      </div>

      <div className="nh-grid">
        <div className="nh-main">
          {featured && (
            <article className="nh-hero">
              <div className="nh-hero-copy">
                <div className="nh-kicker">
                  <span className="nh-tag inv">{featured.type || 'Briefing'}</span>
                  {featured.interactive && <span className="nh-sim">INTERACTIVE</span>}
                </div>
                <h2>{featured.title}</h2>
                <p>{featured.dek}</p>
                <div className="nh-story-meta">
                  <span>{featured.source || 'Niyantran'}</span>
                  {featured.published ? <span>· {featured.published}</span> : null}
                </div>
                <button type="button" className="nh-cta">
                  Read + explore the data
                </button>
              </div>
              {featured.thumb && <img className="nh-hero-img" alt="" src={featured.thumb} />}
            </article>
          )}

          <div className="nh-tools">
            <section className="nh-box">
              <div className="bh">MY WATCHLIST</div>
              <ul className="nh-watchlist">
                {watchlist.map((w) => (
                  <li key={`${w.tab}:${w.feature}`}>
                    <button type="button" onClick={() => onOpen({ tab: w.tab, feature: w.feature })}>
                      {w.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section className="nh-box">
              <div className="bh">FEED HEALTH</div>
              <div className="nh-health">
                <div>
                  <span>Markets</span>
                  <b>{meta.markets?.ageH != null ? `${Number(meta.markets.ageH).toFixed(1)}h` : loading ? '…' : '—'}</b>
                </div>
                <div>
                  <span>Latest (nter.news)</span>
                  <b>{meta.latest?.ageH != null ? `${Number(meta.latest.ageH).toFixed(1)}h` : loading ? '…' : '—'}</b>
                </div>
                <div>
                  <span>Conflict pulse</span>
                  <b>{meta.pulse?.ageH != null ? `${Number(meta.pulse.ageH).toFixed(1)}h` : loading ? '…' : '—'}</b>
                </div>
              </div>
            </section>
          </div>
        </div>

        <aside className="nh-rail">
          <section className="nh-box">
            <div className="bh">
              <span>
                MARKETS
                <SnapshotBadge ageH={meta.markets?.ageH} archive={Boolean(meta.markets?.archive)} />
              </span>
              <button type="button" className="nh-link" onClick={() => onOpen({ tab: 'economics', feature: 'NSE/BSE Delayed Market Feed' })} {...aiDragProps({ kind: 'feature', tab: 'economics', feature: 'NSE/BSE Delayed Market Feed', title: 'NSE/BSE Delayed Market Feed' })}>
                Economics desk →
              </button>
            </div>
            <p className="nh-asof muted" style={{ margin: '0 0 0.5rem', fontSize: '0.75rem' }}>
              {meta.markets?.archive
                ? 'Delayed snapshot — not live ticks. '
                : 'Delayed quotes (not streaming). '}
              {(meta.markets?.as_of || meta.markets?.updated || quotes.find((q) => q.asOf || q.as_of)) && (
                <>
                  As of{' '}
                  {String(
                    meta.markets?.as_of ||
                      meta.markets?.updated ||
                      quotes.find((q) => q.asOf || q.as_of)?.asOf ||
                      quotes.find((q) => q.as_of)?.as_of ||
                      '',
                  )
                    .replace('T', ' ')
                    .replace(/\.\d+Z$/, ' UTC')
                    .replace(/Z$/, ' UTC')}
                </>
              )}
              {!meta.markets?.as_of && !meta.markets?.updated && !quotes.find((q) => q.asOf || q.as_of) && (
                <span>As-of stamp missing on this pull — treat as archive.</span>
              )}
            </p>
            <table className="nh-moves">
              <tbody>
                {quotes.map((q) => (
                  <tr key={`m-${q.name}`} {...aiDragProps({ kind: 'row', tab: 'economics', feature: 'NSE/BSE Delayed Market Feed', title: q.name, row: q })}>
                    <td>{q.name}</td>
                    <td className="spk">
                      <Spark values={q.spark} up={(q.chg || 0) >= 0} />
                    </td>
                    <td className="px">{fmtPx(q.last)}</td>
                    <td className={chClass(q.chg)} title={q.changeWindow ? `${q.changeWindow} change` : 'Change'}>
                      {q.last == null ? '…' : chText(q.chg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="nh-box">
            <div className="bh">
              <span>
                LATEST FROM NTER.NEWS
                <SnapshotBadge ageH={meta.latest?.ageH} archive={Boolean(meta.latest?.archive)} />
              </span>
            </div>
            <ul className="nh-latest">
              {loading && !latest.length && <li className="muted">Loading…</li>}
              {!loading && !latestShown.length && (
                <li className="muted">
                  {meta.latest?.note || 'nter.news feed not configured on this build. No headlines were invented.'}
                </li>
              )}
              {latestShown.map((r, i) => (
                <li key={`${r.link}-${i}`} {...aiDragProps({ kind: 'row', title: r.title, row: { title: r.title, source_url: r.link, src: r.src } })}>
                  <a href={r.link} target="_blank" rel="noreferrer">
                    {r.title}
                  </a>
                  {r.dek ? <span className="nh-story-dek">{r.dek}</span> : null}
                  <span className="s">
                    {r.src || 'nter.news'}
                    {r.ago ? ` · ${r.ago}` : ''}
                    {r.related_count > 0 ? ` · +${r.related_count} related` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="nh-box">
            <div className="bh">
              CONFLICT PULSE{' '}
              <small>{meta.pulse?.gdelt ? 'GDELT · LIVE' : meta.pulse?.rows?.length ? 'OPEN FRONTS' : ''}</small>
              <SnapshotBadge ageH={meta.pulse?.ageH} archive={Boolean(meta.pulse?.archive)} />
            </div>
            <ul className="nh-pulse">
              {loading && !pulse.length && <li className="muted">Loading…</li>}
              {!loading && !pulseShown.length && (
                <li className="muted">
                  Conflict wire quiet.{' '}
                  <button type="button" className="nh-inline" onClick={() => onOpen({ tab: 'global', feature: 'Open Fronts' })} {...aiDragProps({ kind: 'feature', tab: 'global', feature: 'Open Fronts', title: 'Open Fronts' })}>
                    Open Fronts
                  </button>
                </li>
              )}
              {pulseShown.slice(0, 5).map((r, i) => (
                <li key={`${r.link || r.title}-${i}`} {...aiDragProps({ kind: 'row', tab: 'global', feature: 'Open Fronts', title: r.title, row: r })}>
                  <span className="nh-story-kicker">
                    {r.region || 'Theatre'}
                    {r.time ? ` · ${r.time}` : ''}
                    {r.related_count > 0 ? ` · +${r.related_count} related` : ''}
                  </span>
                  {r.link ? (
                    <a href={r.link} target="_blank" rel="noreferrer">
                      {r.title}
                    </a>
                  ) : (
                    <span className="nh-ptitle">{r.title}</span>
                  )}
                  {r.dek ? <span className="nh-story-dek">{r.dek}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

const TICKER_PLACEHOLDERS = [
  'NIFTY 50',
  'SENSEX',
  'USD/INR',
  'BRENT',
  'GOLD',
  'NIFTY BANK',
  'INDIA VIX',
  'S&P 500',
  'BITCOIN',
].map((name) => ({ name, last: null, d1: null, dM: null }));
