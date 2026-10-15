// MLA Directory's register (owner decision C6, option 1): 4,104 MLAs in 31 store variants, one per
// state (kind reference: a load replaces the state's list), loaded by scripts/load-feed-register.mjs
// and never refreshed by the timer. The page serves a state's variant whatever its age and labels it as a dated register.
// The fixture is four real rows of backup/STATE/F30_MLA_Directory.xlsx as server/backupFeed.mjs reads
// them (a subset of the sheet's columns; the e-mail is a placeholder), copied here so no test reads backup/.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFeedCache, scheduledModuleId, serveFeatureFeed, serveFeatureFeedStoredFirst } from '../../server/featureFeed.mjs';
import { STORE_PAGE_ROWS, serveFromStore, storeVariant } from '../../server/feedServe.mjs';
import { FEED_REGISTERS, itemKeyFor } from '../../server/feedSchedule.mjs';
import {
  REGISTERS,
  buildRegisterItems,
  groupByVariant,
  main,
  mapMlaRegisterRow,
  mlaItemKey,
  registerMeta,
  registerRunsFor,
  runFor,
  wikidataEntity,
} from '../../scripts/load-feed-register.mjs';
import { asOfLabel, plainSourceLine } from './plainSourceNote.js';

const MLA = 'state:MLA Directory';
const STATES = FEED_REGISTERS[MLA].values;
const sheet = { active: 'TRUE', record_age_days: '58', source_retrieved_at: '46275.38862', 'Mohan Singh Bisht': 'Anil Kumar Sharma', email: 'someone@example.com' };
const KERALA = {
  ...sheet,
  record_id: 'NYT-30-01d0c234155f6a8e', record_title: 'Adv. C. V. Santhakumar', record_date: '2026-07-14', geography: 'Kerala',
  party: 'Indian National Congress', constituency: 'Adoor', state: 'Kerala', education: 'Graduate Professional',
  constituency_id: 'ac-kl-adoor', current_position: 'Member of the Legislative Assembly, Kerala', name: 'Adv. C. V. Santhakumar',
  politician_id: 'adoor-ac-kl-adv-c-v-santhakumar', state_code: 'KL', wikidata_qid: 'Q139918608', assets_total: '₹72,82,160 (~72 Lacs)',
  criminal_cases_declared: '0', liabilities_total: '₹10,00,000 (~10 Lacs)', districts: 'Pathanamthitta', profession: '',
  age: 'Born 1 January 1980 (age 46)', source_provider: 'Wikipedia - 16th Kerala Assembly (ECI results)',
  source_url: 'https://en.wikipedia.org/wiki/16th_Kerala_Assembly', source_published_at: '2026-07-14', title: 'Adv. C. V. Santhakumar', date: '2026-07-14',
};
// No Wikidata QID (167 of the register's rows): keyed by the register's politician_id.
const NO_QID = {
  ...sheet,
  record_id: 'NYT-30-6f4af6bb8657dc41', record_title: 'Lekhiya Soni', record_date: '2026-07-14', geography: 'Arunachal Pradesh',
  party: 'Nationalist Congress Party', constituency: 'Lekang', state: 'Arunachal Pradesh', education: 'Illiterate',
  constituency_id: 'ac-ar-lekang', current_position: 'Member of the Legislative Assembly, Arunachal Pradesh', name: 'Lekhiya Soni',
  politician_id: 'lekang-ac-ar-lekhiya-soni', state_code: 'AR', wikidata_qid: '', assets_total: '₹11,54,01,178 (~11 Crore)',
  criminal_cases_declared: '4', liabilities_total: '₹79,59,789 (~79 Lacs)', districts: 'Lohit', profession: '', age: '',
  source_provider: 'Wikipedia - 11th Arunachal Pradesh Assembly (ECI results)',
  source_url: 'https://en.wikipedia.org/wiki/11th_Arunachal_Pradesh_Assembly', source_published_at: '2026-07-14', title: 'Lekhiya Soni', date: '2026-07-14',
};
// A by-election member, dated a month later.
const BY_ELECTION = {
  ...sheet,
  record_id: 'NYT-30-0ab608f80fe90f8a', record_title: 'Nyato Dukam', record_date: '2026-08-19', geography: 'Arunachal Pradesh',
  party: 'Bharatiya Janata Party', constituency: 'Taliha', state: 'Arunachal Pradesh', education: '', constituency_id: 'ac-ar-taliha',
  current_position: 'Cabinet Minister, Arunachal Pradesh', name: 'Nyato Dukam', politician_id: 'taliha-ac-ar-nyato-rigia', state_code: 'AR',
  wikidata_qid: 'Q126304862', assets_total: '', criminal_cases_declared: '', liabilities_total: '', districts: 'Upper Subansiri',
  profession: '', age: '', source_provider: 'Wikipedia - 11th Arunachal Pradesh Assembly (ECI results)',
  source_url: 'https://en.wikipedia.org/wiki/11th_Arunachal_Pradesh_Assembly', source_published_at: '2026-08-19', title: 'Nyato Dukam', date: '2026-08-19',
};
const JK = {
  ...sheet,
  record_id: 'NYT-30-24fe5fb01719113c', record_title: 'Mohan Lal', record_date: '2026-07-14', geography: 'Jammu & Kashmir',
  party: 'Bharatiya Janata Party', constituency: 'Akhnoor', state: 'Jammu & Kashmir', education: 'Post Graduate', constituency_id: 'ac-jk-akhnoor',
  current_position: 'Member of the Legislative Assembly, Jammu & Kashmir', name: 'Mohan Lal', politician_id: 'akhnoor-ac-jk-mohan-lal',
  state_code: 'JK', wikidata_qid: 'Q130553556', assets_total: '₹3,52,48,098 (~3 Crore)', criminal_cases_declared: '0',
  liabilities_total: '₹72,87,577 (~72 Lacs)', districts: 'Jammu', profession: '', age: '',
  source_provider: 'Wikipedia - 13th Jammu and Kashmir Assembly (ECI results)',
  source_url: 'https://en.wikipedia.org/wiki/13th_Jammu_and_Kashmir_Assembly', source_published_at: '2026-07-14', title: 'Mohan Lal', date: '2026-07-14',
};
const FIXTURE = [KERALA, BY_ELECTION, JK, NO_QID];
const REGISTER = REGISTERS[MLA];

// ---------------------------------------------------------------------------------------------
// The mapping: register row -> live MLA Directory row.

/** The live loader's row for one Wikidata binding (server/featureFeed.mjs, wikidataRows), fetched through a stub. */
async function liveRowFor({ qid, name, position, state }) {
  const binding = {
    person: { type: 'uri', value: `http://www.wikidata.org/entity/${qid}` },
    personLabel: { type: 'literal', value: name },
    positionLabel: { type: 'literal', value: position },
    stateLabel: { type: 'literal', value: state },
  };
  const body = JSON.stringify({ head: { vars: ['person', 'personLabel', 'positionLabel', 'stateLabel'] }, results: { bindings: [binding] } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/sparql-results+json' } })));
  try {
    resetFeedCache();
    const answer = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'MLA Directory' }));
    expect(answer.source.adapter).toBe('api');
    return answer.rows[0];
  } finally {
    vi.unstubAllGlobals();
    resetFeedCache();
  }
}

describe('mapMlaRegisterRow: a register row as the live MLA Directory row', () => {
  it('maps field by field to the live shape, with the register\'s own fields beside them', () => {
    expect(mapMlaRegisterRow(KERALA)).toEqual({
      row: {
        person: 'Adv. C. V. Santhakumar',
        personLabel: 'Adv. C. V. Santhakumar',
        positionLabel: 'Member of the Legislative Assembly, Kerala',
        stateLabel: 'Kerala',
        position: 'Member of the Legislative Assembly, Kerala',
        state: 'Kerala',
        date: '',
        title: 'Adv. C. V. Santhakumar',
        party: 'Indian National Congress',
        constituency: 'Adoor',
        constituency_id: 'ac-kl-adoor',
        districts: 'Pathanamthitta',
        education: 'Graduate Professional',
        birth_date: '1980-01-01',
        state_code: 'KL',
        politician_id: 'adoor-ac-kl-adv-c-v-santhakumar',
        wikidata_qid: 'Q139918608',
        as_of: '2026-07-14',
        register_id: 'NYT-30-01d0c234155f6a8e',
        register_source: 'Wikipedia - 16th Kerala Assembly (ECI results)',
        register_source_url: 'https://en.wikipedia.org/wiki/16th_Kerala_Assembly',
        source_url: 'https://www.wikidata.org/entity/Q139918608',
      },
    });
  });

  it('has every field of the live row, and the item key a live refresh gives the same person', async () => {
    const live = await liveRowFor({ qid: 'Q139918608', name: 'Adv. C. V. Santhakumar', position: 'member of the Kerala Legislative Assembly', state: 'Kerala' });
    const { row } = mapMlaRegisterRow(KERALA);
    for (const key of Object.keys(live)) expect(row, key).toHaveProperty(key);
    expect(row.source_url).toBe(live.source_url);
    expect(mlaItemKey(row)).toBe(itemKeyFor(live));
    expect(mlaItemKey(row)).toBe('url:wikidata.org/entity/Q139918608');
  });

  it('without a QID: the register\'s citation is the link, and the key is the register\'s politician id', () => {
    const { row } = mapMlaRegisterRow(NO_QID);
    expect(row.source_url).toBe('https://en.wikipedia.org/wiki/11th_Arunachal_Pradesh_Assembly');
    expect(row).not.toHaveProperty('wikidata_qid');
    expect(mlaItemKey(row)).toBe('mla:lekang-ac-ar-lekhiya-soni');
    // Two members cited by the same assembly page stay two items.
    const other = { ...NO_QID, name: 'Someone Else', title: 'Someone Else', record_title: 'Someone Else', constituency: 'Lohit', politician_id: 'lohit-ac-ar-someone-else' };
    expect(buildRegisterItems([NO_QID, other], REGISTER, 'official').items).toHaveLength(2);
  });

  it('leaves out the e-mail, the stray header column, the age, the money and case columns, the day-dependent columns and empty cells', () => {
    const { row } = mapMlaRegisterRow({ ...KERALA, profession: 'politician' });
    for (const key of ['email', 'Mohan Singh Bisht', 'record_age_days', 'source_retrieved_at', 'active', 'record_title', 'geography', 'profession',
      'age', 'assets_total', 'liabilities_total', 'criminal_cases_declared']) {
      expect(row, key).not.toHaveProperty(key);
    }
  });

  it('keeps the birth date only, as ISO when it parses, never the age (which goes out of date)', () => {
    const birth = (age) => mapMlaRegisterRow({ ...KERALA, age }).row.birth_date;
    expect(birth('Born 9 December 1952 (age 73)')).toBe('1952-12-09');
    expect(birth('Born February 1957 (age 69)')).toBe('1957-02');
    expect(birth('Born 1974 (age 52)')).toBe('1974');
    expect(birth('Born 31 February 1957 (age 69)')).toBe('31 February 1957');
    expect(birth('Born circa 1950')).toBe('circa 1950');
    expect(birth('')).toBeUndefined();
    expect(birth('Born (age 50)')).toBeUndefined();
  });

  it('gives the state its variant name, and drops a row whose state has no variant or that has no name', () => {
    expect(mapMlaRegisterRow({ ...JK, state: 'Jammu and Kashmir' }).row.state).toBe('Jammu & Kashmir');
    expect(mapMlaRegisterRow({ ...KERALA, state: 'Ladakh', geography: '' })).toEqual({ drop: 'no_state' });
    expect(mapMlaRegisterRow({ ...KERALA, name: ' ', title: '', record_title: '' })).toEqual({ drop: 'no_title' });
  });
});

describe('buildRegisterItems and groupByVariant: one store variant per state', () => {
  const built = buildRegisterItems(FIXTURE, REGISTER, 'official');
  const groups = groupByVariant(built.items, REGISTER);

  it('keeps every row, keyed by QID or politician id, with no published date (served in register order)', () => {
    expect(built.report).toMatchObject({ read: 4, kept: 4, key_duplicates: 0, oldest: '2026-07-14', newest: '2026-08-19' });
    expect(built.items.map((i) => i.item_key)).toEqual([
      'mla:lekang-ac-ar-lekhiya-soni', 'url:wikidata.org/entity/Q126304862', 'url:wikidata.org/entity/Q130553556', 'url:wikidata.org/entity/Q139918608',
    ]);
    for (const item of built.items) expect(item.published_at).toBeNull();
  });

  it('groups by state in the variants\' order, each state by constituency, whatever the sheet\'s order', () => {
    expect(groups.map((g) => [g.variant, g.items.map((i) => i.row.constituency)])).toEqual([
      ['Arunachal Pradesh', ['Lekang', 'Taliha']],
      ['Jammu & Kashmir', ['Akhnoor']],
      ['Kerala', ['Adoor']],
    ]);
    for (const g of groups) expect(STATES).toContain(g.variant);
    expect(groupByVariant(buildRegisterItems([...FIXTURE].reverse(), REGISTER, 'official').items, REGISTER)).toEqual(groups);
  });

  it('is the same on every load: same keys and hashes when a day-dependent column changes', () => {
    const again = buildRegisterItems(FIXTURE.map((r) => ({ ...r, record_age_days: '99', source_retrieved_at: '1' })), REGISTER, 'official');
    expect(again.items.map((i) => [i.item_key, i.content_hash])).toEqual(built.items.map((i) => [i.item_key, i.content_hash]));
  });

  it('each variant\'s note names its state and date, never a local path, and says a reload replaces the list', () => {
    const [arunachal] = groups;
    const meta = registerMeta(REGISTER, arunachal.report, 'backup/STATE/F30_MLA_Directory.xlsx', '2026-10-15T00:00:00.000Z');
    expect(meta.note).toMatch(/2 MLAs of Arunachal Pradesh/);
    expect(meta.note).toMatch(/not refreshed by the timer/);
    expect(meta.note).toMatch(/reload replaces this state's list/);
    expect(meta.note).not.toMatch(/\/Users|Downloads/);
    expect(meta.coverage).toEqual({ from: '2026-07-14', through: '2026-08-19', exhaustive: false });
    expect(meta.adapter).toBe('register');
  });
});

// ---------------------------------------------------------------------------------------------
// Serving.

const LOADED = '2025-09-01T10:00:00.000Z'; // over a year before the clock below
const NOW = { now: () => Date.parse('2026-10-15T10:00:00.000Z') };

function statePage(state, over = {}) {
  return {
    tier: 'state', feature: 'MLA Directory', variant: state, class: 'register', kind: 'reference', serve: true,
    fetched_at: LOADED, checked_at: LOADED, changed_at: LOADED, interval_minutes: 43200, consecutive_failures: 0, last_error: null,
    total: 2,
    meta: {
      note: `Stored register of 2 MLAs of ${state}.`, links: ['https://www.wikidata.org/'],
      coverage: { from: '2026-07-14', through: '2026-08-19', exhaustive: false }, adapter: 'register', kind: 'register', fetched_at: LOADED,
    },
    items: [
      { item_key: `a-${state}`, row: { title: `First of ${state}`, state, as_of: '2026-07-14', source_url: 'https://www.wikidata.org/entity/Q1' } },
      { item_key: `b-${state}`, row: { title: `Second of ${state}`, state, as_of: '2026-08-19', source_url: 'https://www.wikidata.org/entity/Q2' } },
    ],
    ...over,
  };
}
const byVariant = (make = statePage) => vi.fn(async (_name, args) => make(args.p_variant));
const params = (extra = {}) => new URLSearchParams({ tier: 'state', feature: 'MLA Directory', ...extra });

describe('serveFromStore: MLA Directory from the register', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('a request\'s state picks its variant, normalised', () => {
    expect(storeVariant(MLA, params({ state: 'kerala' }))).toBe('Kerala');
    expect(storeVariant(MLA, params({ state: 'Jammu and Kashmir' }))).toBe('Jammu & Kashmir');
    expect(storeVariant(MLA, params())).toBe('');
    expect(storeVariant(MLA, params({ state: 'Ladakh' }))).toBe('');
  });

  it('serves a state\'s whole list from its variant, whatever its age, labelled as a register', async () => {
    const rpc = byVariant();
    const body = await serveFromStore(MLA, params({ state: 'KL' }), { rpc, ...NOW });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('feed_page', { p_tier: 'state', p_feature: 'MLA Directory', p_variant: 'Kerala', p_limit: STORE_PAGE_ROWS, p_offset: 0 });
    expect(body).toMatchObject({ ok: true, served: 'store', register: true, fallback: false, fetchedAt: LOADED, storeTotal: 2 });
    expect(body.rows.map((r) => r.title)).toEqual(['First of Kerala', 'Second of Kerala']);
  });

  it('a scheduled module of the same age is still left to the live path', async () => {
    const page = { ...statePage('Kerala'), tier: 'finance', feature: 'AI & the Tech Industry', variant: '', class: 'news', kind: 'news', interval_minutes: 30 };
    expect(await serveFromStore('finance:AI & the Tech Industry', new URLSearchParams(), { rpc: vi.fn(async () => page), ...NOW })).toBeNull();
  });

  // public.feed_page_across (supabase/migrations/20261015170000_feed_register_page.sql): one read for
  // every variant; pages only when every variant is served, ordered by the database's collation.
  function acrossPage({ pages = [...STATES].reverse().map((v) => statePage(v)), allServed = true, ...over } = {}) {
    return {
      tier: 'state', feature: 'MLA Directory', variants: STATES.length, served: allServed ? STATES.length : 3, all_served: allServed,
      fetched_at: LOADED, total: 62, pages: allServed ? pages.map(({ tier: _t, feature: _f, items, ...p }) => ({ ...p, items })) : [], ...over,
    };
  }
  const across = (page) => vi.fn(async (name) => (name === 'feed_page_across' ? page : null));

  it('with no state (what the page sends today): one read, a first page across all 31 states in the variants\' order', async () => {
    const rpc = across(acrossPage());
    const body = await serveFromStore(MLA, params(), { rpc, ...NOW });
    expect(rpc).toHaveBeenCalledTimes(1);
    const each = Math.floor(STORE_PAGE_ROWS / 31);
    expect(each).toBe(16);
    expect(rpc).toHaveBeenCalledWith('feed_page_across', { p_tier: 'state', p_feature: 'MLA Directory', p_per_variant: each });
    expect(body).toMatchObject({ served: 'store', register: true, fallback: false, storeTotal: 62, fetchedAt: LOADED });
    expect(body.rows).toHaveLength(62);
    expect(body.rows.slice(0, 3).map((r) => r.title)).toEqual(['First of Andhra Pradesh', 'Second of Andhra Pradesh', 'First of Arunachal Pradesh']);
    expect(body.source.note).toMatch(/16 MLAs from each of the 31 states and union territories/);
    expect(body.coverage).toEqual({ from: '2026-07-14', through: '2026-08-19', exhaustive: false });
    // A state the register does not hold is the same as no state.
    const again = across(acrossPage());
    expect((await serveFromStore(MLA, params({ state: 'Ladakh' }), { rpc: again, ...NOW })).rows).toHaveLength(62);
    expect(again.mock.calls[0][0]).toBe('feed_page_across');
  });

  it('with no state, a module not fully served goes straight to the live path after the one read', async () => {
    const rpc = across(acrossPage({ allServed: false }));
    expect(await serveFromStore(MLA, params(), { rpc, ...NOW })).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await serveFromStore(MLA, params(), { rpc: across(null), ...NOW })).toBeNull();
  });

  it('with no state, a state missing from the pages or with no items leaves the whole page to the live path', async () => {
    const withoutGoa = acrossPage({ pages: STATES.filter((v) => v !== 'Goa').map((v) => statePage(v)) });
    expect(await serveFromStore(MLA, params(), { rpc: across(withoutGoa), ...NOW })).toBeNull();
    const emptyKerala = acrossPage({ pages: STATES.map((v) => statePage(v, v === 'Kerala' ? { items: [] } : {})) });
    expect(await serveFromStore(MLA, params(), { rpc: across(emptyKerala), ...NOW })).toBeNull();
  });

  it('before the load (the store has nothing for the variant) the live path answers', async () => {
    expect(await serveFromStore(MLA, params({ state: 'Kerala' }), { rpc: vi.fn(async () => null), ...NOW })).toBeNull();
    expect(await serveFromStore(MLA, params({ state: 'Kerala' }), { rpc: byVariant((v) => statePage(v, { items: [], total: 0 })), ...NOW })).toBeNull();
  });
});

describe('the route: MLA Directory asks the store first, NSE/BSE never does', () => {
  beforeEach(() => resetFeedCache());

  it('names MLA Directory as a store module and NSE/BSE as none', () => {
    expect(scheduledModuleId(params())).toBe(MLA);
    expect(scheduledModuleId(new URLSearchParams({ tier: 'finance', feature: 'NSE/BSE Delayed Market Feed' }))).toBe('');
  });

  it('serves the stored register, and goes live exactly as today when the store has nothing', async () => {
    const live = vi.fn(async () => ({ ok: true, rows: [{ title: 'Live MLA' }], source: { adapter: 'api' }, fallback: false }));
    const stored = { ok: true, rows: [{ title: 'Stored MLA' }], served: 'store', register: true, fallback: false };
    const store = vi.fn(async () => stored);
    const p = params({ state: 'Kerala' });
    expect(await serveFeatureFeedStoredFirst(p, { store, live })).toBe(stored);
    expect(store).toHaveBeenCalledWith(MLA, p, { allowStale: true });
    expect(live).not.toHaveBeenCalled();
    const body = await serveFeatureFeedStoredFirst(p, { store: vi.fn(async () => null), live });
    expect(live).toHaveBeenCalledTimes(1);
    expect(body.rows).toEqual([{ title: 'Live MLA' }]);
  });
});

// ---------------------------------------------------------------------------------------------
// The label.

describe('the label: a dated register, not "updated N min ago"', () => {
  const NOW_MS = Date.parse('2026-10-15T10:00:00.000Z');
  const answer = (over = {}) => ({
    ok: true, served: 'store', register: true, fetchedAt: LOADED, fallback: false,
    rows: [{ title: 'A', as_of: '2026-07-14' }, { title: 'B', as_of: '2026-08-19' }],
    coverage: { from: '2026-07-14', through: '2026-08-19', exhaustive: false },
    source: { adapter: 'register', links: ['https://www.wikidata.org/', 'https://en.wikipedia.org/wiki/16th_Kerala_Assembly'], note: '' },
    ...over,
  });

  it('says "register" and the newest date the register records', () => {
    expect(asOfLabel(answer(), NOW_MS)).toBe('register · as of 19 Aug 2026');
    expect(asOfLabel(answer({ rows: [{ title: 'A' }] }), NOW_MS)).toBe('register · as of 19 Aug 2026');
    expect(asOfLabel(answer({ rows: [{ title: 'A' }], coverage: {} }), NOW_MS)).toBe('register · date not recorded');
  });

  it('the source line leads with it and names the sources', () => {
    expect(plainSourceLine(answer(), NOW_MS)).toBe('Register · as of 19 Aug 2026 · 2 records from Wikidata and Wikipedia');
  });

  it('a scheduled module\'s store answer keeps "updated N min ago"', () => {
    const fetchedAt = new Date(NOW_MS - 5 * 60_000).toISOString();
    expect(asOfLabel(answer({ register: undefined, fetchedAt }), NOW_MS)).toBe('updated 5 min ago');
  });
});

// ---------------------------------------------------------------------------------------------
// Loading: the runs and the gate.

describe('registerRunsFor: one run per state, never through the schedule', () => {
  it('31 runs for MLA Directory, of a replacing kind so a reload replaces each state\'s list', () => {
    const runs = registerRunsFor(MLA);
    expect(runs.map((r) => r.variant)).toEqual(STATES);
    expect(runs.every((r) => r.kind === 'reference' && r.class === 'register' && r.interval_minutes === 43200)).toBe(true);
  });

  it('refuses a module that is not a register; runFor refuses MLA Directory (not scheduled)', () => {
    expect(() => registerRunsFor('national:Cabinet Decisions')).toThrow(/not a register module/);
    expect(() => runFor(MLA)).toThrow(/not a scheduled module/);
  });
});

describe('main: MLA Directory load', () => {
  const ENV = { SUPABASE_URL: 'https://example-project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_TESTKEY' };
  const TOKEN = '33333333-3333-4333-8333-333333333333';
  let out;

  function setup({ due = () => true, makeDue = () => true } = {}) {
    const calls = [];
    const rpc = vi.fn(async (name, args) => {
      calls.push([name, args]);
      if (name === 'feed_claim_due') {
        const run = args.p_runs[0];
        return due(run.variant) ? [{ ...run, lease_token: TOKEN }] : [];
      }
      if (name === 'feed_record') return { status: 'ok', items: args.p.items.length, new_items: args.p.items.length };
      if (name === 'feed_page') return { total: 1, checked_at: 'x', interval_minutes: 43200, serve: false, items: [] };
      if (name === 'feed_make_due') return makeDue(args.p_variant);
      return null;
    });
    const deps = {
      env: ENV,
      readRows: vi.fn(() => FIXTURE),
      makeLocalRpc: vi.fn(() => rpc),
      makeProdRpc: vi.fn(() => rpc),
      forceDue: vi.fn(async () => {}),
      fetchLive: vi.fn(),
    };
    return { deps, rpc, calls };
  }
  const noClient = (deps) => {
    expect(deps.makeLocalRpc).not.toHaveBeenCalled();
    expect(deps.makeProdRpc).not.toHaveBeenCalled();
    expect(deps.forceDue).not.toHaveBeenCalled();
  };
  const ARGS = ['--module', MLA];

  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  });
  afterEach(() => vi.restoreAllMocks());

  it('a dry run is the default, prints each state\'s count and never makes a database client', async () => {
    const { deps } = setup();
    await expect(main(ARGS, deps)).resolves.toBe(0);
    noClient(deps);
    const text = out.join('\n');
    expect(text).toMatch(/DRY RUN: state:MLA Directory/);
    expect(text).toMatch(/Arunachal Pradesh\s+2/);
    // Only the reasons that apply to this module.
    expect(text).toMatch(/left out: no_state\s+0/);
    for (const cabinetOnly of ['no_date', 'bad_date', 'not_module', 'second release']) expect(text).not.toContain(cabinetOnly);
    expect(text).toMatch(/3 store variants, 4 items/);
  });

  it('the production gate refuses exactly as for Cabinet Decisions, before anything is read', async () => {
    const refusals = [
      [['--apply'], /needs --target local or --target prod/, ENV],
      [['--dry-run', '--apply', '--target', 'local', '--db', 'niyantran_x_test'], /cannot be used together/, ENV],
      [['--apply', '--target', 'local', '--db', 'postgres'], /local test database/, ENV],
      [['--apply', '--target', 'prod', '--confirm-prod'], /needs SUPABASE_URL and SUPABASE_SECRET_KEY/, {}],
      [['--apply', '--target', 'prod'], /add --confirm-prod/, ENV],
      [['--apply', '--target', 'prod', '--force'], /add --confirm-prod/, ENV],
      [['--apply', '--target', 'prod', '--force', '--confirm-prod'], /needs SUPABASE_URL and SUPABASE_SECRET_KEY/, {}],
    ];
    for (const [argv, why, env] of refusals) {
      const { deps } = setup();
      await expect(main([...ARGS, ...argv], { ...deps, env }), argv.join(' ')).rejects.toThrow(why);
      expect(deps.readRows).not.toHaveBeenCalled();
      noClient(deps);
    }
  });

  it('a load claims and records each state on its own, with that state\'s run and lease', async () => {
    const { deps, calls } = setup();
    await expect(main([...ARGS, '--apply', '--target', 'prod', '--confirm-prod'], deps)).resolves.toBe(0);
    expect(deps.makeProdRpc).toHaveBeenCalledTimes(1);
    const claims = calls.filter(([n]) => n === 'feed_claim_due').map(([, a]) => a);
    expect(claims.map((a) => a.p_runs.map((r) => r.variant))).toEqual([['Arunachal Pradesh'], ['Jammu & Kashmir'], ['Kerala']]);
    for (const a of claims) {
      expect(a.p_limit).toBe(1);
      expect(a.p_runs[0]).toEqual({ tier: 'state', feature: 'MLA Directory', variant: a.p_runs[0].variant, class: 'register', kind: 'reference', interval_minutes: 43200 });
    }
    const records = calls.filter(([n]) => n === 'feed_record').map(([, a]) => a.p);
    expect(records.map((p) => [p.variant, p.items.length, p.lease_token, p.status])).toEqual([
      ['Arunachal Pradesh', 2, TOKEN, 'ok'], ['Jammu & Kashmir', 1, TOKEN, 'ok'], ['Kerala', 1, TOKEN, 'ok'],
    ]);
    expect(records[0].meta.note).toMatch(/Arunachal Pradesh/);
    expect(out.join('\n')).not.toContain('sb_secret_TESTKEY');
  });

  it('a state that is not due is reported, the others are recorded, and the exit code is 3', async () => {
    const { deps, calls } = setup({ due: (v) => v !== 'Kerala' });
    await expect(main([...ARGS, '--apply', '--target', 'local', '--db', 'niyantran_x_test'], deps)).resolves.toBe(3);
    expect(calls.filter(([n]) => n === 'feed_record').map(([, a]) => a.p.variant)).toEqual(['Arunachal Pradesh', 'Jammu & Kashmir']);
    expect(out.join('\n')).toMatch(/Kerala.*NOT DUE/);
  });

  it('--force on prod (behind --confirm-prod) makes each state due with feed_make_due before its claim', async () => {
    const { deps, calls } = setup();
    await expect(main([...ARGS, '--apply', '--target', 'prod', '--confirm-prod', '--force'], deps)).resolves.toBe(0);
    expect(deps.makeProdRpc).toHaveBeenCalledTimes(1);
    expect(deps.forceDue).not.toHaveBeenCalled();
    const names = calls.map(([n, a]) => (n === 'feed_make_due' ? `due:${a.p_variant}` : n === 'feed_claim_due' ? `claim:${a.p_runs[0].variant}` : n));
    expect(names.filter((n) => /^(due|claim):/.test(n))).toEqual([
      'due:Arunachal Pradesh', 'claim:Arunachal Pradesh', 'due:Jammu & Kashmir', 'claim:Jammu & Kashmir', 'due:Kerala', 'claim:Kerala',
    ]);
    expect(calls.find(([n]) => n === 'feed_make_due')[1]).toEqual({ p_tier: 'state', p_feature: 'MLA Directory', p_variant: 'Arunachal Pradesh' });
  });

  it('--force on prod says when a state could not be made due (a run holds it), and still never records it unclaimed', async () => {
    const { deps, calls } = setup({ makeDue: (v) => v !== 'Kerala', due: (v) => v !== 'Kerala' });
    await expect(main([...ARGS, '--apply', '--target', 'prod', '--confirm-prod', '--force'], deps)).resolves.toBe(3);
    expect(out.join('\n')).toMatch(/Kerala.*not made due/);
    expect(calls.filter(([n]) => n === 'feed_record').map(([, a]) => a.p.variant)).toEqual(['Arunachal Pradesh', 'Jammu & Kashmir']);
  });

  it('--force on a local test database makes each state due first', async () => {
    const { deps } = setup();
    await expect(main([...ARGS, '--apply', '--target', 'local', '--db', 'niyantran_x_test', '--force'], deps)).resolves.toBe(0);
    expect(deps.forceDue.mock.calls.map(([a]) => a.run.variant)).toEqual(['Arunachal Pradesh', 'Jammu & Kashmir', 'Kerala']);
  });
});

describe('wikidataEntity', () => {
  it('is the link the live loader gives a person', () => {
    expect(wikidataEntity('Q1')).toBe('https://www.wikidata.org/entity/Q1');
  });
});
