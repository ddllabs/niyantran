/**
 * Entertainment live proxies — TVmaze, Apple Music, Wikidata.
 * No GDELT.
 */
import {
  APPLE_IN,
  APPLE_US,
  ITUNES_IN,
  ITUNES_US,
  TVMAZE_IN,
  TVMAZE_US,
  WD_CELEB_Q,
  WD_FILMS_Q,
  WD_OTT_Q,
  appleChartRows,
  tvmazeRows,
  wikidataCelebrityRows,
  wikidataFilmRows,
  wikidataOttRows,
} from '../src/lib/entertainmentPack.js';
import { cacheFresh, cacheWritable } from './loaderCache.mjs';

const UA = 'Mozilla/5.0 (compatible; NiyantranTerminal/1.0; Entertainment)';
const FETCH_MS = 20_000;
const SPARQL_MS = 45_000;
const TTL = 15 * 60 * 1000;
const WD_TTL = 24 * 60 * 60 * 1000;

let tvCache = null;
let tvAt = 0;
let inChart = null;
let inAt = 0;
let usChart = null;
let usAt = 0;
let boxCache = null;
let boxAt = 0;
let ottCache = null;
let ottAt = 0;
let celebCache = null;
let celebAt = 0;

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

function wdUrl(q) {
  return `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`;
}

export async function loadTvTonight() {
  if (tvCache?.rows?.length && cacheFresh(tvAt, TTL)) return tvCache;
  const rows = [];
  for (const [cc, url] of [
    ['IN', TVMAZE_IN],
    ['US', TVMAZE_US],
  ]) {
    try {
      const json = await getJson(url);
      rows.push(...tvmazeRows(json, cc));
    } catch {
      /* skip a country that fails */
    }
  }
  const out = { ok: true, source: 'tvmaze', rows };
  if (rows.length && cacheWritable()) {
    tvCache = out;
    tvAt = Date.now();
  }
  return out;
}

async function loadChart(primary, fallback) {
  try {
    const json = await getJson(primary);
    const rows = appleChartRows(json);
    if (rows.length) return { ok: true, source: 'apple', rows };
  } catch {
    /* iTunes */
  }
  const json = await getJson(fallback);
  return { ok: true, source: 'itunes', rows: appleChartRows(json) };
}

export async function loadMusicIndia() {
  if (inChart?.rows?.length && cacheFresh(inAt, TTL)) return inChart;
  const got = await loadChart(APPLE_IN, ITUNES_IN);
  if (got.rows?.length && cacheWritable()) {
    inChart = got;
    inAt = Date.now();
  }
  return got;
}

export async function loadMusicUs() {
  if (usChart?.rows?.length && cacheFresh(usAt, TTL)) return usChart;
  const got = await loadChart(APPLE_US, ITUNES_US);
  if (got.rows?.length && cacheWritable()) {
    usChart = got;
    usAt = Date.now();
  }
  return got;
}

export async function loadBoxOffice() {
  if (boxCache && cacheFresh(boxAt, WD_TTL)) return boxCache;
  const json = await getJson(wdUrl(WD_FILMS_Q), { Accept: 'application/sparql-results+json' }, SPARQL_MS);
  const rows = wikidataFilmRows(json);
  const fresh = { ok: true, source: 'wikidata', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    boxCache = fresh;
    boxAt = Date.now();
  }
  return fresh;
}

export async function loadOtt() {
  if (ottCache && cacheFresh(ottAt, WD_TTL)) return ottCache;
  const json = await getJson(wdUrl(WD_OTT_Q), { Accept: 'application/sparql-results+json' }, SPARQL_MS);
  const rows = wikidataOttRows(json);
  const fresh = { ok: true, source: 'wikidata', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    ottCache = fresh;
    ottAt = Date.now();
  }
  return fresh;
}

export async function loadCelebrities() {
  if (celebCache && cacheFresh(celebAt, WD_TTL)) return celebCache;
  const json = await getJson(wdUrl(WD_CELEB_Q), { Accept: 'application/sparql-results+json' }, SPARQL_MS);
  const rows = wikidataCelebrityRows(json);
  const fresh = { ok: true, source: 'wikidata', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    celebCache = fresh;
    celebAt = Date.now();
  }
  return fresh;
}
