import { prepareHomeMarketQuotes } from './homeMarkets.js';

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
    archive: true,
  };
}

async function getStaticJson(path, signal) {
  const res = await fetch(path, { signal });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export async function homeMarketsFromStatic(signal) {
  const [ohlc, feed] = await Promise.all([
    getStaticJson('/data/ohlc.json', signal),
    getStaticJson('/data/embedded_csv/finance_market_feed.json', signal),
  ]);
  const feedRows = Array.isArray(feed) ? feed : [];
  const feedAsOf = feedRows.find((r) => r.as_of || r.asOf)?.as_of || feedRows.find((r) => r.as_of || r.asOf)?.asOf || '';

  const rows = TICKERS.map(([name, symbol]) => {
    const pack = ohlc?.[symbol];
    const fromOhlc = quoteFromCloses(name, pack?.c || pack?.close, symbol);
    const feedRow = feedRows.find((r) => String(r.name || '').toUpperCase() === name.toUpperCase());
    const lastFeed = feedRow?.last != null ? Number(String(feedRow.last).replace(/,/g, '')) : null;
    const pctFeed = feedRow?.pct_change != null ? Number(feedRow.pct_change) : null;
    const asOf = feedRow?.as_of || feedRow?.asOf || feedAsOf || '';

    // D8: one source of truth for last + % — prefer the stamped market feed when present.
    // OHLC supplies the spark only so strip and MARKETS never diverge.
    if (Number.isFinite(lastFeed)) {
      return {
        name,
        symbol,
        last: lastFeed,
        d1: Number.isFinite(pctFeed) ? pctFeed : fromOhlc?.d1 ?? null,
        dM: Number.isFinite(pctFeed) ? pctFeed : fromOhlc?.dM ?? null,
        spark: fromOhlc?.spark || [],
        archive: true,
        asOf: asOf || fromOhlc?.asOf || '',
        as_of: asOf || fromOhlc?.asOf || '',
        source: 'finance_market_feed',
      };
    }
    if (fromOhlc) {
      return { ...fromOhlc, asOf: asOf || fromOhlc.asOf || '', as_of: asOf || fromOhlc.asOf || '' };
    }
    return null;
  }).filter(Boolean);

  const stamp = feedAsOf || rows[0]?.asOf || rows[0]?.as_of || '';
  let ageH = null;
  if (stamp) {
    const t = new Date(stamp).getTime();
    if (Number.isFinite(t)) ageH = (Date.now() - t) / 3600000;
  }

  return {
    ok: true,
    rows: prepareHomeMarketQuotes(rows),
    source: 'NSE market-feed snapshot (OHLC spark). Delayed — not live ticks.',
    archive: true,
    as_of: stamp,
    updated: stamp,
    ageH,
    note: 'Snapshot quotes from the shipped market feed. Not a live tick stream.',
  };
}

export async function homeLatestFromStatic(signal) {
  // CR-09: Latest column is nter.news — do not substitute third-party RSS as if it were nter.
  const snap = await getStaticJson('/data/nter-news.json', signal);
  const rows = Array.isArray(snap?.rows) ? snap.rows : [];
  if (rows.length) {
    return {
      ok: true,
      rows,
      note: snap.note || 'Latest from nter.news.',
      archive: Boolean(snap.archive) || !rows.length,
      ageH: snap.updated ? (Date.now() - new Date(snap.updated).getTime()) / 3600000 : null,
      updated: snap.updated,
      source: 'nter.news',
    };
  }
  return {
    ok: true,
    rows: [],
    note: snap?.note || 'Waiting for nter.news article.published pushes to POST /api/news/ingest. No headlines were invented.',
    archive: true,
    source: 'nter.news',
  };
}

export async function homePulseFromStatic(signal) {
  const snap = await getStaticJson('/data/conflict.json', signal);
  if (Array.isArray(snap?.rows) && snap.rows.length) {
    return {
      ok: true,
      rows: snap.rows.slice(0, 8),
      gdelt: Boolean(snap.gdelt),
      archive: true,
      note: snap.note || 'Saved conflict-pulse snapshot.',
      ageH: snap.updated ? (Date.now() - new Date(snap.updated).getTime()) / 3600000 : null,
      updated: snap.updated,
    };
  }
  const war = await getStaticJson('/data/embedded_csv/geopolitics_war_tracker.json', signal);
  const rows = (Array.isArray(war) ? war : [])
    .filter((r) => r.conflict_name)
    .slice(0, 8)
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
    note: 'Open Fronts snapshot (geopolitics_war_tracker). Live GDELT was unreachable.',
  };
}
