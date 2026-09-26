export function isGlobalTradeFeature(name) {
  return /^global trade$/i.test(String(name || '').trim());
}

export function isCriticalMineralsFeature(name) {
  return /^critical minerals$/i.test(String(name || '').trim());
}

export function isEnergyFeature(name) {
  return /^energy$/i.test(String(name || '').trim());
}

export function isGeonomicsTable(name) {
  return isGlobalTradeFeature(name) || isCriticalMineralsFeature(name);
}

export const ENERGY_STATUS = {
  active: { c: '#ff6f6f', l: 'CONCENTRATED' },
  escalating: { c: '#4a90e2', l: 'WEAPONISED' },
};

export function energyStatusOf(s) {
  return ENERGY_STATUS[s] || { c: '#7fb0ff', l: String(s || 'WATCH').toUpperCase() };
}

export function flattenMineralRef(p) {
  return {
    title: p.name || '',
    mineral: p.name || '',
    producers: p.producers || '',
    note: p.note || '',
    source_url: 'https://www.usgs.gov/centers/national-minerals-information-center',
  };
}

export function flattenEnergyMineral(p) {
  const src = Array.isArray(p.sources) && p.sources[0] ? p.sources[0][1] : 'https://www.usgs.gov/';
  return {
    id: p.id || '',
    title: p.name || '',
    name: p.name || '',
    region: p.region || '',
    lat: p.lat,
    lon: p.lon,
    status: p.status || '',
    intensity: p.intensity,
    use: p.use || '',
    topProducers: p.topProducers || '',
    chinaShare: p.chinaShare || '',
    latest: p.note || '',
    note: p.note || '',
    sources: p.sources || [],
    source_url: src,
  };
}
