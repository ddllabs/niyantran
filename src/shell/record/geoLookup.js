/**
 * Approximate positions for Global record maps (F121). Rows that carry their own coordinates use
 * them; everything else is placed at a region or country centre from these tables, and is always
 * returned with `approximate: true` so the map can say so. An unknown place returns null; the
 * panel then shows no marker rather than a guess.
 */
import { COUNTRY_ALIASES, COUNTRY_CENTRES, TERRITORY_CENTRES, normaliseName } from './countryCentres.js';

/** Open Fronts register regions → a representative centre [lat, lon]. */
const REGIONS = {
  'middle east': [31, 42],
  'south asia': [26, 76],
  'west africa': [12, -3],
  'east africa': [6, 38],
  'south america': [-12, -62],
  'central africa': [2, 20],
  'southeast asia': [13, 104],
  'east asia': [34, 118],
  europe: [50, 12],
  'north africa': [28, 12],
  'central america': [14, -87],
  'eastern europe': [49, 32],
  caucasus: [41, 45],
  'central asia': [42, 66],
  'southern africa': [-22, 25],
  'north america': [43, -100],
  caribbean: [19, -72],
};

/**
 * Country centres (T14b): every sovereign state, from countryCentres.js, keyed by its normalised
 * name and by each normalised alias. The table is built once; a Map keeps names such as
 * "constructor" from resolving to something inherited.
 */
const COUNTRIES = (() => {
  const index = new Map();
  const all = { ...COUNTRY_CENTRES, ...TERRITORY_CENTRES };
  for (const [name, pair] of Object.entries(all)) index.set(normaliseName(name), pair);
  for (const [name, aliases] of Object.entries(COUNTRY_ALIASES)) {
    for (const alias of aliases) index.set(normaliseName(alias), all[name]);
  }
  return index;
})();

const at = (pair) => (pair ? { lat: pair[0], lon: pair[1], approximate: true } : null);
const key = (name) => String(name ?? '').trim().toLowerCase();

export const regionPosition = (name) => at(Object.hasOwn(REGIONS, key(name)) ? REGIONS[key(name)] : null);
export const countryPosition = (name) => at(COUNTRIES.get(normaliseName(name)));
export const KNOWN_COUNTRIES = ['India', 'France', 'Russia', 'USA', 'United States', 'Iran', 'Myanmar', 'Sri Lanka', 'Mauritius'];
