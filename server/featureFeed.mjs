/**
 * Same-origin /api/feature-feed handler.
 * Live rows, last-known-good archive, or one labelled status row — never fabricated records.
 */
import fs from 'node:fs';
import { serveNationalLanding } from './nationalLandingSummary.mjs';
import { serveLawLanding } from './lawLandingSummary.mjs';
import { serveEconomicsLanding } from './economicsLandingSummary.mjs';
import { serveCarbonLanding } from './carbonLandingSummary.mjs';
import { serveSportsLanding } from './sportsLandingSummary.mjs';
import { serveEntertainmentLanding } from './entertainmentLandingSummary.mjs';
import { serveGlobalLanding } from './globalLandingSummary.mjs';
import { serveStateLanding } from './stateLandingSummary.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenAlliance } from '../src/lib/alliances.js';
import { flattenSanction } from '../src/lib/sanctions.js';
import { flattenAppeal } from '../src/lib/globalAid.js';
import { flattenChokepoint, flattenInfra, flattenNuclear } from '../src/lib/strategicAssets.js';
import { leadersFromPack, commoditiesFromPack } from '../src/lib/globalResources.js';
import { flattenEnergyMineral, flattenMineralRef } from '../src/lib/geonomics.js';
import { geoRows, geoNote, isGeoDesk } from '../src/lib/niyGeo.js';
import {
  isGithubListing,
  isLawExtract,
  isUsScotusDesk,
  lawNote,
  lawRows,
  lawSlice,
  mapCourtListener,
} from '../src/lib/lawPack.js';
import {
  dgftRows,
  econNote,
  econSlice,
  manifoldPoliticalRows,
  marketQuoteRows,
  nseLiveRows,
} from '../src/lib/econPack.js';
import { serveAir as serveAirLive } from './transitApi.mjs';
import {
  NEWS_FEEDS,
  REGISTRY_FEEDS,
  carbonDataset,
  carbonNote,
  carbonRows,
  carbonSlice,
  newsRows,
  registryRows,
} from '../src/lib/carbonPack.js';
import {
  CRICKET_RSS,
  FOOTBALL_RSS,
  INDIA_SPORTS_RSS,
  rssWireRows,
  sportsNote,
  sportsSlice,
} from '../src/lib/sportsPack.js';
import {
  BOLLYWOOD_NEWS_RSS,
  BOLLYWOOD_RSS,
  VARIETY_RSS,
  entertainmentNote,
  entertainmentSlice,
  rssWireRows as entRssRows,
} from '../src/lib/entertainmentPack.js';
import { PLANNED_NOTE, isPlannedModule } from '../src/lib/plannedModules.js';
import { curatedNewsFor, curatedNewsRows } from '../src/lib/curatedNews.js';
import { serveNational, statementLeader } from './nationalFeed.mjs';
import { loadCentreStateFundFlow as loadCentreStateFundFlowLive, STAT1_URL } from './budgetStat1.mjs';
import * as assetsLive from './assetsApi.mjs';
import * as resourcesLive from './resourcesApi.mjs';
import * as financeLive from './financeApi.mjs';
import * as sportsLive from './sportsApi.mjs';
import { loadBackupForFeature } from './backupFeed.mjs';
import { serveFeaturePage, wantsPage } from './featurePage.mjs';
import { isStoreServed, mlaStateVariant } from './feedSchedule.mjs';
import { serveFromStore } from './feedServe.mjs';
import * as entertainmentLive from './entertainmentApi.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';

// F154: a request that has used up its live time answers from the stored archive. Inside that
// archive pass every live source below refuses at once, so each branch takes the fallback it
// already has for a failed source. Only these loaders and fetchText() reach the network here.
const archivePass = new AsyncLocalStorage();
const ARCHIVE_ONLY = 'live time limit reached; archive only';
function archiveOnly() {
  return archivePass.getStore() === true;
}
function liveOnly(load) {
  return (...args) => (archiveOnly() ? Promise.reject(new Error(ARCHIVE_ONLY)) : load(...args));
}
const serveAir = liveOnly(serveAirLive);
const loadCentreStateFundFlow = liveOnly(loadCentreStateFundFlowLive);
const loadLaunches = liveOnly(assetsLive.loadLaunches);
const loadConstitutions = liveOnly(resourcesLive.loadConstitutions);
const loadGrowth = liveOnly(resourcesLive.loadGrowth);
const loadTrade = liveOnly(resourcesLive.loadTrade);
const loadCountryEconomies = liveOnly(financeLive.loadCountryEconomies);
const loadIndiaCeos = liveOnly(financeLive.loadIndiaCeos);
const loadIndiaEnergy = liveOnly(financeLive.loadIndiaEnergy);
const loadIndiaGdpGrowth = liveOnly(financeLive.loadIndiaGdpGrowth);
const loadKeyIndicators = liveOnly(financeLive.loadKeyIndicators);
const loadManifoldPolitical = liveOnly(financeLive.loadManifoldPolitical);
const loadManifoldIndiaElections = liveOnly(financeLive.loadManifoldIndiaElections);
const loadWorldExchanges = liveOnly(financeLive.loadWorldExchanges);
const loadAthletes = liveOnly(sportsLive.loadAthletes);
const loadIsl = liveOnly(sportsLive.loadIsl);
const loadSportsLeagues = liveOnly(sportsLive.loadSportsLeagues);
const loadWorldFixtures = liveOnly(sportsLive.loadWorldFixtures);
const loadBoxOffice = liveOnly(entertainmentLive.loadBoxOffice);
const loadCelebrities = liveOnly(entertainmentLive.loadCelebrities);
const loadMusicIndia = liveOnly(entertainmentLive.loadMusicIndia);
const loadMusicUs = liveOnly(entertainmentLive.loadMusicUs);
const loadOtt = liveOnly(entertainmentLive.loadOtt);
const loadTvTonight = liveOnly(entertainmentLive.loadTvTonight);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const REGISTRY_PATH = path.join(APP_ROOT, 'src', 'data', 'source-registry.json');
const FEATURES_PATH = path.join(APP_ROOT, 'src', 'data', 'html-feature-map.json');
const EMBEDDED_DIRS = [
  path.join(APP_ROOT, 'public', 'data', 'embedded_csv'),
  path.join(REPO_ROOT, 'data', 'embedded_csv'),
];
const MANIFEST_PATH = EMBEDDED_DIRS.map((d) => path.join(d, '_manifest.json')).find((p) => fs.existsSync(p))
  || path.join(EMBEDDED_DIRS[0], '_manifest.json');
const EMBEDDED_DIR = EMBEDDED_DIRS.find((d) => fs.existsSync(d)) || EMBEDDED_DIRS[0];

const FETCH_MS = 12_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 500;

/** Real topic query — never search the product name "Geopolitics News Wire". */
const GEO_NEWS_WIRE_NEWS =
  'https://news.google.com/rss/search?q=' +
  encodeURIComponent('(geopolitics OR diplomacy OR "foreign policy" OR "United Nations") when:3d') +
  '&hl=en-IN&gl=IN&ceid=IN:en';

/** Home Top Stories (F181): the Google News India edition's own top-stories feed, not a search. */
const GOOGLE_NEWS_INDIA_TOP = 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en';

/** Indian state legislators via Wikidata (not US House Q13218630). */
function indiaMlaWikidataUrl() {
  return (
    'https://query.wikidata.org/sparql?format=json&query=' +
    encodeURIComponent(
      'SELECT DISTINCT ?person ?personLabel ?positionLabel ?stateLabel WHERE { ' +
        '?person wdt:P39 ?position. ' +
        '?position wdt:P279* wd:Q4175034. ' +
        '?position wdt:P1001 ?state. ' +
        '?state wdt:P17 wd:Q668. ' +
        'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } ' +
        '} LIMIT 500',
    )
  );
}

/** Real MLA/assembly coverage — never search product names like "MLA Report Card…". */
function mlaCoverageNewsRssUrl() {
  return (
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent('India (MLA OR "legislative assembly" OR "Vidhan Sabha") when:7d') +
    '&hl=en-IN&gl=IN&ceid=IN:en'
  );
}

/** District media coverage — never search product name "District Media Monitor…". */
function districtMediaNewsRssUrl() {
  return (
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(
      'India (district OR collectorate OR "district magistrate" OR "zilla parishad") (protest OR land OR water OR road OR school OR hospital) when:7d',
    ) +
    '&hl=en-IN&gl=IN&ceid=IN:en'
  );
}

/** State governance coverage — never search product name "State Governance Brief". */
function stateGovernanceNewsRssUrl() {
  return (
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(
      'India ("state government" OR "chief minister" OR "Vidhan Sabha" OR cabinet OR secretariat) when:7d',
    ) +
    '&hl=en-IN&gl=IN&ceid=IN:en'
  );
}

/** Technology titles: AI, chips, digital public infrastructure, telecom, cyber, data, startups. */
const TECH_TITLE = /\b(?:AI|IndiaAI|MeitY|UPI|5G|6G)\b|artificial intelligence|semiconductor|\bchips?\b|digital|technolog|electronics|telecom|cyber|data cent(?:re|er)|quantum|supercomput|startup|software|internet|machine learning|robot/i;
function isTechTitle(title) {
  return TECH_TITLE.test(String(title || ''));
}

function aiTechNewsRssUrl() {
  return (
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent('India ("artificial intelligence" OR AI OR semiconductor OR "tech industry" OR IndiaAI OR MeitY) when:7d') +
    '&hl=en-IN&gl=IN&ceid=IN:en'
  );
}

/** `reg=3` is required: without it PIB answers 302 to the Hindi feed (measured 2026-10-14, F169 T2). */
const PIB_PRESS_RSS = 'https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3&reg=3';

const GDELT_OFF = 'GDELT is not asked (it refuses every request; F169 T4)';
const GDELT_HOST = /gdeltproject\.org/i;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const USER_AGENT_BOT =
  'Mozilla/5.0 (compatible; NiyantranTerminal/1.0; +https://localhost) AppleWebKit/537.36';

const TIER_ALIAS = {
  home: 'home',
  global: 'geopolitics',
  geopolitics: 'geopolitics',
  national: 'national',
  state: 'state',
  local: 'local',
  law: 'judiciary',
  judiciary: 'judiciary',
  economics: 'finance',
  finance: 'finance',
  carbon: 'climate',
  climate: 'climate',
  sports: 'sports',
  entertainment: 'entertainment',
};

const LIVE_ADAPTERS = new Set(['api', 'news-search', 'embedded', 'bill-history', 'source-library']);
const STATUS_ADAPTERS = new Set(['scrape', 'licensed', 'download-or-html', 'internal', '']);

const HOME_STOOQ = [
  ['NIFTY 50', 'https://stooq.com/q/l/?s=%5Enifty&f=sd2t2ohlcv&h&e=csv'],
  ['SENSEX', 'https://stooq.com/q/l/?s=%5Ebsesn&f=sd2t2ohlcv&h&e=csv'],
];
const NSE_INDICES = 'https://www.nseindia.com/api/allIndices';

let cache = null;
let cacheMtime = 0;
const embeddedCache = new Map();

function loadCache() {
  let mt = 0;
  try {
    mt = Math.max(fs.statSync(REGISTRY_PATH).mtimeMs, fs.statSync(FEATURES_PATH).mtimeMs);
  } catch {
    mt = Date.now();
  }
  if (cache && cacheMtime === mt) return cache;
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const features = JSON.parse(fs.readFileSync(FEATURES_PATH, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const datasetToFile = {};
  for (const row of manifest) {
    datasetToFile[row.key] = row.file;
    datasetToFile[row.key.replace(/\.csv$/i, '')] = row.file;
  }
  cache = { registry, features, datasetToFile };
  cacheMtime = mt;
  return cache;
}

export function resetFeedCache() {
  cache = null;
  cacheMtime = 0;
  embeddedCache.clear();
  liveInFlight.clear();
  lateLive.clear();
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveTier(raw) {
  return TIER_ALIAS[norm(raw)] || norm(raw);
}

function isHttpsUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

const TOPIC_STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'tracker',
  'monitor',
  'digest',
  'database',
  'index',
  'simulator',
  'aggregator',
  'brief',
  'wire',
  'editions',
  'vernacular',
  'translated',
  'structured',
  'api',
  'composite',
  'auto',
  'personalised',
  'personalized',
  'deep',
  'dive',
]);

/** Curated topic queries — never the product name in quotes. */
const FEATURE_TOPIC_Q = {
  'assembly proceedings digest':
    'India ("Vidhan Sabha" OR "assembly proceedings" OR "legislative assembly" OR "assembly session")',
  'governor assent tracker':
    'India (governor) (assent OR "returned the bill" OR "withheld assent" OR ordinance)',
  'cabinet decisions':
    'India (cabinet) (decision OR approves OR approved OR "cabinet meeting")',
  'bureaucrat transfer & posting tracker':
    'India (IAS OR IPS OR bureaucrat OR "chief secretary") (transfer OR transferred OR posting OR posted)',
  'cag audit tracker': 'India (CAG OR "Comptroller and Auditor General") (audit OR report)',
  'state fiscal deep-dive': 'India ("state budget" OR "fiscal deficit" OR "state finances" OR FRBM)',
  'centre-state fund flow tracker':
    'India ("finance commission" OR "centrally sponsored" OR "centre-state" OR "tax devolution")',
  'state governance brief':
    'India ("state government" OR "chief minister" OR "Vidhan Sabha" OR cabinet OR secretariat)',
  'district media monitor':
    'India (district OR collectorate OR "district magistrate") (protest OR land OR water OR road OR school OR hospital)',
  'open fronts': 'sourcecountry:IN OR global (war OR conflict OR ceasefire OR frontline)',
  'nuclear watch': '(nuclear OR IAEA OR enrichment OR "ballistic missile") sourcelang:english',
  'maritime choke-points':
    '(Hormuz OR Malacca OR Bab-el-Mandeb OR "South China Sea" OR chokepoint OR "shipping lane")',
  'critical minerals': '(lithium OR cobalt OR nickel OR "rare earth" OR graphite) (mine OR mining OR supply)',
  // F84: the Law news-wire modules search with the forum's own name and legal terms, checked
  // against live Google News results on 2026-10-13 (docs/specs/2026-10-13-law-news-queries.md).
  // International forums carry no "India" filter; ICC excludes cricket's ICC.
  'district court case tracker':
    'India ("district court" OR "sessions court" OR "judicial magistrate" OR "district judge") (order OR judgment OR case OR bail)',
  'up high court (allahabad) order feed':
    '("Allahabad High Court" OR "High Court of Judicature at Allahabad") (order OR judgment OR bench OR hearing OR petition)',
  'ngt environmental litigation tracker':
    '("National Green Tribunal" OR NGT) (order OR petition OR notice OR directs OR compensation)',
  'cat & consumer disputes (ncdrc) watch':
    '("Central Administrative Tribunal" OR NCDRC OR "consumer commission" OR "consumer forum") (order OR judgment OR directs OR compensation)',
  'hc judge profiles & bench analytics':
    '("High Court" OR "Supreme Court") (collegium OR justice OR judge) (appointed OR elevated OR transferred OR retires OR "sworn in" OR recommends)',
  'icc proceedings':
    '("International Criminal Court" OR "ICC prosecutor" OR "ICC judges" OR "ICC arrest warrant" OR "Rome Statute") -cricket',
  'icj proceedings':
    '("International Court of Justice" OR "ICJ ruling" OR "ICJ case" OR "ICJ hearing" OR "ICJ judges") -cricket',
  'wto dispute settlement':
    '("World Trade Organization" OR WTO) ("dispute settlement" OR "dispute panel" OR "panel report" OR "Appellate Body" OR "files complaint" OR "requests consultations")',
  'sector tribunals (itat / tdsat / sat / drt)':
    '("Income Tax Appellate Tribunal" OR ITAT OR TDSAT OR "Securities Appellate Tribunal" OR "Debts Recovery Tribunal") (order OR appeal OR ruling OR directs)',
  'constitutional bench tracker':
    'India ("Constitution Bench" OR "constitutional bench") (Supreme Court) (hearing OR judgment)',
  'hc constitutional & pil tracker':
    'India ("High Court") (PIL OR "public interest litigation" OR constitutional) (order OR judgment)',
  // F196: planned modules built from a curated search, checked against live Google News results on
  // 2026-10-15 (at least 80% of the top 20 on topic). Each answer is kept by its title guard in
  // src/lib/curatedNews.js.
  'sports governance & policy':
    'India ("sports ministry" OR "national sports federation" OR "National Sports Code" OR NADA OR "anti-doping" OR "Indian Olympic Association" OR IOA OR "sports governance" OR "Sports Governance Act")',
  "governor friction & president's rule tracker":
    'India governor ("state government" OR "President\'s Rule" OR "Article 356" OR "withheld assent" OR "governor\'s address" OR walkout OR "Raj Bhavan" OR "Lok Bhavan" OR "chief minister") (row OR clash OR friction OR standoff OR confrontation OR tussle OR "President\'s Rule" OR "Article 356")',
  'legislative productivity comparison':
    'India ("assembly session" OR "Vidhan Sabha session" OR "monsoon session" OR "winter session" OR "budget session") (assembly OR "Vidhan Sabha") (sittings OR adjourned OR "sine die" OR "bills passed" OR "passed the bill" OR walkout OR "cut short" OR curtailed)',
  'mla defection & anti-defection case tracker':
    'India (MLA OR MLAs OR legislator) (defection OR "anti-defection" OR "Tenth Schedule" OR "disqualification petition" OR disqualified OR "switch party" OR "joins BJP" OR "joins Congress" OR "switched sides" OR defect)',
};

/** Whether a feature has a curated topic query (FEATURE_TOPIC_Q), rather than the name-derived fallback. */
function hasCuratedTopic(featureName) {
  const n = norm(featureName);
  return Boolean(n) && Object.keys(FEATURE_TOPIC_Q).some((k) => n.includes(k) || k.includes(n));
}

function topicQueryForFeature(featureName) {
  const n = norm(featureName);
  for (const [k, q] of Object.entries(FEATURE_TOPIC_Q)) {
    if (n.includes(k) || k.includes(n)) return q;
  }
  const cleaned = String(featureName || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[–—&+/|,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned
    .split(' ')
    .filter((w) => w.length > 2 && !TOPIC_STOP.has(w.toLowerCase()))
    .slice(0, 6);
  const phrase = words.slice(0, 4).join(' ') || cleaned.slice(0, 48) || 'India';
  const orBits = words.length ? words.map((w) => `"${w}"`).join(' OR ') : `"${phrase}"`;
  return `India (${orBits})`;
}

/**
 * The route marker for the Google News topic search, as the feature map's `route` and the source
 * registry's `openLiveFallback` spell it (F189).
 */
export const NEWS_TOPIC_ROUTE = 'news-topic';

export function newsRssUrlForFeature(featureName) {
  const q = `${topicQueryForFeature(featureName)} when:7d`;
  return (
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(q) +
    '&hl=en-IN&gl=IN&ceid=IN:en'
  );
}

function wantsPibWire(featureName) {
  return /cabinet decisions|state governance brief|policy pipeline|morning brief/i.test(
    String(featureName || ''),
  );
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    const v = obj[k];
    if (v == null || v === '') continue;
    if (typeof v === 'object' && v.value != null) return String(v.value);
    if (typeof v === 'object' && v.url) return String(v.url);
    if (typeof v === 'object') continue;
    return String(v);
  }
  return '';
}

function flattenValue(v, depth = 0) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth > 2) return JSON.stringify(v);
  if (Array.isArray(v)) return v.map((x) => flattenValue(x, depth + 1)).join('; ');
  if (typeof v === 'object') {
    if (v.value != null && (v.type || Object.keys(v).length <= 3)) return flattenValue(v.value, depth + 1);
    if (v.url && !v.title) return String(v.url);
  }
  return JSON.stringify(v);
}

function flattenRow(item, extra = {}) {
  const src = item && typeof item === 'object' && !Array.isArray(item) ? item : { value: item };
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('_')) continue;
    out[k] = flattenValue(v);
  }
  const date =
    pick(src, [
      'date',
      'date_introduced',
      'seendate',
      'seenDate',
      'pubDate',
      'published',
      'datetime',
      'Date',
      'year',
      'closeTime',
      'createdTime',
      'billIntroducedDate',
      'introducedOn',
      'airdate',
      'dateEvent',
    ]) || extra.date || '';
  const title =
    pick(src, [
      'title',
      'bill_name',
      'billName',
      'name',
      'headline',
      'case_title',
      'topic',
      'policy_name',
      'tender_title',
      'officer_name',
      'mp_name',
      'project_name',
      'conflict_name',
      'subject',
      'question',
      'strEvent',
      'OBJECT_NAME',
      'lastName',
      'indicator',
      'country',
    ]) || extra.title || '';
  let source_url =
    pick(src, [
      'source_url',
      'url',
      'urlSrc',
      'link',
      'sourceurl',
      'html_url',
      'document_url',
      'pdf_url',
      'detail_url',
      'strVideo',
    ]) || extra.source_url || '';
  // Wikidata bindings are http:// by default; upgrade so client citation guard keeps them.
  if (/^http:\/\/(www\.)?wikidata\.org\//i.test(source_url)) {
    source_url = source_url.replace(/^http:/i, 'https:');
  }
  const { source_url: _drop, title: _t, ...restExtra } = extra || {};
  return { ...out, date, title, ...restExtra, source_url };
}

function findArray(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  const keys = [
    'articles',
    'data',
    'items',
    'bills',
    'results',
    'records',
    'rows',
    'content',
    'objects',
    'markets',
    'events',
    'states',
    'value',
    'list',
    'entries',
    'payload',
    'docs',
  ];
  for (const k of keys) {
    if (Array.isArray(json[k])) return json[k];
    if (json[k] && Array.isArray(json[k].data)) return json[k].data;
    if (json[k] && Array.isArray(json[k].objects)) return json[k].objects;
    if (json[k] && Array.isArray(json[k]._embedded?.objects)) return json[k]._embedded.objects;
  }
  if (json._embedded && Array.isArray(json._embedded.objects)) return json._embedded.objects;
  if (json.feed && Array.isArray(json.feed.results)) return json.feed.results;
  if (json.results && Array.isArray(json.results.bindings)) return json.results.bindings;
  for (const v of Object.values(json)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  }
  return [];
}

function worldBankRows(json) {
  const rows = Array.isArray(json) && Array.isArray(json[1]) ? json[1] : findArray(json);
  return rows.map((r) =>
    flattenRow(
      {
        country: r.country?.value || r.countryiso3code || '',
        indicator: r.indicator?.value || '',
        date: r.date || '',
        value: r.value,
        iso3: r.countryiso3code || '',
      },
      { title: `${r.country?.value || r.countryiso3code || ''} ${r.date || ''}`.trim() },
    ),
  );
}

function wikidataRows(json) {
  const bindings = json?.results?.bindings || [];
  return bindings.map((b) => {
    const raw = {};
    for (const [k, cell] of Object.entries(b)) {
      raw[k] = cell?.value || '';
    }
    const flat = { ...raw };
    for (const [k, v] of Object.entries(raw)) {
      if (!k.endsWith('Label')) continue;
      const base = k.slice(0, -5);
      // Prefer human labels over entity URIs for column values.
      if (!flat[base] || /^https?:\/\/www\.wikidata\.org\//i.test(flat[base]) || /^Q\d+$/i.test(flat[base])) {
        flat[base] = v;
      }
    }
    const title =
      raw.personLabel ||
      raw.countryLabel ||
      raw.filmLabel ||
      raw.serviceLabel ||
      raw.leagueLabel ||
      raw.districtLabel ||
      raw.itemLabel ||
      flat.person ||
      flat.country ||
      flat.film ||
      flat.service ||
      flat.league ||
      flat.district ||
      flat.item ||
      Object.values(flat).find((v) => v && !/^https?:/i.test(v)) ||
      '';
    const source_url = (
      Object.values(raw).find((v) => /^https?:\/\/www\.wikidata\.org\//i.test(v)) ||
      Object.values(raw).find((v) => /^https?:/i.test(v)) ||
      ''
    ).replace(/^http:\/\//i, 'https://');
    return flattenRow(flat, { title, source_url });
  });
}

function reliefwebRows(json) {
  const data = json?.data || [];
  return data.map((d) => {
    const f = d.fields || {};
    return flattenRow(
      {
        id: d.id,
        title: f.title,
        date: f.date?.original || f.date?.created || '',
        source_url: f.url,
        status: f.status,
        country: Array.isArray(f.country) ? f.country.map((c) => c.name).join(', ') : '',
      },
      {},
    );
  });
}

function openskyRows(json) {
  const states = json.states || [];
  return states.slice(0, MAX_ROWS).map((s) =>
    flattenRow({
      date: json.time ? new Date(json.time * 1000).toISOString() : '',
      title: (s[1] || s[0] || '').toString().trim() || 'aircraft',
      icao24: s[0],
      callsign: s[1],
      origin_country: s[2],
      longitude: s[5],
      latitude: s[6],
      altitude: s[7],
      on_ground: s[8],
      velocity: s[9],
    }),
  );
}

function espnRows(json) {
  const events = json.events || [];
  return events.map((e) => {
    const comp = e.competitions?.[0];
    const teams = (comp?.competitors || [])
      .map((c) => `${c.team?.displayName || ''} ${c.score || ''}`.trim())
      .join(' vs ');
    return flattenRow({
      date: e.date,
      title: e.name || teams,
      source_url: e.links?.[0]?.href || '',
      status: comp?.status?.type?.description || e.status?.type?.description || '',
      detail: teams,
    });
  });
}

function sportsDbRows(json) {
  const events = json.events || json.event || [];
  return events.map((e) =>
    flattenRow({
      date: e.dateEvent,
      title: e.strEvent,
      source_url: e.strThumb || '',
      league: e.strLeague,
      home: e.strHomeTeam,
      away: e.strAwayTeam,
      time: e.strTime,
    }),
  );
}

function parseCsv(text, cap = MAX_ROWS) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === ',' && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = split(lines[0]).map((h) => h.trim());
  return lines.slice(1, cap + 1).map((line) => {
    const cols = split(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h || `col${i}`] = cols[i] || '';
    });
    return flattenRow(obj, {
      title: obj.name || obj.Symbol || obj.symbol || obj.title || cols[0] || '',
      date: obj.Date || obj.date || obj.Time || '',
    });
  });
}

/**
 * An RSS description as one line of plain text. Feeds such as Google News send it as entity-encoded
 * HTML (&lt;a href=…&gt;headline&lt;/a&gt;&amp;nbsp;…): the XML level is decoded once, the tags are
 * stripped, then only spacing and quote entities are decoded, never &lt; or &gt;, so the result can
 * never become markup.
 */
function plainSummary(raw) {
  const html = String(raw || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRssOrXml(text) {
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(text))) {
    const block = m[1];
    const tag = (name) => {
      const r = new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${name}>`, 'i');
      const hit = r.exec(block);
      return hit ? (hit[1] || hit[2] || '').trim() : '';
    };
    const href = /<link>([^<]+)<\/link>/i.exec(block)?.[1]?.trim()
      || /href="([^"]+)"/i.exec(block)?.[1]
      || '';
    // F128: Google News names each item's publisher in <source>; kept as plain text when present.
    const publisher = tag('source')
      .replace(/<[^>]+>/g, '')
      .replace(/&(amp|quot|apos|#39);/g, (_, e) => ({ amp: '&', quot: '"', apos: "'", '#39': "'" })[e])
      .trim();
    items.push(
      flattenRow({
        date: tag('pubDate') || tag('updated') || tag('date'),
        title: tag('title'),
        source_url: href,
        summary: plainSummary(tag('description')).slice(0, 400),
        ...(publisher ? { publisher } : {}),
      }),
    );
    if (items.length >= MAX_ROWS) break;
  }
  if (items.length) return items;
  const sdn = [];
  const entryRe = /<sdnEntry\b[^>]*>([\s\S]*?)<\/sdnEntry>/gi;
  while ((m = entryRe.exec(text))) {
    const block = m[1];
    const last = /<lastName>([^<]*)<\/lastName>/i.exec(block)?.[1] || '';
    const first = /<firstName>([^<]*)<\/firstName>/i.exec(block)?.[1] || '';
    const uid = /<uid>([^<]*)<\/uid>/i.exec(block)?.[1] || '';
    const sdnType = /<sdnType>([^<]*)<\/sdnType>/i.exec(block)?.[1] || '';
    sdn.push(
      flattenRow({
        title: [last, first].filter(Boolean).join(', ') || uid,
        uid,
        sdnType,
        source_url: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML',
      }),
    );
    if (sdn.length >= MAX_ROWS) break;
  }
  return sdn;
}

function rowsFromPayload(raw, contentType, url) {
  const ct = (contentType || '').toLowerCase();
  const text = typeof raw === 'string' ? raw.replace(/^\uFEFF/, '') : '';
  if (
    ct.includes('xml') ||
    ct.includes('rss') ||
    ct.includes('atom') ||
    text.trimStart().startsWith('<')
  ) {
    return parseRssOrXml(text);
  }
  // F185: a body that opens like JSON is JSON. When it does not parse (cut off part-way, or an error
  // body) it gives no rows; read as CSV it gave one junk row per line ({"{": "value : Bhojpur district"}).
  const jsonLike = /^[[{]/.test(text.trimStart());
  if (!jsonLike && (ct.includes('csv') || (url && /\.csv(\?|$)/i.test(url)))) {
    return parseCsv(text);
  }
  let json;
  try {
    json = typeof raw === 'string' ? JSON.parse(text) : raw;
  } catch {
    if (text.includes('<item')) return parseRssOrXml(text);
    if (!jsonLike && text.includes(',')) return parseCsv(text);
    return [];
  }
  if (Array.isArray(json) && json[0] && typeof json[0] === 'object' && 'page' in json[0] && Array.isArray(json[1])) {
    return worldBankRows(json);
  }
  if (json?.results?.bindings) return wikidataRows(json);
  if (Array.isArray(json?.data) && json.data[0]?.fields) return reliefwebRows(json);
  if (Array.isArray(json?.states) && url.includes('opensky')) return openskyRows(json);
  if (json?.events && /espn\.com/i.test(url)) return espnRows(json);
  if ((json?.events || json?.event) && /thesportsdb/i.test(url)) return sportsDbRows(json);
  if (Array.isArray(json) && json[0]?.icao24 && json[0]?.callsign !== undefined) {
    return json.slice(0, MAX_ROWS).map((r) => flattenRow(r, { title: r.callsign || r.icao24 }));
  }
  if (Array.isArray(json) && json[0]?.question && json[0]?.probability != null) {
    return json.slice(0, MAX_ROWS).map((r) =>
      flattenRow(r, { title: r.question, source_url: r.url, date: r.closeTime || r.createdTime }),
    );
  }
  const arr = findArray(json);
  return arr.slice(0, MAX_ROWS).map((item) => {
    if (item && typeof item === 'object' && item.show && item.name) {
      return flattenRow({
        date: item.airdate,
        title: `${item.show.name}: ${item.name}`,
        source_url: item.show.officialSite || item.show.url || '',
        network: item.show.network?.name || item.show.webChannel?.name || '',
        airtime: item.airtime,
      });
    }
    if (item && item.OBJECT_NAME) return flattenRow(item, { title: item.OBJECT_NAME });
    return flattenRow(item);
  });
}

async function fetchText(url) {
  if (archiveOnly()) throw new Error(ARCHIVE_ONLY);
  if (!isHttpsUrl(url)) {
    throw new Error('HTTPS only');
  }
  // Bare pib.gov.in often ECONNRESET from Node; www host serves the same RSS.
  if (/^https:\/\/pib\.gov\.in\//i.test(url)) {
    url = url.replace(/^https:\/\/pib\.gov\.in\//i, 'https://www.pib.gov.in/');
  }
  // F169 T4 (owner, 2026-10-14): GDELT refuses every request and each try waited up to 11 s, so it
  // is not asked; callers move on to their next source at once.
  if (GDELT_HOST.test(url)) throw new Error(GDELT_OFF);

  const attempt = async () => {
    const ac = new AbortController();
    const wikidata = /query\.wikidata\.org/i.test(url);
    const timeoutMs = wikidata ? Math.max(FETCH_MS, 45_000) : FETCH_MS;
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const pib = /pib\.gov\.in/i.test(url);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ac.signal,
        headers: {
          Accept: pib
            ? 'application/rss+xml, application/xml, text/xml, */*'
            : wikidata
              ? 'application/sparql-results+json, application/json;q=0.9, */*;q=0.8'
              : 'application/json, application/xml, application/rss+xml, text/csv, text/plain, */*',
          'User-Agent': pib ? USER_AGENT : USER_AGENT_BOT,
          ...(pib ? { 'Accept-Language': 'en-US,en;q=0.9' } : {}),
        },
      });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error('response too large');
      const text = buf.toString('utf8');
      if (res.status === 429 || /please limit requests|too many requests/i.test(text)) {
        throw new Error('rate limited');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      return { text, contentType: ct, finalUrl: res.url || url };
    } finally {
      clearTimeout(t);
    }
  };

  return attempt();
}

function datasetFile(dataset) {
  if (!dataset) return null;
  const { datasetToFile } = loadCache();
  const key = dataset.trim();
  if (datasetToFile[key]) return path.join(EMBEDDED_DIR, datasetToFile[key]);
  const noCsv = key.replace(/\.csv$/i, '');
  if (datasetToFile[noCsv]) return path.join(EMBEDDED_DIR, datasetToFile[noCsv]);
  const guess = path.join(EMBEDDED_DIR, `${noCsv}.json`);
  if (fs.existsSync(guess)) return guess;
  return null;
}

function loadRawEmbedded(dataset) {
  const file = datasetFile(dataset);
  if (!file || !fs.existsSync(file)) return [];
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(json) ? json : [];
}

function loadEmbedded(dataset) {
  const file = datasetFile(dataset);
  if (!file || !fs.existsSync(file)) return null;
  if (embeddedCache.has(file)) return embeddedCache.get(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = Array.isArray(json) ? json.map((r) => flattenRow(r)) : rowsFromPayload(json, 'application/json', '');
  embeddedCache.set(file, rows);
  return rows;
}

function loadAlliancesPack() {
  const candidates = [
    path.join(APP_ROOT, 'src', 'data', 'alliances.json'),
    path.join(REPO_ROOT, 'niyantran-react', 'src', 'data', 'alliances.json'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    if (embeddedCache.has(file)) return embeddedCache.get(file);
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    embeddedCache.set(file, pack);
    return pack;
  }
  return null;
}

function loadJsonPack(name) {
  const candidates = [
    path.join(APP_ROOT, 'src', 'data', name),
    path.join(REPO_ROOT, 'niyantran-react', 'src', 'data', name),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    if (embeddedCache.has(file)) return embeddedCache.get(file);
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    embeddedCache.set(file, pack);
    return pack;
  }
  return null;
}

function loadSanctionsPack() {
  return loadJsonPack('sanctions.json');
}

function loadGlobalAidPack() {
  return loadJsonPack('global-aid.json');
}

function loadGeoConflictsPack() {
  const candidates = [
    path.join(APP_ROOT, 'src', 'data', 'geo-conflicts.json'),
    path.join(REPO_ROOT, 'niyantran-react', 'src', 'data', 'geo-conflicts.json'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    if (embeddedCache.has(file)) return embeddedCache.get(file);
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    embeddedCache.set(file, pack);
    return pack;
  }
  return null;
}

function geoConflictRows(pack) {
  return (pack?.conflicts || [])
    .filter((c) => c && c.id && c.name && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon)))
    .map((c) => {
      const sources = (c.sources || []).filter((s) => Array.isArray(s) && String(s[0] || '').trim() && /^https?:\/\//i.test(String(s[1] || '')));
      const actors = (c.actors || []).filter((x) => String(x || '').trim());
      const row = {
        id: c.id,
        name: c.name,
        title: c.name,
        conflict_name: c.name,
        region: c.region || '',
        status: c.status || '',
        current_stage: c.status || '',
        intensity: c.intensity,
        since: c.since || '',
        started: c.since || '',
        date: c.since || '',
        fatalitiesEst: c.fatalitiesEst || '',
        displaced: c.displaced || '',
        latest: c.latest || '',
        latest_development: c.latest || '',
        actors: actors.join(' · '),
        supporters: (c.supporters || []).filter((x) => String(x || '').trim()).join(' · '),
        equipment: (c.equipment || []).filter((x) => String(x || '').trim()).join(' · '),
        lat: Number(c.lat),
        lon: Number(c.lon),
        source_url: sources[0]?.[1] || '',
        sources_json: JSON.stringify(sources),
      };
      sources.forEach((s, i) => {
        row[`source_${i + 1}`] = s[0];
        row[`source_${i + 1}_url`] = s[1];
      });
      return row;
    });
}

function dossierLinks(rows) {
  const urls = [];
  for (const row of rows) {
    for (let i = 1; i <= 6; i++) {
      const u = row[`source_${i}_url`];
      if (u && isHttpsUrl(u) && !urls.includes(u)) urls.push(u);
    }
  }
  return urls;
}

function sourceLinks(entry, feature) {
  const urls = new Set();
  for (const u of String(entry?.primaryFeedUrl || '').split(/\s+/)) {
    if (isHttpsUrl(u)) urls.add(u);
  }
  for (const u of String(entry?.sourceUrls || '').split(/\n/)) {
    const t = u.trim();
    if (isHttpsUrl(t)) urls.add(t);
  }
  if (feature?.source && isHttpsUrl(feature.source.split(/\s/)[0])) urls.add(feature.source.split(/\s/)[0]);
  return [...urls];
}

/**
 * F89 (F171 B1): source links never shown to readers: MoSPI's IPM site (expired certificate,
 * checked 2026-10-14; restore when renewed).
 */
const HIDDEN_SOURCE_LINK = /^https?:\/\/ipm\.mospi\.gov\.in\b/i;

function envelope({ tier, feature, rows, adapter, links, coverage, fallback, note, kind, timeline, meta }) {
  return {
    ok: true,
    tier,
    feature: feature.htmlFeature || feature,
    rows,
    source: {
      adapter,
      links: Array.isArray(links) ? links.filter((l) => !HIDDEN_SOURCE_LINK.test(String(l || ''))) : links,
      note: note || '',
      kind: kind || '',
    },
    coverage: {
      from: coverage?.from || entryCoverage(feature).from,
      through: coverage?.through || entryCoverage(feature).through,
      exhaustive: Boolean(coverage?.exhaustive),
    },
    fallback: Boolean(fallback),
    timeline: Array.isArray(timeline) ? timeline : [],
    meta: meta || null,
  };
}

function entryCoverage(featureOrEntry) {
  return {
    from: featureOrEntry?.coverageFrom || '',
    through: featureOrEntry?.coverageThrough || '',
    exhaustive: Boolean(featureOrEntry?.exhaustive),
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function shortFail(error) {
  const raw = String(error || '').trim();
  if (!raw) return 'live feed unavailable';
  const s = raw.replace(/^[a-z0-9.-]+:\s*/i, '');
  if (/abort/i.test(s)) return 'timed out';
  if (/HTTP 401|HTTP 403/i.test(s)) return 'source refused the request';
  if (/HTTP 404/i.test(s)) return 'source endpoint not found';
  if (/HTTP /i.test(s)) return `source returned ${s.match(/HTTP \d+/)?.[0] || 'an error'}`;
  if (/empty/i.test(s)) return 'source returned no rows';
  if (/fetch failed|ECONN|ENOTFOUND|certificate|network/i.test(s)) return 'host did not respond';
  if (/^https?:/i.test(raw) || /[?&=]/.test(raw) || raw.length > 140) return 'live feed unavailable';
  return raw;
}

function statusRow({ adapter, url, reason, featureName }) {
  const scrape = STATUS_ADAPTERS.has(adapter || '');
  const host = scrape ? '' : hostOf(url);
  const title = scrape ? 'Module planned' : 'Source offline or empty';
  const detail = scrape
    ? 'This adapter is listed in the source map, but table extraction is not scheduled. Intended coverage ships when the family adapter is ready. No records were invented to fill this table.'
    : host
      ? `${host} did not return rows and there is no last-known-good archive for this module. No records were invented.`
      : 'No live rows and no last-known-good archive were available. No records were invented.';
  return [
    flattenRow({
      date: new Date().toISOString().slice(0, 10),
      title,
      source_url: '',
      status: 'source_status',
      adapter: adapter || '',
      feature: featureName || '',
      host: host || '',
      detail,
      fail_reason: shortFail(reason),
      readiness: scrape ? 'planned' : 'offline',
    }),
  ];
}

function matchFeature(tier, featureName) {
  const { features, registry } = loadCache();
  const t = resolveTier(tier);
  const n = norm(featureName);
  const list = t === 'home' ? features : features.filter((f) => f.htmlTier === t);
  let feat =
    list.find((f) => norm(f.htmlFeature) === n) ||
    features.find((f) => norm(f.htmlFeature) === n);
  if (!feat) {
    feat = list.find((f) => norm(f.workbookFunctions) === n);
  }
  if (!feat && n) {
    feat = list.find((f) => norm(f.htmlFeature).includes(n) || n.includes(norm(f.htmlFeature)));
  }
  const entries = (feat?.registryKeys || [])
    .map((k) => registry.find((r) => r.key === k))
    .filter(Boolean);
  if (!entries.length && feat) {
    const byName = registry.find(
      (r) => r.htmlTier === (feat.htmlTier || t) && norm(r.htmlFeature) === norm(feat.htmlFeature),
    );
    if (byName) entries.push(byName);
  }
  return { feat, entries, tier: feat?.htmlTier || t };
}

function capRows(rows, isBills) {
  if (isBills) return rows;
  return rows.slice(0, MAX_ROWS);
}

async function tryUrls(urls) {
  const errors = [];
  for (const url of urls) {
    if (!url || !isHttpsUrl(url)) continue;
    try {
      const got = await fetchText(url);
      const rows = rowsFromPayload(got.text, got.contentType, got.finalUrl);
      if (isGithubListing(rows, got.finalUrl || url)) {
        errors.push(`${hostOf(url) || 'source'}: directory listing, not a table`);
        continue;
      }
      if (rows.length) return { rows, url: got.finalUrl, error: null };
      errors.push(`${hostOf(url) || 'source'}: empty`);
    } catch (err) {
      errors.push(`${hostOf(url) || 'source'}: ${err.message || err}`);
    }
  }
  return { rows: [], url: urls[0] || '', error: errors.join(' | ') };
}

async function rssTagged(url, extra = {}) {
  try {
    const got = await fetchText(url);
    const rows = rowsFromPayload(got.text, got.contentType, got.finalUrl);
    return rows
      .filter((r) => r && r.title)
      .map((r) => ({ ...r, ...extra }));
  } catch {
    return [];
  }
}

function mergeBills(archive, live) {
  const seen = new Set();
  const out = [];
  const keyOf = (r) => norm(r.bill_name || r.billName || r.title) + '|' + (r.date_introduced || r.date || '');
  for (const r of [...live, ...archive]) {
    const k = keyOf(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

async function serveHome(featureName) {
  const n = norm(featureName);
  if (n === 'markets' || n === 'briefing' || n === '') {
    const nse = await tryUrls([NSE_INDICES]);
    if (nse.rows.length) {
      const nifty = nse.rows.filter((r) => /nifty 50|sensex|nifty bank/i.test(r.title || r.indexName || r.name || ''));
      return envelope({
        tier: 'home',
        feature: { htmlFeature: 'Markets' },
        rows: (nifty.length ? nifty : nse.rows).slice(0, 40),
        adapter: 'api',
        links: [NSE_INDICES],
        coverage: { from: '', through: 'present', exhaustive: false },
        fallback: false,
        note: 'NSE index snapshot via proxy.',
      });
    }
    const quotes = [];
    for (const [name, url] of HOME_STOOQ) {
      const got = await tryUrls([url]);
      if (got.rows.length) {
        quotes.push(
          flattenRow({
            ...got.rows[0],
            title: name,
            name,
            source_url: url,
          }),
        );
      }
    }
    if (quotes.length) {
      return envelope({
        tier: 'home',
        feature: { htmlFeature: 'Markets' },
        rows: quotes,
        adapter: 'api',
        links: HOME_STOOQ.map((x) => x[1]),
        coverage: { from: '', through: 'present', exhaustive: false },
        fallback: false,
        note: 'Stooq last quotes via proxy.',
      });
    }
    const archive = loadEmbedded('finance_market_feed.csv') || [];
    return envelope({
      tier: 'home',
      feature: { htmlFeature: 'Markets' },
      rows: archive.length ? archive.slice(0, 40) : statusRow({ adapter: 'api', url: NSE_INDICES, reason: 'live market feed failed; no archive rows parsed', featureName: 'Markets' }),
      adapter: 'embedded',
      links: [NSE_INDICES, ...HOME_STOOQ.map((x) => x[1])],
      coverage: { from: '', through: 'archive', exhaustive: false },
      fallback: true,
      note: archive.length
        ? 'Live NSE/Stooq did not return quotes. Showing last-known-good index snapshot from the local archive.'
        : 'Live market endpoints failed and no archive was available.',
    });
  }
  if (n === 'top stories' || n === 'stories') {
    // F181 (owner-approved): the Google News India top-stories feed, read like the news wires read
    // Google News RSS. It replaces GDELT, which F169 T4 stopped asking. No story is invented.
    const live = await tryUrls([GOOGLE_NEWS_INDIA_TOP]);
    if (live.rows.length) {
      return envelope({
        tier: 'home',
        feature: { htmlFeature: 'Top Stories' },
        rows: capRows(live.rows, false),
        adapter: 'news-search',
        links: [GOOGLE_NEWS_INDIA_TOP],
        coverage: { from: '', through: 'present', exhaustive: false },
        fallback: false,
        note: 'Live Google News RSS: the India edition top stories.',
        meta: { section: 'TOP STORIES — GOOGLE NEWS INDIA', status: 'LIVE · NEWS RSS', heading: 'Top Stories', items: live.rows.length },
      });
    }
    return envelope({
      tier: 'home',
      feature: { htmlFeature: 'Top Stories' },
      rows: statusRow({ adapter: 'news-search', url: GOOGLE_NEWS_INDIA_TOP, reason: live.error || 'empty top stories feed', featureName: 'Top Stories' }),
      adapter: 'news-search',
      links: [GOOGLE_NEWS_INDIA_TOP],
      coverage: { from: '', through: 'present', exhaustive: false },
      fallback: true,
      note: 'Google News did not return the top stories. No stories were invented.',
    });
  }
  return null;
}

/**
 * F196: a curated news module. Its Google News search (FEATURE_TOPIC_Q), kept to the headlines its
 * title guard accepts, newest first (src/lib/curatedNews.js). A status row when nothing is left.
 */
async function serveCuratedNews(tier, feat, spec) {
  const url = newsRssUrlForFeature(feat.htmlFeature);
  const got = await tryUrls([url]);
  const rows = curatedNewsRows(got.rows, spec);
  if (rows.length) {
    return envelope({
      tier,
      feature: feat,
      rows,
      adapter: spec.adapter,
      links: [url],
      coverage: { from: '', through: '', exhaustive: false },
      fallback: false,
      note: spec.note,
      meta: { heading: feat.htmlFeature, section: spec.section, status: 'LIVE · NEWS RSS' },
    });
  }
  return envelope({
    tier,
    feature: feat,
    rows: statusRow({
      adapter: spec.adapter,
      url,
      reason: got.rows.length ? 'the news search returned no on-topic headlines' : got.error,
      featureName: feat.htmlFeature,
    }),
    adapter: spec.adapter,
    links: [url],
    coverage: { from: '', through: '', exhaustive: false },
    fallback: false,
    note: `${spec.note} The news search returned nothing on topic. No records were invented.`,
  });
}

export async function serveFeatureFeed(searchParams) {
  loadCache();
  const tierIn = searchParams.get('tier') || '';
  const featureIn = searchParams.get('feature') || '';
  const resolvedTier = resolveTier(tierIn);

  if (resolvedTier === 'home') {
    const home = await serveHome(featureIn || 'markets');
    if (home) return home;
    return {
      ok: false,
      tier: 'home',
      feature: featureIn,
      rows: statusRow({ adapter: 'internal', url: '', reason: 'unknown home feature', featureName: featureIn }),
      source: { adapter: 'internal', links: [], note: 'Home supports Markets and Top Stories.' },
      coverage: { from: '', through: '', exhaustive: false },
      fallback: false,
    };
  }

  const { feat, entries, tier } = matchFeature(tierIn, featureIn);
  if (!feat) {
    return {
      ok: false,
      tier: resolvedTier,
      feature: featureIn,
      rows: statusRow({ adapter: '', url: '', reason: 'unknown feature', featureName: featureIn }),
      source: { adapter: '', links: [], note: 'No matching HTML FEATURE MAP row.' },
      coverage: { from: '', through: '', exhaustive: false },
      fallback: false,
    };
  }

  // F173 (F171 B9): a module with no data source yet answers its planned state; nothing is fetched.
  if (isPlannedModule(tier, feat.htmlFeature)) {
    return envelope({
      tier,
      feature: feat,
      rows: [],
      adapter: 'planned',
      links: [],
      coverage: { from: '', through: '', exhaustive: false },
      fallback: false,
      note: PLANNED_NOTE,
    });
  }

  // F196: a module built from a curated news search answers that search's on-topic headlines.
  const curated = curatedNewsFor(tier, feat.htmlFeature);
  if (curated) return serveCuratedNews(tier, feat, curated);

  const entry = entries[0] || null;
  const adapter = (entry?.adapter || feat.adapters || '').split(/[|,]/)[0].trim().toLowerCase();
  const links = sourceLinks(entry, feat);
  const dataset = entry?.dataset || feat.dataset || '';
  const isBills = adapter === 'bill-history' || /bill passage/i.test(feat.htmlFeature);
  const coverage = {
    from: entry?.coverageFrom || '',
    through: entry?.coverageThrough || '',
    exhaustive: Boolean(entry?.exhaustive) && isBills,
  };
  const primary = entry?.primaryFeedUrl || (isHttpsUrl(feat.source) ? feat.source : '');
  // The registry's open-live fallback is NEWS_TOPIC_ROUTE or empty. The marker means the row falls back
  // to the module's Google News topic search, built here from its current name (newsRssUrlForFeature),
  // so the address cannot go stale. Empty for a row that routes by status or archive. Any other value is
  // ignored (gdeltRegistry.test.js keeps the shipped register to the two).
  const openLiveFallback = entry?.openLiveFallback === NEWS_TOPIC_ROUTE ? newsRssUrlForFeature(feat.htmlFeature) : '';

  // Transit: never pull full OpenSky /states/all (often times out). Use bbox air proxy.
  if (/^transit$/i.test(feat.htmlFeature || '')) {
    const boxes = [
      { lamin: 2, lamax: 37, lomin: 55, lomax: 97 }, // India & Arabian Sea
      { lamin: 35, lamax: 60, lomin: -10, lomax: 30 }, // Europe
    ];
    const errors = [];
    for (const b of boxes) {
      try {
        const air = await serveAir(b);
        const aircraft = air.aircraft || [];
        if (!aircraft.length) {
          if (air.error) errors.push(air.error);
          continue;
        }
        const rows = aircraft.slice(0, MAX_ROWS).map((a) =>
          flattenRow({
            date: new Date().toISOString(),
            title: a.flt || a.icao,
            icao24: a.icao,
            callsign: a.flt,
            origin_country: a.country,
            longitude: a.lon,
            latitude: a.lat,
            altitude: a.alt,
            on_ground: a.cat === 'on ground',
            velocity: a.vel,
            heading: a.hdg,
            category: a.cat,
          }),
        );
        return envelope({
          tier,
          feature: feat,
          rows,
          adapter: 'api',
          links: ['https://opensky-network.org/api/states/all', '/api/air'],
          coverage: { from: '', through: 'present', exhaustive: false },
          fallback: false,
          note: `OpenSky live aircraft via /api/air (${air.source || 'opensky'}). Full-world dump is not used.`,
        });
      } catch (e) {
        errors.push(e.message || String(e));
      }
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'api',
        url: 'https://opensky-network.org/api/states/all',
        reason: errors.join('; ') || 'OpenSky bbox air feed returned no aircraft',
        featureName: feat.htmlFeature,
      }),
      adapter: 'api',
      links: ['https://opensky-network.org/api/states/all', '/api/air'],
      coverage,
      fallback: false,
      note: 'Transit air feed failed. No last-known-good archive is shipped for live positions.',
    });
  }

  // State/Local geography: ingested NIY_GEO pack, not GitHub directory listings or GDELT.
  if (isGeoDesk(feat.htmlFeature, dataset)) {
    const pack = loadJsonPack('niy-geo.json');
    const rows = geoRows(pack, feat.htmlFeature, dataset);
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: [],
        coverage: { from: pack?.vintage || pack?.packs?.GA?.vintage || '', through: '', exhaustive: false },
        fallback: false,
        kind: 'geo-pack',
        note: geoNote(pack, feat.htmlFeature),
        meta: { vintage: pack?.packs?.GA?.vintage || pack?.vintage, state: 'Goa', heading: feat.htmlFeature },
      });
    }
  }

  // Law: extracted order tables. Do not dump GDELT news or GitHub listings as dockets.
  if (tier === 'judiciary') {
    const slice = lawSlice(feat.htmlFeature);
    if (isLawExtract(feat.htmlFeature)) {
      const rows = lawRows(slice, {
        sc: loadRawEmbedded('judiciary_sc_orders.csv'),
        nclt: loadRawEmbedded('judiciary_nclt_orders.csv'),
        ibbi: loadRawEmbedded('national_ibbi_announcements.csv'),
        wto: slice === 'wto' ? loadRawEmbedded('judiciary_wto_disputes.csv') : [],
      });
      if (rows.length) {
        return envelope({
          tier,
          feature: feat,
          rows,
          adapter: 'embedded',
          links: [...new Set(rows.map((r) => r.source_url).filter(Boolean))].slice(0, 8),
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          kind: 'law-pack',
          note: lawNote(slice),
          meta: { heading: feat.htmlFeature, section: slice === 'archive' ? 'ORDERS BY TOPIC' : slice === 'nclt' ? 'INSOLVENCY' : slice === 'wto' ? 'WTO DISPUTE REGISTER' : 'SUPREME COURT', ...(slice === 'wto' ? { asOf: rows[0]?.as_of || '' } : {}) },
        });
      }
    }
    if (isUsScotusDesk(feat.htmlFeature)) {
      const clUrls = [
        primary,
        'https://www.courtlistener.com/api/rest/v4/search/?type=o&court=scotus&order_by=dateFiled%20desc&page_size=100',
      ]
        .filter(Boolean)
        .map((u) => (u.includes('page_size=') ? u : `${u}${u.includes('?') ? '&' : '?'}page_size=100`));
      for (const url of clUrls) {
        try {
          const got = await fetchText(url);
          const json = JSON.parse(got.text);
          const rows = mapCourtListener(json);
          if (rows.length) {
            return envelope({
              tier,
              feature: feat,
              rows,
              adapter: 'api',
              links: [url],
              coverage: { from: '', through: '', exhaustive: false },
              fallback: false,
              note: 'CourtListener opinion search for SCOTUS. Not a news search.',
              meta: { heading: feat.htmlFeature, section: 'US SUPREME COURT' },
            });
          }
        } catch {
          /* try next */
        }
      }
    }

    // Desks without an extracted docket: Google News RSS coverage (honest wire, not a cause-list).
    // A curated forum query (F84) wins over the registry's product-name search.
    {
      const newsUrl = hasCuratedTopic(feat.htmlFeature) || !/news\.google\.com/i.test(primary || '')
        ? newsRssUrlForFeature(feat.htmlFeature)
        : primary;
      const wire = await tryUrls([newsUrl].filter(Boolean));
      const wireNote = 'Google News RSS — court / litigation coverage. Not an official docket or cause list.';
      if (wire.rows?.length) {
        const rows = wire.rows.slice(0, 100).map((r) => ({
          ...r,
          section: 'COVERAGE — GOOGLE NEWS RSS',
          reporting_search: 'Google News RSS — coverage mentions, not an official court dataset',
        }));
        return envelope({
          tier,
          feature: feat,
          rows,
          adapter: 'news-search',
          links: [newsUrl],
          coverage: { from: '', through: '7d', exhaustive: false },
          fallback: false,
          note: `${rows.length} coverage rows (${wireNote}).`,
          meta: {
            heading: feat.htmlFeature,
            wire: rows.length,
            status: 'LIVE · NEWS RSS',
          },
        });
      }
    }

    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: adapter || 'unmapped',
        url: primary || links[0] || '',
        reason: 'no extracted court table and coverage wire empty',
        featureName: feat.htmlFeature,
      }),
      adapter: adapter || 'unmapped',
      links,
      coverage,
      fallback: false,
      note: 'No extracted docket and coverage wire returned no rows. No records were invented.',
    });
  }

  // Economics: extracted tables + free live APIs. Never GDELT as a quote/macro/docket stand-in.
  if (tier === 'finance') {
    const slice = econSlice(feat.htmlFeature);
    const liveAttempt = ['nse', 'world', 'countries', 'indicators', 'sector', 'leaders', 'ai', 'manifold', 'elections', 'simulator'].includes(slice);
    const econStatus = (reason) =>
      envelope({
        tier,
        feature: feat,
        rows: statusRow({
          adapter: liveAttempt ? 'api' : adapter || 'unmapped',
          url: primary || links[0] || '',
          reason,
          featureName: feat.htmlFeature,
        }),
        adapter: liveAttempt ? 'api' : adapter || 'unmapped',
        links,
        coverage,
        fallback: false,
        note: econNote(slice || 'elections'),
      });

    if (slice === 'nse') {
      try {
        const got = await fetchText(NSE_INDICES);
        const json = JSON.parse(got.text);
        const live = nseLiveRows(json);
        if (live.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live,
            adapter: 'api',
            links: [NSE_INDICES],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: 'NSE allIndices via proxy. Quotes are delayed by the exchange, not a recommendation.',
          });
        }
      } catch {
        /* licence / session */
      }
      const rows = marketQuoteRows(loadRawEmbedded('finance_market_feed.csv'));
      if (rows.length) {
        return envelope({
          tier,
          feature: feat,
          rows,
          adapter: 'embedded',
          links: [NSE_INDICES],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          kind: 'finance-pack',
          note: econNote('nse'),
          meta: { heading: feat.htmlFeature, section: 'EQUITY MARKET FEED' },
        });
      }
      return econStatus('NSE allIndices blocked; no extracted quote snapshot');
    }

    if (slice === 'world') {
      try {
        const live = await loadWorldExchanges();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=5d'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: econNote('world'),
            meta: { heading: feat.htmlFeature, section: 'WORLD EXCHANGES' },
          });
        }
      } catch {
        /* status */
      }
      return econStatus('Yahoo index quotes did not return venue last prices');
    }

    if (slice === 'countries') {
      try {
        const live = await loadCountryEconomies();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://data.worldbank.org/indicator/NY.GDP.MKTP.CD'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: econNote('countries'),
            meta: { heading: feat.htmlFeature, section: 'COUNTRY ECONOMIES' },
          });
        }
      } catch {
        /* status */
      }
      return econStatus('World Bank GDP (current US$) did not return country rows');
    }

    if (slice === 'indicators') {
      try {
        const live = await loadKeyIndicators();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: econNote('indicators'),
            meta: { heading: feat.htmlFeature, section: 'KEY INDICATORS' },
          });
        }
      } catch {
        /* status */
      }
      return econStatus('World Bank growth/CPI/emp-to-pop did not return country rows');
    }

    if (slice === 'trade') {
      const rows = dgftRows(loadRawEmbedded('national_dgft_notifications.csv'));
      if (rows.length) {
        return envelope({
          tier,
          feature: feat,
          rows,
          adapter: 'embedded',
          links: [...new Set(rows.map((r) => r.source_url).filter(Boolean))].slice(0, 8),
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          kind: 'finance-pack',
          note: econNote('trade'),
          meta: { heading: feat.htmlFeature, section: 'TRADE POLICY' },
        });
      }
      return econStatus('no extracted DGFT notification table');
    }

    if (slice === 'simulator') {
      try {
        const live = await loadIndiaGdpGrowth();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: [
              'https://api.worldbank.org/v2/country/IND/indicator/NY.GDP.MKTP.KD.ZG?format=json&date=1990:2030&per_page=100',
              'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG',
            ],
            coverage: {
              from: live.rows[live.rows.length - 1]?.year || '1990',
              through: live.rows[0]?.year || '',
              exhaustive: false,
            },
            fallback: false,
            note: econNote('simulator'),
            meta: {
              heading: feat.htmlFeature,
              section: 'INDIA GDP GROWTH · WORLD BANK',
              status: 'LIVE · WORLD BANK WDI',
              indicator: 'NY.GDP.MKTP.KD.ZG',
              lastupdated: live.lastupdated || '',
              items: live.rows.length,
            },
          });
        }
      } catch {
        /* status */
      }
      return econStatus('World Bank India GDP growth series unavailable');
    }

    if (slice === 'sector') {
      try {
        const live = await loadIndiaEnergy();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: econNote('sector'),
            meta: { heading: feat.htmlFeature, section: 'SECTOR POLICY' },
          });
        }
      } catch {
        /* status */
      }
      return econStatus('World Bank India electricity-access series unavailable');
    }

    if (slice === 'leaders') {
      try {
        const live = await loadIndiaCeos();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://query.wikidata.org/'],
            coverage: { from: '', through: '', exhaustive: false },
            // F169 C3 review: loadIndiaCeos answers its last good list, marked stale, when Wikidata
            // fails; that is a stored copy, so the answer says so.
            fallback: Boolean(live.stale),
            note: econNote('leaders'),
            meta: { heading: feat.htmlFeature, section: 'BUSINESS LEADERS' },
          });
        }
      } catch {
        /* status */
      }
      return econStatus('Wikidata SPARQL for Indian enterprise CEOs did not return rows');
    }

    if (slice === 'ai') {
      // F169 T2: PIB's English press releases about technology, plus a technology news search.
      // The PIB feed is every ministry's releases, so it is filtered to technology titles.
      const news = aiTechNewsRssUrl();
      const [pibGot, newsGot] = await Promise.all([tryUrls([PIB_PRESS_RSS]), tryUrls([news])]);
      const pibRows = (pibGot.rows || [])
        .filter((r) => isTechTitle(r.title) && !/[\u0900-\u097F]/.test(String(r.title || '')))
        .map((r) => ({ ...r, publisher: r.publisher || 'Press Information Bureau' }));
      const seen = new Set();
      const rows = [...pibRows, ...(newsGot.rows || [])]
        .filter((r) => {
          const key = String(r.title || '').toLowerCase().replace(/\s+-\s+[^-]+$/, '').trim();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      if (rows.length) {
        return envelope({
          tier,
          feature: feat,
          rows,
          adapter: 'api',
          links: [PIB_PRESS_RSS, news],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: econNote('ai'),
          meta: { heading: feat.htmlFeature, section: 'AI & TECH' },
        });
      }
      return econStatus('PIB and the technology news search returned no technology items');
    }

    if (slice === 'manifold') {
      try {
        const live = await loadManifoldPolitical();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://api.manifold.markets/v0/markets?limit=1000'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: econNote('manifold', 'Live Manifold polling.'),
            meta: { heading: feat.htmlFeature, section: 'PREDICTION MARKETS' },
          });
        }
      } catch {
        /* archive */
      }
      const rows = manifoldPoliticalRows(loadRawEmbedded('finance_manifold_markets.csv'));
      if (rows.length) {
        return envelope({
          tier,
          feature: feat,
          rows,
          adapter: 'embedded',
          links: ['https://api.manifold.markets/v0/markets?limit=1000'],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: true,
          kind: 'finance-pack',
          note: econNote('manifold', 'Live polling failed; 31-row political snapshot.'),
          meta: { heading: feat.htmlFeature, section: 'PREDICTION MARKETS' },
        });
      }
      return econStatus('Manifold live polling failed and no political snapshot was present');
    }

    // F196: Manifold markets on Indian elections. No stored snapshot: when Manifold fails, the
    // status row answers and the page reads the module's stored rows (it is on FEED_SCHEDULE).
    if (slice === 'elections') {
      try {
        const live = await loadManifoldIndiaElections();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: [...financeLive.MANIFOLD_INDIA_SEARCH],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: econNote('elections'),
            meta: { heading: feat.htmlFeature, section: 'INDIAN ELECTION MARKETS' },
          });
        }
        return econStatus('Manifold returned no markets on Indian elections');
      } catch (e) {
        return econStatus(e?.message || 'Manifold search failed');
      }
    }

    return econStatus('no extracted economics table for this desk');
  }

  // Carbon: extracted milestone/price tables + outlet RSS. Never GDELT, never World Bank CO2-as-price.
  if (tier === 'climate') {
    const slice = carbonSlice(feat.htmlFeature);
    const carbonStatus = (reason) =>
      envelope({
        tier,
        feature: feat,
        rows: statusRow({
          adapter: adapter || 'unmapped',
          url: primary || links[0] || '',
          reason,
          featureName: feat.htmlFeature,
        }),
        adapter: adapter || 'unmapped',
        links,
        coverage,
        fallback: false,
        note: carbonNote(slice || 'cbam'),
      });

    if (slice === 'news') {
      const parts = await Promise.all(NEWS_FEEDS.map((f) => rssTagged(f.url, { outlet: f.outlet, source: f.outlet })));
      const live = newsRows(parts.flat());
      if (live.length) {
        return envelope({
          tier,
          feature: feat,
          rows: live,
          adapter: 'api',
          links: NEWS_FEEDS.map((f) => f.url),
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: carbonNote('news', 'Live outlet RSS.'),
          meta: { heading: feat.htmlFeature, section: 'Climate wire' },
        });
      }
    }

    if (slice === 'registry') {
      const parts = await Promise.all(REGISTRY_FEEDS.map((f) => rssTagged(f.url, { registry: f.registry })));
      const live = registryRows(parts.flat());
      const extracted = registryRows(loadRawEmbedded(carbonDataset('registry')));
      if (live.length) {
        const keep = extracted.filter((r) => !/^verra$/i.test(r.registry));
        const rows = registryRows([...live, ...keep]);
        return envelope({
          tier,
          feature: feat,
          rows,
          adapter: 'api',
          links: REGISTRY_FEEDS.map((f) => f.url),
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: carbonNote(
            'registry',
            'Verra from live RSS. Isometric from the extracted publication list. Puro.earth has no public RSS.',
          ),
          meta: { heading: feat.htmlFeature, section: 'Registry wire' },
        });
      }
    }

    if (slice) {
      const rows = carbonRows(slice, {
        cbam: loadRawEmbedded(carbonDataset('cbam')),
        pricing: loadRawEmbedded(carbonDataset('pricing')),
        monitor: loadRawEmbedded(carbonDataset('monitor')),
        ets: loadRawEmbedded(carbonDataset('ets')),
        ccts: loadRawEmbedded(carbonDataset('ccts')),
        registry: loadRawEmbedded(carbonDataset('registry')),
        news: loadRawEmbedded(carbonDataset('news')),
      });
      if (rows.length) {
        return envelope({
          tier,
          feature: feat,
          rows,
          adapter: 'embedded',
          links: [...new Set(rows.map((r) => r.source_url).filter(Boolean))].slice(0, 8),
          coverage: { from: '', through: '', exhaustive: false },
          fallback: slice === 'news' || slice === 'registry',
          kind: 'carbon-pack',
          note: carbonNote(slice, slice === 'news' || slice === 'registry' ? 'Live RSS failed; extracted snapshot.' : ''),
          meta: { heading: feat.htmlFeature, section: String(feat.htmlFeature || '') },
        });
      }
    }

    return carbonStatus('no extracted carbon table for this desk');
  }

  // Sports: live RSS / TheSportsDB / ESPN / Wikidata. Never GDELT.
  if (tier === 'sports') {
    const slice = sportsSlice(feat.htmlFeature);
    const sportsStatus = (reason) =>
      envelope({
        tier,
        feature: feat,
        rows: statusRow({
          adapter: 'api',
          url: primary || links[0] || '',
          reason,
          featureName: feat.htmlFeature,
        }),
        adapter: 'api',
        links,
        coverage,
        fallback: false,
        note: sportsNote(slice),
      });

    if (slice === 'cricket') {
      const live = rssWireRows(await rssTagged(CRICKET_RSS, { outlet: 'ESPNcricinfo' }), 'ESPNcricinfo');
      if (live.length) {
        return envelope({
          tier,
          feature: feat,
          rows: live,
          adapter: 'api',
          links: [CRICKET_RSS],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: sportsNote('cricket'),
          meta: { heading: feat.htmlFeature, section: 'CRICKET WIRE' },
        });
      }
      return sportsStatus('ESPNcricinfo RSS did not return stories');
    }

    if (slice === 'football') {
      const live = rssWireRows(await rssTagged(FOOTBALL_RSS, { outlet: 'BBC Sport' }), 'BBC Sport');
      if (live.length) {
        return envelope({
          tier,
          feature: feat,
          rows: live,
          adapter: 'api',
          links: [FOOTBALL_RSS],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: sportsNote('football'),
          meta: { heading: feat.htmlFeature, section: 'FOOTBALL WIRE' },
        });
      }
      return sportsStatus('BBC Sport football RSS did not return stories');
    }

    if (slice === 'india') {
      const live = rssWireRows(await rssTagged(INDIA_SPORTS_RSS, { outlet: 'Google News' }), 'Google News');
      if (live.length) {
        return envelope({
          tier,
          feature: feat,
          rows: live,
          adapter: 'api',
          links: [INDIA_SPORTS_RSS],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: sportsNote('india'),
          meta: { heading: feat.htmlFeature, section: 'INDIAN SPORTS WIRE' },
        });
      }
      return sportsStatus('Google News Indian-sports RSS did not return headlines');
    }

    if (slice === 'fixtures') {
      try {
        const live = await loadWorldFixtures();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4328'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: sportsNote('fixtures'),
            meta: { heading: feat.htmlFeature, section: 'WORLD LEAGUES' },
          });
        }
      } catch {
        /* status */
      }
      return sportsStatus('TheSportsDB did not return Premier League, NBA, IPL or La Liga events');
    }

    if (slice === 'isl') {
      try {
        const live = await loadIsl();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://site.api.espn.com/apis/site/v2/sports/soccer/ind.1/scoreboard'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: sportsNote('isl', live.source === 'espn' ? 'ESPN scoreboard.' : 'ESPN empty; TheSportsDB ISL.'),
            meta: { heading: feat.htmlFeature, section: 'ISL TRACKER' },
          });
        }
      } catch {
        /* status */
      }
      return sportsStatus('ESPN ISL scoreboard and TheSportsDB ISL returned no fixtures');
    }

    if (slice === 'business') {
      try {
        const live = await loadSportsLeagues();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://query.wikidata.org/'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: sportsNote('business'),
            meta: { heading: feat.htmlFeature, section: 'SPORTS BUSINESS' },
          });
        }
      } catch {
        /* status */
      }
      return sportsStatus('Wikidata SPARQL for Indian leagues did not return rows');
    }

    if (slice === 'athletes') {
      try {
        const live = await loadAthletes();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://query.wikidata.org/'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: sportsNote('athletes'),
            meta: { heading: feat.htmlFeature, section: 'ATHLETE INDEX' },
          });
        }
      } catch {
        /* status */
      }
      return sportsStatus('Wikidata SPARQL for Indian athletes did not return rows');
    }

    return sportsStatus('no sports table for this desk');
  }

  // Entertainment: TVmaze / Apple / Variety / Wikidata. Never GDELT.
  if (tier === 'entertainment') {
    const slice = entertainmentSlice(feat.htmlFeature);
    const entStatus = (reason) =>
      envelope({
        tier,
        feature: feat,
        rows: statusRow({
          adapter: 'api',
          url: primary || links[0] || '',
          reason,
          featureName: feat.htmlFeature,
        }),
        adapter: 'api',
        links,
        coverage,
        fallback: false,
        note: entertainmentNote(slice || 'tv'),
      });

    if (slice === 'tv') {
      try {
        const live = await loadTvTonight();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://api.tvmaze.com/schedule?country=IN', 'https://api.tvmaze.com/schedule?country=US'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: entertainmentNote('tv'),
            meta: { heading: feat.htmlFeature, section: 'TV & STREAMING TONIGHT' },
          });
        }
      } catch {
        /* status */
      }
      return entStatus('TVmaze schedule for India and the United States returned no listings');
    }

    if (slice === 'variety') {
      const live = entRssRows(await rssTagged(VARIETY_RSS, { outlet: 'Variety' }), 'Variety');
      if (live.length) {
        return envelope({
          tier,
          feature: feat,
          rows: live,
          adapter: 'api',
          links: [VARIETY_RSS],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: entertainmentNote('variety'),
          meta: { heading: feat.htmlFeature, section: 'ENTERTAINMENT NEWS WIRE' },
        });
      }
      return entStatus('Variety RSS did not return stories');
    }

    if (slice === 'bollywood') {
      const ndtv = entRssRows(await rssTagged(BOLLYWOOD_RSS, { outlet: 'NDTV Movies' }), 'NDTV Movies');
      if (ndtv.length) {
        return envelope({
          tier,
          feature: feat,
          rows: ndtv,
          adapter: 'api',
          links: [BOLLYWOOD_RSS],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: entertainmentNote('bollywood', 'NDTV Movies RSS.'),
          meta: { heading: feat.htmlFeature, section: 'BOLLYWOOD & FILM WIRE' },
        });
      }
      const gnews = entRssRows(
        await rssTagged(BOLLYWOOD_NEWS_RSS, { outlet: 'Google News' }),
        'Google News',
      );
      if (gnews.length) {
        return envelope({
          tier,
          feature: feat,
          rows: gnews,
          adapter: 'api',
          links: [BOLLYWOOD_NEWS_RSS],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: entertainmentNote('bollywood', 'NDTV Movies empty; Google News Bollywood wire.'),
          meta: { heading: feat.htmlFeature, section: 'BOLLYWOOD & FILM WIRE' },
        });
      }
      return entStatus('NDTV Movies RSS and Google News Bollywood returned no headlines');
    }

    if (slice === 'music-in' || slice === 'music-us') {
      try {
        const live = slice === 'music-in' ? await loadMusicIndia() : await loadMusicUs();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: [
              slice === 'music-in'
                ? 'https://rss.marketingtools.apple.com/api/v2/in/music/most-played/25/songs.json'
                : 'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/25/songs.json',
            ],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: entertainmentNote(slice, live.source === 'itunes' ? 'Apple Music empty; iTunes Top Songs.' : ''),
            meta: { heading: feat.htmlFeature, section: slice === 'music-in' ? 'INDIA TOP 25' : 'GLOBAL TOP 25' },
          });
        }
      } catch {
        /* status */
      }
      return entStatus('Apple Music and iTunes Top Songs returned no chart rows');
    }

    if (slice === 'box') {
      try {
        const live = await loadBoxOffice();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://query.wikidata.org/'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: entertainmentNote('box'),
            meta: { heading: feat.htmlFeature, section: 'BOX OFFICE TRACKER' },
          });
        }
      } catch {
        /* status */
      }
      return entStatus('Wikidata SPARQL for Indian films did not return rows');
    }

    if (slice === 'ott') {
      try {
        const live = await loadOtt();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://query.wikidata.org/'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: entertainmentNote('ott'),
            meta: { heading: feat.htmlFeature, section: 'OTT & STUDIO INTELLIGENCE' },
          });
        }
      } catch {
        /* status */
      }
      return entStatus('Wikidata SPARQL for Indian OTT and studios did not return rows');
    }

    if (slice === 'celebrity') {
      try {
        const live = await loadCelebrities();
        if (live.rows?.length) {
          return envelope({
            tier,
            feature: feat,
            rows: live.rows,
            adapter: 'api',
            links: ['https://query.wikidata.org/'],
            coverage: { from: '', through: '', exhaustive: false },
            fallback: false,
            note: entertainmentNote('celebrity'),
            meta: { heading: feat.htmlFeature, section: 'CELEBRITY INFLUENCE INDEX' },
          });
        }
      } catch {
        /* status */
      }
      return entStatus('Wikidata SPARQL for Indian screen and music personalities did not return rows');
    }

    return entStatus('no entertainment table for this desk');
  }

  // Strategic Assets — Infra: curated public project register, not World Bank/GDELT.
  if (/^infra$/i.test(feat.htmlFeature || '') || dataset === 'geopolitics_infra_projects.csv') {
    const pack = loadJsonPack('infra-projects.json');
    const rows = (pack?.projects || []).map(flattenInfra);
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: [...new Set(rows.map((r) => r.source_url).filter(Boolean))],
        coverage: { from: pack.asOf || '', through: pack.asOf || '', exhaustive: false },
        fallback: false,
        kind: 'dossier',
        note: 'Original HTML strategic infrastructure register. Live World Bank projects are served at /api/wb-projects.',
        meta: { asOf: pack.asOf },
      });
    }
  }

  // Strategic Assets — Nuclear Watch: public-source facility register, not GDELT.
  if (/^nuclear watch$/i.test(feat.htmlFeature || '')) {
    const pack = loadJsonPack('nuclear-watch.json');
    const rows = (pack?.facilities || []).map(flattenNuclear);
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: [...new Set(rows.map((r) => r.source_url).filter(Boolean))],
        coverage: { from: pack.asOf || '', through: pack.asOf || '', exhaustive: false },
        fallback: false,
        kind: 'dossier',
        note: 'Original HTML nuclear facility register. FAS/SIPRI arsenal estimates are attached as a live overlay, not a live count.',
        meta: { asOf: pack.asOf, strip: pack.strip || {}, arsenal: pack.arsenal || [] },
      });
    }
  }

  // Strategic Assets — Maritime Choke-Points: HTML NIY_GEO_CHOKEPOINTS register, not GDELT.
  if (/^maritime choke-?points$/i.test(feat.htmlFeature || '') || dataset === 'geo_chokepoints') {
    const pack = loadJsonPack('chokepoints.json');
    const rows = (pack?.points || []).map(flattenChokepoint);
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: [...new Set(rows.map((r) => r.source_url).filter(Boolean))],
        coverage: { from: pack.asOf || '', through: pack.asOf || '', exhaustive: false },
        fallback: false,
        kind: 'dossier',
        note: 'Original HTML maritime chokepoint register. Live IMF PortWatch transits are served at /api/portwatch.',
        meta: { asOf: pack.asOf, stats: pack.stats || {} },
      });
    }
  }

  // Strategic Assets — Satellite Infrastructure: live Space Devs upcoming launches. No curated constellation dossier.
  if (/^satellite infrastructure$/i.test(feat.htmlFeature || '')) {
    try {
      const live = await loadLaunches();
      if (live.rows?.length) {
        return envelope({
          tier,
          feature: feat,
          rows: live.rows,
          adapter: 'live',
          links: ['https://ll.thespacedevs.com/'],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          kind: 'dossier',
          note: 'The Space Devs upcoming launches. CelesTrak last-30-days is served at /api/celestrak.',
          meta: { source: live.source },
        });
      }
    } catch (err) {
      return envelope({
        tier,
        feature: feat,
        rows: statusRow({
          adapter: 'api',
          url: 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/',
          reason: err.message || String(err),
          featureName: feat.htmlFeature,
        }),
        adapter: 'api',
        links: ['https://ll.thespacedevs.com/'],
        coverage: { from: '', through: '', exhaustive: false },
        fallback: false,
        note: 'The Space Devs launch library did not return rows. No constellation records were invented.',
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'api',
        url: 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/',
        reason: 'empty launch roster',
        featureName: feat.htmlFeature,
      }),
      adapter: 'api',
      links: ['https://ll.thespacedevs.com/'],
      coverage: { from: '', through: '', exhaustive: false },
      fallback: false,
      note: 'The Space Devs launch library returned no upcoming launches. No constellation records were invented.',
    });
  }

  // Global Resources — World Constitutions: Constitute Project in-force list (not Wikidata/GDELT).
  if (/^world constitutions$/i.test(feat.htmlFeature || '')) {
    try {
      const live = await loadConstitutions();
      if (live.rows?.length) {
        return envelope({
          tier,
          feature: feat,
          rows: live.rows,
          adapter: 'live',
          links: ['https://www.constituteproject.org/'],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: 'Constitute Project constitutions currently in force. Cached up to 7 days.',
          meta: {
            section: 'CONSTITUTIONS IN FORCE — CONSTITUTE PROJECT',
            status: 'LIVE · CONSTITUTE PROJECT · CACHED 7D',
            note: `${live.rows.length} constitutions currently in force`,
          },
        });
      }
    } catch (err) {
      return envelope({
        tier,
        feature: feat,
        rows: statusRow({
          adapter: 'api',
          url: 'https://www.constituteproject.org/service/constitutions?lang=en',
          reason: err.message || String(err),
          featureName: feat.htmlFeature,
        }),
        adapter: 'api',
        links: ['https://www.constituteproject.org/'],
        coverage: { from: '', through: '', exhaustive: false },
        fallback: false,
        note: 'Constitute Project did not return rows. No constitution records were invented.',
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'api',
        url: 'https://www.constituteproject.org/service/constitutions?lang=en',
        reason: 'empty constitution list',
        featureName: feat.htmlFeature,
      }),
      adapter: 'api',
      links: ['https://www.constituteproject.org/'],
      coverage: { from: '', through: '', exhaustive: false },
      fallback: false,
      note: 'Constitute Project returned no in-force constitutions. No records were invented.',
    });
  }

  // Global Resources — Growth Indicators: World Bank GDP / CPI / unemployment for the HTML country set.
  if (/^growth indicators$/i.test(feat.htmlFeature || '')) {
    try {
      const live = await loadGrowth();
      if (live.rows?.length) {
        return envelope({
          tier,
          feature: feat,
          rows: live.rows,
          adapter: 'live',
          links: ['https://data.worldbank.org/'],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: 'World Bank open data — GDP growth, inflation and unemployment. Cached up to 24 hours.',
          meta: {
            section: 'GROWTH MONITOR — WORLD BANK OPEN DATA',
            status: 'LIVE · WORLD BANK · CACHED 24H',
            note: `${live.rows.length} economies · most recent published year`,
          },
        });
      }
    } catch (err) {
      return envelope({
        tier,
        feature: feat,
        rows: statusRow({
          adapter: 'api',
          url: 'https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.KD.ZG',
          reason: err.message || String(err),
          featureName: feat.htmlFeature,
        }),
        adapter: 'api',
        links: ['https://data.worldbank.org/'],
        coverage: { from: '', through: '', exhaustive: false },
        fallback: false,
        note: 'World Bank open-data API did not return rows. No growth figures were invented.',
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'api',
        url: 'https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.KD.ZG',
        reason: 'empty growth table',
        featureName: feat.htmlFeature,
      }),
      adapter: 'api',
      links: ['https://data.worldbank.org/'],
      coverage: { from: '', through: '', exhaustive: false },
      fallback: false,
      note: 'World Bank returned no indicator rows. No growth figures were invented.',
    });
  }

  // Global Resources — Heads of State: original HTML leader dossier (44 profiles), not Wikidata/GDELT.
  if (/^heads of state$/i.test(feat.htmlFeature || '') || dataset === 'geo_leaders') {
    const pack = loadJsonPack('leaders.json');
    const rows = leadersFromPack(pack);
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        // F122: the rows are the embedded register; no outside site is their source.
        links: [],
        coverage: { from: pack.asOf || '', through: pack.asOf || '', exhaustive: false },
        fallback: false,
        kind: 'dossier',
        note: 'Original HTML world-leaders register. As-of the pack date; not a live Wikidata table.',
        meta: {
          asOf: pack.asOf,
          stats: pack.stats,
        },
      });
    }
  }

  // Global Resources — Global Commodities: original HTML benchmark board (Pink Sheet is XLSX).
  if (/^global commodities$/i.test(feat.htmlFeature || '') || dataset === 'geo_commodities') {
    const pack = loadJsonPack('commodities.json');
    const rows = commoditiesFromPack(pack);
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        // F122: the levels are the pack's illustrative values; no outside site is their source.
        links: [],
        coverage: { from: pack.meta?.asOf || '', through: pack.meta?.asOf || '', exhaustive: false },
        fallback: false,
        kind: 'dossier',
        note: `Illustrative benchmark levels from the terminal's pack, as of ${pack.meta?.asOf || 'the pack date'}; no live price feed is connected.`,
        meta: {
          section: 'GLOBAL COMMODITIES',
          status: `AS OF ${String(pack.meta?.asOf || '').toUpperCase()} · ${pack.stats?.tracked || rows.length} BENCHMARKS`,
          note: pack.meta?.note || '',
          asOf: pack.meta?.asOf,
          stats: pack.stats,
          groups: pack.groups || [],
        },
      });
    }
  }

  // Global Resources — Geopolitics News Wire. F169 T4: BBC World first (0.3 s), then a Google News
  // topic search; GDELT is not asked.
  if (/^geopolitics news wire$/i.test(feat.htmlFeature || '') || dataset === 'geo_news_wire.csv') {
    const bbc = 'https://feeds.bbci.co.uk/news/world/rss.xml';
    // Both together, BBC preferred: a slow BBC must not use up the 4 s limit (review, F169 T4).
    const [rss, got] = await Promise.all([rssTagged(bbc, { outlet: 'BBC World' }), tryUrls([GEO_NEWS_WIRE_NEWS])]);
    if (rss.length) {
      return envelope({
        tier,
        feature: feat,
        rows: capRows(rss, false),
        adapter: 'news-search',
        links: [bbc, GEO_NEWS_WIRE_NEWS],
        coverage: { from: '', through: 'present', exhaustive: false },
        fallback: false,
        note: 'BBC World news feed. Reporting, not an official government dataset.',
        meta: { section: 'TOP WORLD STORIES — BBC WORLD', status: 'LIVE · BBC WORLD', note: `${rss.length} stories` },
      });
    }
    if (got.rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows: capRows(got.rows, false),
        adapter: 'news-search',
        links: [GEO_NEWS_WIRE_NEWS, bbc],
        coverage: { from: '', through: '3d', exhaustive: false },
        fallback: false,
        note: 'Google News search for geopolitics and diplomacy (BBC World did not answer). Reporting, not an official government dataset.',
        meta: { section: 'TOP WORLD STORIES — NEWS SEARCH', status: 'LIVE · NEWS SEARCH', note: `${got.rows.length} stories` },
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'news-search',
        url: bbc,
        reason: got.error || 'BBC World and the news search returned no stories',
        featureName: feat.htmlFeature,
      }),
      adapter: 'news-search',
      links: [bbc, GEO_NEWS_WIRE_NEWS],
      coverage: { from: '', through: '3d', exhaustive: false },
      fallback: false,
      note: 'BBC World and the news search returned no stories. No stories were invented.',
    });
  }

  // Geonomics — Global Trade: World Bank merchandise exports + trade/GDP for the HTML country set.
  if (/^global trade$/i.test(feat.htmlFeature || '')) {
    try {
      const live = await loadTrade();
      if (live.rows?.length) {
        return envelope({
          tier,
          feature: feat,
          rows: live.rows,
          adapter: 'live',
          links: ['https://data.worldbank.org/indicator/TX.VAL.MRCH.CD.WT'],
          coverage: { from: '', through: '', exhaustive: false },
          fallback: false,
          note: 'World Bank open data — merchandise exports and trade as a share of GDP. Cached up to 24 hours.',
          meta: {
            section: 'TRADE MONITOR — WORLD BANK OPEN DATA',
            status: 'LIVE · WORLD BANK · CACHED 24H',
            note: `${live.rows.length} economies · most recent published year`,
          },
        });
      }
    } catch (err) {
      return envelope({
        tier,
        feature: feat,
        rows: statusRow({
          adapter: 'api',
          url: 'https://api.worldbank.org/v2/country/all/indicator/TX.VAL.MRCH.CD.WT',
          reason: err.message || String(err),
          featureName: feat.htmlFeature,
        }),
        adapter: 'api',
        links: ['https://data.worldbank.org/'],
        coverage: { from: '', through: '', exhaustive: false },
        fallback: false,
        note: 'World Bank open-data API did not return rows. No trade figures were invented.',
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'api',
        url: 'https://api.worldbank.org/v2/country/all/indicator/TX.VAL.MRCH.CD.WT',
        reason: 'empty trade table',
        featureName: feat.htmlFeature,
      }),
      adapter: 'api',
      links: ['https://data.worldbank.org/'],
      coverage: { from: '', through: '', exhaustive: false },
      fallback: false,
      note: 'World Bank returned no trade rows. No figures were invented.',
    });
  }

  // Geonomics — Critical Minerals: curated USGS-basis register from the HTML live layer.
  if (/^critical minerals$/i.test(feat.htmlFeature || '')) {
    const pack = loadJsonPack('critical-minerals.json');
    const rows = (pack?.minerals || []).map(flattenMineralRef);
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: ['https://www.usgs.gov/centers/national-minerals-information-center'],
        coverage: { from: pack.asOf || '', through: pack.asOf || '', exhaustive: false },
        fallback: false,
        note: 'Curated supply-concentration register on a USGS Mineral Commodity Summaries basis. Not a live mine-output feed.',
        meta: {
          section: 'SUPPLY CONCENTRATION — CURATED REFERENCE',
          status: `CURATED · USGS MINERAL COMMODITY SUMMARIES BASIS · AS OF ${pack.asOf || '2025'}`,
          asOf: pack.asOf,
        },
      });
    }
  }

  // Geonomics — Energy: original HTML energy & critical minerals dossier (not GDELT, not Yahoo OHLC).
  if (/^energy$/i.test(feat.htmlFeature || '') || dataset === 'geo_energy') {
    const pack = loadJsonPack('energy.json');
    const rows = (pack?.minerals || []).map(flattenEnergyMineral);
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: ['https://www.usgs.gov/', 'https://www.eia.gov/', 'https://www.iea.org/topics/critical-minerals'],
        coverage: { from: pack.meta?.asOf || '', through: pack.meta?.asOf || '', exhaustive: false },
        fallback: false,
        kind: 'dossier',
        note: pack.stats?.note || 'Original HTML energy and critical-minerals register. Levels are as-of the pack date.',
        meta: {
          asOf: pack.meta?.asOf,
          stats: pack.stats,
          commodities: pack.commodities || [],
        },
      });
    }
  }

  // Diplomacy Sanctions: programme register + live OpenSanctions via /api/opensanctions.
  if (/^sanctions$/i.test(feat.htmlFeature || '')) {
    const pack = loadSanctionsPack();
    const rows = (pack?.programs || []).map((p) => flattenSanction(p));
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: [...new Set(rows.map((r) => r.source_url).filter(Boolean))],
        coverage: { from: pack.asOf || '', through: pack.asOf || '', exhaustive: false },
        fallback: false,
        kind: 'dossier',
        note: 'Original HTML sanctions programme register. Live OpenSanctions lists are served at /api/opensanctions.',
        timeline: pack.timeline || [],
        meta: { asOf: pack.asOf, stats: pack.stats, byTarget: pack.byTarget },
      });
    }
  }

  // Diplomacy Global Aid: appeal register + live OCHA FTS via /api/fts.
  if (/^global aid$/i.test(feat.htmlFeature || '')) {
    const pack = loadGlobalAidPack();
    const rows = (pack?.appeals || []).map((p) => flattenAppeal(p));
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: [...new Set(rows.map((r) => r.source_url).filter(Boolean))],
        coverage: { from: '', through: '', exhaustive: false },
        fallback: false,
        kind: 'dossier',
        note: 'Original HTML global aid appeal register. Live OCHA FTS is served at /api/fts.',
        meta: { wire: pack.wire || [] },
      });
    }
  }

  // Diplomacy Alliances: original HTML workbench register, not GDELT.
  if (/^alliances$/i.test(feat.htmlFeature || '')) {
    const pack = loadAlliancesPack();
    const rows = (pack?.alliances || []).map((p) => flattenAlliance(p, pack.memberFlags || {}));
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: [...new Set(rows.map((r) => r.source_url).filter(Boolean))],
        coverage: { from: pack.verified || '', through: pack.verified || '', exhaustive: true },
        fallback: false,
        kind: 'dossier',
        note: 'Original HTML alliance and bloc register. Source-linked dossiers, not GDELT.',
        meta: { verified: pack.verified, memberFlags: pack.memberFlags || {} },
      });
    }
  }

  // Global Intelligence: defence procurement register — never product-name news search.
  if (
    /^global intelligence$/i.test(feat.htmlFeature || '') ||
    /defence procurement intelligence/i.test(feat.htmlFeature || '') ||
    dataset === 'geopolitics_defense_procurement.csv' ||
    dataset === 'geopolitics_defense_procurement'
  ) {
    const raw = loadEmbedded('geopolitics_defense_procurement.csv') || [];
    const rows = raw.map((r) => ({
      ...r,
      title: r.title || r.program_name || r.name || '',
      program_name: r.program_name || r.title || r.name || '',
      country: r.country || r.vendor_or_origin || '',
      vendor_or_origin: r.vendor_or_origin || r.country || '',
      stage: r.stage || r.status || '',
      decision_date: r.decision_date || r.as_of || r.date || '',
      as_of: r.as_of || r.decision_date || r.date || '',
    }));
    if (rows.length) {
      const through =
        rows
          .map((r) => String(r.as_of || r.decision_date || '').slice(0, 10))
          .filter(Boolean)
          .sort()
          .slice(-1)[0] || '';
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: [],
        coverage: { from: '', through, exhaustive: false },
        fallback: false,
        kind: 'table',
        note: 'Defence procurement register (geopolitics_defense_procurement). Structured programmes, not a news search.',
      });
    }
  }

  // Open Fronts: war-tracker conflict register — never Google News / product-name search.
  if (
    /^open fronts$/i.test(feat.htmlFeature || '') ||
    dataset === 'geopolitics_war_tracker.csv' ||
    dataset === 'geopolitics_war_tracker'
  ) {
    const raw = loadEmbedded('geopolitics_war_tracker.csv') || [];
    const rows = raw.map((r) => ({
      ...r,
      title: r.title || r.conflict_name || r.name || '',
      conflict_name: r.conflict_name || r.title || r.name || '',
      current_stage: r.current_stage || r.status || '',
      last_verified: r.last_verified || r.as_of || r.updated || '',
      latest_development: r.latest_development || r.latest || '',
    }));
    if (rows.length) {
      const through =
        rows
          .map((r) => String(r.as_of || r.last_verified || '').slice(0, 10))
          .filter(Boolean)
          .sort()
          .slice(-1)[0] || '';
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: [],
        coverage: { from: '', through, exhaustive: false },
        fallback: false,
        kind: 'table',
        note: 'Open Fronts conflict register (geopolitics_war_tracker). Structured theatres, not a news search.',
      });
    }
  }

  // Conflicts Global monitor: original HTML dossier (NIY_GEO_CONFLICTS), not ReliefWeb/GDELT.
  if (dataset === 'geo_conflicts' || /^conflicts$/i.test(feat.htmlFeature || '')) {
    const pack = loadGeoConflictsPack();
    const rows = pack ? geoConflictRows(pack) : [];
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'embedded',
        links: dossierLinks(rows),
        coverage: {
          from: pack.meta?.asOf || '',
          through: pack.meta?.asOf || '',
          exhaustive: false,
        },
        fallback: false,
        kind: 'dossier',
        note: 'Original HTML Global monitor (NIY_GEO_CONFLICTS). Per-theatre dossier sources, not ReliefWeb or GDELT.',
        timeline: pack.timeline || [],
        meta: pack.meta || null,
      });
    }
  }

  // District Media Monitor: Google News RSS district / local-admin coverage, never the product name.
  if (/district media monitor/i.test(feat.htmlFeature || '') || dataset === 'up_district_media.csv') {
    const newsUrl = districtMediaNewsRssUrl();
    const archivePack = loadEmbedded('up_district_media.csv');

    const live = await tryUrls([newsUrl]);

    if (live.rows?.length) {
      return envelope({
        tier,
        feature: feat,
        rows: capRows(live.rows, false),
        adapter: 'news-search',
        links: [newsUrl],
        coverage: { from: '', through: '7d', exhaustive: false },
        fallback: false,
        note: 'Live Google News RSS — India district / local-admin coverage themes.',
        meta: {
          section: 'DISTRICT MEDIA — GOOGLE NEWS RSS',
          status: 'LIVE · NEWS RSS',
          heading: feat.htmlFeature,
          items: live.rows.length,
        },
      });
    }

    if (archivePack?.length) {
      return envelope({
        tier,
        feature: feat,
        rows: capRows(archivePack, false),
        adapter: 'embedded',
        links: [newsUrl],
        coverage,
        fallback: true,
        note: `Live district media wire failed (${live.error || 'empty'}). Showing last-known-good up_district_media pack.`,
      });
    }

    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'news-search',
        url: newsUrl,
        reason: live.error || 'empty district media wire',
        featureName: feat.htmlFeature,
      }),
      adapter: 'news-search',
      links: [newsUrl],
      coverage: { through: '7d' },
      fallback: false,
      note: 'District media wire returned no rows. No stories were invented.',
    });
  }

  // State Governance Brief: PIB and Google News RSS state-government coverage, never the product name.
  if (/^state governance brief$/i.test(feat.htmlFeature || '')) {
    const newsUrl = stateGovernanceNewsRssUrl();
    const pibUrl = PIB_PRESS_RSS;

    const pib = await tryUrls([pibUrl]);
    const wire = await tryUrls([newsUrl]);
    const wireNote = 'Google News RSS — state government / CM / Vidhan Sabha coverage';

    const pibRows = (pib.rows || []).slice(0, 40).map((r) => ({
      ...r,
      section: 'Government wire (PIB)',
      source: r.source || 'PIB',
    }));
    const wireRows = (wire.rows || []).slice(0, 100).map((r) => ({
      ...r,
      section: 'State coverage',
      reporting_search: 'Google News RSS — coverage mentions, not an official briefing',
    }));
    const rows = [...pibRows, ...wireRows];
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'news-search',
        links: [pibUrl, newsUrl],
        coverage: { from: '', through: '7d', exhaustive: false },
        fallback: false,
        note: `${pibRows.length} PIB · ${wireRows.length} state coverage (${wireNote}). Not a personalised governance digest.`,
        meta: {
          heading: 'State Governance Brief',
          pib: pibRows.length,
          wire: wireRows.length,
          status: 'LIVE · PIB / NEWS RSS',
        },
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'news-search',
        url: newsUrl,
        reason: pib.error || wire.error || 'empty state governance wire',
        featureName: feat.htmlFeature,
      }),
      adapter: 'news-search',
      links: [pibUrl, newsUrl],
      coverage: { through: '7d' },
      fallback: false,
      note: 'State Governance Brief wires returned no rows. No stories were invented.',
    });
  }

  // Centre–State Fund Flow: live Union Budget Statement 1 XLSX (not GDELT / news).
  if (/centre[-–]?state fund flow/i.test(feat.htmlFeature || '')) {
    try {
      const pack = await loadCentreStateFundFlow();
      if (pack.rows?.length) {
        return envelope({
          tier,
          feature: feat,
          rows: pack.rows,
          adapter: 'api',
          links: [STAT1_URL, 'https://www.indiabudget.gov.in/'],
          coverage: {
            from: '2024-25',
            through: '2026-27',
            exhaustive: false,
          },
          fallback: Boolean(pack.stale),
          kind: 'budget-xlsx',
          note: pack.stale
            ? `Cached Statement 1 (live download failed: ${pack.error}). ₹ crore as published.`
            : 'Live Union Budget Statement 1 (stat1.xlsx) — Expenditure Profile summary. ₹ crore. Transfer lines 5–8 are the centre→state block.',
          meta: {
            heading: 'Centre-State Fund Flow Tracker',
            section: 'STATEMENT 1 · SUMMARY OF EXPENDITURE',
            status: pack.stale ? 'CACHED · BUDGET XLSX' : 'LIVE · BUDGET XLSX',
            profile: pack.profile,
            unit: pack.unit,
            sheet: pack.sheet,
            fetched_at: pack.fetched_at,
          },
        });
      }
    } catch (err) {
      return envelope({
        tier,
        feature: feat,
        rows: statusRow({
          adapter: 'api',
          url: STAT1_URL,
          reason: err.message || String(err),
          featureName: feat.htmlFeature,
        }),
        adapter: 'api',
        links: [STAT1_URL],
        coverage,
        fallback: false,
        note: 'Union Budget stat1.xlsx could not be downloaded or parsed. No figures were invented.',
      });
    }
  }

  // State MLA Directory: Wikidata Indian legislators (never US House Q13218630).
  if (/^mla directory$/i.test(feat.htmlFeature || '')) {
    const MLA_WD = indiaMlaWikidataUrl();
    const live = await tryUrls([MLA_WD, primary].filter(Boolean));
    // F190: the source lists every state; a request that names one (the page's State picker) gets that
    // state's members only, and a plain status row when the source has none of them.
    const wantState = mlaStateVariant(searchParams.get('state'));
    const members = wantState ? live.rows.filter((r) => mlaStateVariant(r.state || r.stateLabel) === wantState) : live.rows;
    if (wantState && !members.length) {
      const [offline] = statusRow({ adapter: 'api', url: MLA_WD, reason: live.error || `Wikidata SPARQL returned no legislators of ${wantState}`, featureName: feat.htmlFeature });
      return envelope({
        tier,
        feature: feat,
        rows: [{ ...offline, title: `${wantState}\u2019s list isn\u2019t available right now`, detail: `The list of ${wantState} MLAs is not available right now. No records were invented.` }],
        adapter: 'api',
        links: [MLA_WD],
        coverage,
        fallback: false,
        note: 'MLA Directory uses Wikidata SPARQL (Indian jurisdictions). No rows were invented.',
      });
    }
    if (members.length) {
      return envelope({
        tier,
        feature: feat,
        rows: capRows(members, false),
        adapter: 'api',
        links: [MLA_WD, 'https://query.wikidata.org/'],
        coverage: { from: '', through: 'present', exhaustive: false },
        fallback: false,
        note:
          'Wikidata live directory of people holding Indian state legislative positions (jurisdiction in India). Not a complete electoral roll.',
        meta: { heading: 'MLA Directory', items: members.length, source: 'wikidata' },
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'api',
        url: MLA_WD,
        reason: live.error || 'Wikidata SPARQL returned no Indian legislators',
        featureName: feat.htmlFeature,
      }),
      adapter: 'api',
      links: [MLA_WD],
      coverage,
      fallback: false,
      note: 'MLA Directory uses Wikidata SPARQL (Indian jurisdictions). No rows were invented.',
    });
  }

  // MLA Report Card + Statement Tracker: never search the product name.
  // Profiles from Wikidata; coverage wire from Google News RSS.
  if (/mla report card/i.test(feat.htmlFeature || '')) {
    const MLA_WD = indiaMlaWikidataUrl();
    const newsUrl = mlaCoverageNewsRssUrl();
    const pack = loadEmbedded('up_mla_report_card.csv');
    const profiles = pack?.length
      ? {
          rows: pack.map((r) =>
            flattenRow(r, {
              title: r.mla_name || r.name || r.title || '',
              section: 'MLA profiles',
            }),
          ),
          source: 'embedded',
        }
      : await tryUrls([MLA_WD]).then((got) => ({
          rows: (got.rows || []).map((r) => ({
            ...r,
            mla_name: r.title || r.person || '',
            section: 'MLA profiles',
          })),
          source: got.rows?.length ? 'wikidata' : '',
          error: got.error,
        }));

    const wire = await tryUrls([newsUrl]);
    const wireNote = 'Google News RSS MLA/assembly coverage';
    const wireRows = (wire.rows || []).map((r) => ({
      ...r,
      section: 'Statement / coverage wire',
      reporting_search: 'Google News RSS — coverage mentions, not an official scorecard',
    }));

    const profileRows = (profiles.rows || []).slice(0, 400);
    const wireLimited = wireRows.slice(0, 100);
    const rows = [...profileRows, ...wireLimited];
    if (rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: profiles.source === 'embedded' ? 'embedded' : 'api',
        links: [MLA_WD, newsUrl].filter(Boolean),
        coverage: { from: '', through: 'present', exhaustive: false },
        fallback: false,
        note:
          `${profileRows.length} MLA profiles (${profiles.source || 'none'}) · ${wireLimited.length} coverage rows (${wireNote}). ` +
          'Not a complete attendance/questions meter — UP pack is empty on disk; Wikidata supplies identities.',
        meta: {
          heading: 'MLA Report Card + Statement Tracker',
          profiles: profileRows.length,
          wire: wireLimited.length,
          profileSource: profiles.source || '',
        },
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'api',
        url: MLA_WD,
        reason: profiles.error || wire.error || 'no MLA profiles or coverage rows',
        featureName: feat.htmlFeature,
      }),
      adapter: 'api',
      links: [MLA_WD, newsUrl],
      coverage,
      fallback: false,
      note: 'MLA Report Card uses Wikidata profiles + Google News RSS coverage. No rows were invented.',
    });
  }

  const archive = loadEmbedded(dataset);

  if (tier === 'national') {
    const nat = await serveNational({
      // F169 T3: the Statement Tracker's leader; only a listed leader is accepted.
      person: statementLeader(searchParams.get('person')),
      feat,
      dataset,
      adapter,
      primary,
      links,
      coverage,
      loadEmbedded,
      tryUrls,
      capRows,
      envelope,
      statusRow,
    });
    if (nat) return nat;
  }

  // A module with no registry row whose feature-map entry says `"route": "news-topic"` is answered by its
  // Google News topic search, with PIB where it fits. The marker decides, not the entry's `source` (F189):
  // a rename or a change to TOPIC_STOP moves the search address and leaves the route. A module with a
  // registry row reads its own sources. (Before F180 the feature map held a GDELT search here, read only
  // to choose this route; GDELT is not asked.)
  {
    const skipGeoDataset = dataset && /^geo_/i.test(dataset);
    const rewrite = !skipGeoDataset && !entry && feat.route === NEWS_TOPIC_ROUTE;

    if (rewrite) {
      const newsUrl = newsRssUrlForFeature(feat.htmlFeature);
      const pibUrl = wantsPibWire(feat.htmlFeature) ? PIB_PRESS_RSS : '';

      const pib = pibUrl ? await tryUrls([pibUrl]) : { rows: [] };
      const wire = await tryUrls([newsUrl]);
      const wireNote = 'Google News RSS topic search';

      const pibRows = (pib.rows || []).slice(0, 30).map((r) => ({
        ...r,
        section: 'Government wire (PIB)',
        source: r.source || 'PIB',
      }));
      const wireRows = (wire.rows || []).slice(0, 100).map((r) => ({
        ...r,
        section: 'Coverage wire',
        reporting_search: 'Google News RSS — coverage mentions, not an official dataset',
      }));
      const rows = [...pibRows, ...wireRows];
      if (rows.length) {
        return envelope({
          tier,
          feature: feat,
          rows,
          adapter: 'news-search',
          links: [pibUrl, newsUrl].filter(Boolean),
          coverage: { from: '', through: '7d', exhaustive: false },
          fallback: false,
          note: `${pibRows.length ? `${pibRows.length} PIB · ` : ''}${wireRows.length} coverage rows (${wireNote}).`,
          meta: {
            heading: feat.htmlFeature,
            pib: pibRows.length,
            wire: wireRows.length,
            status: 'LIVE · NEWS RSS',
          },
        });
      }
      if (archive && archive.length) {
        return envelope({
          tier,
          feature: feat,
          rows: capRows(archive, isBills),
          adapter: 'embedded',
          links: [newsUrl],
          coverage,
          fallback: true,
          note: `Live topic wire failed (${wire.error || pib.error || 'empty'}). Showing last-known-good archive.`,
        });
      }
      return envelope({
        tier,
        feature: feat,
        rows: statusRow({
          adapter: 'news-search',
          url: newsUrl,
          reason: wire.error || pib.error || 'empty topic wire',
          featureName: feat.htmlFeature,
        }),
        adapter: 'news-search',
        links: [newsUrl],
        coverage: { through: '7d' },
        fallback: false,
        note: 'Topic news wire returned no rows. No records were invented.',
      });
    }
  }

  // Wave C: scrape / licensed / download-or-html / internal / unmapped — no live table.
  if (!entry || STATUS_ADAPTERS.has(adapter) || !LIVE_ADAPTERS.has(adapter)) {
    if (archive && archive.length) {
      return envelope({
        tier,
        feature: feat,
        rows: capRows(archive, isBills),
        adapter: adapter || 'unmapped',
        links,
        coverage,
        fallback: true,
        note: `${adapter || 'unmapped'} adapter: live extraction is not scheduled. Showing last-known-good archive only.`,
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: adapter || 'unmapped',
        url: primary || links[0] || '',
        reason: 'extraction not scheduled',
        featureName: feat.htmlFeature,
      }),
      adapter: adapter || 'unmapped',
      links,
      coverage,
      fallback: false,
      note: 'Live extraction is not scheduled for this adapter. No records were invented.',
    });
  }

  // Bill Passage: never use GDELT as a bill table. Merge live Sansad into exhaustive archive.
  if (adapter === 'bill-history') {
    const live = primary ? await tryUrls([primary]) : { rows: [] };
    if (archive && archive.length) {
      const rows = live.rows.length ? mergeBills(archive, live.rows) : archive;
      return envelope({
        tier,
        feature: feat,
        rows,
        adapter: 'bill-history',
        links,
        coverage: { from: '1952-01-01', through: 'present', exhaustive: true },
        fallback: !live.rows.length,
        note: live.rows.length
          ? 'Sansad live page merged into the 1952–present local archive (Sansad 1952–2016 + PRS 2017–present).'
          : 'Sansad live feed failed. Showing the 4,576-row last-known-good archive. Exhaustive coverage is the archive, not a news search.',
        meta: {
          section: 'BILL PASSAGE INDEX',
          status: live.rows.length ? 'LIVE · SANSAD MERGED INTO ARCHIVE' : 'ARCHIVE · 4,576 BILLS · 1952–PRESENT',
          heading: 'BILL PASSAGE INDEX',
        },
      });
    }
    if (live.rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows: live.rows,
        adapter: 'bill-history',
        links,
        coverage: { from: '', through: 'present', exhaustive: false },
        fallback: false,
        note: 'Sansad live page only — local exhaustive archive was not found on disk.',
      });
    }
    return envelope({
      tier,
      feature: feat,
      rows: statusRow({
        adapter: 'bill-history',
        url: primary,
        reason: 'Sansad live feed failed and no local archive was found',
        featureName: feat.htmlFeature,
      }),
      adapter: 'bill-history',
      links,
      coverage,
      fallback: false,
    });
  }

  const format = (entry?.format || '').toUpperCase();
  const skipBinary = format === 'XLSX' || format === 'XLS';
  const liveUrls = [];
  if (primary && !skipBinary) liveUrls.push(primary);
  // A registry row's `openLiveFallback` names its Google News topic search (newsRssUrlForFeature): the
  // answer when the live table and the archive give nothing. News-search rows always fall back to it.
  const newsFallback =
    Boolean(openLiveFallback) &&
    (adapter === 'news-search' || adapter === 'api' || adapter === 'source-library' || adapter === 'embedded');

  const live = liveUrls.length ? await tryUrls(liveUrls) : { rows: [] };
  if (live.rows.length) {
    return envelope({
      tier,
      feature: feat,
      rows: capRows(live.rows, false),
      adapter,
      links,
      coverage,
      fallback: false,
      note: `Live ${adapter} feed.`,
    });
  }

  if (archive && archive.length) {
    return envelope({
      tier,
      feature: feat,
      rows: capRows(archive, isBills),
      adapter: adapter === 'news-search' ? 'embedded' : adapter,
      links,
      coverage,
      fallback: Boolean(liveUrls.length),
      note: live.error
        ? `Live feed failed (${live.error}). Showing the original HTML dataset.`
        : 'Original HTML dataset.',
    });
  }

  if (newsFallback) {
    const newsUrl = newsRssUrlForFeature(feat.htmlFeature);
    const news = await tryUrls([newsUrl]);
    if (news.rows.length) {
      return envelope({
        tier,
        feature: feat,
        rows: capRows(news.rows, false),
        adapter: 'news-search',
        links: [newsUrl],
        coverage: { from: '', through: '7d', exhaustive: false },
        fallback: false,
        note: 'Google News topic search. Reporting, not an official dataset.',
        meta: { heading: feat.htmlFeature, status: 'LIVE · NEWS RSS' },
      });
    }
  }

  return envelope({
    tier,
    feature: feat,
    rows: statusRow({
      adapter,
      url: primary || openLiveFallback || links[0] || '',
      reason: shortFail(live.error) || (skipBinary ? 'spreadsheet extraction not scheduled' : 'no live rows and no archive'),
      featureName: feat.htmlFeature,
    }),
    adapter,
    links,
    coverage,
    fallback: false,
    note: newsFallback
      ? 'The news search returned nothing. No records were invented.'
      : 'No live rows and no last-known-good archive. Status row only — no records invented.',
  });
}

function isGithubRawCsv(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' && u.hostname === 'raw.githubusercontent.com' && /\.csv$/i.test(u.pathname);
  } catch {
    return false;
  }
}

async function serveCsvTable(searchParams) {
  const url = searchParams.get('url') || '';
  if (!isGithubRawCsv(url)) {
    return { ok: false, error: 'Only raw GitHub CSV URLs are accepted.', rows: [], total: 0 };
  }
  const got = await fetchText(url);
  const all = parseCsv(got.text, 2000);
  const rawLines = got.text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim()).length;
  const total = Math.max(0, rawLines - 1);
  return {
    ok: true,
    url,
    rows: all,
    total,
    truncated: total > all.length,
    note: total > all.length ? `Showing ${all.length} of ${total} rows.` : '',
  };
}

function bodyHasRealRows(body) {
  const rows = body?.rows || [];
  if (!rows.length) return false;
  return rows[0]?.status !== 'source_status';
}

/** Last resort: exhaustive backup/{DESK} XLSX when live + archive are empty. */
function applyBackupFallback(body, searchParams) {
  if (bodyHasRealRows(body)) return body;
  // F173 review: a planned module stays planned; no stored rows are borrowed for it.
  if (body?.source?.adapter === 'planned') return body;
  const featureName =
    (typeof body?.feature === 'string' && body.feature) ||
    searchParams.get('feature') ||
    '';
  const tier = body?.tier || searchParams.get('tier') || '';
  if (!featureName) return body;
  // F190: the backup pack lists every state (capped at MAX_ROWS), so a state's request keeps the answer it has.
  if (/^mla directory$/i.test(featureName.trim()) && mlaStateVariant(searchParams.get('state'))) return body;
  let pack;
  try {
    pack = loadBackupForFeature(featureName, tier, { cap: MAX_ROWS });
  } catch (err) {
    // F159 review: the message can name a file on the server, so it goes to the log only.
    console.warn(`[feature-feed] backup pack for ${tier || 'desk'} / ${featureName} failed to load:`, err?.message || String(err));
    return {
      ...body,
      source: {
        ...(body?.source || {}),
        // F159: kept out of the note a reader sees.
        diagnostic: publicDiagnostic(body?.source?.diagnostic, 'backup-error'),
      },
    };
  }
  if (!pack?.rows?.length) return body;
  // Stored rows: the edge keeps this answer as briefly as any other archive answer (F156).
  const backup = envelope({
    tier,
    feature: featureName,
    rows: pack.rows,
    adapter: 'embedded',
    links: (pack.meta?.files || []).map((f) => `/backup/${String(tier || 'desk')}/${f}`),
    coverage: {
      from: '',
      through: 'backup',
      exhaustive: true,
    },
    fallback: true,
    kind: 'backup-pack',
    note: pack.note,
    meta: pack.meta,
  });
  // F159: why live and archive had no rows stays available for debugging, and a failed live attempt
  // stays marked so the page does not retry it as slow.
  const diagnostic = publicDiagnostic(body?.source?.diagnostic);
  const source = {
    ...backup.source,
    ...(diagnostic ? { diagnostic } : {}),
    ...(body?.source?.liveFailed === true ? { liveFailed: true } : {}),
  };
  return { ...backup, source, served: 'archive' };
}

// F154: the whole live attempt for one request, across every source it tries. Past it the
// request answers from the stored archive instead of waiting (measured 2026-10-14: 9-60 s).
export const LIVE_TIME_LIMIT_MS = 4000;
// The archive pass reads files only; this bounds it in case a branch still waits on something.
const ARCHIVE_TIME_LIMIT_MS = 3000;
// A live answer that arrived after its request gave up is served to later requests this long.
const LATE_LIVE_MS = 10 * 60_000;
// Per instance; keyed by the inputs serveFeatureFeed reads (tier, feature, the Statement Tracker's leader and MLA Directory's state).
const liveInFlight = new Map();
const lateLive = new Map();

function liveKey(searchParams) {
  const person = searchParams.get('person');
  // F190: MLA Directory's live branch keeps one state's members, so a state's answer is its own. Only on
  // the state tier (where MLA Directory and its aliases live), so `?state=` on any other module cannot
  // start extra live attempts.
  const state = searchParams.get('tier') === 'state' ? mlaStateVariant(searchParams.get('state')) : '';
  return `${searchParams.get('tier') || ''}\u0000${searchParams.get('feature') || ''}${person ? `\u0000${statementLeader(person)}` : ''}${state ? `\u0000${state}` : ''}`;
}

function settleWithin(promise, ms) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ state: 'late' }), ms);
  });
  const settled = promise.then(
    (value) => ({ state: 'done', value }),
    (error) => ({ state: 'failed', error }),
  );
  return Promise.race([settled, late]).finally(() => clearTimeout(timer));
}

// One live attempt per feed at a time: a caller that arrives while it runs shares it.
function startLive(key, searchParams, live) {
  const running = liveInFlight.get(key);
  if (running) return running;
  const attempt = Promise.resolve().then(() => live(searchParams));
  liveInFlight.set(key, attempt);
  attempt
    .then(
      (body) => {
        if (bodyHasRealRows(body)) lateLive.set(key, { at: Date.now(), body });
      },
      () => {},
    )
    .finally(() => {
      if (liveInFlight.get(key) === attempt) liveInFlight.delete(key);
    });
  return attempt;
}

// F159: what a reader sees when the request answers from stored records (`source.note`). The
// technical reason stays in `source.diagnostic`, which no screen shows.
export const ARCHIVE_NOTES = {
  slowStored: 'Showing the latest stored records. Live data is still loading.',
  failedStored: 'The live source isn\u2019t responding. Showing the latest stored records.',
  slowEmpty: 'Live data is taking longer than usual.',
  failedEmpty: 'The live source isn\u2019t responding.',
};

// F159 review: `source.diagnostic` is part of the public answer, so it holds only codes from this list
// (joined with ' \u00b7 '), never an error message, which can name a server file or URL. The raw reason
// goes to the server log (console.warn).
export const DIAGNOSTIC_CODES = Object.freeze(['timeout', 'upstream-error', 'no-stored-records', 'backup-error']);

function publicDiagnostic(...parts) {
  const codes = parts.flatMap((p) => String(p || '').split(' \u00b7 ')).filter((c) => DIAGNOSTIC_CODES.includes(c));
  return [...new Set(codes)].join(' \u00b7 ');
}

// `code` is 'timeout' or 'upstream-error'; `failed` marks the answer `source.liveFailed`, which the
// page reads as "not worth retrying soon" (src/desks/moduleLiveRetry.js).
async function serveArchiveFor(searchParams, code, failed) {
  const marked = failed ? { liveFailed: true } : {};
  const archived = await settleWithin(
    archivePass.run(true, () => serveFeatureFeed(searchParams)),
    ARCHIVE_TIME_LIMIT_MS,
  );
  if (archived.state !== 'done') {
    const feature = searchParams.get('feature') || '';
    return {
      ok: false,
      tier: resolveTier(searchParams.get('tier') || ''),
      feature,
      rows: statusRow({ adapter: 'api', url: '', reason: failed ? 'live feed unavailable' : 'timed out', featureName: feature }),
      source: {
        adapter: 'api',
        links: [],
        note: failed ? ARCHIVE_NOTES.failedEmpty : ARCHIVE_NOTES.slowEmpty,
        diagnostic: publicDiagnostic(code, 'no-stored-records'),
        ...marked,
      },
      coverage: { from: '', through: '', exhaustive: false },
      fallback: false,
      served: 'archive',
    };
  }
  const body = archived.value;
  const stored = bodyHasRealRows(body);
  return {
    ...body,
    served: 'archive',
    fallback: stored ? true : Boolean(body?.fallback),
    source: {
      ...(body?.source || {}),
      note: stored
        ? failed ? ARCHIVE_NOTES.failedStored : ARCHIVE_NOTES.slowStored
        : failed ? ARCHIVE_NOTES.failedEmpty : ARCHIVE_NOTES.slowEmpty,
      diagnostic: publicDiagnostic(code),
      ...marked,
    },
  };
}

/**
 * serveFeatureFeed with a time limit (F154). Answers `served: 'live'` when the live attempt
 * finished in time (its own `fallback` still says whether a live source failed inside it), and
 * `served: 'archive'` when the limit passed or the attempt threw; the attempt keeps running and
 * a later request can use its answer.
 */
export async function serveFeatureFeedWithinLimit(
  searchParams,
  { limitMs = LIVE_TIME_LIMIT_MS, live = serveFeatureFeed } = {},
) {
  const key = liveKey(searchParams);
  const outcome = await settleWithin(startLive(key, searchParams, live), limitMs);
  if (outcome.state === 'done') return { ...outcome.value, served: 'live' };
  const kept = lateLive.get(key);
  if (kept && Date.now() - kept.at < LATE_LIVE_MS) {
    return { ...kept.body, served: 'live', liveAt: new Date(kept.at).toISOString() };
  }
  const failed = outcome.state === 'failed';
  if (failed) {
    // F159 review: the raw reason is for the server log; the answer carries a code.
    console.warn(
      `[feature-feed] live attempt failed for ${searchParams.get('tier') || ''} / ${searchParams.get('feature') || ''}:`,
      outcome.error?.message || String(outcome.error),
    );
  }
  return serveArchiveFor(searchParams, failed ? 'upstream-error' : 'timeout', failed);
}

/**
 * F156: the feed within its time limit, then the backup pack when live and archive have no rows.
 * The Vite middleware and api/router.js both answer /api/feature-feed and the National, Global,
 * Law and State landings through this, so the local and deployed servers answer the same way.
 */
export async function serveFeatureFeedWithBackup(searchParams, options) {
  return applyBackupFallback(await serveFeatureFeedWithinLimit(searchParams, options), searchParams);
}

/**
 * The schedule id (`tier:feature`, server/feedSchedule.mjs) of the module a request names, resolved
 * as the loader resolves it (tier aliases, spelling, the feature map's own tier), or '' when the
 * module is not served from the store (neither scheduled nor a register module, C6 option 1).
 */
export function scheduledModuleId(searchParams) {
  const tier = searchParams.get('tier') || '';
  const feature = searchParams.get('feature') || '';
  if (!feature.trim() || resolveTier(tier) === 'home') return '';
  const { feat } = matchFeature(tier, feature);
  if (!feat) return '';
  const id = `${feat.htmlTier}:${feat.htmlFeature}`;
  return isStoreServed(id) ? id : '';
}

/**
 * F169 phase 4 (C4): what /api/feature-feed answers. A scheduled module is read from the feed store
 * first (server/feedServe.mjs): that is the normal path, so it skips the live attempt and the backup
 * pass. When the store has nothing to serve (not configured, an error or timeout, no state, `serve`
 * off, no items) the answer is today's: serveFeatureFeedWithBackup. The landing summaries do not use
 * this; they still call serveFeatureFeedWithBackup or serveFeatureFeedWithinLimit directly.
 * Paged modules (Bills, Parliamentary Questions) are not scheduled and keep serveFeaturePage.
 */
export async function serveFeatureFeedStoredFirst(searchParams, { store = serveFromStore, ...options } = {}) {
  const id = scheduledModuleId(searchParams);
  if (id) {
    try {
      const stored = await store(id, searchParams);
      if (stored) return stored;
    } catch {
      // The live path answers.
    }
  }
  return serveFeatureFeedWithBackup(searchParams, options);
}

export async function handleFeatureFeedRequest(req, res, next) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  if (url.pathname === '/api/national-landing' || url.pathname === '/api/global-landing' || url.pathname === '/api/law-landing' || url.pathname === '/api/economics-landing' || url.pathname === '/api/carbon-landing' || url.pathname === '/api/sports-landing' || url.pathname === '/api/entertainment-landing' || url.pathname === '/api/state-landing') {
    const state = url.pathname === '/api/state-landing';
    const global = url.pathname === '/api/global-landing';
    const law = url.pathname === '/api/law-landing';
    const economics = url.pathname === '/api/economics-landing';
    const carbon = url.pathname === '/api/carbon-landing';
    const sports = url.pathname === '/api/sports-landing';
    const entertainment = url.pathname === '/api/entertainment-landing';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: 'GET only' }));
      return;
    }
    try {
      const body = await (state ? serveStateLanding : entertainment ? serveEntertainmentLanding : sports ? serveSportsLanding : carbon ? serveCarbonLanding : economics ? serveEconomicsLanding : law ? serveLawLanding : global ? serveGlobalLanding : serveNationalLanding)(url.searchParams, (economics || carbon || sports || entertainment) ? serveFeatureFeedWithinLimit : serveFeatureFeedWithBackup);
      res.statusCode = body.ok ? 200 : 502;
      res.end(JSON.stringify(body));
    } catch (err) {
      res.statusCode = err.message === `Unknown ${state ? 'State' : entertainment ? 'Entertainment' : sports ? 'Sports' : carbon ? 'Carbon' : economics ? 'Economics' : law ? 'Law' : global ? 'Global' : 'National'} module` ? 400 : 502;
      res.end(JSON.stringify({ ok: false, error: `${state ? 'State' : entertainment ? 'Entertainment' : sports ? 'Sports' : carbon ? 'Carbon' : economics ? 'Economics' : law ? 'Law' : global ? 'Global' : 'National'} summary unavailable` }));
    }
    return;
  }
  if (url.pathname === '/api/csv-table') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'GET only' }));
      return;
    }
    try {
      const body = await serveCsvTable(url.searchParams);
      const json = JSON.stringify(body);
      res.statusCode = body.ok ? 200 : 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'HEAD') res.end();
      else res.end(json);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: err.message || String(err), rows: [] }));
    }
    return;
  }
  if (url.pathname !== '/api/feature-feed') {
    next();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'GET only' }));
    return;
  }
  try {
    // F156: a page of a large module when `page` is asked for; otherwise the whole answer, as before.
    const { status, body } = wantsPage(url.searchParams)
      ? await serveFeaturePage(url.searchParams, serveFeatureFeedWithBackup)
      : { status: 200, body: await serveFeatureFeedStoredFirst(url.searchParams) };
    const json = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'HEAD') res.end();
    else res.end(json);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
  }
}

export function featureFeedPlugin() {
  return {
    name: 'niyantran-feature-feed',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleFeatureFeedRequest(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleFeatureFeedRequest(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
