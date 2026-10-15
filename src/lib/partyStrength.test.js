// F196 Party Organisation Map: party seat strength per state assembly, counted from the MLA register.
import { describe, expect, it } from 'vitest';
import { MLA_STATES } from './mlaStates.js';
import { aggregatePartyStrength, isPartyMapFeature, partyName, partyStrengthRows } from './partyStrength.js';
import geo from '../data/india-states-geo.json';
import { projectStateSummary, stateModule } from './stateLandingSummary.js';

const mla = (state, party, as_of = '2026-07-14') => ({ state, party, as_of });
const many = (n, state, party, as_of) => Array.from({ length: n }, () => mla(state, party, as_of));

describe('partyName', () => {
  it('merges the register’s spellings of one party', () => {
    for (const raw of ['Bharatiya Janata Party', 'Bhartiya Janata Party', 'Bharatiya Janta Party', ' Bharatiya  Janata Party ']) {
      expect(partyName(raw)).toBe('Bharatiya Janata Party');
    }
    for (const raw of ['Independent', 'Independent politician', 'Independent (politician)']) expect(partyName(raw)).toBe('Independent');
    expect(partyName('Trinamool Congress')).toBe('All India Trinamool Congress');
    expect(partyName('Jammu and Kashmir National Conference')).toBe('Jammu & Kashmir National Conference');
    expect(partyName("Jammu and Kashmir Peoples Democratic Party")).toBe("Jammu & Kashmir People's Democratic Party");
    expect(partyName("National People's Party (India)")).toBe("National People's Party");
    expect(partyName('Indian National Congress')).toBe('Indian National Congress');
  });

  it('reads a vacancy as no member and a missing or personal name as not recorded', () => {
    expect(partyName('Casual vacancy')).toBe('');
    expect(partyName('')).toBe('Party not recorded');
    expect(partyName(undefined)).toBe('Party not recorded');
    expect(partyName('Ravi Rana')).toBe('Party not recorded');
  });
});

describe('aggregatePartyStrength', () => {
  it('counts each state’s seats by party, with shares, the largest party and the majority flag', () => {
    const rows = [
      ...many(6, 'Kerala', 'Indian National Congress'),
      ...many(3, 'Kerala', 'Communist Party of India (Marxist)'),
      ...many(1, 'Kerala', 'Independent politician'),
      ...many(4, 'Goa', 'Bharatiya Janata Party'),
      ...many(3, 'Goa', 'Indian National Congress'),
      ...many(3, 'Goa', 'Independent'),
    ];
    const { states } = aggregatePartyStrength(rows);
    const kerala = states.find((s) => s.state === 'Kerala');
    expect(kerala).toMatchObject({ state: 'Kerala', code: 'KL', seats: 10, majorityMark: 6, majority: true, shortBy: 0, tie: false });
    expect(kerala.largest).toEqual({ party: 'Indian National Congress', seats: 6, share: 0.6 });
    expect(kerala.parties).toEqual([
      { party: 'Indian National Congress', seats: 6, share: 0.6 },
      { party: 'Communist Party of India (Marxist)', seats: 3, share: 0.3 },
      { party: 'Independent', seats: 1, share: 0.1 },
    ]);
    const goa = states.find((s) => s.state === 'Goa');
    // 4 of 10 is not more than half: the largest party is short of a majority by two.
    expect(goa).toMatchObject({ seats: 10, majorityMark: 6, majority: false, shortBy: 2, tie: false });
    expect(goa.largest.party).toBe('Bharatiya Janata Party');
  });

  it('needs more than half: exactly half is not a majority', () => {
    const { states } = aggregatePartyStrength([...many(5, 'Sikkim', 'Sikkim Krantikari Morcha'), ...many(5, 'Sikkim', 'Sikkim Democratic Front')]);
    expect(states[0]).toMatchObject({ seats: 10, majority: false, tie: true, largest: null });
    expect(states[0].leaders).toEqual(['Sikkim Democratic Front', 'Sikkim Krantikari Morcha']);
  });

  it('marks a tie for the most seats and names no largest party', () => {
    const { states } = aggregatePartyStrength([
      ...many(4, 'Manipur', 'Bharatiya Janata Party'),
      ...many(4, 'Manipur', 'Indian National Congress'),
      ...many(2, 'Manipur', "Naga People's Front"),
    ]);
    expect(states[0]).toMatchObject({ tie: true, largest: null, majority: false, shortBy: 2 });
    expect(states[0].leaders).toEqual(['Bharatiya Janata Party', 'Indian National Congress']);
  });

  it('leaves vacancies and unknown states out of the seats, and counts the vacancies', () => {
    const result = aggregatePartyStrength([
      ...many(3, 'Punjab', 'Aam Aadmi Party'),
      mla('Punjab', 'Casual vacancy'),
      mla('Atlantis', 'Aam Aadmi Party'),
      mla('', 'Aam Aadmi Party'),
    ]);
    expect(result.states).toHaveLength(1);
    expect(result.states[0].seats).toBe(3);
    expect(result.vacancies).toBe(1);
    expect(result.totalSeats).toBe(3);
  });

  it('rolls up each party’s MLAs across assemblies, with the number of states and the newest register date', () => {
    const result = aggregatePartyStrength([
      ...many(3, 'Gujarat', 'Bharatiya Janata Party', '2026-07-14'),
      ...many(1, 'Gujarat', 'Indian National Congress', '2026-07-14'),
      ...many(2, 'Haryana', 'Bharatiya Janata Party', '2026-08-19'),
      ...many(2, 'Haryana', 'Indian National Congress', '2026-07-17'),
    ]);
    expect(result.national).toEqual([
      { party: 'Bharatiya Janata Party', seats: 5, share: 0.625, states: 2 },
      { party: 'Indian National Congress', seats: 3, share: 0.375, states: 2 },
    ]);
    expect(result.totalSeats).toBe(8);
    expect(result.asOf).toBe('2026-08-19');
    expect(result.states.map((s) => s.state)).toEqual(['Gujarat', 'Haryana']);
  });

  it('accepts the store’s other spellings of a state', () => {
    const { states } = aggregatePartyStrength([mla('Orissa', 'Biju Janata Dal'), mla('NCT of Delhi', 'Aam Aadmi Party')]);
    expect(states.map((s) => s.state)).toEqual(['Delhi', 'Odisha']);
  });
});

describe('partyStrengthRows', () => {
  it('gives one flat row per state for the table, with the majority in words', () => {
    const rows = partyStrengthRows(aggregatePartyStrength([
      ...many(4, 'Goa', 'Bharatiya Janata Party'),
      ...many(3, 'Goa', 'Indian National Congress'),
      ...many(3, 'Goa', 'Independent'),
      ...many(2, 'Mizoram', "Zoram People's Movement"),
      ...many(2, 'Mizoram', 'Mizo National Front'),
    ]));
    expect(rows[0]).toMatchObject({
      title: 'Goa', state: 'Goa', seats: 10, largest_party: 'Bharatiya Janata Party', largest_seats: 4, largest_share: 40,
      majority: 'Short of majority by 2', breakdown: 'Bharatiya Janata Party 4 · Indian National Congress 3 · Independent 3',
    });
    expect(rows[1]).toMatchObject({ state: 'Mizoram', largest_party: "Tied: Mizo National Front and Zoram People's Movement", majority: 'Tied for the most seats' });
  });
});

describe('the map’s names', () => {
  it('has a shape for every state the register can hold', () => {
    const shapes = new Set(geo.states.map((s) => s.name));
    expect(MLA_STATES.filter((name) => !shapes.has(name))).toEqual([]);
  });

  it('knows the module by tier and name only', () => {
    expect(isPartyMapFeature('state', 'Party Organisation Map')).toBe(true);
    expect(isPartyMapFeature('state', ' party organisation map ')).toBe(true);
    expect(isPartyMapFeature('national', 'Party Organisation Map')).toBe(false);
    expect(isPartyMapFeature('state', 'MLA Directory')).toBe(false);
  });
});

describe('the State landing card', () => {
  it('counts the assemblies the register covers and says what a seat means', () => {
    const module = stateModule('Party Organisation Map');
    expect(module).toMatchObject({ tier: 'state', configured: true });
    const rows = partyStrengthRows(aggregatePartyStrength([...many(3, 'Goa', 'Bharatiya Janata Party', '2026-08-19'), ...many(2, 'Kerala', 'Indian National Congress')]));
    const summary = projectStateSummary(module, {
      ok: true, tier: 'state', feature: 'Party Organisation Map', rows,
      source: { adapter: 'register', kind: 'register', links: ['https://www.wikidata.org/'], note: 'n' },
      meta: { view: 'party-map', as_of: '2026-08-19' },
    });
    expect(summary).toMatchObject({ count: 2, unit: 'state assemblies', availability: 'ready', asOf: '2026-08-19' });
    expect(summary.limitations).toMatch(/Seats are the MLAs the register lists/);
    expect(summary.columns.map((c) => c.key)).not.toContain('parties');
  });
});
