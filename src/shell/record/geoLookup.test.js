import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import warTracker from '../../../public/data/embedded_csv/geopolitics_war_tracker.json';
import infra from '../../data/infra-projects.json';
import procurement from '../../../public/data/embedded_csv/geopolitics_defense_procurement.json';
import landmap from '../../data/landmap.json';
import leaders from '../../data/leaders.json';
import { COUNTRY_ALIASES, COUNTRY_CENTRES, TERRITORY_CENTRES, normaliseName } from './countryCentres.js';
import { countryPosition, KNOWN_COUNTRIES, regionPosition } from './geoLookup.js';
import { originCountry } from './touchRules.js';

// F121: maps place a record honestly. Region- and country-level positions are approximate by
// construction, so every one of them says so; an unknown place returns nothing, never a guess.
describe('approximate positions', () => {
  it('places every Open Fronts region, marked approximate', () => {
    for (const region of new Set(warTracker.map((r) => r.region))) {
      const pos = regionPosition(region);
      expect(pos, region).toMatchObject({ approximate: true });
      expect(pos.lat).toBeGreaterThanOrEqual(-90);
      expect(pos.lat).toBeLessThanOrEqual(90);
      expect(pos.lon).toBeGreaterThanOrEqual(-180);
      expect(pos.lon).toBeLessThanOrEqual(180);
    }
  });

  it('places every country the batch 1 registers name', () => {
    const countries = new Set([
      ...infra.projects.map((p) => p.country),
      ...procurement.map((r) => originCountry(r.vendor_or_origin)).filter(Boolean),
    ]);
    for (const country of countries) expect(countryPosition(country), country).toMatchObject({ approximate: true });
  });

  it('returns null for an unknown or empty place', () => {
    expect(regionPosition('Atlantis')).toBeNull();
    expect(countryPosition('')).toBeNull();
    expect(countryPosition(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// T14b: country centres for every sovereign state.
// ---------------------------------------------------------------------------------------------

// The independent roster and oracle: every UN member (193) plus Taiwan, Kosovo, Palestine and the
// Holy See (197), each with the bounding box of its own territory as [latMin, latMax, lonMin,
// lonMax], rounded outward (Russia, the United States and Fiji exclude their far-flung parts; island
// groups use the group the centre sits in). A centre outside its country's box is in the wrong
// country, on the wrong continent, or has its latitude and longitude swapped or signed wrongly.
const COUNTRY_BOX = {
  Afghanistan: [29, 39, 60, 75],
  Albania: [39, 43, 19, 21.5],
  Algeria: [18, 38, -9, 12],
  Andorra: [42, 43, 1, 2],
  Angola: [-19, -4, 11, 25],
  'Antigua and Barbuda': [16.9, 17.8, -62.4, -61.6],
  Argentina: [-56, -21, -74, -53],
  Armenia: [38.8, 41.4, 43.4, 46.7],
  Australia: [-44, -10, 112, 154],
  Austria: [46.3, 49.1, 9.5, 17.2],
  Azerbaijan: [38.3, 42, 44.7, 51],
  Bahamas: [20.8, 27.3, -79.5, -72.5],
  Bahrain: [25.5, 26.4, 50.3, 50.9],
  Bangladesh: [20.5, 26.7, 88, 92.7],
  Barbados: [13, 13.4, -59.7, -59.4],
  Belarus: [51, 56.2, 23, 33],
  Belgium: [49.4, 51.6, 2.5, 6.5],
  Belize: [15.8, 18.6, -89.3, -87.4],
  Benin: [6.1, 12.5, 0.7, 3.9],
  Bhutan: [26.6, 28.4, 88.7, 92.2],
  Bolivia: [-23, -9.6, -69.7, -57.4],
  'Bosnia and Herzegovina': [42.5, 45.3, 15.7, 19.7],
  Botswana: [-27, -17.7, 19.9, 29.5],
  Brazil: [-34, 5.4, -74, -34],
  Brunei: [4, 5.1, 114, 115.4],
  Bulgaria: [41.2, 44.3, 22.3, 28.7],
  'Burkina Faso': [9.4, 15.1, -5.6, 2.5],
  Burundi: [-4.5, -2.3, 28.9, 30.9],
  'Cabo Verde': [14.7, 17.3, -25.4, -22.6],
  Cambodia: [10.3, 14.8, 102.3, 107.7],
  Cameroon: [1.6, 13.1, 8.4, 16.3],
  Canada: [41.6, 83.2, -141, -52],
  'Central African Republic': [2.2, 11.1, 14.4, 27.5],
  Chad: [7.4, 23.5, 13.4, 24.1],
  Chile: [-56, -17.4, -76, -66.4],
  China: [18, 54, 73, 135.1],
  Colombia: [-4.3, 13.5, -79.1, -66.8],
  Comoros: [-12.5, -11.3, 43.1, 44.6],
  "Cote d'Ivoire": [4.3, 10.8, -8.7, -2.4],
  'Costa Rica': [8, 11.3, -86, -82.5],
  Croatia: [42.3, 46.6, 13.4, 19.5],
  Cuba: [19.8, 23.3, -85, -74],
  Cyprus: [34.5, 35.8, 32.2, 34.7],
  Czechia: [48.5, 51.1, 12, 18.9],
  'Democratic Republic of the Congo': [-13.5, 5.4, 12.1, 31.4],
  Denmark: [54.5, 57.8, 8, 15.2],
  Djibouti: [10.9, 12.8, 41.7, 43.5],
  Dominica: [15.1, 15.7, -61.5, -61.2],
  'Dominican Republic': [17.4, 20, -72.1, -68.3],
  Ecuador: [-5.1, 1.5, -81.1, -75.1],
  Egypt: [21.9, 31.7, 24.6, 36.9],
  'El Salvador': [13.1, 14.5, -90.2, -87.6],
  'Equatorial Guinea': [-1.5, 3.8, 5.5, 11.4],
  Eritrea: [12.3, 18.1, 36.4, 43.2],
  Estonia: [57.5, 59.8, 21.7, 28.3],
  Eswatini: [-27.4, -25.7, 30.7, 32.2],
  Ethiopia: [3.3, 14.9, 32.9, 48],
  Fiji: [-20.7, -12.4, 176.8, 180],
  Finland: [59.7, 70.2, 20.5, 31.7],
  France: [41.3, 51.2, -5.2, 9.6],
  Gabon: [-4, 2.4, 8.6, 14.6],
  Gambia: [13, 13.9, -16.9, -13.7],
  Georgia: [41, 43.7, 40, 46.8],
  Germany: [47.2, 55.1, 5.8, 15.1],
  Ghana: [4.7, 11.2, -3.3, 1.3],
  Greece: [34.7, 41.8, 19.3, 29.7],
  Grenada: [11.9, 12.6, -61.9, -61.5],
  Guatemala: [13.7, 17.9, -92.3, -88.2],
  Guinea: [7.1, 12.7, -15.2, -7.6],
  'Guinea-Bissau': [10.8, 12.7, -16.8, -13.6],
  Guyana: [1.1, 8.6, -61.5, -56.4],
  Haiti: [18, 20.1, -74.5, -71.6],
  'Holy See': [41.8, 42, 12.3, 12.6],
  Honduras: [12.9, 16.5, -89.4, -83.1],
  Hungary: [45.7, 48.6, 16.1, 22.9],
  Iceland: [63.3, 66.6, -24.6, -13.4],
  India: [6.7, 35.7, 68.1, 97.4],
  Indonesia: [-11, 6, 95, 141],
  Iran: [25, 39.8, 44, 63.4],
  Iraq: [29, 37.4, 38.8, 48.6],
  Ireland: [51.4, 55.4, -10.7, -5.9],
  Israel: [29.4, 33.4, 34.2, 35.9],
  Italy: [36.6, 47.1, 6.6, 18.6],
  Jamaica: [17.7, 18.6, -78.4, -76.2],
  Japan: [24, 45.6, 122.9, 146],
  Jordan: [29.1, 33.4, 34.9, 39.4],
  Kazakhstan: [40.5, 55.5, 46.4, 87.4],
  Kenya: [-4.7, 5.1, 33.9, 41.9],
  Kiribati: [-12, 5, 172, 178],
  Kosovo: [41.8, 43.3, 20, 21.9],
  Kuwait: [28.5, 30.1, 46.5, 48.5],
  Kyrgyzstan: [39.1, 43.3, 69.2, 80.3],
  Laos: [13.9, 22.5, 100, 107.7],
  Latvia: [55.6, 58.1, 20.9, 28.3],
  Lebanon: [33, 34.7, 35.1, 36.7],
  Lesotho: [-30.7, -28.5, 27, 29.5],
  Liberia: [4.3, 8.6, -11.5, -7.4],
  Libya: [19.5, 33.2, 9.3, 25.2],
  Liechtenstein: [47, 47.3, 9.4, 9.7],
  Lithuania: [53.9, 56.5, 20.9, 26.9],
  Luxembourg: [49.4, 50.2, 5.7, 6.6],
  Madagascar: [-25.7, -11.9, 43.2, 50.5],
  Malawi: [-17.2, -9.3, 32.6, 35.9],
  Malaysia: [0.8, 7.4, 99.6, 119.3],
  Maldives: [-0.8, 7.2, 72.6, 73.8],
  Mali: [10, 25, -12.3, 4.3],
  Malta: [35.7, 36.1, 14.1, 14.6],
  'Marshall Islands': [4.5, 14.7, 160.7, 172],
  Mauritania: [14.7, 27.3, -17.1, -4.8],
  Mauritius: [-20.6, -19.9, 57.2, 57.9],
  Mexico: [14.5, 32.8, -118.5, -86.7],
  Micronesia: [5.2, 10.1, 138, 163.2],
  Moldova: [45.4, 48.5, 26.6, 30.2],
  Monaco: [43.7, 43.8, 7.4, 7.5],
  Mongolia: [41.5, 52.2, 87.7, 119.9],
  Montenegro: [41.8, 43.6, 18.4, 20.4],
  Morocco: [27.6, 35.9, -13.2, -1],
  Mozambique: [-26.9, -10.4, 30.2, 41],
  Myanmar: [9.6, 28.6, 92.1, 101.2],
  Namibia: [-29, -16.9, 11.7, 25.3],
  Nauru: [-0.6, -0.5, 166.9, 167],
  Nepal: [26.3, 30.5, 80, 88.2],
  Netherlands: [50.7, 53.6, 3.3, 7.3],
  'New Zealand': [-47.4, -34.3, 166, 178.6],
  Nicaragua: [10.7, 15.1, -87.7, -82.6],
  Niger: [11.6, 23.6, 0.1, 16],
  Nigeria: [4.2, 13.9, 2.6, 14.7],
  'North Korea': [37.6, 43.1, 124.1, 130.8],
  'North Macedonia': [40.8, 42.4, 20.4, 23.1],
  Norway: [57.9, 71.2, 4.5, 31.2],
  Oman: [16.6, 26.4, 51.9, 59.9],
  Pakistan: [23.6, 37.1, 60.8, 77.9],
  Palau: [2.7, 8.2, 131.1, 134.8],
  Palestine: [31.2, 32.6, 34.2, 35.6],
  Panama: [7.1, 9.7, -83.1, -77.1],
  'Papua New Guinea': [-11.7, -0.8, 140.8, 157],
  Paraguay: [-27.7, -19.2, -62.7, -54.2],
  Peru: [-18.4, 0, -81.4, -68.6],
  Philippines: [4.5, 21.2, 116.9, 127],
  Poland: [49, 54.9, 14.1, 24.2],
  Portugal: [36.9, 42.2, -9.6, -6.1],
  Qatar: [24.4, 26.2, 50.7, 51.7],
  'Republic of the Congo': [-5.1, 3.7, 11.1, 18.7],
  Romania: [43.6, 48.3, 20.2, 29.8],
  Russia: [41, 82, 19, 180],
  Rwanda: [-3, -1, 28.8, 30.9],
  'Saint Kitts and Nevis': [17, 17.5, -63, -62.5],
  'Saint Lucia': [13.7, 14.2, -61.1, -60.8],
  'Saint Vincent and the Grenadines': [12.5, 13.4, -61.5, -61.1],
  Samoa: [-14.1, -13.4, -172.9, -171.4],
  'San Marino': [43.8, 44, 12.3, 12.6],
  'Sao Tome and Principe': [0, 1.8, 6.4, 7.5],
  'Saudi Arabia': [16.3, 32.2, 34.5, 55.7],
  Senegal: [12.3, 16.7, -17.6, -11.3],
  Serbia: [42.2, 46.2, 18.8, 23],
  Seychelles: [-10.3, -3.7, 46.2, 56.3],
  'Sierra Leone': [6.9, 10, -13.4, -10.3],
  Singapore: [1.2, 1.5, 103.6, 104.1],
  Slovakia: [47.7, 49.7, 16.8, 22.6],
  Slovenia: [45.4, 46.9, 13.3, 16.6],
  'Solomon Islands': [-12.4, -5.1, 155.5, 170.2],
  Somalia: [-1.7, 12, 41, 51.5],
  'South Africa': [-35, -22, 16.4, 33],
  'South Korea': [33, 38.7, 124.5, 131.9],
  'South Sudan': [3.4, 12.3, 23.4, 35.9],
  Spain: [35.9, 43.9, -9.4, 4.4],
  'Sri Lanka': [5.9, 9.9, 79.6, 82],
  Sudan: [8.6, 23.2, 21.8, 38.7],
  Suriname: [1.8, 6.1, -58.1, -53.9],
  Sweden: [55.3, 69.1, 10.9, 24.2],
  Switzerland: [45.8, 47.9, 5.9, 10.6],
  Syria: [32.3, 37.4, 35.6, 42.4],
  Taiwan: [21.8, 25.4, 119.9, 122.1],
  Tajikistan: [36.6, 41.1, 67.3, 75.2],
  Tanzania: [-11.8, -0.9, 29.3, 40.5],
  Thailand: [5.6, 20.5, 97.3, 105.7],
  'Timor-Leste': [-9.5, -8.1, 124.9, 127.4],
  Togo: [6.1, 11.2, -0.2, 1.9],
  Tonga: [-22.4, -15.5, -176, -173.5],
  'Trinidad and Tobago': [10, 11.4, -61.95, -60.5],
  Tunisia: [30.2, 37.6, 7.5, 11.6],
  Turkey: [35.8, 42.2, 25.6, 44.9],
  Turkmenistan: [35.1, 42.8, 52.4, 66.7],
  Tuvalu: [-10.9, -5.6, 176, 180],
  Uganda: [-1.5, 4.3, 29.5, 35.1],
  Ukraine: [44.3, 52.4, 22.1, 40.3],
  'United Arab Emirates': [22.6, 26.1, 51.5, 56.4],
  'United Kingdom': [49.9, 60.9, -8.7, 1.8],
  'United States': [24.5, 49.5, -125, -66.9],
  Uruguay: [-35, -30, -58.5, -53],
  Uzbekistan: [37.1, 45.6, 55.9, 73.2],
  Vanuatu: [-20.3, -13, 166.5, 170.3],
  Venezuela: [0.6, 12.2, -73.4, -59.8],
  Vietnam: [8.5, 23.4, 102.1, 109.5],
  Yemen: [12.1, 19, 42.5, 54.5],
  Zambia: [-18.1, -8.2, 22, 33.7],
  Zimbabwe: [-22.5, -15.6, 25.2, 33.1],
};
const TERRITORY_BOX = {
  'Hong Kong': [22.1, 22.6, 113.8, 114.5],
  Macao: [22.1, 22.3, 113.5, 113.7],
  // F122: territories on alliance rosters, each box the island group its centre sits in.
  'Cook Islands': [-22, -18.8, -160, -157.3],
  'French Polynesia': [-18, -16, -152, -148],
  'New Caledonia': [-22.8, -19.5, 163.5, 167.2],
  Niue: [-19.2, -18.9, -170, -169.7],
  Montserrat: [16.65, 16.83, -62.25, -62.13],
};
const ROSTER = Object.keys(COUNTRY_BOX);

const inBox = ([latMin, latMax, lonMin, lonMax], [lat, lon]) => lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;

// The land mask, decoded the way src/desks/GeoDotsMap.jsx does it: a 200 x 100 grid over
// [-180, 180] x [90, -90] (cells 1.8 degrees square), one bit per cell, row 0 at the north.
const LAND = (() => {
  const bytes = atob(landmap.b);
  const land = new Set();
  for (let i = 0; i < landmap.w * landmap.h; i++) {
    if (bytes.charCodeAt(i >> 3) & (1 << (i & 7))) land.add(i);
  }
  return land;
})();

/** True when a land cell lies within `cells` grid cells (1.8 degrees each) of the point's own cell. */
function landWithin(lat, lon, cells) {
  const gx = Math.min(landmap.w - 1, Math.floor(((lon + 180) / 360) * landmap.w));
  const gy = Math.min(landmap.h - 1, Math.floor(((90 - lat) / 180) * landmap.h));
  for (let dy = -cells; dy <= cells; dy++) {
    for (let dx = -cells; dx <= cells; dx++) {
      const y = gy + dy;
      if (y < 0 || y >= landmap.h) continue;
      const x = (gx + dx + landmap.w) % landmap.w;
      if (LAND.has(y * landmap.w + x)) return true;
    }
  }
  return false;
}

// A centre passes when it is on a land cell or within one cell (about 200 km) of one: the mask is
// coarse and its coastline is smoothed, so a point on a real coast can sit just outside it.
const LAND_TOLERANCE_CELLS = 1;

// States too small for the mask. Each is an island (or island group, or half of one) that the
// 1.8 degree grid does not resolve, so a centre that is exactly right on a map still has no land
// cell beside it. They are exempt from the land check, and checked instead against the state's
// capital (lat, lon, from the capital's own coordinates): the centre must lie within
// CAPITAL_RADIUS_KM of it, which on an island state means the right island. The list is a roster of
// exceptions, not a loophole: a test below fails if an entry no longer needs its exemption.
const SMALL_ISLAND_CAPITAL = {
  'Cook Islands': [-21.21, -159.78], // Avarua
  'French Polynesia': [-17.54, -149.57], // Papeete
  Niue: [-19.06, -169.92], // Alofi
  Montserrat: [16.79, -62.21], // Brades
  'Antigua and Barbuda': [17.12, -61.85], // St John's
  Barbados: [13.1, -59.61], // Bridgetown
  'Cabo Verde': [14.93, -23.51], // Praia
  Comoros: [-11.7, 43.26], // Moroni
  Dominica: [15.3, -61.39], // Roseau
  Fiji: [-18.14, 178.44], // Suva
  Kiribati: [1.33, 172.98], // South Tarawa
  Maldives: [4.18, 73.51], // Male
  Malta: [35.9, 14.51], // Valletta
  'Marshall Islands': [7.09, 171.38], // Majuro
  Mauritius: [-20.16, 57.5], // Port Louis
  Micronesia: [6.92, 158.16], // Palikir
  Nauru: [-0.55, 166.92], // Yaren
  Palau: [7.5, 134.62], // Ngerulmud
  'Saint Kitts and Nevis': [17.3, -62.72], // Basseterre
  'Saint Lucia': [14.01, -60.99], // Castries
  'Saint Vincent and the Grenadines': [13.16, -61.23], // Kingstown
  Samoa: [-13.83, -171.76], // Apia
  'Sao Tome and Principe': [0.34, 6.73], // Sao Tome
  Seychelles: [-4.62, 55.45], // Victoria
  'Timor-Leste': [-8.56, 125.57], // Dili
  Tonga: [-21.14, -175.2], // Nuku'alofa
  Tuvalu: [-8.52, 179.19], // Funafuti
  Vanuatu: [-17.73, 168.32], // Port Vila
};
const CAPITAL_RADIUS_KM = 150;

/** Great-circle distance in kilometres. */
function distanceKm([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

const ALL_CENTRES = { ...COUNTRY_CENTRES, ...TERRITORY_CENTRES };

// Names as the live feeds spell them. World Bank: country.value from api.worldbank.org. Constitute:
// country_id from www.constituteproject.org/service/constitutions?lang=en, captured 2026-10-13
// (every id the service returned, less the three historic German states Baden, Bavaria and Prussia).
const WORLD_BANK_NAMES = [
  'United States', 'China', 'India', 'Germany', 'Japan', 'United Kingdom', 'France', 'Brazil', 'Italy', 'Canada',
  'Russian Federation', 'Korea, Rep.', 'Australia', 'Mexico', 'Indonesia', 'Saudi Arabia', 'Turkiye', 'Netherlands',
  'Switzerland', 'Spain', "Korea, Dem. People's Rep.", 'Egypt, Arab Rep.', 'Iran, Islamic Rep.', 'Viet Nam', 'Slovak Republic',
  'Venezuela, RB', 'Yemen, Rep.', 'Congo, Dem. Rep.', 'Congo, Rep.', 'Gambia, The', 'Bahamas, The', 'Lao PDR',
  'Kyrgyz Republic', 'Syrian Arab Republic', 'Micronesia, Fed. Sts.', 'Czechia', 'Brunei Darussalam', 'Cabo Verde',
  "Cote d'Ivoire", 'St. Kitts and Nevis', 'St. Lucia', 'St. Vincent and the Grenadines', 'West Bank and Gaza', 'Eswatini',
  'Timor-Leste', 'Sao Tome and Principe', 'Bolivia', 'Tanzania', 'Moldova', 'North Macedonia', 'Kosovo', 'Myanmar',
  'Hong Kong SAR, China', 'Macao SAR, China',
];
const CONSTITUTE_IDS = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua_and_Barbuda', 'Argentina', 'Armenia',
  'Australia', 'Austria', 'Azerbaijan', 'Bahamas_the', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium',
  'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia_and_Herzegovina', 'Botswana', 'Brazil', 'Brunei_Darussalam',
  'Bulgaria', 'Burkina_Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Cape_Verde',
  'Central_African_Republic_the', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros_the', 'Congo_the', 'Costa_Rica',
  'Cote_d_Ivoire', 'Croatia', 'Cuba', 'Cyprus', 'Czech_Republic_the', 'Democratic_People_s_Republic_of_Korea_the',
  'Democratic_Republic_of_the_Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican_Republic_the', 'Ecuador',
  'Egypt', 'El_Salvador', 'Equatorial_Guinea', 'Eritrea', 'Estonia', 'Ethiopia', 'Fiji', 'Finland', 'France',
  'Gabon', 'Gambia__the', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau',
  'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran_Islamic_Rep_of_', 'Iraq',
  'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait',
  'Kyrgyzstan', 'Lao_People_s_Democratic_Republic__the', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya',
  'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta',
  'Marshall_Islands__the', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia__Fed_States_of_', 'Monaco', 'Mongolia',
  'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands_the', 'New_Zealand',
  'Nicaragua', 'Niger_the', 'Nigeria', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama',
  'Papua_New_Guinea', 'Paraguay', 'Peru', 'Philippines__the', 'Poland', 'Portugal', 'Qatar',
  'Republic_of_Korea__the', 'Republic_of_Moldova', 'Romania', 'Russian_Federation__the', 'Rwanda',
  'Saint_Kitts_and_Nevis', 'Saint_Lucia', 'Saint_Vincent_and_the_Grenadines', 'Samoa', 'Sao_Tome_and_Principe',
  'Saudi_Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra_Leone', 'Singapore', 'Slovakia', 'Slovenia',
  'Solomon_Islands', 'Somalia', 'South_Africa', 'South_Sudan', 'Spain', 'Sri_Lanka', 'Sudan_the', 'Suriname',
  'Swaziland', 'Sweden', 'Switzerland', 'Syrian_Arab_Republic_the', 'Taiwan', 'Tajikistan', 'Thailand',
  'The_former_Yugoslav_Republic_of_Macedonia', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad_and_Tobago', 'Tunisia',
  'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United_Arab_Emirates__the',
  'United_Kingdom_of_Great_Britain_and_Northern_Ireland__the', 'United_Republic_of_Tanzania__the',
  'United_States_of_America', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Venezuela', 'Viet_Nam', 'Yemen', 'Zambia',
  'Zimbabwe',
];

// What the other sources call countries: Wikidata labels (Heads of State), the common short forms
// of the registers, and the formal UN names.
const OTHER_SPELLINGS = [
  'USA', 'US', 'U.S.', 'UK', 'U.K.', 'Great Britain', 'UAE', 'South Korea', 'North Korea', 'DR Congo', 'DRC', 'Czechia',
  'Czech Republic', 'Ivory Coast', "Côte d'Ivoire", 'Myanmar', 'Burma', 'Eswatini', 'Swaziland', 'Türkiye', 'Turkey', 'Turkiye',
  'Cabo Verde', 'Cape Verde', 'Timor-Leste', 'East Timor', 'Vietnam', 'Laos', 'Russia', 'Brunei', 'Macedonia',
  'United States of America', "People's Republic of China", 'Democratic Republic of the Congo', 'Republic of the Congo',
  'Federated States of Micronesia', 'The Bahamas', 'The Gambia', 'Kingdom of the Netherlands', 'Vatican City', 'Holy See',
  'State of Palestine', 'Palestinian Territories', 'Republic of Korea', "Democratic People's Republic of Korea",
  "Lao People's Democratic Republic", 'United Republic of Tanzania', 'Republic of Moldova', 'Bolivia (Plurinational State of)',
  'Venezuela (Bolivarian Republic of)', 'Iran (Islamic Republic of)', 'Micronesia (Federated States of)',
  'United Kingdom of Great Britain and Northern Ireland', 'Sao Tome & Principe', 'São Tomé and Príncipe', 'Saint Kitts and Nevis',
  'St Lucia', 'Congo (Brazzaville)', 'Congo (Kinshasa)', 'Taiwan', 'Kosovo', 'Palestine',
];

const ISO_COUNTRY_NAMES = (() => {
  const src = readFileSync(new URL('../../../server/assetsApi.mjs', import.meta.url), 'utf8');
  const block = src.match(/const ISO_COUNTRY = \{([\s\S]*?)\n\};/);
  return block ? [...new Set([...block[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]))] : [];
})();

describe('country centres (T14b)', () => {
  it('covers exactly the 193 UN members plus Taiwan, Kosovo, Palestine and the Holy See', () => {
    expect(ROSTER).toHaveLength(197);
    expect(new Set(ROSTER).size).toBe(197);
    expect(Object.keys(COUNTRY_CENTRES).sort()).toEqual([...ROSTER].sort());
  });

  it('gives every entry a finite point on the globe', () => {
    for (const [name, [lat, lon]] of Object.entries(ALL_CENTRES)) {
      expect(Number.isFinite(lat) && Number.isFinite(lon), name).toBe(true);
      expect(lat, name).toBeGreaterThanOrEqual(-90);
      expect(lat, name).toBeLessThanOrEqual(90);
      expect(lon, name).toBeGreaterThanOrEqual(-180);
      expect(lon, name).toBeLessThanOrEqual(180);
    }
  });

  it("keeps every centre inside its own country's box, never in a neighbour or on another continent", () => {
    for (const [name, box] of Object.entries({ ...COUNTRY_BOX, ...TERRITORY_BOX })) {
      expect(inBox(box, ALL_CENTRES[name]), `${name} ${JSON.stringify(ALL_CENTRES[name])} is outside ${JSON.stringify(box)}`).toBe(true);
    }
  });

  it('puts every centre on land, or within one mask cell (1.8 degrees) of it', () => {
    for (const [name, [lat, lon]] of Object.entries(ALL_CENTRES)) {
      if (name in SMALL_ISLAND_CAPITAL) continue;
      expect(landWithin(lat, lon, LAND_TOLERANCE_CELLS), `${name} [${lat}, ${lon}] is in the sea`).toBe(true);
    }
  });

  it('puts every small island state on its capital island instead', () => {
    for (const [name, capital] of Object.entries(SMALL_ISLAND_CAPITAL)) {
      const km = distanceKm(ALL_CENTRES[name], capital);
      expect(km, `${name} is ${Math.round(km)} km from its capital`).toBeLessThanOrEqual(CAPITAL_RADIUS_KM);
    }
  });

  it('exempts only states that really need it', () => {
    for (const name of Object.keys(SMALL_ISLAND_CAPITAL)) {
      expect(ALL_CENTRES[name], `${name} is not a table entry`).toBeDefined();
      const [lat, lon] = ALL_CENTRES[name];
      expect(landWithin(lat, lon, LAND_TOLERANCE_CELLS), `${name} no longer needs its exemption`).toBe(false);
    }
  });

  it('proves the land check detects a sea point', () => {
    expect(landWithin(22, 79, 0)).toBe(true); // central India
    expect(landWithin(-30, -140, LAND_TOLERANCE_CELLS)).toBe(false); // the South Pacific
    expect(landWithin(0, -25, LAND_TOLERANCE_CELLS)).toBe(false); // the mid Atlantic
  });

  it('resolves every table entry through countryPosition, marked approximate', () => {
    for (const [name, [lat, lon]] of Object.entries(ALL_CENTRES)) {
      expect(countryPosition(name), name).toEqual({ lat, lon, approximate: true });
    }
  });

  it('leaves the ten original centres exactly as they were', () => {
    const original = {
      India: [22, 79],
      'Pan-India': [22, 79],
      France: [46.6, 2.4],
      Russia: [56, 40],
      USA: [39, -98],
      'United States': [39, -98],
      Iran: [32, 53],
      Myanmar: [21, 96],
      'Sri Lanka': [7.9, 80.7],
      Mauritius: [-20.3, 57.6],
    };
    for (const [name, [lat, lon]] of Object.entries(original)) {
      expect(countryPosition(name), name).toEqual({ lat, lon, approximate: true });
    }
  });

  it('leaves KNOWN_COUNTRIES (the origin-country matcher) exactly as it was', () => {
    expect(KNOWN_COUNTRIES).toEqual(['India', 'France', 'Russia', 'USA', 'United States', 'Iran', 'Myanmar', 'Sri Lanka', 'Mauritius']);
    expect(originCountry('Dassault Aviation, France')).toBe('France');
    expect(originCountry('Rolls-Royce, United Kingdom')).toBeNull();
  });

  it('leaves regionPosition as it was', () => {
    expect(regionPosition('Middle East')).toEqual({ lat: 31, lon: 42, approximate: true });
    expect(regionPosition('  EUROPE ')).toEqual({ lat: 50, lon: 12, approximate: true });
    expect(regionPosition('France')).toBeNull();
  });

  it('places every head of state country in leaders.json', () => {
    expect(leaders.leaders.length).toBeGreaterThan(20);
    for (const { country } of leaders.leaders) expect(countryPosition(country), country).toMatchObject({ approximate: true });
  });

  it('places every launch country the satellite loader can produce', () => {
    expect(ISO_COUNTRY_NAMES.length, 'could not read ISO_COUNTRY from server/assetsApi.mjs').toBeGreaterThan(10);
    for (const country of ISO_COUNTRY_NAMES) expect(countryPosition(country), country).toMatchObject({ approximate: true });
  });

  it('places every World Bank country name', () => {
    for (const name of WORLD_BANK_NAMES) expect(countryPosition(name), name).toMatchObject({ approximate: true });
  });

  it('places every Constitute country id, underscores and all', () => {
    expect(CONSTITUTE_IDS).toHaveLength(195);
    for (const id of CONSTITUTE_IDS) expect(countryPosition(id), id).toMatchObject({ approximate: true });
  });

  it('places the other spellings of the registers, the UN and Wikidata', () => {
    for (const name of OTHER_SPELLINGS) expect(countryPosition(name), name).toMatchObject({ approximate: true });
  });

  it('resolves an alias to the same point as the country it names', () => {
    for (const [canonical, aliases] of Object.entries(COUNTRY_ALIASES)) {
      expect(ALL_CENTRES[canonical], `${canonical} is not a table entry`).toBeDefined();
      for (const alias of aliases) expect(countryPosition(alias), alias).toEqual(countryPosition(canonical));
    }
  });

  it('never lets one name mean two places', () => {
    const owner = new Map();
    const claim = (name, canonical) => {
      const key = normaliseName(name);
      expect(owner.get(key) ?? canonical, `"${name}" names both ${owner.get(key)} and ${canonical}`).toBe(canonical);
      owner.set(key, canonical);
    };
    for (const name of Object.keys(ALL_CENTRES)) claim(name, name);
    for (const [canonical, aliases] of Object.entries(COUNTRY_ALIASES)) for (const alias of aliases) claim(alias, canonical);
  });

  it('ignores case, surrounding space, underscores and accents', () => {
    const korea = countryPosition('Korea, Rep.');
    expect(korea).not.toBeNull();
    expect(countryPosition('  KOREA, REP.  ')).toEqual(korea);
    expect(countryPosition('Bosnia_and_Herzegovina')).toEqual(countryPosition('Bosnia and Herzegovina'));
    expect(countryPosition('Gambia__the')).toEqual(countryPosition('Gambia'));
    expect(countryPosition('TÜRKIYE')).toEqual(countryPosition('Turkey'));
    expect(countryPosition('COTE D’IVOIRE')).toEqual(countryPosition('Ivory Coast')); // curly apostrophe
    expect(countryPosition('Kenia')).toBeNull(); // no fuzzy matching
    expect(countryPosition("Côte d'Ivoire")).toEqual(countryPosition('Ivory Coast'));
  });

  it('places Hong Kong and Macao at their own positions, not China\'s', () => {
    const china = countryPosition('China');
    for (const name of ['Hong Kong SAR, China', 'Hong Kong', 'Macao SAR, China', 'Macau']) {
      const pos = countryPosition(name);
      expect(pos, name).not.toBeNull();
      expect(pos, name).not.toEqual(china);
      expect(inBox([21, 24, 112, 115], [pos.lat, pos.lon]), name).toBe(true);
    }
  });

  it('refuses ambiguous, aggregate and unknown names rather than guess', () => {
    for (const name of ['Congo', 'Korea', 'Guinea Bissau Republic', 'World', 'European Union', 'Euro area', 'Low income', 'Sub-Saharan Africa', 'Atlantis', '   ', null, 42]) {
      expect(countryPosition(name), String(name)).toBeNull();
    }
  });

  it('does not resolve names inherited from Object.prototype', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(countryPosition(name), name).toBeNull();
      expect(regionPosition(name), name).toBeNull();
    }
  });
});

// F122: the alliance rosters name five territories; each is placed at its own position, and the
// non-states on rosters (the EU, the AU) are not places and stay unplaced.
describe('alliance roster territories', () => {
  it('places the five territories and leaves non-states unplaced', () => {
    for (const name of ['Cook Islands', 'French Polynesia', 'New Caledonia', 'Niue', 'Montserrat']) {
      const p = countryPosition(name);
      expect(p, name).toBeTruthy();
      expect(inBox(TERRITORY_BOX[name], [p.lat, p.lon]), name).toBe(true);
    }
    for (const name of ['European Union', 'African Union', 'EU', 'AU']) expect(countryPosition(name), name).toBeNull();
  });
});
