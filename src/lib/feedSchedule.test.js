import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';
import {
  FEED_CLASSES, FEED_REGISTERS, FEED_SCHEDULE, FEED_VARIANTS, OFF_TIMER, REGISTER_CLASS, feedRunsForDb, isStoreServed, itemKeyFor, itemKeysFor,
  mlaStateVariant, registerRunsForDb, scheduledRuns,
} from '../../server/feedSchedule.mjs';
import { PLANNED_MODULES } from './plannedModules.js';

/**
 * F169 phase 4, C1. The modules the timer refreshes are the ones whose loader calls an outside
 * source; each has a class (how often, how long its items are kept). The table is checked against
 * what the loaders actually call, so a new source cannot be left off the schedule unnoticed.
 */
describe('the refresh schedule (F169 C1)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

  it('lists exactly the modules whose loader calls an outside source', async () => {
    let called = false;
    vi.stubGlobal('fetch', vi.fn(async (u) => { called = true; return { ok: false, status: 404, url: String(u), headers: new Headers(), text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }));
    // Deterministic whatever ran before in the shared test process: no store configured, and no
    // loader answers from a cache another file filled (either would hide or add an outside call).
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    const { serveFeatureFeed, resetFeedCache } = await import('../../server/featureFeed.mjs');
    const calling = [];
    for (const m of DESK_CATALOGUE) {
      resetFeedCache();
      called = false;
      await serveFeatureFeed(new URLSearchParams({ tier: m.tier, feature: m.feature })).catch(() => null);
      if (called) calling.push(m.id);
    }
    // Register modules (loaded once, never refreshed) and modules deliberately off the timer are the
    // only ones a calling loader may leave off the schedule; every other calling module must be on it.
    const expected = calling.filter((id) => !Object.hasOwn(FEED_REGISTERS, id) && !Object.hasOwn(OFF_TIMER, id));
    expect(Object.keys(FEED_SCHEDULE).sort()).toEqual(expected.sort());
    // An exclusion is deliberate, not stale: each module kept off the timer still calls a source.
    for (const id of Object.keys(OFF_TIMER)) expect(calling, id).toContain(id);
  }, 120_000);

  it('every class has an interval of at least 15 minutes and a keeping rule', () => {
    for (const [name, c] of Object.entries(FEED_CLASSES)) {
      expect(c.every, name).toBeGreaterThanOrEqual(15);
      expect(['official', 'news', 'events', 'measurement', 'latest', 'reference'], name).toContain(c.kind);
    }
    for (const [id, cls] of Object.entries(FEED_SCHEDULE)) expect(FEED_CLASSES[cls], id).toBeTruthy();
  });

  it('never schedules a planned module', () => {
    for (const id of Object.keys(FEED_SCHEDULE)) expect(PLANNED_MODULES.has(id), id).toBe(false);
  });

  it('runs one entry per Statement Tracker leader', () => {
    const runs = scheduledRuns().filter((r) => r.feature.startsWith('Statement & Quote Tracker'));
    expect(runs.map((r) => r.variant).sort()).toEqual([...FEED_VARIANTS['national:Statement & Quote Tracker with Contradiction Detection'].values].sort());
    expect(runs.every((r) => r.params.person === r.variant)).toBe(true);
  });

  it('gives feed_claim_due the schedule in its own field names, with the kind from the class (C2)', () => {
    const runs = feedRunsForDb();
    expect(runs).toHaveLength(scheduledRuns().length);
    for (const r of runs) {
      expect(Object.keys(r).sort()).toEqual(['class', 'feature', 'interval_minutes', 'kind', 'params', 'tier', 'variant']);
      expect(r.kind, r.feature).toBe(FEED_CLASSES[r.class].kind);
      expect(r.interval_minutes, r.feature).toBe(FEED_CLASSES[r.class].every);
      // What the database accepts (feed_claim_due's validation).
      expect(r.class).toMatch(/^[a-z][a-z_]{0,39}$/);
      expect(Number.isInteger(r.interval_minutes) && r.interval_minutes >= 15 && r.interval_minutes <= 43200).toBe(true);
      expect(typeof r.variant).toBe('string');
    }
    expect(new Set(runs.map((r) => `${r.tier}\u0000${r.feature}\u0000${r.variant}`)).size).toBe(runs.length);
    expect(runs.find((r) => r.feature === 'Live Global Stock Exchanges')).toMatchObject({
      tier: 'finance', variant: '', class: 'markets', kind: 'measurement', interval_minutes: 15, params: {},
    });
    expect(runs.find((r) => r.feature === 'Music Charts — India Top 25')).toMatchObject({ class: 'charts', kind: 'latest', interval_minutes: 60 });
  });
});

describe('modules served from the store but off the timer (C6 option 1, F186)', () => {
  const MLA = 'state:MLA Directory';
  const NSE = 'finance:NSE/BSE Delayed Market Feed';
  const has = (runs, id) => runs.some((r) => `${r.tier}:${r.feature}` === id);

  it('MLA Directory is a register module, not a scheduled one', () => {
    expect(Object.hasOwn(FEED_REGISTERS, MLA)).toBe(true);
    expect(Object.hasOwn(FEED_SCHEDULE, MLA)).toBe(false);
    expect(isStoreServed(MLA)).toBe(true);
  });

  it('NSE/BSE is off the timer, with a reason, and is not served from the store', () => {
    expect(Object.hasOwn(FEED_SCHEDULE, NSE)).toBe(false);
    expect(OFF_TIMER[NSE]).toMatch(/F186/);
    expect(isStoreServed(NSE)).toBe(false);
  });

  it('no refresh ever claims a register variant or an off-timer module', () => {
    const runs = feedRunsForDb();
    expect(has(runs, MLA)).toBe(false);
    expect(has(runs, NSE)).toBe(false);
    for (const state of FEED_REGISTERS[MLA].values) expect(runs.some((r) => r.variant === state)).toBe(false);
  });

  it('stays off even if the module is put back on the schedule by mistake', () => {
    const schedule = { ...FEED_SCHEDULE, [MLA]: 'reference', [NSE]: 'markets' };
    expect(has(scheduledRuns(schedule), MLA)).toBe(false);
    expect(has(feedRunsForDb(schedule), NSE)).toBe(false);
    expect(feedRunsForDb(schedule)).toEqual(feedRunsForDb());
  });

  it('the schedule, the registers and the off-timer list never overlap', () => {
    for (const id of [...Object.keys(FEED_REGISTERS), ...Object.keys(OFF_TIMER)]) expect(Object.hasOwn(FEED_SCHEDULE, id), id).toBe(false);
    for (const id of Object.keys(FEED_REGISTERS)) expect(Object.hasOwn(OFF_TIMER, id), id).toBe(false);
  });

  it('a register variant run replaces its list (reference), is long-interval and acceptable to feed_claim_due', () => {
    const runs = registerRunsForDb(MLA);
    expect(runs).toHaveLength(31);
    expect(REGISTER_CLASS).toEqual({ name: 'register', every: 43200, kind: 'reference' });
    for (const r of runs) {
      expect(r).toEqual({ tier: 'state', feature: 'MLA Directory', variant: r.variant, class: 'register', kind: 'reference', interval_minutes: 43200 });
      expect(r.class).toMatch(/^[a-z][a-z_]{0,39}$/);
      expect(r.variant.length).toBeGreaterThan(0);
      expect(r.variant.length).toBeLessThanOrEqual(200);
    }
    expect(new Set(runs.map((r) => r.variant)).size).toBe(31);
    expect(registerRunsForDb('national:Cabinet Decisions')).toEqual([]);
  });
});

describe('MLA Directory variants: one stable name per state', () => {
  it('the 31 states and union territories of the register, by their own names', () => {
    expect(FEED_REGISTERS['state:MLA Directory'].values).toEqual([
      'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
      'Himachal Pradesh', 'Jammu & Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
      'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
      'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    ]);
    expect(FEED_REGISTERS['state:MLA Directory'].param).toBe('state');
  });

  it('normalises spelling, case, spacing, "&" or "and", old names and the register\'s state codes', () => {
    const cases = {
      'Jammu and Kashmir': 'Jammu & Kashmir', ' jammu  &  KASHMIR ': 'Jammu & Kashmir', JK: 'Jammu & Kashmir',
      'tamil nadu': 'Tamil Nadu', TN: 'Tamil Nadu', 'NCT of Delhi': 'Delhi', Orissa: 'Odisha', OD: 'Odisha',
      Pondicherry: 'Puducherry', Uttaranchal: 'Uttarakhand', UK: 'Uttarakhand', TG: 'Telangana', TS: 'Telangana', up: 'Uttar Pradesh',
    };
    for (const [given, want] of Object.entries(cases)) expect(mlaStateVariant(given), given).toBe(want);
    for (const state of FEED_REGISTERS['state:MLA Directory'].values) expect(mlaStateVariant(state)).toBe(state);
  });

  it('names no variant for a place without a register, or for nothing', () => {
    for (const v of ['', null, undefined, 'Ladakh', 'Lakshadweep', 'Kerala; Goa', 'X']) expect(mlaStateVariant(v), String(v)).toBe('');
  });
});

describe('item keys (F170 rule 1)', () => {
  it('a bill uses the corpus identity, so the corpus links up later', () => {
    expect(itemKeyFor({ bill_number: '113', bill_name: 'The Data Bill, 2025' })).toBe('bill:2025:113');
  });

  it('otherwise the link, without tracking parameters, fragments or a trailing slash', () => {
    const a = itemKeyFor({ title: 'X', source_url: 'https://www.example.com/news/item/?utm_source=x&id=7#top' });
    const b = itemKeyFor({ title: 'X (edited)', source_url: 'https://example.com/news/item?id=7' });
    expect(a).toBe(b);
    expect(a).toBe('url:example.com/news/item?id=7');
  });

  it('a market quote without a link is one item per instrument, whatever its time', () => {
    const live = itemKeyFor({ title: 'NIFTY 50', name: 'NIFTY 50', exchange: 'NSE', last: 25000, source_url: '' });
    const stored = itemKeyFor({ title: 'NIFTY 50', name: 'NIFTY 50', exchange: 'NSE', last: 24900, as_of: '2026-10-14T10:00:00Z' });
    expect(live).toBe('q:nse:nifty 50');
    expect(stored).toBe(live);
  });

  it('a PIB release is one item whichever page or language parameters link it', () => {
    const forms = [
      'https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2301145',
      'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2301145&lang=1&reg=3',
      'https://pib.gov.in/PressReleasePage.aspx?PRID=2301145&Lang=1',
    ];
    expect(new Set(forms.map((u) => itemKeyFor({ source_url: u }))).size).toBe(1);
    expect(itemKeyFor({ source_url: forms[0] })).toBe('url:pib.gov.in/PressRelease?PRID=2301145');
    expect(itemKeyFor({ source_url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=2301146' })).not.toBe(itemKeyFor({ source_url: forms[0] }));
  });

  it('a PIB link without a usable PRID keeps its own path key, and other hosts and pages are unchanged', () => {
    expect(itemKeyFor({ source_url: 'https://pib.gov.in/PressReleasePage.aspx' })).toBe('url:pib.gov.in/PressReleasePage.aspx');
    expect(itemKeyFor({ source_url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=' })).toBe('url:pib.gov.in/PressReleasePage.aspx?PRID=');
    expect(itemKeyFor({ source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=abc&Lang=1' })).toBe('url:pib.gov.in/PressReleasePage.aspx?PRID=abc&Lang=1');
    expect(itemKeyFor({ source_url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=12abc' })).toBe('url:pib.gov.in/PressReleasePage.aspx?PRID=12abc');
    expect(itemKeyFor({ source_url: 'https://pib.nic.in/PressReleasePage.aspx?PRID=2301145' })).toBe('url:pib.nic.in/PressReleasePage.aspx?PRID=2301145');
    expect(itemKeyFor({ source_url: 'https://pib.gov.in/allRel.aspx?PRID=2301145' })).toBe('url:pib.gov.in/allRel.aspx?PRID=2301145');
  });

  it('otherwise a hash of the title and date, the same on every run', () => {
    const k = itemKeyFor({ title: 'Rupee steadies', date: '2026-10-14' });
    expect(k).toMatch(/^h:[0-9a-f]{16}$/);
    expect(itemKeyFor({ title: '  Rupee  steadies ', date: '2026-10-14' })).toBe(k);
    expect(itemKeyFor({ title: 'Rupee steadies', date: '2026-10-15' })).not.toBe(k);
  });

  it('replacing kinds: rows that share a dataset link stay separate items, keyed the same whatever else the answer holds', () => {
    const wb = 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD';
    const usa = { iso3: 'USA', title: 'United States', country: 'United States', year: '2025', source_url: wb };
    const ind = { iso3: 'IND', title: 'India', country: 'India', year: '2025', source_url: wb };
    for (const kind of ['reference', 'latest', 'measurement']) {
      const keys = itemKeysFor([usa, ind], kind);
      expect(new Set(keys).size).toBe(2);
      expect(keys[0]).toMatch(/^url:data\.worldbank\.org\/indicator\/NY\.GDP\.MKTP\.CD#[0-9a-f]{16}$/);
      // A key never depends on the other rows: alone, or beside more rows, a row keeps its key.
      expect(itemKeysFor([usa], kind)).toEqual([keys[0]]);
      expect(itemKeysFor([ind, usa, { ...usa, iso3: 'NPL', title: 'Nepal', country: 'Nepal' }], kind).slice(0, 2)).toEqual([keys[1], keys[0]]);
      // A value is not part of the key.
      expect(itemKeysFor([{ ...usa, gdp_usd_bn: '1' }], kind)).toEqual([keys[0]]);
    }
  });

  it('replacing kinds: the date or year is part of a reference key, never of a measurement key', () => {
    const wb = 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD';
    const y25 = { title: 'India', iso3: 'IND', year: '2025', source_url: wb };
    const y26 = { ...y25, year: '2026' };
    expect(itemKeysFor([y25], 'reference')).not.toEqual(itemKeysFor([y26], 'reference'));
    const quote = { name: 'S&P/ASX 200', exchange: 'ASX', date: '2026-10-14', source_url: 'https://finance.yahoo.com/quote/%5EAXJO' };
    expect(itemKeysFor([quote], 'measurement')).toEqual(itemKeysFor([{ ...quote, date: '2026-10-15', last: 1 }], 'measurement'));
  });

  it('kept kinds: the link alone, so the same link is one item whatever else the answer holds', () => {
    const story = { title: 'A story', source_url: 'https://example.com/story/1' };
    for (const kind of ['news', 'official', 'events', undefined]) {
      expect(itemKeysFor([story], kind)).toEqual(['url:example.com/story/1']);
      expect(itemKeysFor([story, { ...story, title: 'Retitled' }], kind)).toEqual(['url:example.com/story/1', 'url:example.com/story/1']);
    }
  });

  it('keys other than links are left as itemKeyFor gives them', () => {
    const bill = itemKeyFor({ title: 'No link', date: '2026-10-14' });
    expect(itemKeysFor([{ title: 'No link', date: '2026-10-14' }], 'reference')).toEqual([bill]);
  });
});

