/**
 * F164: what a reader sees in place of a feed's technical source note.
 *
 * `source.note` and `meta.note` stay as the server and the shipped archive write them, because
 * refreshFeeds.js and dataState.js read their exact words to work out a module's state. Screens pass
 * them through here instead: a note with no technical wording is shown as written; from one with
 * technical wording only the plain sentences are kept, and the caller supplies a plain line (for
 * example `plainSourceLine(feed)`) for what was dropped. The original stays reachable as a `title`.
 */

// Wording a reader should not have to decode: hosts, paths, files, protocols, pacing, archives,
// internal identifiers and error text.
const TECHNICAL = [
  /https?:\/\//i,
  /(^|[\s(])\/(api|data|backup)\//i,
  /\b[\w-]+\.(csv|json|xlsx?|mjs|jsx?|aspx|xml)\b/i,
  /\b[\w-]+(\.[\w-]+)*\.(org|com|gov|in|net|io|int|uk)\/\S/i,
  /\bapi\.[\w-]+\./i,
  /\bGDELT\b(?! news search)/i,
  /\bDOC\s*2\.0\b/i,
  /\bTimelineVol\b/i,
  /\bSPARQL\b/i,
  /\bRSS\b/i,
  /\bAPI\b/i,
  /\bproxy\b/i,
  /\bbackend\b/i,
  /\badapters?\b/i,
  /\bhost(ed|s)?\b/i,
  /\barchives?\b/i,
  /\bbackup\b/i,
  /\bfallback\b/i,
  /\blast-known-good\b/i,
  /\bpaced\b/i,
  /\brate[- ]?limit/i,
  /≥\s*\d/,
  /(^|[^\w.])\d{1,2}\s?s\b/,
  /\bHTTP\s*\d{3}\b/i,
  /\btimed?\s*out\b/i,
  /\bunreachable\b/i,
  /\bfailed\b/i,
  /\berror\b/i,
  /\bwired\b/i,
  /\bshipped\b/i,
  /\bpacks?\b/i,
  /\bembedded\b/i,
  /\bingest(ed|ion)?\b/i,
  /\bextraction\b/i,
  /\bcached\b/i,
  /\bon disk\b/i,
  /\bfeature map\b/i,
  /\bHTML\b/,
  /\bNIY_[A-Z_]+/,
  /\b[a-z0-9]+_[a-z0-9_]+\b/,
  /\brobots\.txt\b/i,
  /\bbrowser-reachable\b/i,
  /\bdata check\b/i,
  /\bworkbook\b/i,
  /\bGitHub\b/i,
  /\bendpoints?\b/i,
  /\bdiagnostic/i,
  /\bunwired\b/i,
  /\bsub-label\b/i,
  /\b[A-Z]{2,}(\.[A-Z0-9]+){2,}\b/,
];

/** True when the text carries wording meant for developers rather than readers. */
export function isTechnicalNote(text) {
  const s = String(text ?? '');
  return Boolean(s.trim()) && TECHNICAL.some((re) => re.test(s));
}

function sentences(text) {
  return String(text)
    .split(/(?<=[.!?…])\s+(?=[A-Za-z0-9"“'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinSentences(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return /[.!?…]$/.test(a) ? `${a} ${b}` : `${a}. ${b}`;
}

/**
 * The note as a reader should see it. A plain note is returned as written. A technical one keeps
 * only its plain sentences, after `fallback` (the caller's plain account of what was dropped).
 * An empty note returns ''.
 */
export function plainNote(text, fallback = '') {
  const s = String(text ?? '').trim();
  if (!s) return '';
  if (!isTechnicalNote(s)) return s;
  const kept = sentences(s).filter((x) => !isTechnicalNote(x)).join(' ');
  return joinSentences(fallback, kept);
}

/**
 * A short label (a module strip's section or status) without its technical tokens:
 * "TOP WORLD STORIES — BBC WORLD RSS" → "TOP WORLD STORIES — BBC WORLD"; a label that is technical
 * through and through ("BACKUP · EXHAUSTIVE PACK") becomes ''.
 */
export function plainLabel(text) {
  const s = String(text ?? '').trim();
  if (!isTechnicalNote(s)) return s;
  const cleaned = s
    .replace(/\bGDELT(\s+DOC)?\s*2\.0\b/gi, '')
    .replace(/\bDOC\s*2\.0\b/gi, '')
    .replace(/\bGDELT\b/gi, '')
    .replace(/\bRSS\b/gi, '')
    .replace(/\s*([·—/|-]\s*)+$/g, '')
    .replace(/^(\s*[·—/|-])+\s*/g, '')
    .replace(/\s*·\s*(·\s*)+/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned && !isTechnicalNote(cleaned) ? cleaned : '';
}

// Readable names for the sources the feeds use; anything else shows its bare domain.
const KNOWN_SOURCES = [
  [/(^|\.)bbci?\.co\.uk$|(^|\.)bbc\.com$/, (u) => (/\/world\b/.test(u.pathname) ? 'BBC World' : /sport/.test(u.pathname) ? 'BBC Sport' : 'BBC')],
  [/(^|\.)gdeltproject\.org$/, 'GDELT news search'],
  [/(^|\.)news\.google\.[a-z.]+$/, 'Google News'],
  [/(^|\.)pib\.gov\.in$/, 'Press Information Bureau'],
  [/(^|\.)worldbank\.org$/, 'World Bank'],
  [/(^|\.)wikidata\.org$/, 'Wikidata'],
  [/(^|\.)sansad\.in$/, 'Sansad'],
  [/(^|\.)espncricinfo\.com$/, 'ESPNcricinfo'],
  [/(^|\.)espn\.(com|in)$/, 'ESPN'],
  [/(^|\.)thesportsdb\.com$/, 'TheSportsDB'],
  [/(^|\.)tvmaze\.com$/, 'TVmaze'],
  [/(^|\.)applemarketingtools\.com$|(^|\.)music\.apple\.com$/, 'Apple Music'],
  [/(^|\.)itunes\.apple\.com$/, 'iTunes'],
  [/(^|\.)variety\.com$/, 'Variety'],
  [/(^|\.)ndtv\.com$/, 'NDTV'],
  [/(^|\.)reuters\.com$/, 'Reuters'],
  [/(^|\.)courtlistener\.com$/, 'CourtListener'],
  [/(^|\.)constituteproject\.org$/, 'Constitute Project'],
  [/(^|\.)opensanctions\.org$/, 'OpenSanctions'],
  [/(^|\.)thespacedevs\.com$/, 'The Space Devs'],
  [/(^|\.)opensky-network\.org$/, 'OpenSky'],
  [/(^|\.)nseindia\.com$/, 'NSE'],
  [/(^|\.)stooq\.[a-z]+$/, 'Stooq'],
  [/(^|\.)reliefweb\.int$/, 'ReliefWeb'],
  [/(^|\.)indiabudget\.gov\.in$/, 'Union Budget'],
  [/(^|\.)eci\.gov\.in$/, 'Election Commission of India'],
  [/(^|\.)github(usercontent)?\.com$/, 'GitHub'],
];

/** "https://feeds.bbci.co.uk/news/world/rss.xml" → "BBC World"; '' for a relative or bad link. */
export function sourceName(url) {
  let u;
  try {
    u = new URL(String(url || ''));
  } catch {
    return '';
  }
  if (!/^https?:$/.test(u.protocol)) return '';
  const host = u.hostname.toLowerCase();
  for (const [re, name] of KNOWN_SOURCES) if (re.test(host)) return typeof name === 'function' ? name(u) : name;
  return host.replace(/^(www|api|feeds?|rss|data)\d*\./, '');
}

/** The distinct readable names of a feed's source links, in order. */
export function sourceNames(links) {
  const list = Array.isArray(links) ? links : String(links || '').split(/,\s*/);
  return [...new Set(list.map(sourceName).filter(Boolean))];
}

/** Each source link with its readable name (for a "Sources" list of links). */
export function sourceLinks(links) {
  const list = Array.isArray(links) ? links : String(links || '').split(/,\s*/);
  const seen = new Set();
  const out = [];
  for (const url of list) {
    const name = sourceName(url);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, url: new URL(url).href });
  }
  return out;
}

function listNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, 2).join(', ')} and others`;
}

// Names the rows themselves carry (an RSS outlet such as "BBC World"), when there are only a few.
function rowNames(rows) {
  const names = new Set();
  for (const r of rows) {
    const v = r?.outlet || r?.source_label;
    if (typeof v !== 'string' || !v.trim() || v.length > 40 || /[/:]/.test(v)) return [];
    names.add(v.trim());
    if (names.size > 2) return [];
  }
  return [...names];
}

const NEWS_LINK = /gdeltproject|news\.google|bbci?\.co|bbc\.com|variety\.com|ndtv\.com|espncricinfo|reuters\.com/i;

/**
 * One plain line naming what a module shows and where it comes from, e.g.
 * "Live · 24 stories from BBC World", "Latest stored records", "Stored records from the published
 * source", "Updated live."
 */
export function plainSourceLine(feed) {
  if (!feed) return '';
  const src = feed.source || {};
  const rows = (feed.rows || []).filter((r) => r?.status !== 'source_status');
  const n = feed.paged ? Math.max(0, Number(feed.totalAll) || 0) : rows.length;
  const links = Array.isArray(src.links) ? src.links : [];
  const names = rowNames(rows).length ? rowNames(rows) : sourceNames(links);
  const from = listNames(names);
  const kind = String(src.kind || '');
  if (feed.updatedLive) return 'Updated live.';
  if (feed.served === 'archive' || feed.fallback || /backup-pack/i.test(kind)) return 'Latest stored records';
  if (feed.meta?.curated || /curated/i.test(kind)) return from ? `Curated records from ${from}` : 'Curated records';
  if (src.adapter === 'embedded' || /pack|dossier/i.test(kind)) {
    return from ? `Stored records from ${from}` : 'Stored records from the published source';
  }
  if (!n) return from ? `Source: ${from}` : '';
  const news = src.adapter === 'news-search' || Boolean(src.gdelt) || NEWS_LINK.test(links[0] || '');
  const unit = news ? (n === 1 ? 'story' : 'stories') : n === 1 ? 'record' : 'records';
  return `Live · ${n.toLocaleString('en-IN')} ${unit}${from ? ` from ${from}` : ''}`;
}

/** The text to keep as a `title` for debugging, when what is shown differs from it. */
export function technicalTitle(original, shown) {
  const s = String(original ?? '').trim();
  return s && s !== String(shown ?? '').trim() ? s : undefined;
}
