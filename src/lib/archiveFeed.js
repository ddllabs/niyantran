/**
 * Static-host archive for desks when /api/feature-feed is not deployed.
 * Reads bundled registers and /data/embedded_csv — never invents rows.
 */
import features from '../data/html-feature-map.json';
import registry from '../data/source-registry.json';
import manifest from '../../public/data/embedded_csv/_manifest.json';
import alliances from '../data/alliances.json';
import sanctions from '../data/sanctions.json';
import globalAid from '../data/global-aid.json';
import geoConflicts from '../data/geo-conflicts.json';
import infraProjects from '../data/infra-projects.json';
import nuclearWatch from '../data/nuclear-watch.json';
import chokepoints from '../data/chokepoints.json';
import leaders from '../data/leaders.json';
import commodities from '../data/commodities.json';
import criticalMinerals from '../data/critical-minerals.json';
import energy from '../data/energy.json';
import { flattenAlliance } from './alliances.js';
import { flattenSanction } from './sanctions.js';
import { flattenAppeal } from './globalAid.js';
import { flattenChokepoint, flattenInfra, flattenNuclear } from './strategicAssets.js';
import { flattenLeader, commoditiesFromPack } from './globalResources.js';
import { flattenEnergyMineral, flattenMineralRef } from './geonomics.js';
import { geoRows, geoNote, isGeoDesk } from './niyGeo.js';
import { isLawExtract, isUsScotusDesk, lawNote, lawRows, lawSlice } from './lawPack.js';
import { dgftRows, econNote, econSlice, isEconExtract, manifoldPoliticalRows, marketQuoteRows } from './econPack.js';
import { carbonDataset, carbonNote, carbonRows, carbonSlice, isCarbonExtract } from './carbonPack.js';
import {
  CRICKET_RSS,
  FOOTBALL_RSS,
  INDIA_SPORTS_RSS,
  ISL_ESPN,
  WORLD_LEAGUES,
  WD_ATHLETES_Q,
  WD_LEAGUES_Q,
  espnScoreboardRows,
  rssWireRows,
  sportsDbRows,
  sportsNote,
  sportsSlice,
  wikidataAthleteRows,
  wikidataLeagueRows,
} from './sportsPack.js';
import {
  APPLE_IN,
  APPLE_US,
  BOLLYWOOD_NEWS_RSS,
  BOLLYWOOD_RSS,
  VARIETY_RSS,
  WD_CELEB_Q,
  WD_FILMS_Q,
  WD_OTT_Q,
  appleChartRows,
  entertainmentNote,
  entertainmentSlice,
  rssWireRows as entRssRows,
  wikidataCelebrityRows,
  wikidataFilmRows,
  wikidataOttRows,
} from './entertainmentPack.js';
import niyGeo from '../data/niy-geo.json';

async function fetchJsonOk(url, signal) {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  } catch {
    return null;
  }
}

async function fetchTextOk(url, signal) {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return '';
    return res.text();
  } catch {
    return '';
  }
}

function parseRssItems(xml, outlet) {
  if (!xml || typeof DOMParser === 'undefined') return [];
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    return [...doc.querySelectorAll('item')].map((it) => {
      const g = (k) => it.querySelector(k)?.textContent?.trim() || '';
      return { title: g('title'), link: g('link'), date: g('pubDate'), outlet };
    });
  } catch {
    return [];
  }
}

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

const datasetToFile = {};
const knownDatasetKeys = new Set();
for (const row of manifest) {
  datasetToFile[row.key] = row.file;
  datasetToFile[row.key.replace(/\.csv$/i, '')] = row.file;
  knownDatasetKeys.add(String(row.key).replace(/\.csv$/i, ''));
  knownDatasetKeys.add(String(row.file || '').replace(/\.json$/i, ''));
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

function flattenRow(item) {
  const src = item && typeof item === 'object' && !Array.isArray(item) ? item : { value: item };
  const out = { ...src };
  out.date =
    pick(src, [
      'date',
      'date_introduced',
      'seendate',
      'pubDate',
      'published',
      'datetime',
      'year',
      'started',
      'since',
    ]) || '';
  out.title =
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
    ]) || '';
  out.source_url =
    pick(src, ['source_url', 'url', 'link', 'html_url', 'document_url', 'pdf_url']) || '';
  return out;
}

function envelope({ feature, rows, adapter, note, fallback, kind, meta, timeline, tier, coverage }) {
  return {
    ok: true,
    tier: tier || feature?.htmlTier || '',
    feature: feature.htmlFeature || feature,
    rows: rows || [],
    source: {
      adapter: adapter || 'embedded',
      links: [...new Set((rows || []).map((r) => r.source_url).filter(Boolean))],
      note: note || 'Shipped register on this host.',
      gdelt: false,
      kind: kind || '',
    },
    // Primary embedded registers are the product dataset — not a degraded live fallback.
    // Only mark fallback when the caller sets it explicitly (e.g. live API failed → pack).
    coverage: coverage || { from: '', through: '', exhaustive: false },
    fallback: Boolean(fallback),
    timeline: Array.isArray(timeline) ? timeline : [],
    meta: meta || null,
  };
}

function matchFeature(tier, featureName) {
  const t = resolveTier(tier);
  const n = norm(featureName);
  const list = t === 'home' ? features : features.filter((f) => f.htmlTier === t);
  let feat = list.find((f) => norm(f.htmlFeature) === n) || features.find((f) => norm(f.htmlFeature) === n);
  if (!feat) feat = list.find((f) => norm(f.workbookFunctions) === n);
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
  return { feat, entry: entries[0] || null };
}

function datasetFileName(dataset) {
  if (!dataset) return null;
  const key = String(dataset).trim();
  if (datasetToFile[key]) return datasetToFile[key];
  const noCsv = key.replace(/\.csv$/i, '');
  if (datasetToFile[noCsv]) return datasetToFile[noCsv];
  return `${noCsv}.json`;
}

async function loadRawEmbedded(dataset, signal) {
  const file = datasetFileName(dataset);
  if (!file) return [];
  const key = String(dataset || '')
    .replace(/\.csv$/i, '')
    .replace(/\.json$/i, '')
    .trim();
  // D10: never hit a path that will 404 — only fetch keys present in the manifest.
  if (key && !knownDatasetKeys.has(key) && !datasetToFile[key] && !datasetToFile[`${key}.csv`]) {
    return [];
  }
  const res = await fetch(`/data/embedded_csv/${file}`, { signal });
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  return Array.isArray(json) ? json : [];
}

async function loadEmbedded(dataset, signal) {
  const file = datasetFileName(dataset);
  if (!file) return [];
  const res = await fetch(`/data/embedded_csv/${file}`, { signal });
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  if (Array.isArray(json)) return json.map(flattenRow);
  return [];
}

function geoConflictRows(pack) {
  return (pack?.conflicts || [])
    .filter((c) => c && c.id && c.name && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon)))
    .map((c) => {
      const sources = (c.sources || []).filter(
        (s) => Array.isArray(s) && String(s[0] || '').trim() && /^https?:\/\//i.test(String(s[1] || '')),
      );
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

export function hasRealRows(body) {
  const rows = body?.rows || [];
  if (!rows.length) return false;
  return rows[0]?.status !== 'source_status';
}

export async function fetchArchiveFeature({ tier, feature, signal } = {}) {
  const n = norm(feature);
  const { feat, entry } = matchFeature(tier, feature);
  if (!feat) {
    return envelope({
      feature: feature || '',
      rows: [],
      adapter: 'embedded',
      note: 'No matching feature map row.',
    });
  }

  const dataset = entry?.dataset || feat.dataset || '';
  const name = feat.htmlFeature || '';
  const role = String(entry?.role || feat.role || '').toLowerCase();

  // D1: HTML-ONLY modules have no view of their own. Never fall through to a
  // sibling desk's embedded dataset (Constituency Register / Local Governance Brief).
  if (String(feat.mapping || '').toUpperCase() === 'HTML-ONLY') {
    return envelope({
      feature: feat,
      rows: [],
      adapter: 'planned',
      note: 'Module planned. No adapter or dataset is shipped for this module yet.',
      fallback: false,
    });
  }

  // D11: discovery-only (GDELT) sources never paint as a primary register.
  if (role === 'discovery' && !dataset) {
    return envelope({
      feature: feat,
      rows: [],
      adapter: 'planned',
      note: 'Discovery source only (news search). No primary-of-record dataset is wired for this module.',
      fallback: false,
    });
  }

  if (isGeoDesk(name, dataset)) {
    const rows = geoRows(niyGeo, name, dataset);
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'geo-pack',
        meta: { vintage: niyGeo.packs?.GA?.vintage || niyGeo.vintage, state: 'Goa' },
        note: geoNote(niyGeo, name),
      });
    }
  }

  if (isLawExtract(name)) {
    const slice = lawSlice(name);
    const rows = lawRows(slice, {
      sc: await loadRawEmbedded('judiciary_sc_orders.csv', signal),
      nclt: await loadRawEmbedded('judiciary_nclt_orders.csv', signal),
      ibbi: await loadRawEmbedded('national_ibbi_announcements.csv', signal),
    });
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'law-pack',
        meta: { heading: name },
        note: lawNote(slice),
        fallback: false,
      });
    }
  }

  if (isUsScotusDesk(name)) {
    return envelope({
      feature: feat,
      rows: [],
      note: 'CourtListener is only available through the live feed host.',
    });
  }

  if (isEconExtract(name)) {
    const slice = econSlice(name);
    let rows = [];
    if (slice === 'nse') rows = marketQuoteRows(await loadRawEmbedded('finance_market_feed.csv', signal));
    else if (slice === 'trade') rows = dgftRows(await loadRawEmbedded('national_dgft_notifications.csv', signal));
    else if (slice === 'manifold') {
      rows = manifoldPoliticalRows(await loadRawEmbedded('finance_manifold_markets.csv', signal));
    }
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'finance-pack',
        meta: { heading: name },
        note: econNote(slice),
        fallback: false,
      });
    }
  }

  const econLive = econSlice(name);
  if (econLive && !isEconExtract(name)) {
    return envelope({
      feature: feat,
      rows: [],
      note: `${econNote(econLive)} Live host only on the static archive.`,
    });
  }

  if (isCarbonExtract(name)) {
    const slice = carbonSlice(name);
    const rows = carbonRows(slice, {
      cbam: await loadRawEmbedded(carbonDataset('cbam'), signal),
      pricing: await loadRawEmbedded(carbonDataset('pricing'), signal),
      monitor: await loadRawEmbedded(carbonDataset('monitor'), signal),
      ets: await loadRawEmbedded(carbonDataset('ets'), signal),
      ccts: await loadRawEmbedded(carbonDataset('ccts'), signal),
      registry: await loadRawEmbedded(carbonDataset('registry'), signal),
      news: await loadRawEmbedded(carbonDataset('news'), signal),
    });
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'carbon-pack',
        meta: { heading: name },
        note: carbonNote(slice),
        fallback: false,
      });
    }
  }

  const sport = sportsSlice(name);
  if (sport) {
    // D15: browser-OK hosts — wire directly (no /api proxy required).
    let rows = [];
    if (sport === 'isl') {
      const json = await fetchJsonOk(ISL_ESPN, signal);
      rows = espnScoreboardRows(json, 'Indian Super League');
    } else if (sport === 'fixtures') {
      for (const league of WORLD_LEAGUES) {
        const json = await fetchJsonOk(
          `https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${league.id}`,
          signal,
        );
        rows = rows.concat(sportsDbRows(json, league.name));
      }
    } else if (sport === 'cricket') {
      rows = rssWireRows(parseRssItems(await fetchTextOk(CRICKET_RSS, signal), 'ESPNcricinfo'), 'ESPNcricinfo');
    } else if (sport === 'football') {
      rows = rssWireRows(parseRssItems(await fetchTextOk(FOOTBALL_RSS, signal), 'BBC Sport'), 'BBC Sport');
    } else if (sport === 'india') {
      rows = rssWireRows(parseRssItems(await fetchTextOk(INDIA_SPORTS_RSS, signal), 'Google News'), 'Google News');
    } else if (sport === 'business') {
      const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(WD_LEAGUES_Q)}`;
      rows = wikidataLeagueRows(await fetchJsonOk(url, signal));
    } else if (sport === 'athletes') {
      const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(WD_ATHLETES_Q)}`;
      rows = wikidataAthleteRows(await fetchJsonOk(url, signal));
    }
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'sports-pack',
        note: sportsNote(sport),
        fallback: false,
      });
    }
    return envelope({
      feature: feat,
      rows: [],
      note: `${sportsNote(sport)} No rows returned from the browser-reachable host.`,
    });
  }

  const ent = entertainmentSlice(name);
  if (ent) {
    let rows = [];
    const wd = async (q) => {
      const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`;
      return fetchJsonOk(url, signal);
    };
    if (ent === 'variety') {
      rows = entRssRows(parseRssItems(await fetchTextOk(VARIETY_RSS, signal), 'Variety'), 'Variety');
    } else if (ent === 'bollywood') {
      rows = entRssRows(parseRssItems(await fetchTextOk(BOLLYWOOD_RSS, signal), 'NDTV Movies'), 'NDTV Movies');
      if (!rows.length) {
        rows = entRssRows(
          parseRssItems(await fetchTextOk(BOLLYWOOD_NEWS_RSS, signal), 'Google News'),
          'Google News',
        );
      }
    } else if (ent === 'box') {
      rows = wikidataFilmRows(await wd(WD_FILMS_Q));
    } else if (ent === 'ott') {
      rows = wikidataOttRows(await wd(WD_OTT_Q));
    } else if (ent === 'celebrity') {
      rows = wikidataCelebrityRows(await wd(WD_CELEB_Q));
    } else if (ent === 'music-in' || ent === 'music-us') {
      const url = ent === 'music-in' ? APPLE_IN : APPLE_US;
      rows = appleChartRows(await fetchJsonOk(url, signal));
    }
    // tv (TVmaze) deliberately skipped here — intermittent per D15; stays Planned when empty.
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'entertainment-pack',
        note: entertainmentNote(ent),
        fallback: false,
      });
    }
    return envelope({
      feature: feat,
      rows: [],
      note: `${entertainmentNote(ent)} No rows returned from the browser-reachable host.`,
    });
  }

  if (/^infra$/i.test(name) || dataset === 'geopolitics_infra_projects.csv') {
    const rows = (infraProjects.projects || []).map(flattenInfra);
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'dossier',
        meta: { asOf: infraProjects.asOf },
        note: 'Strategic infrastructure register (static archive).',
      });
    }
  }

  if (/^nuclear watch$/i.test(name)) {
    const rows = (nuclearWatch.facilities || []).map(flattenNuclear);
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'dossier',
        meta: { asOf: nuclearWatch.asOf, strip: nuclearWatch.strip || {}, arsenal: nuclearWatch.arsenal || [] },
        note: 'Nuclear facility register (static archive).',
      });
    }
  }

  if (/^maritime choke-?points$/i.test(name) || dataset === 'geo_chokepoints') {
    const rows = (chokepoints.points || []).map(flattenChokepoint);
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'dossier',
        meta: { asOf: chokepoints.asOf, stats: chokepoints.stats || {} },
        note: 'Maritime chokepoint register (static archive).',
      });
    }
  }

  if (/^heads of state$/i.test(name) || dataset === 'geo_leaders') {
    const rows = (leaders.leaders || []).map(flattenLeader).filter((r) => r.name);
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'dossier',
        meta: { asOf: leaders.asOf, stats: leaders.stats },
        note: 'World-leaders register (static archive).',
      });
    }
  }

  if (/^world constitutions$/i.test(name)) {
    try {
      const res = await fetch('/api/constitutions', { signal });
      const body = await res.json().catch(() => null);
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      if (res.ok && rows.length) {
        return envelope({
          feature: feat,
          rows,
          adapter: 'live',
          kind: 'table',
          meta: {
            section: 'CONSTITUTIONS IN FORCE — CONSTITUTE PROJECT',
            status: 'LIVE · CONSTITUTE PROJECT',
          },
          note: 'Constitute Project constitutions currently in force.',
        });
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
  }

  if (/^growth indicators$/i.test(name)) {
    try {
      const res = await fetch('/api/growth', { signal });
      const body = await res.json().catch(() => null);
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      if (res.ok && rows.length) {
        return envelope({
          feature: feat,
          rows,
          adapter: 'live',
          kind: 'table',
          meta: {
            section: 'GROWTH MONITOR — WORLD BANK OPEN DATA',
            status: 'LIVE · WORLD BANK',
          },
          note: 'World Bank open data — GDP growth, inflation and unemployment.',
        });
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
  }

  if (/^geopolitics news wire$/i.test(name) || dataset === 'geo_news_wire.csv') {
    try {
      const gdelt =
        'https://api.gdeltproject.org/api/v2/doc/doc?query=(geopolitics+OR+diplomacy+OR+%22foreign+policy%22)+sourcelang:eng&mode=ArtList&format=json&maxrecords=40&sort=DateDesc';
      const res = await fetch(gdelt, { signal });
      const body = await res.json().catch(() => null);
      const arts = Array.isArray(body?.articles) ? body.articles : [];
      const rows = arts
        .map((a) => ({
          title: a.title || a.seendate || '',
          date: a.seendate || '',
          source_url: a.url || '',
          domain: a.domain || '',
          language: a.language || '',
        }))
        .filter((r) => r.title);
      if (rows.length) {
        return envelope({
          feature: feat,
          rows,
          adapter: 'news-search',
          kind: 'table',
          note: 'GDELT DOC 2.0 reporting search — not an official dataset.',
        });
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
  }

  if (/^global commodities$/i.test(name) || dataset === 'geo_commodities') {
    const rows = commoditiesFromPack(commodities);
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'dossier',
        meta: { asOf: commodities.meta?.asOf, stats: commodities.stats, groups: commodities.groups || [] },
        note: commodities.meta?.note || 'Commodity benchmark board (static archive).',
      });
    }
  }

  if (/^critical minerals$/i.test(name)) {
    const rows = (criticalMinerals.minerals || []).map(flattenMineralRef);
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        meta: { asOf: criticalMinerals.asOf },
        note: 'Critical minerals register (static archive).',
      });
    }
  }

  if (/^energy$/i.test(name) || dataset === 'geo_energy') {
    const rows = (energy.minerals || []).map(flattenEnergyMineral);
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'dossier',
        meta: { asOf: energy.meta?.asOf, stats: energy.stats, commodities: energy.commodities || [] },
        note: 'Energy and critical-minerals register (static archive).',
      });
    }
  }

  if (/^sanctions$/i.test(name)) {
    const rows = (sanctions.programs || []).map(flattenSanction);
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'dossier',
        timeline: sanctions.timeline || [],
        meta: { asOf: sanctions.asOf, stats: sanctions.stats, byTarget: sanctions.byTarget },
        note: 'Sanctions programme register (static archive).',
      });
    }
  }

  if (/^global aid$/i.test(name)) {
    const rows = (globalAid.appeals || []).map(flattenAppeal);
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'dossier',
        meta: { wire: globalAid.wire || [] },
        note: 'Global aid appeal register (static archive).',
      });
    }
  }

  if (/^alliances$/i.test(name)) {
    const rows = (alliances.alliances || []).map((p) => flattenAlliance(p, alliances.memberFlags || {}));
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'dossier',
        meta: { verified: alliances.verified, memberFlags: alliances.memberFlags || {} },
        note: 'Alliance and bloc register (static archive).',
      });
    }
  }

  if (
    /^global intelligence$/i.test(name) ||
    /defence procurement intelligence/i.test(name) ||
    dataset === 'geopolitics_defense_procurement.csv' ||
    dataset === 'geopolitics_defense_procurement'
  ) {
    const rows = await loadEmbedded('geopolitics_defense_procurement.csv', signal);
    if (rows.length) {
      const mapped = rows.map((r) => ({
        ...r,
        title: r.title || r.program_name || r.name || '',
        program_name: r.program_name || r.title || r.name || '',
        country: r.country || r.vendor_or_origin || '',
        vendor_or_origin: r.vendor_or_origin || r.country || '',
        stage: r.stage || r.status || '',
        decision_date: r.decision_date || r.as_of || r.date || '',
        as_of: r.as_of || r.decision_date || r.date || '',
      }));
      return envelope({
        feature: feat,
        rows: mapped,
        kind: 'table',
        note: 'Defence procurement register (static archive).',
      });
    }
  }

  if (/^open fronts$/i.test(name) || dataset === 'geopolitics_war_tracker.csv' || dataset === 'geopolitics_war_tracker') {
    const rows = await loadEmbedded('geopolitics_war_tracker.csv', signal);
    if (rows.length) {
      const mapped = rows.map((r) => ({
        ...r,
        title: r.title || r.conflict_name || r.name || '',
        conflict_name: r.conflict_name || r.title || r.name || '',
        current_stage: r.current_stage || r.status || '',
        last_verified: r.last_verified || r.as_of || r.updated || '',
      }));
      return envelope({
        feature: feat,
        rows: mapped,
        kind: 'table',
        note: 'Open Fronts conflict register (static archive).',
      });
    }
  }

  if (dataset === 'geo_conflicts' || /^conflicts$/i.test(name) || n === 'conflicts') {
    const rows = geoConflictRows(geoConflicts);
    if (rows.length) {
      return envelope({
        feature: feat,
        rows,
        kind: 'dossier',
        timeline: geoConflicts.timeline || [],
        meta: geoConflicts.meta || null,
        note: 'Conflicts theatre monitor (static archive).',
      });
    }
  }

  const archiveKeys = [
    dataset,
    /policy intelligence graph/i.test(name) ? 'national_bill_tracker.csv' : '',
    /mp profiles|mp report cards/i.test(name) ? 'national_mp_report_card.csv' : '',
    n === 'markets' || n === 'briefing' ? 'finance_market_feed.csv' : '',
  ].filter(Boolean);

  for (const key of archiveKeys) {
    const rows = await loadEmbedded(key, signal);
    if (rows.length) {
      const isBillRegister =
        /bill passage|policy intelligence graph/i.test(name) || /national_bill_tracker/i.test(String(key));
      if (isBillRegister) {
        return envelope({
          feature: feat,
          rows,
          adapter: 'bill-history',
          note: 'national_bill_tracker.csv — 1952–present. Sansad getBills is not wired for refresh on this host.',
          fallback: false,
          coverage: { from: '1952-01-01', through: 'present', exhaustive: true },
          meta: {
            section: 'BILL PASSAGE INDEX',
            status: 'REGISTER · SANSAD / PRS ARCHIVE',
            heading: 'BILL PASSAGE INDEX',
          },
          tier: feat.htmlTier || tier || '',
        });
      }
      return envelope({
        feature: feat,
        rows,
        note: 'Primary register for this module (embedded dataset).',
        fallback: false,
        coverage: { from: '', through: 'present', exhaustive: true },
        tier: feat.htmlTier || tier || '',
      });
    }
  }

  return envelope({
    feature: feat,
    rows: [],
    adapter: 'embedded',
    note: 'No shipped register for this module on this host.',
    tier: feat.htmlTier || tier || '',
  });
}
