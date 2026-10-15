/**
 * Global Resources live proxies — Constitute Project, World Bank, Wikidata.
 * GET /api/constitutions  — constitutions currently in force
 * GET /api/growth         — G20-set GDP / CPI / unemployment
 * GET /api/leaders        — UN member heads of state / government
 */
import { cacheFresh, cacheWritable } from './loaderCache.mjs';
import { constitutionCountryName } from '../src/lib/globalResources.js';

const UA = 'Mozilla/5.0 (compatible; NiyantranTerminal/1.0; GlobalResources)';
const FETCH_MS = 25_000;
const WC_TTL = 7 * 24 * 60 * 60 * 1000;
const GR_TTL = 24 * 60 * 60 * 1000;
const HS_TTL = 24 * 60 * 60 * 1000;

const CONSTITUTE = 'https://www.constituteproject.org/service/constitutions?lang=en';
const GR_CC = 'USA;CHN;IND;DEU;JPN;GBR;FRA;BRA;ITA;CAN;RUS;KOR;AUS;MEX;IDN;SAU;TUR;NLD;CHE;ESP';
const WB = (ind) =>
  `https://api.worldbank.org/v2/country/${GR_CC}/indicator/${ind}?format=json&mrv=1&per_page=25`;
const WD_Q =
  'SELECT ?countryLabel ?hosLabel ?hogLabel WHERE { ?country wdt:P463 wd:Q1065 . ' +
  '?country wdt:P35 ?hos . OPTIONAL { ?country wdt:P6 ?hog } ' +
  'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 600';
const WIKIDATA = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(WD_Q)}`;

let wcCache = null;
let wcAt = 0;
let grCache = null;
let grAt = 0;
let hsCache = null;
let hsAt = 0;

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function getJson(url, extraHeaders = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_MS);
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

export async function loadConstitutions() {
  if (wcCache && cacheFresh(wcAt, WC_TTL)) return wcCache;
  const arr = await getJson(CONSTITUTE);
  const rows = (Array.isArray(arr) ? arr : [])
    .filter((c) => c && c.in_force === true)
    .map((c) => {
      // country_id is a slug (`Bahamas_the`); show the name (audit 2026-10-15, cause 7).
      const country = constitutionCountryName(c.country_id) || c.country || '';
      const enacted = String(c.year_enacted || (c.date_enacted || '').slice(0, 4) || '').trim();
      const id = c.id || '';
      return {
        title: country,
        country,
        enacted,
        constitution_id: id,
        source_url: id ? `https://www.constituteproject.org/constitution/${id}` : 'https://www.constituteproject.org/',
      };
    })
    .filter((r) => r.country)
    .sort((a, b) => (a.country < b.country ? -1 : 1));
  const fresh = { ok: true, source: 'constitute', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    wcCache = fresh;
    wcAt = Date.now();
  }
  return fresh;
}

function wbMap(payload) {
  const out = {};
  const list = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : [];
  for (const r of list) {
    const name = r?.country?.value;
    if (!name || r.value == null) continue;
    out[name] = { v: r.value, y: r.date };
  }
  return out;
}

export async function loadGrowth() {
  if (grCache && cacheFresh(grAt, GR_TTL)) return grCache;
  const [gdpJ, cpiJ, uemJ] = await Promise.all([
    getJson(WB('NY.GDP.MKTP.KD.ZG')),
    getJson(WB('FP.CPI.TOTL.ZG')),
    getJson(WB('SL.UEM.TOTL.ZS')),
  ]);
  const gdp = wbMap(gdpJ);
  const cpi = wbMap(cpiJ);
  const uem = wbMap(uemJ);
  const rows = Object.keys(gdp)
    .map((c) => ({
      title: c,
      country: c,
      year: gdp[c].y || '',
      gdp_growth: fmt1(gdp[c].v),
      inflation: fmt1(cpi[c]?.v) || '—',
      unemployment: fmt1(uem[c]?.v) || '—',
      source_url: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG',
    }))
    .sort((a, b) => Number(b.gdp_growth) - Number(a.gdp_growth));
  const fresh = { ok: true, source: 'world-bank', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    grCache = fresh;
    grAt = Date.now();
  }
  return fresh;
}

let gtCache = null;
let gtAt = 0;

export async function loadTrade() {
  if (gtCache && cacheFresh(gtAt, GR_TTL)) return gtCache;
  const [expJ, trdJ] = await Promise.all([getJson(WB('TX.VAL.MRCH.CD.WT')), getJson(WB('NE.TRD.GNFS.ZS'))]);
  const exp = wbMap(expJ);
  const trd = wbMap(trdJ);
  const rows = Object.keys(exp)
    .map((c) => {
      const bn = Number(exp[c].v) / 1e9;
      return {
        title: c,
        country: c,
        year: exp[c].y || '',
        exports_bn: Number.isFinite(bn) ? bn.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '',
        exports_raw: exp[c].v,
        trade_gdp: fmt1(trd[c]?.v) || '—',
        source_url: 'https://data.worldbank.org/indicator/TX.VAL.MRCH.CD.WT',
      };
    })
    .sort((a, b) => (b.exports_raw || 0) - (a.exports_raw || 0));
  const fresh = { ok: true, source: 'world-bank', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    gtCache = fresh;
    gtAt = Date.now();
  }
  return fresh;
}

function wdLabel(cell) {
  const v = cell?.value || '';
  if (!v || /^Q[0-9]+$/.test(v)) return '';
  return v;
}

export async function loadLeaders() {
  if (hsCache && cacheFresh(hsAt, HS_TTL)) return hsCache;
  const j = await getJson(WIKIDATA, { Accept: 'application/sparql-results+json' });
  const seen = {};
  const rows = [];
  for (const b of j?.results?.bindings || []) {
    const country = wdLabel(b.countryLabel);
    if (!country || seen[country]) continue;
    seen[country] = 1;
    rows.push({
      title: country,
      country,
      head_of_state: wdLabel(b.hosLabel) || '—',
      head_of_government: wdLabel(b.hogLabel) || '—',
      source_url: 'https://www.wikidata.org/',
    });
  }
  rows.sort((a, b) => (a.country < b.country ? -1 : 1));
  const fresh = { ok: true, source: 'wikidata', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    hsCache = fresh;
    hsAt = Date.now();
  }
  return fresh;
}

function handleResourcesRequest(req, res, next) {
  const host = req.headers.host || 'localhost';
  let url;
  try {
    url = new URL(req.url, `http://${host}`);
  } catch {
    next();
    return;
  }
  const p = url.pathname.replace(/\/$/, '');
  const routes = {
    '/api/constitutions': loadConstitutions,
    '/api/growth': loadGrowth,
    '/api/trade': loadTrade,
    '/api/leaders': loadLeaders,
  };
  const run = routes[p];
  if (!run) {
    next();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, { ok: false, error: 'GET only' }, 405);
    return;
  }
  return run()
    .then((body) => {
      if (req.method === 'HEAD') {
        res.statusCode = 200;
        res.end();
        return;
      }
      json(res, body);
    })
    .catch((err) => json(res, { ok: false, error: err.message || String(err) }, 502));
}

export function resourcesApiPlugin() {
  return {
    name: 'niyantran-resources-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleResourcesRequest(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleResourcesRequest(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
