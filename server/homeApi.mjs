/**
 * Same-origin home APIs as the root HTML terminal:
 *   GET /data/markets.json | conflict.json | news.json   agent snapshots (HTML niySnapshot)
 *   GET /api/ohlc?symbol=&range=                         Yahoo, then data/ohlc.json
 *   GET /api/conflict?days=&topic=                       GDELT, then Open Fronts snapshot
 *   GET /api/rss?url=                                    raw RSS XML (JSON if format=json)
 *   GET /api/home/markets | latest | pulse               Home desk helpers
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareHomeMarketQuotes } from '../src/lib/homeMarkets.js';
import { serveNterLatest } from './nterNews.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const PUBLIC_DATA = path.join(APP_ROOT, 'public', 'data');
const OHLC_PATH = [
  path.join(PUBLIC_DATA, 'ohlc.json'),
  path.join(REPO_ROOT, 'data', 'ohlc.json'),
].find((p) => fs.existsSync(p)) || path.join(PUBLIC_DATA, 'ohlc.json');
const MARKET_FEED_PATH = [
  path.join(PUBLIC_DATA, 'embedded_csv', 'finance_market_feed.json'),
  path.join(REPO_ROOT, 'data', 'embedded_csv', 'finance_market_feed.json'),
].find((p) => fs.existsSync(p)) || path.join(PUBLIC_DATA, 'embedded_csv', 'finance_market_feed.json');
const WAR_PATH = [
  path.join(PUBLIC_DATA, 'embedded_csv', 'geopolitics_war_tracker.json'),
  path.join(REPO_ROOT, 'data', 'embedded_csv', 'geopolitics_war_tracker.json'),
].find((p) => fs.existsSync(p)) || path.join(PUBLIC_DATA, 'embedded_csv', 'geopolitics_war_tracker.json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TICKERS = [
  ['NIFTY 50', '^NSEI'],
  ['SENSEX', '^BSESN'],
  ['USD/INR', 'INR=X'],
  ['BRENT', 'BZ=F'],
  ['GOLD', 'GC=F'],
  ['NIFTY BANK', '^NSEBANK'],
  ['INDIA VIX', '^INDIAVIX'],
  ['S&P 500', '^GSPC'],
  ['BITCOIN', 'BTC-USD'],
];

const SNAPSHOT_MAX_AGE_H = 24;
const DEFAULT_HOME_MAX_AGE_H = 6;
const GDELT_GAP_MS = 5_500;
const GDELT_CACHE_MS = 10 * 60_000;
let gdeltNextAt = 0;
const gdeltCache = new Map();

let ohlcCache = null;
const homeRefreshInflight = Object.create(null);
let marketFeedCache = null;
let warCache = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readJsonFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadOhlc() {
  if (!ohlcCache) ohlcCache = readJsonFile(OHLC_PATH) || {};
  return ohlcCache;
}

function loadMarketFeed() {
  if (!marketFeedCache) marketFeedCache = readJsonFile(MARKET_FEED_PATH) || [];
  return marketFeedCache;
}

function loadWar() {
  if (!warCache) warCache = readJsonFile(WAR_PATH) || [];
  return warCache;
}

async function fetchText(url, ms = 12000) {
  if (/^https:\/\/pib\.gov\.in\//i.test(url || '')) {
    url = url.replace(/^https:\/\/pib\.gov\.in\//i, 'https://www.pib.gov.in/');
  }
  const gdelt = /gdeltproject\.org/i.test(url || '');
  if (gdelt) {
    const hit = gdeltCache.get(url);
    if (hit && Date.now() - hit.at < GDELT_CACHE_MS) return hit.value;
    const wait = gdeltNextAt - Date.now();
    if (wait > 0) await sleep(wait);
    gdeltNextAt = Date.now() + GDELT_GAP_MS;
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { Accept: '*/*', 'User-Agent': UA },
    });
    const text = await res.text();
    if (res.status === 429 || /please limit requests|too many requests/i.test(text)) {
      throw new Error('GDELT rate limited');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (gdelt) gdeltCache.set(url, { at: Date.now(), value: text });
    return text;
  } finally {
    clearTimeout(t);
  }
}

function quoteFromCloses(name, closes, symbol) {
  const c = (closes || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (c.length < 2) return null;
  const last = c[c.length - 1];
  const prev = c[c.length - 2];
  const first = c[0];
  const step = Math.max(1, Math.floor(c.length / 24));
  const spark = c.filter((_, k) => k % step === 0 || k === c.length - 1);
  return {
    name,
    symbol,
    last,
    d1: prev ? ((last - prev) / prev) * 100 : null,
    dM: first ? ((last - first) / first) * 100 : null,
    spark,
  };
}

function ohlcFromArchive(symbol) {
  const pack = loadOhlc()[symbol];
  if (!pack) return null;
  const c = pack.c || pack.close || [];
  const lastLive = c.filter((v) => v != null && Number.isFinite(Number(v)));
  return {
    t: pack.t || pack.timestamp || [],
    o: pack.o || pack.open || [],
    h: pack.h || pack.high || [],
    l: pack.l || pack.low || [],
    c: pack.c || pack.close || [],
    last: lastLive.length ? lastLive[lastLive.length - 1] : null,
    archive: true,
  };
}

function quoteFromMarketFeed(name, symbol) {
  const row = loadMarketFeed().find((r) => String(r.name || '').toUpperCase() === name.toUpperCase());
  if (!row || row.last == null) return null;
  const last = Number(String(row.last).replace(/,/g, ''));
  const pct = Number(row.pct_change);
  if (!Number.isFinite(last)) return null;
  const asOf = row.as_of || row.asOf || '';
  return {
    name,
    symbol,
    last,
    d1: Number.isFinite(pct) ? pct : null,
    dM: Number.isFinite(pct) ? pct : null,
    spark: [],
    archive: true,
    asOf,
    as_of: asOf,
    source: 'finance_market_feed',
  };
}

function snapshotAgeH(d) {
  const stamp = d?.as_of || d?.updated;
  if (!stamp) return Infinity;
  const t = new Date(stamp).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 3600000;
}

function readDiskSnapshot(feed) {
  const file = path.join(PUBLIC_DATA, `${feed}.json`);
  const d = readJsonFile(file);
  if (!d || !(d.as_of || d.updated)) return null;
  d.__ageH = snapshotAgeH(d);
  return d;
}

function writeDiskSnapshot(feed, body) {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (!rows.length) return;
  try {
    fs.mkdirSync(PUBLIC_DATA, { recursive: true });
    const quoteStamp =
      body.as_of ||
      body.updated ||
      rows.find((r) => r?.as_of || r?.asOf)?.as_of ||
      rows.find((r) => r?.asOf)?.asOf ||
      '';
    const now = new Date().toISOString();
    // Prefer quote as-of for age; keep fetched_at as wall-clock of this write.
    const out = {
      updated: quoteStamp || now,
      as_of: quoteStamp || '',
      fetched_at: now,
      rows,
      note: body.note || '',
      source: body.source || 'snapshot',
      gdelt: Boolean(body.gdelt),
      archive: Boolean(body.archive),
    };
    if (body.meta) out.meta = body.meta;
    fs.writeFileSync(path.join(PUBLIC_DATA, `${feed}.json`), JSON.stringify(out));
  } catch (err) {
    console.warn('[home-cache] write failed', feed, err.message);
  }
}

function snapshotPayload(snap, extra = {}) {
  return {
    ok: true,
    rows: snap.rows,
    source: snap.source || 'snapshot',
    note: snap.note,
    gdelt: Boolean(snap.gdelt),
    archive: Boolean(snap.archive) || snap.__ageH > SNAPSHOT_MAX_AGE_H,
    ageH: snap.__ageH,
    updated: snap.updated,
    as_of: snap.as_of || snap.updated || '',
    cached: true,
    ...extra,
  };
}

function scheduleHomeRefresh(feed, fn) {
  if (homeRefreshInflight[feed]) return;
  homeRefreshInflight[feed] = true;
  Promise.resolve()
    .then(fn)
    .then((body) => {
      if (body?.rows?.length) writeDiskSnapshot(feed, body);
    })
    .catch((err) => console.warn('[home-cache] refresh', feed, err?.message || err))
    .finally(() => {
      homeRefreshInflight[feed] = false;
    });
}

function maxAgeFromUrl(url) {
  const n = Number(url.searchParams.get('maxAgeH'));
  if (Number.isFinite(n) && n > 0 && n <= 72) return n;
  return DEFAULT_HOME_MAX_AGE_H;
}

export async function serveOhlc(symbol, range = '1mo') {
  const sym = String(symbol || '').trim();
  if (!sym) return { error: 'symbol required' };
  const rng = /^(\d+[dmyw]|1mo|3mo|6mo|1y|2y|5y|ytd|max)$/i.test(range) ? range : '1mo';
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${encodeURIComponent(rng)}&interval=1d`;
    const text = await fetchText(url, 14000);
    const j = JSON.parse(text);
    const res = j?.chart?.result?.[0];
    const q = res?.indicators?.quote?.[0] || {};
    const c = (q.close || []).filter((v) => v != null && Number.isFinite(v));
    if (!c.length) throw new Error('empty chart');
    return {
      t: res?.timestamp || [],
      o: q.open || [],
      h: q.high || [],
      l: q.low || [],
      c: q.close || [],
      last: c[c.length - 1],
    };
  } catch (err) {
    const arch = ohlcFromArchive(sym);
    if (arch && (arch.c || []).some((v) => v != null)) return arch;
    throw err;
  }
}

async function liveQuote(name, symbol) {
  try {
    const ohlc = await serveOhlc(symbol, '1mo');
    const q = quoteFromCloses(name, ohlc.c, symbol);
    if (q) return { ...q, archive: Boolean(ohlc.archive) };
  } catch {
    /* fall through */
  }
  return quoteFromMarketFeed(name, symbol);
}

function snapshotMarketsFromArchive() {
  // D8: feed last + pct_change are the headline numbers; OHLC is spark-only.
  const rows = TICKERS.map(([name, symbol]) => {
    const fromFeed = quoteFromMarketFeed(name, symbol);
    const fromOhlc = quoteFromCloses(name, ohlcFromArchive(symbol)?.c, symbol);
    if (fromFeed) {
      return { ...fromFeed, spark: fromOhlc?.spark || [] };
    }
    return fromOhlc || { name, symbol, last: null, d1: null, dM: null, spark: [], archive: true };
  }).filter((r) => r.last != null);
  const feedAsOf = rows.find((r) => r.as_of || r.asOf)?.as_of || rows.find((r) => r.asOf)?.asOf;
  const ts = (ohlcFromArchive('^NSEI')?.t || []).filter(Boolean);
  const updated =
    feedAsOf || (ts.length ? new Date(ts[ts.length - 1] * 1000).toISOString() : new Date().toISOString());
  return { updated, rows: prepareHomeMarketQuotes(rows), as_of: updated };
}

async function fetchLiveMarkets() {
  const rows = await Promise.all(TICKERS.map(([name, symbol]) => liveQuote(name, symbol)));
  const live = prepareHomeMarketQuotes(rows.filter(Boolean));
  if (live.some((r) => r.last != null && !r.archive)) {
    return {
      ok: true,
      rows: live,
      source: 'Yahoo Finance via /api/ohlc. Not a recommendation.',
    };
  }
  if (live.some((r) => r.last != null)) {
    return {
      ok: true,
      rows: live,
      source: 'Original HTML OHLC / NSE market-feed snapshot. Live Yahoo was unreachable.',
      archive: true,
    };
  }
  const arch = snapshotMarketsFromArchive();
  return {
    ok: true,
    rows: prepareHomeMarketQuotes(arch.rows),
    source: 'Original HTML OHLC / NSE market-feed snapshot.',
    archive: true,
  };
}

export async function serveHomeMarkets(opts = {}) {
  const maxAgeH = opts.maxAgeH ?? DEFAULT_HOME_MAX_AGE_H;
  const fresh = Boolean(opts.fresh);
  // On Vercel serverless, prefer a live Yahoo pull — disk writes do not persist
  // and archived packs are what made production look months stale.
  const preferLive = fresh || Boolean(process.env.VERCEL);
  if (!preferLive) {
    const snap = readDiskSnapshot('markets');
    if (snap?.rows?.some((r) => r?.last != null)) {
      if (snap.__ageH > maxAgeH) scheduleHomeRefresh('markets', fetchLiveMarkets);
      return {
        ...snapshotPayload(snap, { source: snap.source || 'snapshot' }),
        rows: prepareHomeMarketQuotes(snap.rows),
      };
    }
    const arch = snapshotMarketsFromArchive();
    if (arch.rows?.length) {
      const rows = prepareHomeMarketQuotes(arch.rows);
      const stamp = arch.as_of || arch.updated || '';
      const ageH = stamp ? snapshotAgeH({ as_of: stamp, updated: stamp }) : Infinity;
      writeDiskSnapshot('markets', {
        ...arch,
        rows,
        archive: true,
        as_of: stamp,
        updated: stamp,
        source: 'Original HTML OHLC / NSE market-feed snapshot.',
      });
      scheduleHomeRefresh('markets', fetchLiveMarkets);
      return {
        ok: true,
        rows,
        source: 'Original HTML OHLC / NSE market-feed snapshot.',
        archive: true,
        cached: true,
        as_of: stamp,
        updated: stamp,
        ageH,
      };
    }
  }
  try {
    const live = await fetchLiveMarkets();
    writeDiskSnapshot('markets', live);
    return { ...live, rows: prepareHomeMarketQuotes(live.rows || []) };
  } catch (err) {
    const snap = readDiskSnapshot('markets');
    if (snap?.rows?.some((r) => r?.last != null)) {
      return {
        ...snapshotPayload(snap, { source: snap.source || 'snapshot' }),
        rows: prepareHomeMarketQuotes(snap.rows),
        note: `Live quotes unreachable (${err.message || 'error'}). Showing last saved markets.`,
        archive: true,
      };
    }
    const arch = snapshotMarketsFromArchive();
    if (arch.rows?.length) {
      return {
        ok: true,
        rows: prepareHomeMarketQuotes(arch.rows),
        source: 'Original HTML OHLC / NSE market-feed snapshot.',
        archive: true,
        as_of: arch.as_of || arch.updated || '',
        updated: arch.updated || arch.as_of || '',
        note: `Live quotes unreachable (${err.message || 'error'}). Showing shipped market pack.`,
      };
    }
    throw err;
  }
}

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseRss(xml) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const tag = (name) => {
      const r = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
      return decodeXml((r.exec(block)?.[1] || '').replace(/<[^>]+>/g, ''));
    };
    const href =
      /<link>([^<]+)<\/link>/i.exec(block)?.[1]?.trim() ||
      /href="([^"]+)"/i.exec(block)?.[1] ||
      '';
    const img =
      /<media:content[^>]+url="([^"]+)"/i.exec(block)?.[1] ||
      /<enclosure[^>]+url="([^"]+)"/i.exec(block)?.[1] ||
      /<img[^>]+src=["']([^"']+)/i.exec(block)?.[1] ||
      '';
    const title = tag('title');
    if (title) items.push({ title, link: href, pub: tag('pubDate') || tag('updated'), img });
    if (items.length >= 12) break;
  }
  return items;
}

async function fetchRssXml(url) {
  if (!/^https:\/\//i.test(url || '')) throw new Error('HTTPS url required');
  return fetchText(url, 16000);
}

export async function serveRss(url) {
  return parseRss(await fetchRssXml(url));
}

function ago(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 5400) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 172800) return `${Math.round(s / 3600)} hr`;
  return `${Math.round(s / 86400)} d`;
}

async function fetchLiveLatest() {
  // Homepage Latest is nter.news only — never fall back to wire RSS.
  const nter = serveNterLatest({ limit: 12 });
  return nter.rows?.length ? nter : null;
}

const WIRE_FEEDS = [
  { src: 'THE WIRE', site: 'https://thewire.in', url: 'https://cms.thewire.in/feed' },
  { src: 'OCCRP', site: 'https://www.occrp.org', url: 'https://www.occrp.org/en/feed' },
  { src: 'SCROLL.IN', site: 'https://scroll.in', url: 'https://feeds.feedburner.com/ScrollinArticles.rss' },
  { src: 'THE HINDU', site: 'https://www.thehindu.com', url: 'https://www.thehindu.com/news/national/feeder/default.rss' },
];

async function fetchWireRssLatest() {
  const parts = await Promise.all(
    WIRE_FEEDS.map(async (f) => {
      try {
        const xml = await fetchRssXml(f.url);
        return parseRss(xml).map((it) => ({
          ...it,
          src: f.src,
          site: f.site,
          source: 'wire-rss',
          t: new Date(it.pub).getTime() || Date.now(),
          ago: ago(it.pub),
        }));
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set();
  const rows = parts
    .flat()
    .filter((r) => {
      const k = String(r.link || r.title || '').toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (b.t || 0) - (a.t || 0))
    .slice(0, 12);
  if (!rows.length) return null;
  return {
    ok: true,
    rows,
    note: 'Headlines from The Wire, OCCRP, Scroll.in and The Hindu RSS.',
    source: 'wire-rss',
    archive: false,
    updated: new Date().toISOString(),
    as_of: new Date().toISOString(),
    ageH: 0,
    cached: false,
  };
}

export async function serveHomeLatest(opts = {}) {
  const live = serveNterLatest({ limit: 12 });
  if (live.rows?.length) {
    writeDiskSnapshot('news', {
      rows: live.rows,
      note: live.note,
      source: 'nter.news',
      updated: live.updated,
      as_of: live.updated,
    });
    return live;
  }

  // Only serve a prior nter.news snapshot — never wire RSS / old news.json.
  const snap = readDiskSnapshot('news');
  if (snap?.rows?.length && snap.source === 'nter.news') {
    const ageH = snap.__ageH;
    const stale = !Number.isFinite(ageH) || ageH > (opts.maxAgeH ?? DEFAULT_HOME_MAX_AGE_H);
    if (stale && !opts.fresh) {
      scheduleHomeRefresh('news', () => fetchLiveLatest());
    }
    return {
      ...snapshotPayload(snap),
      rows: snap.rows.map((r) => ({ ...r, ago: r.ago || ago(r.pub) })),
      note: snap.note || 'Latest from nter.news.',
      source: 'nter.news',
    };
  }

  return {
    ok: true,
    rows: [],
    note: live.note || 'Waiting for nter.news article.published pushes to POST /api/news/ingest. No headlines were invented.',
    source: 'nter.news',
    archive: false,
    waiting: true,
    ageH: null,
  };
}

function gdeltTime(seendate) {
  const s = String(seendate || '');
  if (s.length >= 15) return `${s.slice(9, 11)}:${s.slice(11, 13)}`;
  return '';
}

function conflictFromWarTracker() {
  const rows = loadWar()
    .filter((r) => r.conflict_name)
    .map((r) => ({
      title: r.conflict_name,
      time: r.started || r.current_stage || '',
      region: r.region || '',
      link: r.source_url || r.link || '',
      source: 'Open Fronts snapshot',
      outlets: r.conflict_type || '',
      event: r.latest_development || '',
    }));
  return {
    ok: true,
    rows,
    gdelt: false,
    archive: true,
    meta: { unique: rows.length, deduped: 0, window: 'embedded Open Fronts snapshot' },
    note: 'Original HTML Open Fronts table (geopolitics_war_tracker). GDELT live wire was unreachable. No records were invented.',
  };
}

function conflictSnapshotDisk() {
  const snap = readDiskSnapshot('conflict');
  if (snap?.rows?.length) {
    return {
      ok: true,
      rows: snap.rows,
      gdelt: false,
      source: 'snapshot',
      ageH: snap.__ageH,
      archive: snap.__ageH > SNAPSHOT_MAX_AGE_H,
      meta: { unique: snap.rows.length, deduped: 0, window: 'agent snapshot' },
      note: 'Agent snapshot (same /data/conflict.json the HTML home reads).',
    };
  }
  return null;
}

export async function serveConflict(days = 2, topic = '') {
  const snap = conflictSnapshotDisk();
  if (snap && snap.ageH <= SNAPSHOT_MAX_AGE_H) return snap;

  const span = Number(days) === 1 ? '1d' : Number(days) >= 7 ? '7d' : `${Number(days) || 2}d`;
  const q = (topic && String(topic).trim()) || '(war OR conflict OR ceasefire OR airstrike)';
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&sort=datedesc&timespan=${span}&maxrecords=75`;
  try {
    const text = await fetchText(url, 15000);
    const j = JSON.parse(text);
    const arts = j?.articles || [];
    const seen = new Set();
    const rows = [];
    let deduped = 0;
    for (const a of arts) {
      const title = (a.title || '').trim();
      const key = title.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
      if (!title || seen.has(key)) {
        if (title) deduped += 1;
        continue;
      }
      seen.add(key);
      rows.push({
        title,
        link: a.url || '',
        time: gdeltTime(a.seendate),
        region: a.sourcecountry || '',
        source: a.domain || '',
        outlets: a.domain || '',
      });
    }
    if (rows.length) {
      return {
        ok: true,
        rows,
        gdelt: true,
        meta: { unique: rows.length, deduped, window: span },
        note: 'GDELT DOC 2.0 reporting search — not an official dataset.',
      };
    }
  } catch {
    /* fall through to original HTML table */
  }
  if (snap?.rows?.length) return snap;
  return conflictFromWarTracker();
}

async function fetchLiveConflict() {
  const span = '2d';
  const q = '(war OR conflict OR ceasefire OR airstrike)';
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&sort=datedesc&timespan=${span}&maxrecords=75`;
  try {
    const text = await fetchText(url, 15000);
    const j = JSON.parse(text);
    const arts = j?.articles || [];
    const seen = new Set();
    const rows = [];
    let deduped = 0;
    for (const a of arts) {
      const title = (a.title || '').trim();
      const key = title.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
      if (!title || seen.has(key)) {
        if (title) deduped += 1;
        continue;
      }
      seen.add(key);
      rows.push({
        title,
        link: a.url || '',
        time: gdeltTime(a.seendate),
        region: a.sourcecountry || '',
        source: a.domain || '',
        outlets: a.domain || '',
      });
    }
    if (rows.length) {
      return {
        ok: true,
        rows,
        gdelt: true,
        meta: { unique: rows.length, deduped, window: span },
        note: 'GDELT DOC 2.0 reporting search — not an official dataset.',
      };
    }
  } catch {
    /* fall through */
  }
  return conflictFromWarTracker();
}

export async function serveHomePulse(opts = {}) {
  const maxAgeH = opts.maxAgeH ?? DEFAULT_HOME_MAX_AGE_H;
  const fresh = Boolean(opts.fresh);
  if (!fresh) {
    const snap = readDiskSnapshot('conflict');
    if (snap?.rows?.length) {
      if (snap.__ageH > maxAgeH) scheduleHomeRefresh('conflict', fetchLiveConflict);
      return { ...snapshotPayload(snap), rows: snap.rows.slice(0, 8) };
    }
    const war = conflictFromWarTracker();
    if (war.rows?.length) {
      writeDiskSnapshot('conflict', war);
      scheduleHomeRefresh('conflict', fetchLiveConflict);
      return { ...war, rows: war.rows.slice(0, 8), cached: true, ageH: 0 };
    }
  }
  const live = await fetchLiveConflict();
  writeDiskSnapshot('conflict', live);
  return { ...live, rows: (live.rows || []).slice(0, 8) };
}

let fullRefreshInflight = null;

export async function refreshHomeSnapshots() {
  if (fullRefreshInflight) return fullRefreshInflight;
  fullRefreshInflight = (async () => {
    const [markets, news, conflict] = await Promise.all([
      fetchLiveMarkets().catch(() => null),
      fetchLiveLatest().catch(() => null),
      fetchLiveConflict().catch(() => null),
    ]);
    if (markets?.rows?.length) writeDiskSnapshot('markets', markets);
    if (news?.rows?.length) writeDiskSnapshot('news', news);
    if (conflict?.rows?.length) writeDiskSnapshot('conflict', conflict);
    return {
      ok: true,
      markets: markets?.rows?.length || 0,
      news: news?.rows?.length || 0,
      conflict: conflict?.rows?.length || 0,
    };
  })().finally(() => {
    fullRefreshInflight = null;
  });
  return fullRefreshInflight;
}

function snapshotConflictFile() {
  const snap = readDiskSnapshot('conflict');
  if (snap?.rows?.length) return snap;
  const war = conflictFromWarTracker();
  return { updated: new Date().toISOString(), rows: war.rows };
}

function snapshotNewsFile() {
  const snap = readDiskSnapshot('news');
  if (snap) return snap;
  return null;
}

export async function handleHomeApi(req, res, next) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  const p = url.pathname;
  const homeish =
    p.startsWith('/api/ohlc') ||
    p.startsWith('/api/conflict') ||
    p.startsWith('/api/rss') ||
    p.startsWith('/api/home/') ||
    p === '/data/markets.json' ||
    p === '/data/conflict.json' ||
    p === '/data/news.json';
  if (!homeish) {
    next();
    return;
  }
  if (p === '/api/home/refresh' && (req.method === 'POST' || req.method === 'GET')) {
    json(res, await refreshHomeSnapshots());
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, { ok: false, error: 'GET only' }, 405);
    return;
  }
  try {
    if (p === '/data/markets.json') {
      const disk = readDiskSnapshot('markets');
      json(res, disk || snapshotMarketsFromArchive());
      return;
    }
    if (p === '/data/conflict.json') {
      json(res, snapshotConflictFile());
      return;
    }
    if (p === '/data/news.json') {
      const live = serveNterLatest({ limit: 12 });
      if (live.rows?.length) {
        json(res, live);
        return;
      }
      const news = snapshotNewsFile();
      if (news?.source === 'nter.news' && news.rows?.length) {
        json(res, news);
        return;
      }
      json(
        res,
        {
          ok: true,
          rows: [],
          note: live.note || 'Waiting for nter.news ingest. No headlines were invented.',
          source: 'nter.news',
          archive: true,
        },
      );
      return;
    }
    if (p === '/api/ohlc') {
      json(res, await serveOhlc(url.searchParams.get('symbol'), url.searchParams.get('range') || '1mo'));
      return;
    }
    if (p === '/api/conflict') {
      json(res, await serveConflict(url.searchParams.get('days') || 2, url.searchParams.get('topic') || ''));
      return;
    }
    if (p === '/api/rss') {
      const xml = await fetchRssXml(url.searchParams.get('url') || '');
      if (url.searchParams.get('format') === 'json') {
        json(res, { ok: true, items: parseRss(xml) });
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(xml);
      return;
    }
    if (p === '/api/home/markets') {
      json(res, await serveHomeMarkets({ maxAgeH: maxAgeFromUrl(url), fresh: url.searchParams.get('fresh') === '1' }));
      return;
    }
    if (p === '/api/home/latest') {
      json(res, await serveHomeLatest({ maxAgeH: maxAgeFromUrl(url), fresh: url.searchParams.get('fresh') === '1' }));
      return;
    }
    if (p === '/api/home/pulse') {
      json(res, await serveHomePulse({ maxAgeH: maxAgeFromUrl(url), fresh: url.searchParams.get('fresh') === '1' }));
      return;
    }
    next();
  } catch (err) {
    json(res, { ok: false, error: err.message || String(err) }, 502);
  }
}

export function homeApiPlugin() {
  return {
    name: 'niyantran-home-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleHomeApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleHomeApi(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
