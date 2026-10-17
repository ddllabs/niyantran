/**
 * Economics desk projectors. GDELT news searches are not quotes, macro tables, or DGFT notifications.
 */

function num(v) {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : '';
}

function pct(v) {
  const n = num(v);
  if (n === '') return '';
  const x = n <= 1 && n >= 0 ? n * 100 : n;
  return x.toFixed(1);
}

function isoDay(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e11) return new Date(n).toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

const SLICE = [
  [/^nse\/bse delayed market feed$/i, 'nse'],
  [/^live global stock exchanges$/i, 'world'],
  [/^economic overview of all countries$/i, 'countries'],
  [/^key financial indicators/i, 'indicators'],
  [/^trade agreements/i, 'trade'],
  [/^economic simulator$/i, 'simulator'],
  [/^sector policy/i, 'sector'],
  [/^top financial & business players$/i, 'leaders'],
  [/^ai & the tech industry$/i, 'ai'],
  [/^prediction market political odds$/i, 'manifold'],
  [/^election forecast aggregator$/i, 'elections'],
];

export function econSlice(feature) {
  const n = String(feature || '');
  const hit = SLICE.find(([re]) => re.test(n));
  return hit ? hit[1] : '';
}

export function isEconExtract(feature) {
  const s = econSlice(feature);
  return s === 'nse' || s === 'trade' || s === 'manifold';
}

export function econNote(slice, extra = '') {
  const notes = {
    nse: 'Extracted NSE/BSE quote snapshot (frozen). Live NSE allIndices is licence/session gated. Not a news search.',
    world: 'Yahoo last quotes for NYSE, NASDAQ, TSX, Tadawul and ASX index levels. Stooq CSV is JS-gated from this host. Not a licensed tick feed.',
    countries: 'World Bank NY.GDP.MKTP.CD, most recent non-empty year per country. Aggregates excluded.',
    indicators:
      'World Bank GDP growth, CPI, and employment-to-population. PMI is licensed (S&P Global) and is not in this table.',
    trade: 'Extracted DGFT notifications (India trade policy). OFAC/EU lists and WTO tariff schedules are not in this pack.',
    simulator:
      'World Bank India GDP growth (annual %, NY.GDP.MKTP.KD.ZG). Historical baseline for the desk — not a forecast engine, and no scenario outcomes are invented.',
    sector:
      'World Bank India electricity-access series. Not a ministry gazette. CEA/Grid India/PPAC are not in this pack. The 8-row policy pipeline links to Google News and is not used here.',
    leaders:
      'Wikidata chief-executive identity for Indian enterprises. No rankings, no financials, no market cap (market cap is price).',
    ai: 'PIB press releases about technology, plus a Google News search for Indian AI and technology news. Private investment databases are licensed and are not substituted.',
    manifold:
      'Manifold markets flagged political, ranked by recent volume. Snapshot if live polling is down. Not an Indian-election board.',
    elections:
      'Manifold play-money (mana) markets on Indian elections, found by search and kept only when the question names an Indian election or elected office. Market probabilities are not polls and not NTER forecasts; many markets are thin.',
  };
  const base = notes[slice] || 'Economics pack.';
  return extra ? `${base} ${extra}` : base;
}

export function marketQuoteRows(raw) {
  return (raw || [])
    .map((r) => {
      const name = String(r.name || r.index || r.title || '').trim();
      if (!name) return null;
      return {
        title: name,
        name,
        exchange: r.exchange || 'NSE',
        last: num(r.last) === '' ? r.last || '' : num(r.last),
        change: num(r.change) === '' ? r.change || '' : num(r.change),
        pct_change: num(r.pct_change) === '' ? r.pct_change || '' : num(r.pct_change),
        open: num(r.open) === '' ? r.open || '' : num(r.open),
        high: num(r.high) === '' ? r.high || '' : num(r.high),
        low: num(r.low) === '' ? r.low || '' : num(r.low),
        source_url: r.source_url || '',
        // F169 T9: when the quote was taken, so a stored copy can say how old it is.
        ...(r.as_of || r.occurred_at ? { as_of: r.as_of || r.occurred_at } : {}),
      };
    })
    .filter(Boolean);
}

export function nseLiveRows(json) {
  const arr = json?.data || json?.records || (Array.isArray(json) ? json : []);
  return marketQuoteRows(
    arr.map((r) => ({
      name: r.index || r.indexSymbol || r.name || '',
      exchange: 'NSE',
      last: r.last || r.lastPrice,
      change: r.variation || r.change,
      pct_change: r.percentChange || r.pChange || r.pct_change,
      open: r.open,
      high: r.high,
      low: r.low,
    })),
  );
}

export function dgftRows(raw) {
  return (raw || [])
    .map((r) => {
      const title = String(r.subject || r.title || '').trim();
      if (!title) return null;
      return {
        title,
        subject: title,
        notification_no: r.notification_no || r.id || '',
        date: r.date || '',
        year: r.year || '',
        source_url: r.pdf_url || r.source_url || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function politicalFlag(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

// Optional provider metadata; feed storage keys stay unchanged (F222).
function manifoldIdentity(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id) ? { market_id: id } : {};
}

export function manifoldPoliticalRows(raw) {
  return (raw || [])
    .filter((r) => politicalFlag(r.is_political))
    .map((r) => {
      const title = String(r.question || r.title || '').trim();
      if (!title) return null;
      return {
        ...manifoldIdentity(r.market_id),
        title,
        question: title,
        probability: pct(r.probability),
        volume_24h: num(r.volume_24h) === '' ? r.volume_24h || '' : num(r.volume_24h),
        total_volume: num(r.total_volume) === '' ? r.total_volume || '' : num(r.total_volume),
        is_political: 'Yes',
        date: isoDay(r.close_time || r.closeTime),
        close_time: isoDay(r.close_time || r.closeTime),
        source_url: r.source_url || r.url || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.volume_24h || 0) - Number(a.volume_24h || 0));
}

function livePolitical(m) {
  const slugs = (m.groupSlugs || []).join(' ').toLowerCase();
  if (m.isPolitics === true) return true;
  return /\bpolitic|election|geopolit|president|parliament|congress|senate|prime.?minister|cabinet\b/.test(slugs);
}

export function mapManifoldLive(json, { allPolitical = false } = {}) {
  const arr = Array.isArray(json) ? json : Array.isArray(json?.markets) ? json.markets : [];
  const picked = allPolitical ? arr : arr.filter(livePolitical);
  return manifoldPoliticalRows(
    picked.map((m) => ({
      market_id: m.id,
      question: m.question,
      probability: m.probability,
      volume_24h: m.volume24Hours ?? m.volume24Hour,
      total_volume: m.volume,
      is_political: 'Yes',
      close_time: m.closeTime,
      source_url: m.url,
    })),
  );
}

// F196: Election Forecast Aggregator. A Manifold search finds questions about other countries'
// elections and Indian questions that are not about an election; a market is kept only when its
// question names India (or an Indian party, leader, house or state) and an election or an elected
// office. "Congress" alone is not Indian (the US Congress); "Indiana" is not India.
const INDIA_TOKEN = new RegExp(
  [
    "\\bIndia(?:n|'s)?\\b", '\\bBJP\\b', '\\bNDA\\b', 'I\\.N\\.D\\.I\\.A', '\\bAAP\\b', '\\bDMK\\b', '\\bAIADMK\\b',
    '\\bTVK\\b', '\\bTMC\\b', 'Trinamool', '\\bBRS\\b', '\\bBJD\\b', '\\bYSRCP\\b', '\\bTDP\\b', 'Shiv Sena', '\\bNCP\\b',
    '\\bRJD\\b', 'JD\\(U\\)', '\\bUDF\\b', '\\bLDF\\b', '\\bBSP\\b', 'Samajwadi', '\\bModi\\b', 'Rahul Gandhi', 'Kejriwal',
    '\\bKCR\\b', 'Lok Sabha', 'Vidhan Sabha', 'Uttar Pradesh', 'Bihar', '\\bBengal\\b', 'Tamil ?Nadu', 'Kerala',
    'Karnataka', 'Maharas?htra', 'Gujarat', 'Punjab', '\\bAssam\\b', 'Telangana', 'Andhra', 'Odisha', '\\bDelhi\\b',
    '\\bGoa\\b', 'Rajasthan', 'Madhya Pradesh', 'Haryana', 'Jharkhand', 'Uttarakhand', 'Himachal', 'Manipur',
    'Puducherry', 'Jammu', 'Kashmir', 'Chhattisgarh', 'Tripura', 'Meghalaya', 'Mizoram', 'Nagaland', 'Sikkim', 'Arunachal',
  ].join('|'),
  'i',
);
const ELECTION_TOKEN =
  /\b(?:elections?|elected|electoral|by-?elections?|re-?election|polls?|seats?|majority|ruling party|in office|prime minister|chief minister|CM|PM candidate|Lok Sabha|Vidhan Sabha|legislative assembly)\b/i;
const NOT_ELECTION = /\bnobel\b|person of the year|\bwar\b|military|recession|american indian|native american/i;

/** Whether a Manifold question is about an Indian election (or who holds an elected Indian office). */
export function isIndiaElectionMarket(question) {
  const q = String(question || '');
  return INDIA_TOKEN.test(q) && ELECTION_TOKEN.test(q) && !NOT_ELECTION.test(q);
}

const MARKET_TYPE = {
  BINARY: 'Yes / no',
  MULTIPLE_CHOICE: 'Multiple choice',
  MULTI_NUMERIC: 'Number range',
  PSEUDO_NUMERIC: 'Number',
  DATE: 'Date',
};

/**
 * The most likely answer of a multiple-choice market (its details' `answers`), or null. A tie for the
 * lead is no leader: an untraded number-range market holds every range at the same probability.
 */
function topAnswer(detail) {
  const answers = (Array.isArray(detail?.answers) ? detail.answers : []).filter((a) => Number.isFinite(a?.probability));
  const sorted = [...answers].sort((a, b) => b.probability - a.probability);
  if (!sorted.length || (sorted.length > 1 && sorted[0].probability === sorted[1].probability)) return null;
  return sorted[0];
}

/**
 * F196: Manifold search results as Election Forecast Aggregator rows: Indian election questions only,
 * play-money (mana) markets only, no polls. `details` maps a market id to its /v0/market answer (the
 * search does not carry a multiple-choice market's answers). Open markets first by volume, then
 * resolved ones by close date, newest first.
 */
export function mapManifoldIndiaElections(markets, details = new Map()) {
  const seen = new Set();
  const rows = [];
  for (const m of Array.isArray(markets) ? markets : []) {
    const question = String(m?.question || '').trim();
    if (!question || seen.has(m.id || question)) continue;
    if (m.outcomeType === 'POLL' || (m.token && m.token !== 'MANA') || !isIndiaElectionMarket(question)) continue;
    seen.add(m.id || question);
    const top = topAnswer(details.get(m.id));
    const volume = num(m.volume);
    rows.push({
      ...manifoldIdentity(m.id),
      title: question,
      question,
      market_type: MARKET_TYPE[m.outcomeType] || String(m.outcomeType || ''),
      probability: m.outcomeType === 'BINARY' ? pct(m.probability) : '',
      top_outcome: top ? String(top.text || '').trim() : '',
      top_outcome_pct: top ? pct(top.probability) : '',
      total_volume: volume === '' ? '' : Math.round(volume),
      volume_24h: num(m.volume24Hours) === '' ? '' : Math.round(num(m.volume24Hours)),
      date: isoDay(m.closeTime),
      close_time: isoDay(m.closeTime),
      resolved: m.isResolved ? 'Yes' : 'No',
      source_url: m.url || '',
    });
  }
  const open = rows.filter((r) => r.resolved === 'No').sort((a, b) => Number(b.total_volume || 0) - Number(a.total_volume || 0));
  const resolved = rows.filter((r) => r.resolved === 'Yes').sort((a, b) => String(b.close_time).localeCompare(String(a.close_time)));
  return [...open, ...resolved];
}

export function mapWikidataCeos(json) {
  const bindings = json?.results?.bindings || [];
  const seen = new Set();
  const rows = [];
  for (const b of bindings) {
    const person = b.personLabel?.value || '';
    const company = b.companyLabel?.value || '';
    if (!person || !company) continue;
    const k = `${person}|${company}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const companyUri = b.company?.value || '';
    rows.push({
      title: person,
      person,
      company,
      source_url: companyUri || b.person?.value || 'https://www.wikidata.org/',
    });
  }
  return rows.sort((a, b) => String(a.company).localeCompare(String(b.company)));
}

export function yahooQuoteRow({ venue, index, symbol, json }) {
  const res = json?.chart?.result?.[0];
  if (!res) return null;
  const meta = res.meta || {};
  const quote = res.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  let last = Number(meta.regularMarketPrice);
  if (!Number.isFinite(last)) {
    for (let i = closes.length - 1; i >= 0; i--) {
      if (Number.isFinite(Number(closes[i]))) {
        last = Number(closes[i]);
        break;
      }
    }
  }
  if (!Number.isFinite(last)) return null;
  const prev = Number(meta.chartPreviousClose);
  const open = Number((quote.open || []).at(-1));
  const high = Number((quote.high || []).at(-1));
  const low = Number((quote.low || []).at(-1));
  const chg = Number.isFinite(prev) ? Number((last - prev).toFixed(2)) : '';
  const pctChg = chg !== '' && prev ? Number(((chg / prev) * 100).toFixed(2)) : '';
  const ts = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10) : '';
  return {
    title: index,
    name: index,
    venue,
    exchange: venue,
    symbol,
    date: ts,
    last: Number(last.toFixed(2)),
    open: Number.isFinite(open) ? Number(open.toFixed(2)) : '',
    high: Number.isFinite(high) ? Number(high.toFixed(2)) : '',
    low: Number.isFinite(low) ? Number(low.toFixed(2)) : '',
    change: chg,
    pct_change: pctChg,
    source_url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
  };
}

export const WORLD_BOARD = [
  { venue: 'NYSE', index: 'S&P 500', symbol: '^GSPC' },
  { venue: 'NASDAQ', index: 'NASDAQ Composite', symbol: '^IXIC' },
  { venue: 'TSX', index: 'S&P/TSX Composite', symbol: '^GSPTSE' },
  { venue: 'Tadawul', index: 'Tadawul All Share', symbol: '^TASI.SR' },
  { venue: 'ASX', index: 'S&P/ASX 200', symbol: '^AXJO' },
];
