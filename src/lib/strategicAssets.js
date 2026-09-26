export function strategicKind(name) {
  const n = String(name || '').trim();
  if (/^infra$/i.test(n)) return 'infra';
  if (/^nuclear watch$/i.test(n)) return 'nuclear';
  if (/^satellite infrastructure$/i.test(n)) return 'satellite';
  if (/^maritime choke-?points$/i.test(n)) return 'chokepoint';
  return '';
}

export function isStrategicAssetFeature(name) {
  return Boolean(strategicKind(name));
}

export function isNuclearWatchFeature(name) {
  return strategicKind(name) === 'nuclear';
}

export function isChokepointsFeature(name) {
  return strategicKind(name) === 'chokepoint';
}

export const CHOKE_STATUS = {
  active: { c: '#ff6f6f', l: 'ACTIVE' },
  escalating: { c: '#4a90e2', l: 'ESCALATING' },
  watch: { c: '#7fb0ff', l: 'WATCH' },
};

export function chokeStatusOf(s) {
  return CHOKE_STATUS[s] || { c: '#7fb0ff', l: String(s || 'WATCH').toUpperCase() };
}

function parsePairs(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (!v) return [];
  try {
    const j = JSON.parse(v);
    if (Array.isArray(j)) return j.filter(Boolean);
  } catch {
    /* ignore */
  }
  return [];
}

export function operatorCountries(operators) {
  return String(operators || '')
    .split('/')
    .map((t) =>
      t
        .replace(/\([^)]*\)/g, '')
        .replace(/\b(coasts?|waters|occupied|lease|operator|controlled|adjunct|bases?|hub)\b/gi, '')
        .trim(),
    )
    .filter((t) => t && t.length > 1 && !/houthi|not a country/i.test(t))
    .map((t) => {
      if (/^PRC$/i.test(t)) return 'China';
      if (/^UK$/i.test(t)) return 'United Kingdom';
      if (/^UAE$/i.test(t)) return 'United Arab Emirates';
      if (/turkiye|turkey/i.test(t)) return 'Turkey';
      if (/^Gib$/i.test(t)) return 'United Kingdom';
      return t;
    })
    .filter((t, i, a) => a.indexOf(t) === i);
}

export function hydrateAsset(row, kind) {
  if (!row) return null;
  const k = kind || row.__saKind || '';
  const sources = parsePairs(row.sources_json);
  const p = {
    kind: k,
    id: row.id || row.__saId,
    name: row.name || row.title || '',
    region: row.region || '',
    country: row.country || '',
    status: row.status || '',
    sector: row.sector || row.kind || row.facility_kind || '',
    operators: row.operators || row.operator || row.provider || '',
    oil: row.oil || '',
    width: row.width || '',
    risk: row.risk || '',
    note: row.note || row.detail || row.latest || row.role || '',
    expected: row.expected || row.net || '',
    capacity: row.capacity || '',
    material: row.material || '',
    safeguards: row.safeguards || '',
    precision: row.precision || '',
    scope: row.scope || '',
    facilityKind: row.facility_kind || row.kind || '',
    sourceLabel: row.source_label || sources[0]?.[0] || '',
    source: row.source_url || sources[0]?.[1] || '',
    sources,
    pad: row.pad || '',
    provider: row.provider || '',
    lat: Number(row.lat),
    lon: Number(row.lon),
    row,
  };
  if (!p.id) return null;
  return p;
}

export function flattenChokepoint(p) {
  const sources = (p.sources || []).filter((s) => Array.isArray(s) && s[1]);
  return {
    id: p.id,
    __saId: p.id,
    __saKind: 'chokepoint',
    title: p.name,
    name: p.name,
    region: p.region,
    status: p.status,
    operators: p.operators,
    oil: p.oil,
    width: p.width,
    risk: p.risk,
    intensity: p.intensity,
    note: p.note,
    lat: p.lat,
    lon: p.lon,
    sources_json: JSON.stringify(sources),
    source_url: sources[0]?.[1] || '',
    source_label: sources[0]?.[0] || '',
  };
}

export function flattenInfra(p) {
  return {
    id: p.id,
    __saId: p.id,
    __saKind: 'infra',
    title: p.name,
    name: p.name,
    sector: p.sector,
    region: p.region,
    country: p.country,
    status: p.status,
    expected: p.expected,
    detail: p.detail,
    note: p.detail,
    source_url: p.source || '',
    source_label: p.sourceLabel || '',
  };
}

export function flattenNuclear(p) {
  return {
    id: p.id,
    __saId: p.id,
    __saKind: 'nuclear',
    title: p.name,
    name: p.name,
    facility_kind: p.kind,
    kind: p.kind,
    region: p.region,
    country: p.country,
    status: p.status,
    lat: p.lat,
    lon: p.lon,
    precision: p.precision,
    operator: p.operator,
    operators: p.operator,
    scope: p.scope,
    capacity: p.capacity,
    material: p.material,
    safeguards: p.safeguards,
    source_url: p.source || '',
    source_label: p.sourceLabel || '',
    latest: p.latest,
    note: p.latest,
    role: p.role,
    checked: p.checked,
  };
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

export function heatFor(kind, selected, list) {
  if (!selected) return [];
  if (kind === 'chokepoint') {
    const focus = new Set(operatorCountries(selected.operators));
    const others = new Set();
    list.forEach((p) => operatorCountries(p.operators).forEach((c) => others.add(c)));
    const records = [...others]
      .filter((c) => !focus.has(c))
      .map((c) => ({ country: c, color: '#a7c4d3', label: 'Other recorded operator', detail: 'Appears on another chokepoint in this register' }));
    focus.forEach((c) => {
      records.push({ country: c, color: '#d94e35', label: 'Selected operator geography', detail: selected.name, focus: true });
    });
    return records;
  }
  if (kind === 'infra' || kind === 'nuclear' || kind === 'satellite') {
    const focus = selected.country;
    const others = unique(list.map((p) => p.country).filter((c) => c && c !== focus));
    const records = others.map((c) => ({
      country: c,
      color: '#63859a',
      label: kind === 'infra' ? 'Other project country' : kind === 'nuclear' ? 'Other facility country' : 'Other launch geography',
      detail: 'Present in this register',
    }));
    if (focus) {
      records.push({
        country: focus,
        color: '#d94e35',
        label: kind === 'infra' ? 'Selected project country' : kind === 'nuclear' ? 'Selected facility country' : 'Selected launch geography',
        detail: selected.name,
        focus: true,
      });
    }
    return records;
  }
  return [];
}

export function deskCopy(kind) {
  if (kind === 'chokepoint') {
    return {
      title: 'MARITIME CHOKE-POINTS',
      kicker: 'Chokepoint register',
      sub: 'Operator geography · source-linked · not a closure score',
      liveTitle: 'IMF PortWatch',
      liveUrl: '/api/portwatch',
      liveHint: 'Daily AIS-derived transit calls · ~3-day lag',
      search: 'Search strait, canal, region or operator',
      empty: 'Chokepoint register is unavailable.',
      mapTitle: (p) => `Operator geography · ${p.name}`,
      mapSub: (p) => {
        const n = operatorCountries(p.operators).length;
        return n
          ? `${n} mapped operator ${n === 1 ? 'jurisdiction' : 'jurisdictions'} · not a disruption score`
          : 'Operator geography not resolved to a country polygon';
      },
      legend: [
        ['Selected operators', '#d94e35'],
        ['Other recorded operators', '#a7c4d3'],
      ],
      fit: false,
      columns: ['Asset', 'Region', 'Operators', 'Oil / cargo', 'Status'],
      filters: ['region', 'status'],
    };
  }
  if (kind === 'infra') {
    return {
      title: 'INFRA',
      kicker: 'Strategic infrastructure register',
      sub: 'Public project records · country geography',
      liveTitle: 'World Bank projects',
      liveUrl: '/api/wb-projects',
      liveHint: 'Recent World Bank project approvals · not this curated register',
      search: 'Search project, sector or country',
      empty: 'Infrastructure register is unavailable.',
      mapTitle: (p) => `Project geography · ${p.name}`,
      mapSub: (p) => `${p.country || p.region} · curated public projects, not a delivery score`,
      legend: [
        ['Selected project country', '#d94e35'],
        ['Other projects in register', '#63859a'],
      ],
      fit: false,
      columns: ['Project', 'Sector', 'Location', 'Status', 'Expected'],
      filters: ['sector', 'status'],
    };
  }
  if (kind === 'nuclear') {
    return {
      title: 'NUCLEAR WATCH',
      kicker: 'Public-source facility register',
      sub: 'IAEA / Red Book / SIPRI-linked records · not an inventory',
      liveTitle: 'Arsenal reference — FAS / SIPRI estimates',
      liveUrl: '',
      liveHint: 'Curated estimates · as of 2025/2026 · not a live count',
      search: 'Search facility, country, operator or material',
      empty: 'Nuclear register is unavailable.',
      mapTitle: (p) => `Facility geography · ${p.name}`,
      mapSub: (p) => `${p.country} · ${p.precision || 'public coordinates'} · not a readiness score`,
      legend: [
        ['Selected facility country', '#d94e35'],
        ['Other facility countries', '#63859a'],
      ],
      fit: false,
      columns: ['Facility / country', 'Class / region', 'Status', 'Latest source record'],
      filters: ['region', 'facilityKind', 'status'],
    };
  }
  return {
    title: 'SATELLITE INFRASTRUCTURE',
    kicker: 'Upcoming launches',
    sub: 'The Space Devs Launch Library · live upcoming roster',
    liveTitle: 'CelesTrak — last 30 days',
    liveUrl: '/api/celestrak',
    liveHint: 'Newly catalogued objects · not a constellation score',
    search: 'Search launch, provider or pad',
    empty: 'Upcoming launch roster is unavailable.',
    mapTitle: (p) => `Launch geography · ${p.name}`,
    mapSub: (p) => `${p.pad || p.country || 'Pad'} · ${p.expected || ''} · not a cadence score`,
    legend: [
      ['Selected launch geography', '#d94e35'],
      ['Other pads in this roster', '#63859a'],
    ],
    fit: false,
    columns: ['Launch', 'Provider', 'Pad', 'NET (UTC)', 'Status'],
    filters: ['provider', 'status'],
  };
}

export function statsFor(kind, list) {
  if (kind === 'chokepoint') {
    return [
      [list.length, 'Chokepoints'],
      [unique(list.map((p) => p.region)).length, 'Regions'],
      [list.filter((p) => /escalat/i.test(p.status)).length, 'Escalating'],
    ];
  }
  if (kind === 'infra') {
    return [
      [list.length, 'Projects'],
      [unique(list.map((p) => p.country)).length, 'Countries'],
      [unique(list.map((p) => p.sector)).length, 'Sectors'],
    ];
  }
  if (kind === 'nuclear') {
    return [
      [list.length, 'Records'],
      [unique(list.map((p) => p.country)).length, 'Countries'],
      [unique(list.map((p) => p.facilityKind)).length, 'Classes'],
    ];
  }
  return [
    [list.length, 'Launches'],
    [unique(list.map((p) => p.provider)).length, 'Providers'],
    [unique(list.map((p) => p.country)).length, 'Pad countries'],
  ];
}
