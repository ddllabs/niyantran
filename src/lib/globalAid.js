export function isGlobalAidFeature(name) {
  return /^global aid$/i.test(String(name || '').trim());
}

export function money(v) {
  if (v == null || v === '') return 'Not stated';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  // Trailing zeros after the point are trimmed ("$2.5B", not "$2.50B"; F122).
  const trim = (s) => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (n >= 1e9) return `$${trim((n / 1e9).toFixed(n >= 10e9 ? 1 : 2))}B`;
  if (n >= 1e6) return `$${trim((n / 1e6).toFixed(n >= 100e6 ? 0 : 1))}M`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function compact(v) {
  if (v == null || v === '') return 'Not stated';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 100e6 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 100e3 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function coveragePct(p) {
  if (p.coverageComparable === false) return null;
  if (p.funded == null || !p.requirement) return null;
  return Math.max(0, Math.min(100, Math.round((Number(p.funded) / Number(p.requirement)) * 100)));
}

function parseList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (!v) return [];
  try {
    const j = JSON.parse(v);
    if (Array.isArray(j)) return j.filter(Boolean);
  } catch {
    /* pipe */
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

export function hydrateAppeal(row) {
  if (!row) return null;
  return {
    id: row.id || row.__gaId,
    name: row.name || row.title,
    agency: row.agency || '',
    region: row.region || '',
    geography: row.geography || '',
    type: row.programme_type || row.type || '',
    status: row.appeal_status || row.status || '',
    requirement: row.requirement === '' || row.requirement == null ? null : Number(row.requirement),
    funded: row.funded === '' || row.funded == null ? null : Number(row.funded),
    coverageComparable: row.coverageComparable !== 'false' && row.coverageComparable !== false,
    target: row.people_target === '' || row.people_target == null ? null : Number(row.people_target),
    need: row.people_need === '' || row.people_need == null ? null : Number(row.people_need),
    period: row.period || '',
    dataThrough: row.dataThrough || row.data_through || '',
    latestDate: row.latestDate || row.latest_date || '',
    latest: row.latest || '',
    brief: row.brief || '',
    source: row.source_url || row.source || '',
    sourceLabel: row.source_label || '',
    fundingNote: row.fundingNote || row.funding_note || '',
    sectors: parseList(row.sectors_json || row.sectors),
    delivery: row.delivery || '',
    coordinator: row.coordinator || '',
    indicators: parsePairs(row.indicators_json),
    milestones: parsePairs(row.milestones_json),
    row,
  };
}

export function statsFor(list) {
  const agencies = new Set();
  const regions = new Set();
  let requirement = 0;
  let funded = 0;
  let people = 0;
  list.forEach((p) => {
    if (p.agency) agencies.add(p.agency);
    if (p.region) regions.add(p.region);
    if (Number.isFinite(Number(p.requirement))) requirement += Number(p.requirement);
    if (Number.isFinite(Number(p.funded))) funded += Number(p.funded);
    if (Number.isFinite(Number(p.target))) people += Number(p.target);
  });
  return {
    programmes: list.length,
    institutions: agencies.size,
    regions: regions.size,
    requirement,
    funded,
    gap: Math.max(0, requirement - funded),
    people,
  };
}

export function flattenAppeal(p) {
  return {
    id: p.id,
    __gaId: p.id,
    title: p.name,
    name: p.name,
    agency: p.agency,
    region: p.region,
    geography: p.geography,
    programme_type: p.type,
    type: p.type,
    appeal_status: p.status,
    status: p.status,
    requirement: p.requirement,
    funded: p.funded,
    coverageComparable: p.coverageComparable === false ? 'false' : 'true',
    people_target: p.target,
    people_need: p.need,
    period: p.period,
    dataThrough: p.dataThrough,
    latestDate: p.latestDate,
    latest: p.latest,
    brief: p.brief,
    source_url: p.source || '',
    source_label: p.sourceLabel || '',
    fundingNote: p.fundingNote || '',
    sectors_json: JSON.stringify(p.sectors || []),
    delivery: p.delivery || '',
    coordinator: p.coordinator || '',
    indicators_json: JSON.stringify(p.indicators || []),
    milestones_json: JSON.stringify(p.milestones || []),
  };
}

export const AID_COUNTRIES = {
  afg26: 'Afghanistan',
  sdn26: 'Sudan',
  pal26: 'Palestine',
  som26: 'Somalia',
  yem26: 'Yemen',
  hti26: 'Haiti',
  ukr26: 'Ukraine',
  bfa26: 'Burkina Faso',
  lbn26: 'Lebanon',
};
