/**
 * F196 Party Organisation Map: party seat strength in each state assembly, counted from the MLA
 * register (MLA Directory's stored register, 4,104 MLAs in 31 states; server/partyStrength.mjs reads
 * it). Owner, 2026-10-15: the module means party strength per state, not party office-bearers.
 *
 * "Seats" are the members the register lists for a state, so a vacancy is not a seat here and the
 * majority mark is more than half of the members listed, which can be below half the assembly's full
 * strength. Plain data and functions, shared by the server and the page.
 */
import { MLA_STATE_NAMES } from './mlaStates.js';

export const PARTY_MAP_FEATURE = 'Party Organisation Map';

/** Whether a request (tier and feature name) is the Party Organisation Map. */
export function isPartyMapFeature(tier, feature) {
  return String(tier || '').toLowerCase() === 'state' && String(feature || '').trim().toLowerCase() === PARTY_MAP_FEATURE.toLowerCase();
}

export const NOT_RECORDED = 'Party not recorded';
const INDEPENDENT = 'Independent';

/**
 * The register's other spellings of a party (seen in backup/STATE/F30_MLA_Directory.xlsx, 2026-10-15),
 * by lower-case spelling. Two rows give a person's name where the party belongs; they count as not recorded.
 */
const PARTY_ALIASES = new Map(Object.entries({
  'bhartiya janata party': 'Bharatiya Janata Party',
  'bharatiya janta party': 'Bharatiya Janata Party',
  'independent politician': INDEPENDENT,
  'independent (politician)': INDEPENDENT,
  'trinamool congress': 'All India Trinamool Congress',
  'jammu and kashmir national conference': 'Jammu & Kashmir National Conference',
  "jammu and kashmir people's democratic party": "Jammu & Kashmir People's Democratic Party",
  'jammu and kashmir peoples democratic party': "Jammu & Kashmir People's Democratic Party",
  "national people's party (india)": "National People's Party",
  'ravi rana': NOT_RECORDED,
  'rajendra patil': NOT_RECORDED,
}));
const VACANCY = /^(casual )?vacan(t|cy)$/i;

/** A register party as one name; '' for a vacancy (no member), NOT_RECORDED when it gives none. */
export function partyName(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return NOT_RECORDED;
  if (VACANCY.test(text)) return '';
  return PARTY_ALIASES.get(text.toLowerCase()) || text;
}

const STATES = new Map(MLA_STATE_NAMES.flatMap(([name, code, ...aliases]) => [name, code, ...aliases].map((n) => [n.toLowerCase(), { name, code }])));
const stateOf = (raw) => STATES.get(String(raw ?? '').trim().toLowerCase()) || null;

const share = (part, whole) => (whole ? Math.round((part / whole) * 10_000) / 10_000 : 0);
const notAParty = (party) => party === INDEPENDENT || party === NOT_RECORDED;
const bySeats = (a, b) => b.seats - a.seats || Number(notAParty(a.party)) - Number(notAParty(b.party)) || a.party.localeCompare(b.party);

/**
 * Rows with `state`, `party` and `as_of` (the register's MLA rows) as:
 *   states: per state, in name order: { state, code, seats, parties: [{ party, seats, share }], largest,
 *           leaders, tie, majority, majorityMark, shortBy }. `largest` is null on a tie for the most seats
 *           (`leaders` names them); `majority` means the largest party holds more than half the seats.
 *   national: each party's MLAs across every assembly, with its share and its number of states.
 *   totalSeats, vacancies, asOf (the newest register date, YYYY-MM-DD, or '').
 */
export function aggregatePartyStrength(rows) {
  const counts = new Map();
  let vacancies = 0;
  let asOf = '';
  for (const row of Array.isArray(rows) ? rows : []) {
    const state = stateOf(row?.state);
    if (!state) continue;
    const party = partyName(row?.party);
    if (!party) {
      vacancies += 1;
      continue;
    }
    const date = String(row?.as_of || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date > asOf) asOf = date;
    if (!counts.has(state.name)) counts.set(state.name, { code: state.code, parties: new Map() });
    const parties = counts.get(state.name).parties;
    parties.set(party, (parties.get(party) || 0) + 1);
  }
  const states = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([state, { code, parties }]) => {
    const seats = [...parties.values()].reduce((sum, n) => sum + n, 0);
    const list = [...parties].map(([party, n]) => ({ party, seats: n, share: share(n, seats) })).sort(bySeats);
    const top = list[0]?.seats || 0;
    const leaders = list.filter((p) => p.seats === top).map((p) => p.party).sort((a, b) => a.localeCompare(b));
    const tie = leaders.length > 1;
    const majorityMark = Math.floor(seats / 2) + 1;
    return {
      state,
      code,
      seats,
      parties: list,
      largest: tie ? null : list[0] || null,
      leaders,
      tie,
      majority: !tie && top > seats / 2,
      majorityMark,
      shortBy: Math.max(0, majorityMark - top),
    };
  });
  const totalSeats = states.reduce((sum, s) => sum + s.seats, 0);
  const national = new Map();
  for (const s of states) {
    for (const p of s.parties) {
      const entry = national.get(p.party) || { party: p.party, seats: 0, states: 0 };
      entry.seats += p.seats;
      entry.states += 1;
      national.set(p.party, entry);
    }
  }
  return {
    states,
    national: [...national.values()].map((p) => ({ party: p.party, seats: p.seats, share: share(p.seats, totalSeats), states: p.states })).sort(bySeats),
    totalSeats,
    vacancies,
    asOf,
  };
}

const percent = (fraction) => Math.round(fraction * 1000) / 10;
const joinNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '');

/** One flat row per state (the module's rows: the table, the landing count and an AI attachment). */
export function partyStrengthRows(result) {
  return result.states.map((s) => ({
    title: s.state,
    state: s.state,
    state_code: s.code,
    seats: s.seats,
    largest_party: s.tie ? `Tied: ${joinNames(s.leaders)}` : s.largest?.party || '',
    largest_seats: s.parties[0]?.seats || 0,
    largest_share: percent(s.parties[0]?.share || 0),
    majority: s.tie ? 'Tied for the most seats' : s.majority ? 'Majority' : `Short of majority by ${s.shortBy}`,
    majority_mark: s.majorityMark,
    breakdown: s.parties.map((p) => `${p.party} ${p.seats}`).join(' · '),
    parties: s.parties,
    tie: s.tie,
    leaders: s.leaders,
    as_of: result.asOf,
  }));
}
