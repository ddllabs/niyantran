/**
 * Related-record rules for Global record panels (F121). Every relation here is computed from data
 * the terminal holds, by a documented rule; it is a relation on record, not an assessed impact. A
 * rule that finds nothing returns an empty result and the panel lists nothing for it (F204).
 */
import { KNOWN_COUNTRIES } from './geoLookup.js';

/**
 * Curated geography: the chokepoints on the Maritime Choke-Points board that lie in or border each
 * Open Fronts region. Names must match the board exactly (tested).
 */
export const REGION_CHOKEPOINTS = {
  'Middle East': ['Strait of Hormuz', 'Bab-el-Mandeb', 'Suez Canal', 'Hodeidah (port)', 'Fujairah (bunker hub)'],
  'Eastern Europe': ['Kerch Strait', 'Turkish Straits (Bosphorus)'],
  Europe: ['Danish Straits', 'Strait of Gibraltar', 'Turkish Straits (Bosphorus)'],
  'North Africa': ['Suez Canal', 'Strait of Gibraltar'],
  'East Africa': ['Bab-el-Mandeb', 'Djibouti (port/bases)'],
  'South Asia': ['Gwadar (port, CPEC)', 'Hambantota (port)'],
  'Southeast Asia': ['Strait of Malacca', 'Sunda Strait', 'Lombok / Makassar'],
  'East Asia': ['Taiwan Strait'],
  'Central America': ['Panama Canal'],
  'Southern Africa': ['Cape of Good Hope'],
};

export const chokepointsForRegion = (region) => REGION_CHOKEPOINTS[String(region ?? '').trim()] || [];

/**
 * The origin country named in a vendor field: the last comma-separated part, when it is exactly a
 * known country ("Dassault Aviation, France" → France). Anything else ("Naval Group + Mazagon Dock",
 * "Indian Navy") states no origin and returns null.
 */
export function originCountry(vendor) {
  const parts = String(vendor ?? '').split(',');
  const last = parts.length > 1 ? parts[parts.length - 1].trim().toLowerCase() : '';
  const found = KNOWN_COUNTRIES.find((c) => c.toLowerCase() === last) || null;
  return found === 'United States' ? 'USA' : found;
}

const norm = (value) => String(value ?? '').trim().toLowerCase();

/** How many other rows share this row's value in `field` (case-insensitive); 0 when the value is empty. */
export function othersSharing(rows, row, field) {
  const value = norm(row?.[field]);
  if (!value) return 0;
  const list = rows || [];
  // The selection may be a copy of its feed row; find the row it stands for so it is not counted.
  const self = list.includes(row) ? row : list.find((r) => (row?.id != null && r?.id === row.id) || (row?.title && r?.title === row.title));
  return list.filter((r) => r !== self && norm(r?.[field]) === value).length;
}
