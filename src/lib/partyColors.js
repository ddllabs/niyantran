/**
 * F196 Party Organisation Map: one stable colour and short name per party, the same in light and dark
 * themes (the map's borders and text take the theme's tokens). The parties that lead an assembly or
 * rank high nationally have their customary colours, chosen to stay apart from one another; any other
 * party takes a muted colour picked by its name, so it never changes between visits.
 */
import { NOT_RECORDED } from './partyStrength.js';

const KNOWN = Object.freeze({
  'Bharatiya Janata Party': ['BJP', '#ff9933'],
  'Indian National Congress': ['INC', '#19aaed'],
  'Aam Aadmi Party': ['AAP', '#1f4e9c'],
  'Telugu Desam Party': ['TDP', '#f2d200'],
  'Tamilaga Vettri Kazhagam': ['TVK', '#b8860b'],
  'Samajwadi Party': ['SP', '#e53935'],
  'Janata Dal (United)': ['JD(U)', '#2c3e50'],
  'All India Trinamool Congress': ['AITC', '#66bb6a'],
  'Dravida Munnetra Kazhagam': ['DMK', '#a83232'],
  'Shiv Sena': ['SHS', '#f4743b'],
  'Biju Janata Dal': ['BJD', '#00796b'],
  'Nationalist Congress Party': ['NCP', '#00acc1'],
  'Communist Party of India (Marxist)': ['CPI(M)', '#c62828'],
  'All India Anna Dravida Munnetra Kazhagam': ['AIADMK', '#43a047'],
  'Jammu & Kashmir National Conference': ['JKNC', '#d7263d'],
  'Jharkhand Mukti Morcha': ['JMM', '#1b5e20'],
  "National People's Party": ['NPP', '#e377c2'],
  "Zoram People's Movement": ['ZPM', '#7e57c2'],
  "Naga People's Front": ['NPF', '#8c564b'],
  'All India N.R. Congress': ['AINRC', '#17becf'],
  'Sikkim Krantikari Morcha': ['SKM', '#9e1f63'],
  'Rashtriya Janata Dal': ['RJD', '#2e7d32'],
  'Bharat Rashtra Samithi': ['BRS', '#ec407a'],
  'YSR Congress Party': ['YSRCP', '#1565c0'],
  Independent: ['IND', '#9e9e9e'],
  [NOT_RECORDED]: ['N/R', '#bdbdbd'],
});

/** Muted colours for every other party, apart from the known ones. */
const OTHERS = ['#8d6e63', '#78909c', '#a1887f', '#7986cb', '#4db6ac', '#ba68c8', '#9ccc65', '#ffb74d', '#90a4ae', '#f06292'];

function hash(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

/** A party's colour (#rrggbb). */
export function partyColor(party) {
  return KNOWN[party]?.[1] || OTHERS[hash(party) % OTHERS.length];
}

/** A party's short name: its usual abbreviation, else the initials of its words. */
export function partyShort(party) {
  if (KNOWN[party]) return KNOWN[party][0];
  const words = String(party || '').replace(/\(.*?\)/g, ' ').split(/[\s-]+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|and|the|for|&)$/i.test(w));
  return words.length > 1 ? words.map((w) => w[0].toUpperCase()).join('') : String(party || '').slice(0, 6);
}
