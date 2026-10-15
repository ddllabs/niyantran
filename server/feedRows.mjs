/**
 * Task B follow-up (2026-10-16): the row rules of each scheduled news and official module, in one place,
 * so that the module's live branch (server/featureFeed.mjs, server/nationalFeed.mjs) and the store path
 * (server/feedServe.mjs) call the same function and cannot drift apart.
 *
 * Why: a news module keeps its items across runs (ADR 0012), so rows stored before a fix (F202's guards,
 * age windows, one row per story, decoded entities) stayed in the store. With `serve` on, State
 * Governance Brief showed 182 stored rows against 55 live, led by undated national PIB releases with raw
 * "&amp;" that its live branch no longer shows. A stored answer now passes through the live branch's own
 * rules, judged at the time of the request (`now`), on the dates already stored on the rows.
 *
 * STORE_ROW_RULES: module id → (rows, { now, variant }) → the rows its live branch would show.
 * STORE_ROWS_AS_STORED: module id → why its stored rows need no rule (its live branch filters nothing,
 * or the store serves only its latest run: server/feedServe.mjs, kinds measurement and events).
 * A test (src/lib/feedStoreRows.test.js) checks that every scheduled module of kind news, official,
 * events or measurement is in exactly one of them.
 *
 * Kept free of loaders and of the network, so the page server can use it without importing them.
 */
import { CURATED_NEWS, WIRE_GUARDS, curatedNewsRows, freshNewsRows, headlineKey, isPipelineRelease } from '../src/lib/curatedNews.js';
import { newsRows } from '../src/lib/carbonPack.js';
import { isCabinetDecision, pickReleasePairs } from '../src/lib/parliament.js';
import { FEED_SCHEDULE } from './feedSchedule.mjs';

const DAY_MS = 86_400_000;

/**
 * Rows dated within the last `days` days (by Date.parse of `date`, as src/lib/curatedNews.js judges
 * them). A row with no readable date is kept, as the live branches keep it; the store serves an
 * undated row only while its source still lists it (server/feedServe.mjs).
 */
export function withinDays(rows, days, now = Date.now()) {
  const oldest = now - days * DAY_MS;
  return (rows || []).filter((row) => {
    const t = Date.parse(String(row?.date || ''));
    return !Number.isFinite(t) || t >= oldest;
  });
}

// ---------------------------------------------------------------------------------------------
// The live branches' rules.

/**
 * Technology-industry titles: AI and compute, chips, electronics and IT, telecom, cyber security,
 * data centres, startups, digital public infrastructure. F202 (2026-10-16): the bare words "digital"
 * and "technolog" let through a rural-livelihood data workshop ("Strengthening Digital Data
 * Systems ... DAY-NRLM") and an Ayurveda institute's "digital initiatives", so a digital title
 * must name the digital economy or its infrastructure, and a technology title an industry or an
 * emerging technology. (Moved here from server/featureFeed.mjs, unchanged.)
 */
const TECH_TITLE = new RegExp(
  [
    '\\b(?:AI|GenAI|IndiaAI|MeitY|UPI|5G|6G|GPUs?|CERT-In|DPDP)\\b',
    'artificial intelligence|machine learning|large language model|\\bLLMs?\\b|generative',
    'semiconductor|\\bchips?\\b|\\bfabs?\\b|supercomput|\\bcomput(?:e|ing)\\b|quantum',
    'electronics|information technology|telecom|spectrum|broadband',
    'cyber ?(?:secur|attack|threat|resilien)|data cent(?:re|er)|data protection',
    'start-?ups?|deep ?tech|emerging technolog|critical (?:and emerging )?technolog|frontier tech',
    'technology (?:park|compan|firm|sector|industry|major|giant|hub)|\\bIT (?:sector|industry|services|compan)',
    'software|\\binternet\\b|robot',
    'digital (?:India|public infrastructure|economy|payments?|platform|stack|trade|infrastructure|transformation|governance)',
  ].join('|'),
  'i',
);
export function isTechTitle(title) {
  return TECH_TITLE.test(String(title || ''));
}

const DEVANAGARI = /[ऀ-ॿ]/;
const isPibLink = (row) => /^https?:\/\/(?:www\.)?pib\.gov\.in\//i.test(String(row?.source_url || row?.link || row?.url || ''));

/** A PIB release AI & the Tech Industry shows: an English title about technology (F169 T2, F202). */
export function isTechPibRelease(row) {
  const title = String(row?.title || '');
  return isTechTitle(title) && !DEVANAGARI.test(title);
}

/** AI & the Tech Industry's window: the 7 days its news search asks for (`when:7d`). */
export const AI_TECH_DAYS = 7;

/**
 * AI & the Tech Industry: its PIB releases about technology and its news search's rows, each title
 * once (the first kept), newest first, none older than AI_TECH_DAYS. A PIB release is known by its
 * pib.gov.in link; a news search row (a news.google.com link) is never judged by the technology filter.
 */
export function aiTechRows(rows, { now = Date.now() } = {}) {
  const seen = new Set();
  return withinDays(rows, AI_TECH_DAYS, now)
    .filter((r) => !isPibLink(r) || isTechPibRelease(r))
    .filter((r) => {
      const key = String(r.title || '').toLowerCase().replace(/\s+-\s+[^-]+$/, '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

/** The fields every Law wire row carries (F202, audit C6). */
export const LAW_WIRE_FIELDS = Object.freeze({
  section: 'COVERAGE — GOOGLE NEWS RSS',
  reporting_search: 'Google News RSS — coverage mentions, not an official court dataset',
});
/** A Law wire's window, and a Google News search wire's (F202, audit C6). */
export const WIRE_DAYS = 7;

/** A Law news wire (a forum with no extracted docket): the last 7 days, one row per story. */
export function lawWireRows(rows, { now = Date.now() } = {}) {
  return freshNewsRows(rows, { days: WIRE_DAYS, now }).map((r) => ({ ...r, ...LAW_WIRE_FIELDS }));
}

const isNewsSearchRow = (row) => /^https?:\/\/news\.google\.com\//i.test(String(row?.source_url || row?.link || ''));

/** A registry row's Google News search (or its news fallback): the last 7 days, one row per story. */
export function searchWireRows(rows, { now = Date.now() } = {}) {
  return freshNewsRows(rows, { days: WIRE_DAYS, now });
}

/** The Statement Tracker: the leader's coverage of the last 7 days, one row per story, each row naming the leader. */
export function statementRows(rows, person, { now = Date.now() } = {}) {
  return freshNewsRows(rows, { days: WIRE_DAYS, now }).map((r) => ({ ...r, person: person || r.person }));
}

/**
 * Geopolitics News Wire: BBC World's rows and the geopolitics search's, each kept to the geopolitics
 * guard (7 days, one row per story); BBC's first, then the search's whose link BBC did not give, at
 * most 100. With nothing from BBC, the search's rows alone. `bbc` and `searched` count each part.
 */
export function geopoliticsWireRows(bbcRows, searchRows, { now = Date.now() } = {}) {
  const geo = WIRE_GUARDS.geopolitics;
  const bbc = curatedNewsRows(bbcRows, geo, { now });
  const searched = curatedNewsRows(searchRows, geo, { now });
  if (!bbc.length) return { rows: searched, bbc, searched };
  const seen = new Set(bbc.map((r) => r.source_url));
  return { rows: [...bbc, ...searched.filter((r) => !seen.has(r.source_url))].slice(0, 100), bbc, searched };
}
/** The outlet the Geopolitics News Wire tags BBC World's rows with. */
export const BBC_WORLD = 'BBC World';

/**
 * Climate Newswire: Mongabay India's rows kept to climate and energy headlines; every outlet 30 days,
 * one row per story (F202), as the wire's rows (src/lib/carbonPack.js newsRows), newest first.
 */
export function climateWireRows(rows, { now = Date.now() } = {}) {
  const climate = WIRE_GUARDS.climate;
  const all = rows || [];
  const isMongabay = (r) => /mongabay/i.test(r?.outlet || '');
  return newsRows([
    ...curatedNewsRows(all.filter(isMongabay), climate, { now }),
    ...freshNewsRows(all.filter((r) => !isMongabay(r)), { days: climate.days, now }),
  ]);
}

/** The National Morning Brief's window: its searches ask for 3 days, and its PIB releases are held to the same. */
export const BRIEF_DAYS = 3;

/**
 * The National Morning Brief: the top stories and the economy stories of the last 3 days, one row per
 * story, an economy story the top stories already tell left out; PIB's releases of the same 3 days
 * (undated ones kept). Tagged by section, top stories first, then PIB, then the economy.
 */
export function morningBriefRows({ top = [], pib = [], eco = [] } = {}, { now = Date.now() } = {}) {
  const topRows = freshNewsRows(top, { days: BRIEF_DAYS, now });
  const topKeys = new Set(topRows.map((r) => headlineKey(r.title, r.publisher)));
  const topLinks = new Set(topRows.map((r) => r.source_url));
  const ecoRows = freshNewsRows(eco, { days: BRIEF_DAYS, now })
    .filter((r) => !topLinks.has(r.source_url) && !topKeys.has(headlineKey(r.title, r.publisher)));
  const pibRows = withinDays(pib, BRIEF_DAYS, now);
  return {
    top: topRows,
    pib: pibRows,
    eco: ecoRows,
    rows: [
      ...topRows.map((r) => ({ ...r, section: 'Top of the Day', source: r.publisher || r.source || 'News' })),
      ...pibRows.map((r) => ({ ...r, section: 'Government Wire', source: r.source || 'PIB' })),
      ...ecoRows.map((r) => ({ ...r, section: 'Economy', source: r.publisher || r.source || 'News' })),
    ],
  };
}

/** Indian Sports Wire's window: the 7 days its Google News search asks for (`when:7d`). */
export const INDIA_SPORTS_DAYS = 7;
export function indiaSportsRows(rows, { now = Date.now() } = {}) {
  return withinDays(rows, INDIA_SPORTS_DAYS, now);
}

/** Policy Pipeline Tracker: only releases about policy in the making, judged by their titles (F202, audit C2). */
export function pipelineRows(rows) {
  return (rows || []).filter((r) => isPipelineRelease(r?.title));
}

/** Cabinet Decisions: only the Cabinet's decisions (F125), one release per decision (F187). */
export function cabinetDecisionRows(rows) {
  return pickReleasePairs((rows || []).filter(isCabinetDecision));
}

// ---------------------------------------------------------------------------------------------
// The registry the store path reads.

const LAW_WIRES = [
  'judiciary:UP High Court (Allahabad) Order Feed',
  'judiciary:NGT Environmental Litigation Tracker',
  'judiciary:CAT & Consumer Disputes (NCDRC) Watch',
  'judiciary:ICC Proceedings',
  'judiciary:Sector Tribunals (ITAT / TDSAT / SAT / DRT)',
];

const MORNING_SECTIONS = { 'Top of the Day': 'top', 'Government Wire': 'pib', Economy: 'eco' };

export const STORE_ROW_RULES = Object.freeze({
  // F196/F202: every scheduled module answered by a curated news search (serveCuratedNews), by its own spec.
  ...Object.fromEntries(
    Object.entries(CURATED_NEWS)
      .filter(([id]) => Object.hasOwn(FEED_SCHEDULE, id))
      .map(([id, spec]) => [id, (rows, { now } = {}) => curatedNewsRows(rows, spec, { now })]),
  ),
  ...Object.fromEntries(LAW_WIRES.map((id) => [id, (rows, { now } = {}) => lawWireRows(rows, { now })])),
  'geopolitics:Geopolitics News Wire': (rows, { now } = {}) =>
    geopoliticsWireRows(rows.filter((r) => r.outlet === BBC_WORLD), rows.filter((r) => r.outlet !== BBC_WORLD), { now }).rows,
  'climate:Climate Newswire': (rows, { now } = {}) => climateWireRows(rows, { now }),
  'finance:AI & the Tech Industry': (rows, { now } = {}) => aiTechRows(rows, { now }),
  'national:National Morning Brief (Auto-digest)': (rows, { now } = {}) => {
    const parts = { top: [], pib: [], eco: [] };
    // A row with a section the brief no longer has is not one it would show.
    for (const r of rows) if (MORNING_SECTIONS[r.section]) parts[MORNING_SECTIONS[r.section]].push(r);
    return morningBriefRows(parts, { now }).rows;
  },
  'national:Statement & Quote Tracker with Contradiction Detection': (rows, { now, variant } = {}) => statementRows(rows, variant, { now }),
  // Its registry row is a Google News search (the generic branch's storedSearch, or its news fallback).
  'state:Bureaucrat Transfer & Posting Tracker (State Cadre)': (rows, { now } = {}) => searchWireRows(rows, { now }),
  'sports:Indian Sports Wire': (rows, { now } = {}) => indiaSportsRows(rows, { now }),
  // Its registry row's live feed (Wikidata districts, undated) is answered whole (capRows); only when that
  // feed and the archive give nothing does its Google News fallback answer, kept to 7 days, one row per
  // story. A row from that search (a news.google.com link) is held to the fallback's rule.
  'state:District Performance Tracker (Composite)': (rows, { now } = {}) => {
    const fromSearch = searchWireRows(rows.filter(isNewsSearchRow), { now });
    return [...rows.filter((r) => !isNewsSearchRow(r)), ...fromSearch];
  },
  'national:Policy Pipeline Tracker (Draft-to-Gazette)': (rows) => pipelineRows(rows),
  'national:Cabinet Decisions': (rows) => cabinetDecisionRows(rows),
});

const LATEST_RUN = 'kind events: the store serves only the items of the latest run (server/feedServe.mjs), which is what the live branch shows';
const MEASURED = 'kind measurement: the store serves only the items of the latest run (server/feedServe.mjs), which is what the live branch shows';

export const STORE_ROWS_AS_STORED = Object.freeze({
  'finance:Live Global Stock Exchanges': MEASURED,
  'finance:Prediction Market Political Odds': MEASURED,
  'finance:Election Forecast Aggregator': MEASURED,
  'geopolitics:Satellite Infrastructure': `${LATEST_RUN} (The Space Devs' upcoming launches)`,
  'sports:Fixtures & Results — World Leagues': `${LATEST_RUN} (TheSportsDB's next and last events)`,
  'sports:ISL Tracker': `${LATEST_RUN} (the season's ESPN scoreboard)`,
  'entertainment:TV & Streaming Tonight': `${LATEST_RUN} (TVmaze's schedule for today)`,
  'national:Regulatory Body Watch (RBI/SEBI/TRAI/CCI)': 'the live branch keeps every RBI and SEBI feed item and its stored register, one row per link (the store keys items by link) newest first (the store\'s order); no topic or age filter',
  'state:SDL Auction & Borrowing Tracker': 'every SDL auction release RBI listed is kept by design (the history starts when the module went live); the live branch filters only which releases are SDL auctions, before rows are built',
  'climate:Carbon Registry Wire': 'Verra RSS and the extracted Isometric list, shaped and ordered only (registryRows); no topic or age filter',
  'sports:Cricket Wire': 'ESPNcricinfo RSS shaped and ordered only (rssWireRows); no topic, age or story filter, so stored items are records the live branch would show',
  'sports:Football Wire': 'BBC Sport football RSS shaped and ordered only (rssWireRows); no topic, age or story filter',
  'entertainment:Entertainment News Wire': 'Variety RSS shaped and ordered only (rssWireRows); no topic, age or story filter',
  'entertainment:Bollywood & Film Wire': 'NDTV Movies RSS shaped and ordered only (rssWireRows; the Google News fallback likewise); no topic, age or story filter',
  'state:MLA Report Card + Statement Tracker': 'not fixed here: serve stays off (owner, 2026-10-16); 400 undated Wikidata profiles plus an unfiltered coverage wire, flagged by scripts/compare-feed-store.mjs',
});

/**
 * The stored rows of module `id` as its live branch would show them now. A module with no rule
 * (STORE_ROWS_AS_STORED, a register, anything unscheduled) gets its rows back unchanged, the same array.
 */
export function storeRowsFor(id, rows, { now = Date.now(), variant = '' } = {}) {
  const rule = Object.hasOwn(STORE_ROW_RULES, id) ? STORE_ROW_RULES[id] : null;
  return rule ? rule(Array.isArray(rows) ? rows : [], { now, variant }) : rows;
}
