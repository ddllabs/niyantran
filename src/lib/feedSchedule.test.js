import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';
import { FEED_CLASSES, FEED_SCHEDULE, FEED_VARIANTS, feedRunsForDb, itemKeyFor, itemKeysFor, scheduledRuns } from '../../server/feedSchedule.mjs';
import { PLANNED_MODULES } from './plannedModules.js';

/**
 * F169 phase 4, C1. The modules the timer refreshes are the ones whose loader calls an outside
 * source; each has a class (how often, how long its items are kept). The table is checked against
 * what the loaders actually call, so a new source cannot be left off the schedule unnoticed.
 */
describe('the refresh schedule (F169 C1)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('lists exactly the modules whose loader calls an outside source', async () => {
    let called = false;
    vi.stubGlobal('fetch', vi.fn(async (u) => { called = true; return { ok: false, status: 404, url: String(u), headers: new Headers(), text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }; }));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const calling = [];
    for (const m of DESK_CATALOGUE) {
      called = false;
      await serveFeatureFeed(new URLSearchParams({ tier: m.tier, feature: m.feature })).catch(() => null);
      if (called) calling.push(m.id);
    }
    expect(Object.keys(FEED_SCHEDULE).sort()).toEqual(calling.sort());
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
    expect(runs.find((r) => r.feature === 'NSE/BSE Delayed Market Feed')).toMatchObject({
      tier: 'finance', variant: '', class: 'markets', kind: 'measurement', interval_minutes: 15, params: {},
    });
    expect(runs.find((r) => r.feature === 'Music Charts — India Top 25')).toMatchObject({ class: 'charts', kind: 'latest', interval_minutes: 60 });
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

