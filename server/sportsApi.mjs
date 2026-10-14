/**
 * Sports live proxies — TheSportsDB, ESPN ISL, Wikidata.
 * No GDELT. League/athlete Wikidata URLs normalised to https.
 */
import {
  ISL_ESPN,
  ISL_SPORTSDB,
  WD_ATHLETES_Q,
  WD_LEAGUES_Q,
  WORLD_LEAGUES,
  espnScoreboardRows,
  sportsDbRows,
  wikidataAthleteRows,
  wikidataLeagueRows,
} from '../src/lib/sportsPack.js';
import { cacheFresh, cacheWritable } from './loaderCache.mjs';

const UA = 'Mozilla/5.0 (compatible; NiyantranTerminal/1.0; Sports)';
const FETCH_MS = 20_000;
const SPARQL_MS = 45_000;
const TTL = 15 * 60 * 1000;
const WD_TTL = 24 * 60 * 60 * 1000;

let fxCache = null;
let fxAt = 0;
let islCache = null;
let islAt = 0;
let lgCache = null;
let lgAt = 0;
let atCache = null;
let atAt = 0;

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

function sportsDb(kind, id) {
  return `https://www.thesportsdb.com/api/v1/json/3/${kind}.php?id=${id}`;
}

export async function loadWorldFixtures() {
  if (fxCache && cacheFresh(fxAt, TTL)) return fxCache;
  const rows = [];
  await Promise.all(
    WORLD_LEAGUES.map(async (lg) => {
      for (const kind of ['eventsnextleague', 'eventspastleague']) {
        try {
          const json = await getJson(sportsDb(kind, lg.id));
          rows.push(...sportsDbRows(json, lg.name));
        } catch {
          /* skip a missing window */
        }
      }
    }),
  );
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.league).localeCompare(String(b.league)));
  const fresh = { ok: true, source: 'thesportsdb', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    fxCache = fresh;
    fxAt = Date.now();
  }
  return fresh;
}

/** Live first, then upcoming (soonest first), then results (newest first). F169 T5. */
const STAGE_RANK = { Live: 0, Upcoming: 1, Result: 2 };
function islOrder(a, b) {
  const ra = STAGE_RANK[a.stage] ?? 3;
  const rb = STAGE_RANK[b.stage] ?? 3;
  if (ra !== rb) return ra - rb;
  return a.stage === 'Upcoming' ? String(a.date).localeCompare(String(b.date)) : String(b.date).localeCompare(String(a.date));
}

export async function loadIsl() {
  if (islCache && cacheFresh(islAt, TTL)) return islCache;
  try {
    // F169 T5: the season's two calendar years (the season runs September to April). Without a
    // date ESPN returns only today's matchday; a date range answers 400 (measured 2026-10-14).
    const now = new Date();
    const y = now.getUTCFullYear();
    const years = now.getUTCMonth() >= 6 ? [y, y + 1] : [y - 1, y];
    const answers = await Promise.allSettled(years.map((year) => getJson(`${ISL_ESPN}?dates=${year}&limit=400`)));
    const seen = new Set();
    const rows = answers
      .flatMap((a) => (a.status === 'fulfilled' ? espnScoreboardRows(a.value, 'Indian Super League') : []))
      .filter((r) => {
        const key = r.source_url || `${r.date}|${r.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(islOrder);
    if (rows.length) {
      const fresh = { ok: true, source: 'espn', rows };
      // F169 C3 review: a refresh never writes the cache (its answer may be partial).
      if (cacheWritable()) {
        islCache = fresh;
        islAt = Date.now();
      }
      return fresh;
    }
  } catch {
    /* SportsDB */
  }
  const rows = [];
  for (const kind of ['eventsnextleague', 'eventspastleague']) {
    try {
      const json = await getJson(sportsDb(kind, ISL_SPORTSDB));
      rows.push(...sportsDbRows(json, 'Indian Super League'));
    } catch {
      /* skip */
    }
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const fresh = { ok: true, source: 'thesportsdb', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    islCache = fresh;
    islAt = Date.now();
  }
  return fresh;
}

function wdUrl(q) {
  return `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`;
}

export async function loadSportsLeagues() {
  if (lgCache && cacheFresh(lgAt, WD_TTL)) return lgCache;
  const json = await getJson(wdUrl(WD_LEAGUES_Q), { Accept: 'application/sparql-results+json' }, SPARQL_MS);
  const rows = wikidataLeagueRows(json);
  const fresh = { ok: true, source: 'wikidata', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    lgCache = fresh;
    lgAt = Date.now();
  }
  return fresh;
}

export async function loadAthletes() {
  if (atCache && cacheFresh(atAt, WD_TTL)) return atCache;
  const json = await getJson(wdUrl(WD_ATHLETES_Q), { Accept: 'application/sparql-results+json' }, SPARQL_MS);
  const rows = wikidataAthleteRows(json);
  const fresh = { ok: true, source: 'wikidata', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    atCache = fresh;
    atAt = Date.now();
  }
  return fresh;
}
