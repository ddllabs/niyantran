/**
 * Strategic Assets live proxies.
 * GET /api/portwatch  — IMF PortWatch daily chokepoint transits
 * GET /api/launches   — The Space Devs upcoming launches
 * GET /api/celestrak  — CelesTrak objects catalogued in the last 30 days
 * GET /api/wb-projects — World Bank projects API (trimmed)
 */
import { cacheFresh, cacheWritable } from './loaderCache.mjs';

const UA = 'Mozilla/5.0 (compatible; NiyantranTerminal/1.0; StrategicAssets)';
const FETCH_MS = 28_000;
const TTL = 30 * 60 * 1000;
const PW_TTL = 6 * 60 * 60 * 1000;
const CT_TTL = 6 * 60 * 60 * 1000;

const PORTWATCH =
  'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query' +
  '?where=1%3D1&outFields=date,portname,n_total,n_tanker,n_container,n_dry_bulk,n_cargo&orderByFields=date%20DESC&resultRecordCount=60&f=json';
const LAUNCHES = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=12&format=json';
const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=json';
const WB = 'https://search.worldbank.org/api/v2/projects?format=json&rows=12&os=0';

const ISO_COUNTRY = {
  USA: 'United States',
  US: 'United States',
  CHN: 'China',
  CN: 'China',
  RUS: 'Russia',
  RU: 'Russia',
  IND: 'India',
  IN: 'India',
  FRA: 'France',
  FR: 'France',
  GUF: 'France',
  JPN: 'Japan',
  JP: 'Japan',
  GBR: 'United Kingdom',
  GB: 'United Kingdom',
  NZL: 'New Zealand',
  NZ: 'New Zealand',
  AUS: 'Australia',
  KAZ: 'Kazakhstan',
  KOR: 'South Korea',
  ISR: 'Israel',
  IRN: 'Iran',
  ARE: 'United Arab Emirates',
  BRA: 'Brazil',
  ARG: 'Argentina',
};

let pwCache = null;
let pwAt = 0;
let launchCache = null;
let launchAt = 0;
let ctCache = null;
let ctAt = 0;
let wbCache = null;
let wbAt = 0;

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function getJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function loadPortwatch() {
  if (pwCache && cacheFresh(pwAt, PW_TTL)) return pwCache;
  const j = await getJson(PORTWATCH);
  const attrs = (j.features || []).map((f) => f.attributes).filter((a) => a?.portname);
  const latest = attrs[0]?.date || '';
  const rows = attrs
    .filter((a) => a.date === latest)
    .sort((a, b) => (b.n_total || 0) - (a.n_total || 0))
    .map((a) => ({
      title: a.portname,
      transits: a.n_total,
      tanker: a.n_tanker,
      container: a.n_container,
      dryBulk: a.n_dry_bulk,
      cargo: a.n_cargo,
    }));
  const fresh = { ok: true, source: 'imf-portwatch', date: latest, rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    pwCache = fresh;
    pwAt = Date.now();
  }
  return fresh;
}

export function flattenLaunch(l) {
  const pad = l.pad || {};
  const loc = pad.location || {};
  return {
    id: String(l.id || l.url || l.name),
    __saId: String(l.id || l.url || l.name),
    title: l.name || '',
    name: l.name || '',
    provider: l.launch_service_provider?.name || '',
    pad: loc.name || pad.name || '',
    country: ISO_COUNTRY[String(loc.country_code || '').toUpperCase()] || loc.country_code || '',
    __saKind: 'satellite',
    net: String(l.net || '').replace('T', ' ').slice(0, 16),
    expected: String(l.net || '').replace('T', ' ').slice(0, 16),
    status: l.status?.name || '',
    kind: 'Launch',
    region: loc.name || '',
    lat: pad.latitude,
    lon: pad.longitude,
    // F122: Launch Library's `url` is a JSON endpoint, not a page a reader can open, and the pad's
    // wiki page is not the launch; no readable launch page is given, so no record link is drawn.
    source_url: '',
    api_url: l.url || '',
    source_label: 'The Space Devs',
  };
}

export async function loadLaunches() {
  if (launchCache && cacheFresh(launchAt, TTL)) return launchCache;
  const j = await getJson(LAUNCHES);
  const rows = (j.results || []).map(flattenLaunch);
  const fresh = { ok: true, source: 'spacedevs', rows };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    launchCache = fresh;
    launchAt = Date.now();
  }
  return fresh;
}

export async function loadCelestrak() {
  if (ctCache && cacheFresh(ctAt, CT_TTL)) return ctCache;
  const arr = await getJson(CELESTRAK);
  const list = Array.isArray(arr) ? arr : [];
  const fresh = {
    ok: true,
    source: 'celestrak',
    total: list.length,
    rows: list.slice(0, 12).map((o) => ({
      title: o.OBJECT_NAME,
      id: o.OBJECT_ID,
      epoch: String(o.EPOCH || '').slice(0, 10),
    })),
  };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    ctCache = fresh;
    ctAt = Date.now();
  }
  return fresh;
}

export async function loadWbProjects() {
  if (wbCache && cacheFresh(wbAt, PW_TTL)) return wbCache;
  const j = await getJson(WB);
  const ps = j?.projects ? Object.keys(j.projects).map((k) => j.projects[k]) : [];
  const fresh = {
    ok: true,
    source: 'world-bank',
    rows: ps.slice(0, 12).map((p) => ({
      title: p.project_name || '',
      country: p.countryshortname || '',
      commitment: p.curr_total_commitment ?? p.totalamt ?? '',
      approved: String(p.boardapprovaldate || '').slice(0, 10),
      url: p.url || '',
    })),
  };
  // F169 C3 review: a refresh never writes the cache (its answer may be partial).
  if (cacheWritable()) {
    wbCache = fresh;
    wbAt = Date.now();
  }
  return fresh;
}

export function handleAssetsRequest(req, res, next) {
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
    '/api/portwatch': loadPortwatch,
    '/api/launches': loadLaunches,
    '/api/celestrak': loadCelestrak,
    '/api/wb-projects': loadWbProjects,
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

export function assetsApiPlugin() {
  return {
    name: 'niyantran-assets-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleAssetsRequest(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const p = handleAssetsRequest(req, res, next);
        if (p && p.catch) p.catch(next);
      });
    },
  };
}
