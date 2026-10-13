export function isSanctionsFeature(name) {
  return /^sanctions$/i.test(String(name || '').trim());
}

export function issuerTokens(p) {
  const s = p.issuer || '';
  const all = [
    ['US', 'US'],
    ['OFAC', 'US'],
    ['EU', 'EU'],
    ['UK', 'UK'],
    ['UN', 'UN'],
    ['Canada', 'Canada'],
    ['Japan', 'Japan'],
    ['Australia', 'Australia'],
    ['AUS', 'Australia'],
    ['S. Korea', 'South Korea'],
  ];
  // Whole tokens only, so "AUS" is not also read as "US" (F122).
  const has = (k) => new RegExp(`(^|[^A-Za-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`).test(s);
  const out = [];
  for (const [k, v] of all) {
    if (has(k) && !out.includes(v)) out.push(v);
  }
  return out.length ? out : ['Other'];
}

function parseList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (!v) return [];
  try {
    const j = JSON.parse(v);
    if (Array.isArray(j)) return j.filter(Boolean);
  } catch {
    /* csv */
  }
  return String(v)
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parsePairs(v) {
  const raw = parseList(v);
  if (raw.length && Array.isArray(raw[0])) return raw;
  return [];
}

export function hydrateSanction(row) {
  if (!row) return null;
  const p = {
    id: row.id || row.__snId,
    name: row.name || row.title || row.programme,
    region: row.region || '',
    status: row.alliance_status || row.programme_status || row.status || '',
    type: row.regime_type || row.type || '',
    issuer: row.issuer || '',
    target: row.target || '',
    reason: row.reason || '',
    entities: row.entities || row.listed_scope || '',
    impact: row.impact || '',
    basis: row.basis || '',
    sectors: parseList(row.sectors_json || row.sectors),
    instruments: parseList(row.instruments_json || row.instruments),
    exemptions: parseList(row.exemptions_json || row.exemptions),
    watch: parsePairs(row.watch_json),
    market: parsePairs(row.market_json),
    trail: parsePairs(row.trail_json),
    sources: parsePairs(row.sources_json),
    lat: Number(row.lat),
    lon: Number(row.lon),
    row,
  };
  p.source = p.sources[0]?.[1] || row.source_url || '';
  p.sourceLabel = p.sources[0]?.[0] || 'Official source';
  p.issuers = issuerTokens(p);
  return p;
}

export function statsFor(list) {
  const issuers = new Set();
  const regions = new Set();
  list.forEach((p) => {
    issuerTokens(p).forEach((x) => issuers.add(x));
    if (p.region) regions.add(p.region);
  });
  return { regimes: list.length, issuers: issuers.size, regions: regions.size };
}

const SAN_EU = [
  'Austria',
  'Belgium',
  'Bulgaria',
  'Croatia',
  'Cyprus',
  'Czechia',
  'Denmark',
  'Estonia',
  'Finland',
  'France',
  'Germany',
  'Greece',
  'Hungary',
  'Ireland',
  'Italy',
  'Latvia',
  'Lithuania',
  'Luxembourg',
  'Malta',
  'Netherlands',
  'Poland',
  'Portugal',
  'Romania',
  'Slovakia',
  'Slovenia',
  'Spain',
  'Sweden',
];

export function sanctionTargetCountries(p) {
  const s = `${p.id || ''} ${p.name || ''} ${p.target || ''}`.toLowerCase();
  const out = [];
  const add = (x) => {
    if (!out.includes(x)) out.push(x);
  };
  if (/russia|russian/.test(s)) add('Russian Federation');
  if (/\biran\b/.test(s)) add('Iran');
  if (/north korea|dprk/.test(s)) add('North Korea');
  if (/myanmar|burma/.test(s)) add('Myanmar');
  if (/venezuela/.test(s)) add('Venezuela');
  if (/belarus/.test(s)) add('Belarus');
  if (/cuba/.test(s)) add('Cuba');
  if (/zimbabwe/.test(s)) add('Zimbabwe');
  if (/nicaragua/.test(s)) add('Nicaragua');
  if (/syria/.test(s)) add('Syria');
  if (/china|xinjiang|uflpa/.test(s)) add('China');
  if (/mali|\baes\b/.test(s)) add('Mali');
  if (/houthi|ansar allah|yemen/.test(s)) add('Yemen');
  if (/hamas|pij/.test(s)) add('Palestine');
  if (/hezbollah/.test(s)) add('Lebanon');
  if (/fentanyl|drug cartel/.test(s)) add('Mexico');
  return out;
}

export function sanctionIssuerCountries(p) {
  const out = [];
  const add = (x) => {
    if (!out.includes(x)) out.push(x);
  };
  issuerTokens(p).forEach((t) => {
    if (t === 'EU') SAN_EU.forEach(add);
    else if (t === 'US') add('United States');
    else if (t === 'UK') add('United Kingdom');
    else if (t === 'Canada' || t === 'Japan' || t === 'Australia' || t === 'South Korea') add(t);
  });
  return out;
}

export function sanctionHeatRecords(p) {
  const targets = sanctionTargetCountries(p);
  const records = sanctionIssuerCountries(p).map((c) => ({
    country: c,
    color: '#63859a',
    label: 'Issuing jurisdiction',
    detail: 'Recorded programme issuer',
  }));
  targets.forEach((c) => {
    const i = records.findIndex((r) => r.country === c);
    if (i >= 0) records.splice(i, 1);
    records.push({ country: c, color: '#d94e35', label: 'Selected target geography', detail: p.name, focus: true });
  });
  return records;
}

export const SANCTIONS_MAP_LEGEND = [
  ['Selected target', '#d94e35'],
  ['Issuing jurisdiction', '#63859a'],
];

export function flattenSanction(p) {
  const sources = (p.sources || []).filter((s) => Array.isArray(s) && s[1]);
  return {
    id: p.id,
    __snId: p.id,
    title: p.name,
    name: p.name,
    programme: p.name,
    region: p.region,
    programme_status: p.status,
    status: p.status,
    regime_type: p.type,
    type: p.type,
    issuer: p.issuer,
    target: p.target,
    reason: p.reason,
    entities: p.entities,
    listed_scope: p.entities,
    impact: p.impact,
    basis: p.basis,
    sectors_json: JSON.stringify(p.sectors || []),
    instruments_json: JSON.stringify(p.instruments || []),
    exemptions_json: JSON.stringify(p.exemptions || []),
    watch_json: JSON.stringify(p.watch || []),
    market_json: JSON.stringify(p.market || []),
    trail_json: JSON.stringify(p.trail || []),
    sources_json: JSON.stringify(sources),
    source_url: sources[0]?.[1] || '',
    lat: p.lat,
    lon: p.lon,
  };
}
