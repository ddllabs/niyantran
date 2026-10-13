export function isAlliancesFeature(name) {
  return /^alliances$/i.test(String(name || '').trim());
}

export const OBLIGATIONS = ['Mutual / collective', 'Security cooperation', 'Intelligence / command', 'Political / economic'];

export function obligationClass(p) {
  const t = `${p.obligation || ''} ${p.category || ''}`;
  if (/collective|mutual defence/i.test(p.obligation || '')) return 'Mutual / collective';
  if (/intelligence|aerospace warning|integrated command/i.test(t)) return 'Intelligence / command';
  if (/security|defence/i.test(p.obligation || '')) return 'Security cooperation';
  return 'Political / economic';
}

export function bindingType(p) {
  if (/treaty|convention|protocol/i.test(p.legalBasis || '')) return 'Treaty / protocol';
  if (/charter/i.test(p.legalBasis || '')) return 'Charter-based';
  if (/agreement/i.test(p.legalBasis || '')) return 'Agreement-based';
  // F122: nothing in the legal basis says what kind it is; no binding form is asserted.
  return 'Not stated';
}

function parseList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (!v) return [];
  try {
    const j = JSON.parse(v);
    if (Array.isArray(j)) return j.filter(Boolean);
  } catch {
    /* pipe or comma */
  }
  return String(v)
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** F122: the register holds no per-member standing, so none is asserted (flags set it where they exist). */
function defaultStanding() {
  return 'Not stated';
}

export function hydrateAlliance(row, flags = {}) {
  if (!row) return null;
  const members = parseList(row.members_json || row.members);
  const p = {
    id: row.id || row.__alId,
    name: row.name || row.title || row.alliance,
    short: row.short || row.acronym || '',
    category: row.category || row.structure || '',
    region: row.region || '',
    status: row.alliance_status || row.status || '',
    formed: String(row.formed || ''),
    seat: row.seat || '',
    legalBasis: row.legalBasis || row.legal_basis || '',
    decision: row.decision || '',
    obligation: row.obligation || '',
    scope: row.scope || '',
    chair: row.chair || '',
    latestDate: row.latestDate || row.latest_date || '',
    latest: row.latest || row.latest_development || '',
    next: row.next || '',
    members,
    memberCount: members.length || Number(row.memberCount) || 0,
    agenda: parseList(row.agenda_json || row.agenda),
    instruments: parseList(row.instruments_json || row.instruments),
    milestones: parseList(row.milestones_json || row.milestones),
    source: row.source_url || row.source || '',
    sourceLabel: row.source_label || row.sourceLabel || '',
    query: row.query || '',
    verified: row.verified || '',
    row,
  };
  p.obligationKind = row.obligation_class || obligationClass(p);
  p.flags = flags;
  return p;
}

export function memberRecord(p, country, flags = {}) {
  const base = {
    country,
    standing: defaultStanding(p),
    alignment: 'Recorded alignment',
    tone: 'aligned',
    basis: p.legalBasis,
    focus: p.agenda[0],
    evidence: 'Official roster entry confirmed. No formal exception is recorded in this embedded dossier; individual policy performance is not inferred.',
    source: p.source,
  };
  return { ...base, ...(flags[`${p.id}::${country}`] || {}) };
}

export function memberRecords(p, flags = p.flags || {}) {
  return (p.members || []).map((c) => memberRecord(p, c, flags));
}

export function memberSummary(p, flags = p.flags || {}) {
  const rows = memberRecords(p, flags);
  const out = { aligned: 0, differentiated: 0, transition: 0, exception: 0, review: 0 };
  rows.forEach((x) => {
    out[x.tone] = (out[x.tone] || 0) + 1;
  });
  out.active = rows.length - (out.exception || 0) - (out.review || 0);
  out.total = rows.length;
  return out;
}

export function overlaps(p, all) {
  const set = new Set(p.members || []);
  return (all || [])
    .filter((x) => x.id !== p.id)
    .map((x) => {
      const common = (x.members || []).filter((m) => set.has(m));
      return { p: x, n: common.length, common };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.p.name.localeCompare(b.p.name))
    .slice(0, 5);
}

export function statsFor(list) {
  const treaty = list.filter((p) => obligationClass(p) === 'Mutual / collective').length;
  const security = list.filter((p) => {
    const k = obligationClass(p);
    return k === 'Security cooperation' || k === 'Intelligence / command';
  }).length;
  return { tracked: list.length, treaty, security, dossiers: list.length };
}

export function flattenAlliance(p, flags = {}) {
  const members = p.members || [];
  return {
    id: p.id,
    __alId: p.id,
    title: p.name,
    name: p.name,
    alliance: p.name,
    short: p.short,
    category: p.category,
    structure: p.category,
    region: p.region,
    alliance_status: p.status,
    formed: p.formed,
    seat: p.seat,
    legalBasis: p.legalBasis,
    decision: p.decision,
    obligation: p.obligation,
    obligation_class: obligationClass(p),
    scope: p.scope,
    chair: p.chair,
    latestDate: p.latestDate,
    latest: p.latest,
    latest_development: p.latest,
    next: p.next,
    members_json: JSON.stringify(members),
    memberCount: members.length,
    agenda_json: JSON.stringify(p.agenda || []),
    instruments_json: JSON.stringify(p.instruments || []),
    milestones_json: JSON.stringify(p.milestones || []),
    source_url: p.source || '',
    source_label: p.sourceLabel || '',
    query: p.query || '',
    verified: p.verified || '',
  };
}

export function countryKey(v, aliases) {
  const k = String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]/g, '');
  return aliases[k] || k;
}

export const COUNTRY_ALIASES = {
  US: 'UNITEDSTATESOFAMERICA',
  USA: 'UNITEDSTATESOFAMERICA',
  UNITEDSTATES: 'UNITEDSTATESOFAMERICA',
  RUSSIA: 'RUSSIANFEDERATION',
  UK: 'UNITEDKINGDOM',
  BRITAIN: 'UNITEDKINGDOM',
  TURKEY: 'TURKIYE',
  CZECHREPUBLIC: 'CZECHIA',
  SOUTHKOREA: 'REPUBLICOFKOREA',
  KOREAREPUBLIC: 'REPUBLICOFKOREA',
  NORTHKOREA: 'DEMOCRATICPEOPLESREPUBLICOFKOREA',
  DRC: 'DEMOCRATICREPUBLICOFTHECONGO',
  CONGOKINSHASA: 'DEMOCRATICREPUBLICOFTHECONGO',
  CONGOBRAZZAVILLE: 'REPUBLICOFTHECONGO',
  TANZANIA: 'UNITEDREPUBLICOFTANZANIA',
  MOLDOVA: 'REPUBLICOFMOLDOVA',
  VENEZUELA: 'VENEZUELABOLIVARIANREPUBLICOF',
  BOLIVIA: 'BOLIVIAPLURINATIONALSTATEOF',
  SYRIA: 'SYRIANARABREPUBLIC',
  LAOS: 'LAOPEOPLESDEMOCRATICREPUBLIC',
  CABOVERDE: 'CABOVERDE',
  PALESTINE: 'PALESTINE',
  STATEOFPALESTINE: 'PALESTINE',
  BRUNEI: 'BRUNEIDARUSSALAM',
  ESWATINI: 'ESWATINI',
  MACEDONIA: 'NORTHMACEDONIA',
};
