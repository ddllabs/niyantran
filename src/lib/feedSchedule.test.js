import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';
import { FEED_CLASSES, FEED_SCHEDULE, FEED_VARIANTS, itemKeyFor, scheduledRuns } from '../../server/feedSchedule.mjs';
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

  it('otherwise a hash of the title and date, the same on every run', () => {
    const k = itemKeyFor({ title: 'Rupee steadies', date: '2026-10-14' });
    expect(k).toMatch(/^h:[0-9a-f]{16}$/);
    expect(itemKeyFor({ title: '  Rupee  steadies ', date: '2026-10-14' })).toBe(k);
    expect(itemKeyFor({ title: 'Rupee steadies', date: '2026-10-15' })).not.toBe(k);
  });
});
