// F196 Party Organisation Map, server side: the MLA register is read from the feed store (one page per
// state), counted by src/lib/partyStrength.js and kept for an hour. Locally, where no store is
// configured, the register's own workbook is read instead; never on the live site.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEED_REGISTERS } from '../../server/feedSchedule.mjs';
import { resetPartyStrengthCache, servePartyStrength } from '../../server/partyStrength.mjs';

const STATES = FEED_REGISTERS['state:MLA Directory'].values;
const member = (state, party, as_of = '2026-07-14') => ({ state, party, as_of, register_source_url: `https://en.wikipedia.org/wiki/${state.replace(/\W+/g, '_')}_Assembly` });

/** A store that holds, for every state, two members of one party and one of another. */
function fullStore(overrides = {}) {
  return vi.fn(async (_id, params) => {
    const state = params.get('state');
    if (Object.hasOwn(overrides, state)) return overrides[state];
    const rows = [member(state, 'Bharatiya Janata Party'), member(state, 'Bharatiya Janata Party', '2026-08-19'), member(state, 'Indian National Congress')];
    return { ok: true, rows, storeTotal: rows.length, served: 'store', register: true, fetchedAt: '2026-10-15T00:00:00.000Z' };
  });
}

const offline = () => vi.fn(async () => null);

beforeEach(() => resetPartyStrengthCache());
afterEach(() => vi.restoreAllMocks());

describe('servePartyStrength', () => {
  it('reads every state from the store, once an hour, and answers one row per state with the roll-up', async () => {
    const store = fullStore();
    const readWorkbook = vi.fn();
    let now = Date.parse('2026-10-15T10:00:00Z');
    const options = { store, readWorkbook, env: {}, now: () => now };
    const answer = await servePartyStrength(options);
    expect(store).toHaveBeenCalledTimes(STATES.length);
    expect(store.mock.calls.map(([id, params]) => [id, params.get('state')])).toEqual(STATES.map((s) => ['state:MLA Directory', s]));
    expect(readWorkbook).not.toHaveBeenCalled();
    expect(answer.adapter).toBe('register');
    expect(answer.rows).toHaveLength(STATES.length);
    expect(answer.rows.find((r) => r.state === 'Kerala')).toMatchObject({ seats: 3, largest_party: 'Bharatiya Janata Party', majority: 'Majority' });
    expect(answer.meta).toMatchObject({ view: 'party-map', as_of: '2026-08-19', totalSeats: 3 * STATES.length, states: STATES.length, source: 'store' });
    expect(answer.meta.national[0]).toEqual({ party: 'Bharatiya Janata Party', seats: 2 * STATES.length, share: 0.6667, states: STATES.length });
    expect(answer.note).toMatch(/as of 2026-08-19/);
    expect(answer.coverage).toEqual({ from: '', through: '2026-08-19', exhaustive: true });
    expect(answer.links).toContain('https://en.wikipedia.org/wiki/Kerala_Assembly');

    now += 30 * 60_000;
    await servePartyStrength(options);
    expect(store).toHaveBeenCalledTimes(STATES.length);
    now += 31 * 60_000;
    await servePartyStrength(options);
    expect(store).toHaveBeenCalledTimes(2 * STATES.length);
  });

  it('never counts a partial register: a state missing or cut short leaves the store unused', async () => {
    for (const broken of [null, { ok: true, rows: [member('Uttar Pradesh', 'Samajwadi Party')], storeTotal: 403 }]) {
      resetPartyStrengthCache();
      const answer = await servePartyStrength({ store: fullStore({ 'Uttar Pradesh': broken }), readWorkbook: vi.fn(), env: { VERCEL: '1' } });
      expect(answer.rows).toEqual([]);
      expect(answer.reason).toMatch(/MLA register/);
    }
  });

  it('reads the register’s workbook locally when the store has nothing, but never on the live site', async () => {
    const readWorkbook = vi.fn(() => [member('Goa', 'Bharatiya Janata Party'), member('Goa', 'Indian National Congress'), member('Goa', 'Bharatiya Janata Party')]);
    const local = await servePartyStrength({ store: offline(), readWorkbook, env: {} });
    expect(readWorkbook).toHaveBeenCalledTimes(1);
    expect(local.rows.map((r) => r.state)).toEqual(['Goa']);
    expect(local.meta.source).toBe('workbook');
    expect(local.coverage.exhaustive).toBe(false);

    resetPartyStrengthCache();
    const live = await servePartyStrength({ store: offline(), readWorkbook, env: { VERCEL: '1' } });
    expect(readWorkbook).toHaveBeenCalledTimes(1);
    expect(live.rows).toEqual([]);
  });

  it('in the archive pass answers only what it already counted, without asking the store', async () => {
    const store = fullStore();
    expect((await servePartyStrength({ store, readWorkbook: vi.fn(), archiveOnly: true, env: {} })).rows).toEqual([]);
    expect(store).not.toHaveBeenCalled();
    await servePartyStrength({ store, readWorkbook: vi.fn(), env: {} });
    const archived = await servePartyStrength({ store, readWorkbook: vi.fn(), archiveOnly: true, env: {}, now: () => Date.now() + 5 * 3_600_000 });
    expect(archived.rows).toHaveLength(STATES.length);
    expect(store).toHaveBeenCalledTimes(STATES.length);
  });
});

describe('the feature feed', () => {
  it('answers the module from the register instead of the planned state', async () => {
    vi.resetModules();
    vi.doMock('../../server/partyStrength.mjs', () => ({
      servePartyStrength: vi.fn(async () => ({ rows: [{ title: 'Goa', state: 'Goa', seats: 3 }], adapter: 'register', kind: 'register', links: [], note: 'n', coverage: { from: '', through: '2026-07-14', exhaustive: true }, meta: { view: 'party-map' }, fallback: false })),
    }));
    try {
      const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
      const body = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'Party Organisation Map' }));
      expect(body).toMatchObject({ ok: true, tier: 'state', feature: 'Party Organisation Map', source: { adapter: 'register' }, meta: { view: 'party-map' } });
      expect(body.rows).toEqual([{ title: 'Goa', state: 'Goa', seats: 3 }]);
    } finally {
      vi.doUnmock('../../server/partyStrength.mjs');
      vi.resetModules();
    }
  });
});
