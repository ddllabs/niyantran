/**
 * Economics live proxies — World Bank, Yahoo index quotes, Manifold, Wikidata.
 * No GDELT. No market cap. PMI is licensed and is not fetched.
 */
import { mapManifoldLive, mapWikidataCeos, WORLD_BOARD, yahooQuoteRow } from '../src/lib/econPack.js';
import { cacheFresh, cacheWritable } from './loaderCache.mjs';

const UA = 'Mozilla/5.0 (compatible; NiyantranTerminal/1.0; Economics)';
const FETCH_MS = 25_000;
const SPARQL_MS = 45_000;
const TTL = 24 * 60 * 60 * 1000;
const STOOQ_TTL = 15 * 60 * 1000;
const MANIFOLD_TTL = 15 * 60 * 1000;

// F169 T7: Indian companies of five named types (enterprise, public company, business,
// company, multinational) with a chief executive. The earlier `wdt:P31/wdt:P279*` subclass walk
// timed out at Wikidata (HTTP 504 after 67 s); this answers in about 3.3 s uncached (2026-10-14).
const WD_Q =
  'SELECT DISTINCT ?person ?personLabel ?company ?companyLabel WHERE { ' +
  '?company wdt:P17 wd:Q668; wdt:P169 ?person; wdt:P31 ?type. ' +
  'VALUES ?type { wd:Q4830453 wd:Q891723 wd:Q6881511 wd:Q783794 wd:Q161726 } ' +
  'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 500';
const WIKIDATA = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(WD_Q)}`;

let gdpCache = null;
let gdpAt = 0;
let keyCache = null;
let keyAt = 0;
let energyCache = null;
let energyAt = 0;
let stooqCache = null;
let stooqAt = 0;
let manCache = null;
let manAt = 0;
let ceoCache = null;
let ceoAt = 0;
let iso2Set = null;

async function getJson(url, extraHeaders = {}, timeoutMs = FETCH_MS) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA, ...extraHeaders },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function fmt1(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(1);
}

function fmtGdpBn(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return (n / 1e9).toFixed(1);
}

async function countryIso2() {
  if (iso2Set) return iso2Set;
  try {
    const j = await getJson('https://api.worldbank.org/v2/country?format=json&per_page=400');
    const list = Array.isArray(j?.[1]) ? j[1] : [];
    iso2Set = new Set(
      list.filter((c) => c.region?.id && c.region.id !== 'NA').map((c) => c.iso2Code || c.id),
    );
  } catch {
    iso2Set = null;
  }
  return iso2Set;
}

async function wbAll(ind) {
  const base = `https://api.worldbank.org/v2/country/all/indicator/${ind}?format=json&mrv=1&per_page=300`;
  const first = await getJson(`${base}&page=1`);
  const meta = Array.isArray(first) ? first[0] : {};
  let rows = Array.isArray(first?.[1]) ? first[1] : [];
  const pages = Math.min(Number(meta?.pages) || 1, 8);
  for (let p = 2; p <= pages; p++) {
    const j = await getJson(`${base}&page=${p}`);
    if (Array.isArray(j?.[1])) rows = rows.concat(j[1]);
  }
  const allowed = await countryIso2();
  return rows.filter((r) => {
    if (!r || r.value == null || !r.country?.value) return false;
    if (allowed) return allowed.has(r.country?.id);
    const name = r.country.value;
    return (
      r.countryiso3code &&
      r.countryiso3code.length === 3 &&
      !/income|OECD|World|dividend|IBRD|IDA |Euro area|Arab World|small states|least developed|Sub-Saharan|Latin America|East Asia|South Asia|North America|European Union|Fragile|classified|demographic/i.test(
        name,
      )
    );
  });
}

function wbMap(list) {
  const out = {};
  for (const r of list) {
    const name = r?.country?.value;
    if (!name || r.value == null) continue;
    out[name] = { v: r.value, y: r.date, iso: r.countryiso3code || '' };
  }
  return out;
}

export async function loadCountryEconomies() {
  if (gdpCache && cacheFresh(gdpAt, TTL)) return gdpCache;
  const list = await wbAll('NY.GDP.MKTP.CD');
  const rows = list
    .map((r) => ({
      title: r.country?.value || '',
      country: r.country?.value || '',
      iso3: r.countryiso3code || '',
      year: r.date || '',
      gdp_usd_bn: fmtGdpBn(r.value),
      gdp_raw: r.value,
      source_url: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD',
    }))
    .filter((r) => r.country)
    .sort((a, b) => (b.gdp_raw || 0) - (a.gdp_raw || 0));
  const fresh = { ok: true, source: 'world-bank', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    gdpCache = fresh;
    gdpAt = Date.now();
  }
  return fresh;
}

export async function loadKeyIndicators() {
  if (keyCache && cacheFresh(keyAt, TTL)) return keyCache;
  const [gdp, cpi, emp] = await Promise.all([
    wbAll('NY.GDP.MKTP.KD.ZG'),
    wbAll('FP.CPI.TOTL.ZG'),
    wbAll('SL.EMP.TOTL.SP.ZS'),
  ]);
  const g = wbMap(gdp);
  const c = wbMap(cpi);
  const e = wbMap(emp);
  const rows = Object.keys(g)
    .map((name) => ({
      title: name,
      country: name,
      year: g[name].y || '',
      gdp_growth: fmt1(g[name].v),
      inflation: fmt1(c[name]?.v) || '—',
      emp_to_pop: fmt1(e[name]?.v) || '—',
      source_url: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG',
    }))
    .sort((a, b) => Number(b.gdp_growth) - Number(a.gdp_growth));
  const fresh = { ok: true, source: 'world-bank', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    keyCache = fresh;
    keyAt = Date.now();
  }
  return fresh;
}

export async function loadIndiaEnergy() {
  if (energyCache && cacheFresh(energyAt, TTL)) return energyCache;
  const url =
    'https://api.worldbank.org/v2/country/IND/indicator/EG.ELC.ACCS.ZS?format=json&date=2000:2030&per_page=100';
  const j = await getJson(url);
  const list = Array.isArray(j?.[1]) ? j[1] : [];
  const rows = list
    .filter((r) => r && r.value != null)
    .map((r) => ({
      title: `India electricity access ${r.date}`,
      country: 'India',
      year: r.date || '',
      indicator: r.indicator?.value || 'Access to electricity (% of population)',
      value: fmt1(r.value),
      source_url: 'https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS',
    }))
    .sort((a, b) => String(b.year).localeCompare(String(a.year)));
  const fresh = { ok: true, source: 'world-bank', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    energyCache = fresh;
    energyAt = Date.now();
  }
  return fresh;
}

let indiaGdpCache = null;
let indiaGdpAt = 0;

/** India annual GDP growth (NY.GDP.MKTP.KD.ZG) — baseline series for Economic Simulator. */
export async function loadIndiaGdpGrowth() {
  if (indiaGdpCache && cacheFresh(indiaGdpAt, TTL)) return indiaGdpCache;
  const url =
    'https://api.worldbank.org/v2/country/IND/indicator/NY.GDP.MKTP.KD.ZG?format=json&date=1990:2030&per_page=100';
  const j = await getJson(url);
  const list = Array.isArray(j?.[1]) ? j[1] : [];
  const rows = list
    .filter((r) => r && r.value != null && r.date)
    .map((r) => {
      const growth = Number(r.value);
      return {
        title: `India GDP growth ${r.date}`,
        country: 'India',
        iso3: r.countryiso3code || 'IND',
        year: String(r.date),
        date: String(r.date),
        indicator: r.indicator?.value || 'GDP growth (annual %)',
        indicator_id: r.indicator?.id || 'NY.GDP.MKTP.KD.ZG',
        value: Number.isFinite(growth) ? Math.round(growth * 100) / 100 : null,
        gdp_growth_pct: Number.isFinite(growth) ? Math.round(growth * 100) / 100 : null,
        unit: 'annual %',
        source_url: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG',
        lastupdated: Array.isArray(j?.[0]) ? j[0]?.lastupdated : j?.[0]?.lastupdated || '',
      };
    })
    .sort((a, b) => String(b.year).localeCompare(String(a.year)));
  const fresh = { ok: true, source: 'world-bank', rows, lastupdated: rows[0]?.lastupdated || '' };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    indiaGdpCache = fresh;
    indiaGdpAt = Date.now();
  }
  return fresh;
}

function yahooChartUrl(symbol) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
}

export async function loadWorldExchanges() {
  if (stooqCache && cacheFresh(stooqAt, STOOQ_TTL)) return stooqCache;
  const rows = [];
  for (const item of WORLD_BOARD) {
    try {
      const json = await getJson(yahooChartUrl(item.symbol));
      const row = yahooQuoteRow({ ...item, json });
      if (row) rows.push(row);
    } catch {
      /* skip a venue that did not return a last quote */
    }
  }
  const fresh = { ok: true, source: 'yahoo', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    stooqCache = fresh;
    stooqAt = Date.now();
  }
  return fresh;
}

const MANIFOLD_SEARCH = [
  'https://api.manifold.markets/v0/search-markets?term=election&limit=100',
  'https://api.manifold.markets/v0/search-markets?term=politics&limit=100',
  'https://api.manifold.markets/v0/search-markets?term=geopolitics&limit=50',
];

export async function loadManifoldPolitical() {
  if (manCache && cacheFresh(manAt, MANIFOLD_TTL)) return manCache;
  const seen = new Set();
  const merged = [];
  // F169 T7: the searches run together (one after another took 4.3-5 s, over the 4 s limit).
  const answers = await Promise.allSettled(MANIFOLD_SEARCH.map((url) => getJson(url)));
  if (answers.every((a) => a.status === 'rejected')) throw answers[0].reason;
  for (const json of answers.map((a) => (a.status === 'fulfilled' ? a.value : null))) {
    const arr = Array.isArray(json) ? json : [];
    for (const m of arr) {
      if (!m?.id || seen.has(m.id)) continue;
      seen.add(m.id);
      merged.push(m);
    }
  }
  const rows = mapManifoldLive(merged, { allPolitical: true });
  const fresh = { ok: true, source: 'manifold', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    manCache = fresh;
    manAt = Date.now();
  }
  return fresh;
}

export async function loadIndiaCeos() {
  if (ceoCache && cacheFresh(ceoAt, TTL)) return ceoCache;
  try {
    const json = await getJson(WIKIDATA, { Accept: 'application/sparql-results+json' }, SPARQL_MS);
    const rows = mapWikidataCeos(json);
    if (!rows.length && ceoCache) return { ...ceoCache, stale: true };
    const fresh = { ok: true, source: 'wikidata', rows };
    // F169 C3 review: a refresh never writes the cache (its answer may be partial).
    if (cacheWritable()) {
      ceoCache = fresh;
      ceoAt = Date.now();
    }
    return fresh;
  } catch (err) {
    // F169 T7: the last good answer, marked stale, when Wikidata does not answer.
    if (ceoCache) return { ...ceoCache, stale: true };
    throw err;
  }
}
