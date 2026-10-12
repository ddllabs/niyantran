/**
 * Approximate positions for Global record maps (F121). Rows that carry their own coordinates use
 * them; everything else is placed at a region or country centre from these tables, and is always
 * returned with `approximate: true` so the map can say so. An unknown place returns null; the
 * panel then shows no marker rather than a guess.
 */

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

/** Countries named by the Global registers → a representative centre [lat, lon]. */
const COUNTRIES = {
  india: [22, 79],
  'pan-india': [22, 79],
  france: [46.6, 2.4],
  russia: [56, 40],
  usa: [39, -98],
  'united states': [39, -98],
  iran: [32, 53],
  myanmar: [21, 96],
  'sri lanka': [7.9, 80.7],
  mauritius: [-20.3, 57.6],
};

const at = (pair) => (pair ? { lat: pair[0], lon: pair[1], approximate: true } : null);
const key = (name) => String(name ?? '').trim().toLowerCase();

export const regionPosition = (name) => at(REGIONS[key(name)]);
export const countryPosition = (name) => at(COUNTRIES[key(name)]);
export const KNOWN_COUNTRIES = ['India', 'France', 'Russia', 'USA', 'United States', 'Iran', 'Myanmar', 'Sri Lanka', 'Mauritius'];
