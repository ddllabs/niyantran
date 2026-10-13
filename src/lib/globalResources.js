export function isWorldConstitutionsFeature(name) {
  return /^world constitutions$/i.test(String(name || '').trim());
}

export function isGrowthIndicatorsFeature(name) {
  return /^growth indicators$/i.test(String(name || '').trim());
}

export function isHeadsOfStateFeature(name) {
  return /^heads of state$/i.test(String(name || '').trim());
}

export function isGlobalCommoditiesFeature(name) {
  return /^global commodities$/i.test(String(name || '').trim());
}

export function isNewsWireFeature(name) {
  return /^geopolitics news wire$/i.test(String(name || '').trim());
}

export function isGeoResourceDossier(name) {
  return isHeadsOfStateFeature(name) || isGlobalCommoditiesFeature(name);
}

export function isGlobalResourcesTable(name) {
  return isWorldConstitutionsFeature(name) || isGrowthIndicatorsFeature(name);
}

/**
 * The Heads of State rows from the pack (F122): each leader flattened, rows without a name dropped,
 * and a pointer row ("Ukraine (see Zelensky)") dropped when the leader it points to is in the pack,
 * so a country is not listed twice. A pointer whose target is missing is kept.
 */
export function leadersFromPack(pack) {
  const list = Array.isArray(pack?.leaders) ? pack.leaders : [];
  const names = list.map((p) => String(p?.name || '').toLowerCase());
  const isPointerToHeld = (p) => {
    const m = /\(see ([^)]+)\)\s*$/i.exec(String(p?.name || ''));
    if (!m) return false;
    const target = m[1].trim().toLowerCase();
    return names.some((n, i) => list[i] !== p && !/\(see /i.test(n) && n.includes(target));
  };
  return list.filter((p) => !isPointerToHeld(p)).map(flattenLeader).filter((r) => r.name);
}

export function flattenLeader(p) {
  const name = String(p.name || '').trim();
  const role = String(p.role || p.office || '').trim();
  const placeholder =
    !name ||
    /^not verified$/i.test(name) ||
    /^(us )?president$/i.test(name) ||
    /^prime minister$/i.test(name) ||
    (role && name.toLowerCase() === role.toLowerCase());
  return {
    id: p.id || '',
    title: placeholder ? 'Not verified' : name || p.country || '',
    name: placeholder ? 'Not verified' : name,
    country: p.country || '',
    flag: p.flag || '',
    office: role || p.office || '',
    role: role || p.office || '',
    status: p.status || (placeholder ? 'Not verified' : 'Tracked'),
    term_start: p.term_start || p.since || '',
    since: p.since || p.term_start || '',
    next_transition: p.next_transition || p.next_election || 'Not reported',
    last_verified: p.last_verified || p.as_of || '',
    party: p.party || '',
    ideology: p.ideology || '',
    age: p.age == null ? '' : p.age,
    latest: p.latest || '',
    authority: p.authority || (p.acting ? 'Acting / interim' : 'De jure (as listed)'),
    iso: String(p.id || '')
      .replace(/\d+$/, '')
      .slice(0, 2)
      .toUpperCase(),
    source_url: p.source_url || 'https://www.wikidata.org/',
  };
}

export function flattenCommodity(item, group) {
  const [name, level, change, pct] = Array.isArray(item) ? item : [];
  return {
    title: name || '',
    commodity: name || '',
    group: group || '',
    level: level || '',
    change: change || '',
    pct: Number(pct) || 0,
    source_url: 'https://www.worldbank.org/en/research/commodity-markets',
  };
}

export function commoditiesFromPack(pack) {
  const rows = [];
  for (const grp of pack?.groups || []) {
    for (const item of grp.items || []) {
      rows.push(flattenCommodity(item, grp.g));
    }
  }
  return rows;
}
