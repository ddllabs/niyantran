/**
 * F164: what a reader sees in place of a feed's technical source note.
 *
 * `source.note` and `meta.note` stay as the server and the shipped archive write them, because
 * refreshFeeds.js and dataState.js read their exact words to work out a module's state. Screens pass
 * them through here instead: a note with no technical wording is shown as written; from one with
 * technical wording only the plain sentences are kept, and the caller supplies a plain line (for
 * example `plainSourceLine(feed)`) for what was dropped. The original stays reachable as a `title`.
 */

import { formatDate, parseDate } from './format.js';

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
  [/(^|\.)wikipedia\.org$/, 'Wikipedia'],
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
export function plainSourceLine(feed, now = Date.now()) {
  if (!feed) return '';
  const src = feed.source || {};
  const rows = (feed.rows || []).filter((r) => r?.status !== 'source_status');
  const n = feed.paged ? Math.max(0, Number(feed.totalAll) || 0) : rows.length;
  const links = Array.isArray(src.links) ? src.links : [];
  const names = rowNames(rows).length ? rowNames(rows) : sourceNames(links);
  const from = listNames(names);
  const kind = String(src.kind || '');
  if (feed.updatedLive && !isStoreAnswer(feed)) return 'Updated live.';
  if (feed.served === 'archive' || feed.fallback || /backup-pack/i.test(kind)) return 'Latest stored records';
  if (feed.meta?.curated || /curated/i.test(kind)) return from ? `Curated records from ${from}` : 'Curated records';
  // F202: the line agrees with the LIVE badge (dataState.js): a model is modelled, a register or a
  // pack is stored, and a dossier fetched live is live.
  if (src.adapter === 'internal') return from ? `Modelled from ${from}` : 'Modelled from stored records';
  const liveAdapter = ['api', 'live', 'news-search', 'scrape'].includes(src.adapter);
  const storedRegister = !isStoreAnswer(feed) && (src.adapter === 'register' || /register/i.test(kind));
  if (src.adapter === 'embedded' || storedRegister || (/pack|dossier/i.test(kind) && !liveAdapter)) {
    return from ? `Stored records from ${from}` : 'Stored records from the published source';
  }
  if (!n) return from ? `Source: ${from}` : '';
  const news = src.adapter === 'news-search' || NEWS_LINK.test(links[0] || '');
  const unit = news ? (n === 1 ? 'story' : 'stories') : n === 1 ? 'record' : 'records';
  // F169 C4: items kept by the scheduled refresh say when they were fetched, not "Live".
  const ago = isStoreAnswer(feed) ? asOfLabel(feed, now) : '';
  const lead = ago ? ago[0].toUpperCase() + ago.slice(1) : 'Live';
  return `${lead} · ${n.toLocaleString('en-IN')} ${unit}${from ? ` from ${from}` : ''}`;
}

/** The text to keep as a `title` for debugging, when what is shown differs from it. */
export function technicalTitle(original, shown) {
  const s = String(original ?? '').trim();
  return s && s !== String(shown ?? '').trim() ? s : undefined;
}

const YEARS = /^\d{4}(-\d{2,4})?$/; // "2024", "2026-27"
const whenText = (value) => (YEARS.test(String(value).trim()) ? String(value).trim() : formatDate(value) || '');

/**
 * F165: the "complete list" part of a module header ("500 rows · complete list"), for a register the
 * feed marks `coverage.exhaustive`. When fewer rows are shown than the register holds (a stored copy
 * capped for display), it says how many the full list has instead of calling the rows complete.
 */
export function completenessLabel(feed, shown) {
  if (!feed?.coverage?.exhaustive) return '';
  const declared = Number(feed?.meta?.declaredRecords);
  return Number.isFinite(declared) && declared > Number(shown || 0)
    ? `${declared.toLocaleString('en-IN')} in the full list`
    : 'complete list';
}

/**
 * F165: how current a module's records are, in place of the header's "sync <value>". The value comes
 * from the same fields, in the same order, as dataState.js's `lastSync`: an update time, then how far
 * the records run (`coverage.through`: a date, a year, "present", "7d", or "backup"/"archive" for a
 * stored copy), then when the source was checked. '' when there is nothing a reader can use.
 */
export function freshnessLabel(feed) {
  const updated = feed?.updated || feed?.meta?.updated || feed?.meta?.lastSync;
  if (updated) {
    const when = whenText(updated);
    return when ? `updated ${when}` : '';
  }
  const through = String(feed?.coverage?.through || '').trim();
  if (through) {
    if (/^(backup|archive)$/i.test(through)) return 'stored copy';
    if (/^present$/i.test(through)) return 'to the present';
    const days = /^(\d+)\s*d$/i.exec(through);
    if (days) return `last ${days[1]} day${days[1] === '1' ? '' : 's'}`;
    const when = whenText(through);
    return when ? `through ${when}` : '';
  }
  const checked = feed?.source?.verifiedAt ? whenText(feed.source.verifiedAt) : '';
  return checked ? `checked ${checked}` : '';
}

/**
 * F165: a row's `reporting_search` field ("GDELT DOC 2.0 — news reporting search, not an official
 * dataset", "Google News RSS — media mentions, not an official statement archive") as a reader sees
 * it: how the item was found, and the field's own caveat. The row keeps the original.
 */
export function plainReportingNote(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const caveat = /\bnot an? official [^.;,]+/i.exec(s)?.[0]?.replace(/\barchive\b/i, 'record').trim();
  const how = /google news/i.test(s) ? 'Found by a Google News search' : 'Found by a news search';
  return caveat ? `${how}, ${caveat}.` : `${how}.`;
}

// F169 T9: a stored answer says how old its records are.
const STORED_ADAPTERS = new Set(['embedded', 'register', 'source-library']);
const DATE_KEYS = ['date', 'published', 'published_at', 'pubDate', 'date_introduced', 'occurred_at', 'updated', 'updated_at',
  'as_of', 'asOf', 'snapshot_at', 'last_updated', 'decision_date', 'order_date', 'release_date', 'filed', 'year_date'];

/**
 * F169 C4: an answer read from the scheduled feed store (server/feedServe.mjs): `served: 'store'` with
 * the time the items were fetched. It is the normal path, neither live nor a stored or old copy.
 */
export function isStoreAnswer(feed) {
  return feed?.served === 'store' && Number.isFinite(Date.parse(String(feed.fetchedAt || '')));
}

/**
 * C6 option 1: a register held in the feed store (MLA Directory): loaded by a script, never refreshed, valid
 * until loaded again. It is dated by its records ("register · as of …"), not by when it was loaded.
 */
export function isRegisterAnswer(feed) {
  return isStoreAnswer(feed) && feed.register === true;
}

/** Records read from storage rather than fetched live for this request. */
export function isStoredAnswer(feed) {
  if (isStoreAnswer(feed)) return false;

  return Boolean(feed?.served === 'archive' || feed?.fallback || STORED_ADAPTERS.has(String(feed?.source?.adapter || '')));
}

// "updated 5 min ago", "updated 3 h ago" (from an hour), "updated 2 d ago" (from a day), in the header's
// lower case; a sentence that starts with it capitalises it (plainSourceLine).
function updatedAgo(fetchedAt, now) {
  const minutes = Math.floor((now - Date.parse(fetchedAt)) / 60_000);
  if (minutes < 1) return 'updated just now';
  if (minutes < 60) return `updated ${minutes} min ago`;
  if (minutes < 1440) return `updated ${Math.floor(minutes / 60)} h ago`;
  return `updated ${Math.floor(minutes / 1440)} d ago`;
}

/**
 * "as of 15 Jul 2026" from the newest record date (dates more than a day ahead, such as scheduled
 * releases, are not "as of" dates), else the answer's own as-of date, else "date not recorded".
 * An answer from the feed store says instead how long ago its items were fetched: "updated 5 min ago";
 * a register from the store says "register · as of 19 Aug 2026" (isRegisterAnswer).
 */
export function asOfLabel(feed, now = Date.now()) {
  const register = isRegisterAnswer(feed);
  if (isStoreAnswer(feed) && !register) return updatedAgo(feed.fetchedAt, now);
  const limit = now + 86_400_000;
  let best = 0;
  for (const row of feed?.rows || []) {
    if (!row || row.status === 'source_status') continue;
    for (const key of DATE_KEYS) {
      const t = parseDate(row[key])?.getTime();
      if (t && t <= limit && t > best) best = t;
    }
  }
  if (!best) {
    for (const v of [feed?.meta?.as_of, feed?.meta?.asOf, feed?.coverage?.through]) {
      const t = parseDate(v)?.getTime();
      if (t && t <= limit) { best = t; break; }
    }
  }
  const dated = best ? `as of ${formatDate(new Date(best))}` : 'date not recorded';
  return register ? `register · ${dated}` : dated;
}
