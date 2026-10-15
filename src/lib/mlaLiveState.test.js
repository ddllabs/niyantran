// F190 review: when the store cannot answer a state (variant not served, time limit, database error)
// the live Wikidata branch answers, and it reads no `state`. A request for Kerala must never show another
// state's MLAs, and the answer kept for one state (the live attempt's and the edge's) must not reach another.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFeedCache, serveFeatureFeedStoredFirst } from '../../server/featureFeed.mjs';

const binding = (qid, name, state) => ({
  person: { type: 'uri', value: `http://www.wikidata.org/entity/${qid}` },
  personLabel: { type: 'literal', value: name },
  positionLabel: { type: 'literal', value: 'member of the legislative assembly' },
  stateLabel: { type: 'literal', value: state },
});
const WIKIDATA = [
  binding('Q1', 'Kerala Member', 'Kerala'), binding('Q2', 'Assam Member', 'Assam'), binding('Q3', 'Another Kerala Member', 'Kerala'),
  binding('Q4', 'Kashmir Member', 'Jammu and Kashmir'), binding('Q5', 'Goa Member', 'Goa'),
];
const sparql = (bindings) => new Response(JSON.stringify({ head: { vars: [] }, results: { bindings } }), { status: 200, headers: { 'content-type': 'application/sparql-results+json' } });
const noStore = { store: vi.fn(async () => null) };
const ask = (state) => serveFeatureFeedStoredFirst(new URLSearchParams({ tier: 'state', feature: 'MLA Directory', ...(state === undefined ? {} : { state }) }), noStore);
const real = (body) => body.rows.filter((r) => r.status !== 'source_status');

beforeEach(() => resetFeedCache());
afterEach(() => { vi.unstubAllGlobals(); resetFeedCache(); });

describe('MLA Directory live path with a state (F190 review)', () => {
  it('keeps only the requested state\'s rows, and an all-states request keeps them all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sparql(WIKIDATA)));
    const kerala = await ask('Kerala');
    expect(real(kerala).map((r) => r.title)).toEqual(['Kerala Member', 'Another Kerala Member']);
    expect(real(kerala).every((r) => r.state === 'Kerala')).toBe(true);
    resetFeedCache();
    expect(real(await ask(undefined))).toHaveLength(5);
  });

  it('reads the state as the register names it (a code, and "and" for "&")', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sparql(WIKIDATA)));
    expect(real(await ask('kl')).map((r) => r.title)).toEqual(['Kerala Member', 'Another Kerala Member']);
    resetFeedCache();
    expect(real(await ask('Jammu & Kashmir')).map((r) => r.title)).toEqual(['Kashmir Member']);
  });

  it('a second state does not get the first state\'s rows, from a live attempt in flight or one kept', async () => {
    const fetchSpy = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return sparql(WIKIDATA); });
    vi.stubGlobal('fetch', fetchSpy);
    // Asked together: one attempt must not serve both.
    const [kerala, assam] = await Promise.all([ask('Kerala'), ask('Assam')]);
    expect(real(kerala).map((r) => r.title)).toEqual(['Kerala Member', 'Another Kerala Member']);
    expect(real(assam).map((r) => r.title)).toEqual(['Assam Member']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Asked after: the kept answer is each state's own.
    expect(real(await ask('Assam')).map((r) => r.title)).toEqual(['Assam Member']);
  });

  it('a state the source has none of answers a plain status row, never another state\'s list or the all-India backup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sparql([binding('Q2', 'Assam Member', 'Assam')])));
    const kerala = await ask('Kerala');
    expect(real(kerala)).toEqual([]);
    expect(kerala.rows).toHaveLength(1);
    expect(kerala.rows[0]).toMatchObject({ status: 'source_status' });
    expect(kerala.rows[0].title).toMatch(/Kerala/);
    expect(kerala.rows[0].detail).toMatch(/Kerala.*not available right now/i);
    // Wikidata itself empty: the same, not the backup pack's all-India list.
    resetFeedCache();
    vi.stubGlobal('fetch', vi.fn(async () => sparql([])));
    const empty = await ask('Kerala');
    expect(real(empty)).toEqual([]);
    expect(empty.rows[0]).toMatchObject({ status: 'source_status' });
  });

  it('a name that is no state is ignored, as before', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sparql(WIKIDATA)));
    expect(real(await ask('Atlantis'))).toHaveLength(5);
  });
});
