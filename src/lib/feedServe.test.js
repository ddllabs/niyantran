// F169 phase 4 (C4): a scheduled module is served from the feed store (public.feed_page), newest
// first, with today's live path as the fallback. The store answer is the normal path, not a
// fallback: it never sets `fallback`, never reaches the backup pass, and carries its fetched time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  scheduledModuleId,
  resetFeedCache,
  serveFeatureFeedStoredFirst,
} from '../../server/featureFeed.mjs';
import { STORE_MIN_FRESH_MINUTES, STORE_PAGE_ROWS, STORE_TIME_LIMIT_MS, liveAnswerIsUsable, serveFromStore, storeMaxAgeMinutes, storeVariant } from '../../server/feedServe.mjs';
import { metaFor } from '../../server/feedStore.mjs';
import { FEED_SCHEDULE } from '../../server/feedSchedule.mjs';
import { STATEMENT_LEADERS } from '../data/nationalCurated.js';

const NEWS = 'finance:AI & the Tech Industry';
const NEWS_PARAMS = new URLSearchParams({ tier: 'finance', feature: 'AI & the Tech Industry' });
const STATEMENTS = 'national:Statement & Quote Tracker with Contradiction Detection';
const SECRET = 'sb_secret_c4-test-key-5d1f';

/** What public.feed_page returns for a module (supabase/migrations/20261015150000_feed_records.sql). */
function page(over = {}) {
  return {
    tier: 'finance',
    feature: 'AI & the Tech Industry',
    variant: '',
    class: 'news',
    kind: 'news',
    serve: true,
    fetched_at: '2026-10-15T10:00:00.000Z',
    checked_at: '2026-10-15T10:00:00.000Z',
    changed_at: '2026-10-15T09:30:00.000Z',
    interval_minutes: 30,
    consecutive_failures: 0,
    last_error: null,
    total: 2,
    meta: {
      note: 'Google News topic search. Reporting, not an official dataset.',
      links: ['https://news.google.com/rss/search?q=ai', 'https://api.gdeltproject.org/api/v2/doc/doc'],
      coverage: { from: '', through: '7d', exhaustive: false },
      adapter: 'news-search',
      kind: '',
      fetched_at: '2026-10-15T10:00:00.000Z',
      view: { heading: 'AI & the Tech Industry', status: 'LIVE · NEWS RSS' },
    },
    items: [
      { item_key: 'url:b.example/2', row: { title: 'Newer story', date: '2026-10-15', source_url: 'https://b.example/2' }, published_at: '2026-10-15T08:00:00Z', first_seen: '2026-10-15T09:00:00Z', last_seen: '2026-10-15T10:00:00Z' },
      { item_key: 'url:a.example/1', row: { title: 'Older story', date: '2026-10-14', source_url: 'https://a.example/1' }, published_at: '2026-10-14T08:00:00Z', first_seen: '2026-10-14T09:00:00Z', last_seen: '2026-10-15T10:00:00Z' },
    ],
    ...over,
  };
}

const rpcReturning = (value) => vi.fn(async () => value);
const FETCHED = Date.parse('2026-10-15T10:00:00.000Z');
// A clock five minutes after the page's fetched time: fresh for every module.
const SOON = { now: () => FETCHED + 5 * 60_000 };

describe('serveFromStore: a scheduled module answers from the store', () => {
  it('rebuilds the live envelope from the stored rows, newest first, and says it came from the store', async () => {
    const rpc = rpcReturning(page());
    const body = await serveFromStore(NEWS, NEWS_PARAMS, { rpc, ...SOON });
    expect(body).toMatchObject({
      ok: true,
      tier: 'finance',
      feature: 'AI & the Tech Industry',
      fallback: false,
      served: 'store',
      fetchedAt: '2026-10-15T10:00:00.000Z',
      timeline: [],
      meta: { heading: 'AI & the Tech Industry', status: 'LIVE · NEWS RSS' },
      coverage: { from: '', through: '7d', exhaustive: false },
    });
    expect(body.rows.map((r) => r.title)).toEqual(['Newer story', 'Older story']);
    expect(body.source).toMatchObject({
      adapter: 'news-search',
      note: 'Google News topic search. Reporting, not an official dataset.',
      links: ['https://news.google.com/rss/search?q=ai', 'https://api.gdeltproject.org/api/v2/doc/doc'],
      kind: '',
    });
    expect(body.storeTotal).toBe(2);
  });

  it('asks feed_page for the module and variant, the first page at the usual row count', async () => {
    const rpc = rpcReturning(page());
    await serveFromStore(NEWS, NEWS_PARAMS, { rpc, ...SOON });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('feed_page', {
      p_tier: 'finance',
      p_feature: 'AI & the Tech Industry',
      p_variant: '',
      p_limit: STORE_PAGE_ROWS,
      p_offset: 0,
    });
    expect(STORE_PAGE_ROWS).toBe(500);
    expect(STORE_TIME_LIMIT_MS).toBe(1500);
  });

  it('maps the Statement Tracker person to the variant, as the live loader reads it', async () => {
    const rpc = rpcReturning(page({ tier: 'national', feature: 'Statement & Quote Tracker with Contradiction Detection', variant: 'Amit Shah' }));
    const params = new URLSearchParams({ tier: 'national', feature: 'Statement & Quote Tracker with Contradiction Detection', person: 'amit shah' });
    await serveFromStore(STATEMENTS, params, { rpc, ...SOON });
    expect(rpc.mock.calls[0][1].p_variant).toBe('Amit Shah');
    expect(storeVariant(STATEMENTS, new URLSearchParams({ person: 'Nobody Listed' }))).toBe(STATEMENT_LEADERS[0]);
    expect(storeVariant(STATEMENTS, new URLSearchParams())).toBe(STATEMENT_LEADERS[0]);
    for (const leader of STATEMENT_LEADERS) expect(storeVariant(STATEMENTS, new URLSearchParams({ person: leader }))).toBe(leader);
  });

  it('uses the empty variant for every other module, whatever person says', () => {
    expect(storeVariant(NEWS, new URLSearchParams({ person: 'Amit Shah' }))).toBe('');
  });

  it('does not serve a store answer as a stored copy: no fallback, no archive, no backup', async () => {
    const body = await serveFromStore(NEWS, NEWS_PARAMS, { rpc: rpcReturning(page()), ...SOON });
    expect(body.fallback).toBe(false);
    expect(body.served).not.toBe('archive');
    expect(body.source.kind).not.toBe('backup-pack');
    expect(body.source.adapter).not.toBe('embedded');
  });
});

describe('serveFromStore: Cabinet Decisions shows one release per decision (F187)', () => {
  it('two stored releases of one decision, recorded by different refreshes, are served as one', async () => {
    const TITLE = 'Cabinet approves four multitracking projects';
    const cabinet = page({
      tier: 'national', feature: 'Cabinet Decisions', class: 'official', kind: 'official', interval_minutes: 60,
      items: [
        { item_key: 'url:pib.gov.in/PressRelease?PRID=2301145', row: { title: TITLE, date: '2026-08-19', ministry: 'Ministry of Railways', source_url: 'https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2301145' } },
        { item_key: 'url:pib.gov.in/PressRelease?PRID=2301144', row: { title: TITLE, date: '2026-08-19', ministry: 'Cabinet Committee on Economic Affairs (CCEA)', source_url: 'https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2301144' } },
        { item_key: 'url:pib.gov.in/PressRelease?PRID=2300001', row: { title: 'Cabinet approves another scheme', date: '2026-08-18', ministry: 'Cabinet', source_url: 'https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2300001' } },
      ],
    });
    const body = await serveFromStore('national:Cabinet Decisions', new URLSearchParams({ tier: 'national', feature: 'Cabinet Decisions' }), { rpc: rpcReturning(cabinet), ...SOON });
    expect(body.rows.map((r) => r.source_url.match(/PRID=(\d+)/)[1])).toEqual(['2301144', '2300001']);
  });
});

describe('serveFromStore: when the live path is used instead (it answers null)', () => {
  const cases = {
    'the call fails': () => ({ rpc: vi.fn(async () => { throw new Error('HTTP 500'); }) }),
    'the module has no state (the database answers null)': () => ({ rpc: rpcReturning(null) }),
    'the answer is not a page': () => ({ rpc: rpcReturning('nope') }),
    'serve is false': () => ({ rpc: rpcReturning(page({ serve: false })) }),
    'serve is missing': () => ({ rpc: rpcReturning(page({ serve: undefined })) }),
    'serve is only truthy': () => ({ rpc: rpcReturning(page({ serve: 'true' })) }),
    'the module has no items': () => ({ rpc: rpcReturning(page({ items: [], total: 0 })) }),
    'the items hold no rows': () => ({ rpc: rpcReturning(page({ items: [{ item_key: 'x', row: null }] })) }),
    'there is no fetched time': () => ({ rpc: rpcReturning(page({ fetched_at: null, meta: { note: 'x', links: [] } })) }),
  };
  for (const [name, make] of Object.entries(cases)) {
    it(name, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await serveFromStore(NEWS, NEWS_PARAMS, make())).toBeNull();
    });
  }

  it('the call takes longer than the time limit', async () => {
    const started = Date.now();
    const rpc = vi.fn(() => new Promise(() => {}));
    const body = await serveFromStore(NEWS, NEWS_PARAMS, { rpc, timeoutMs: 40 });
    expect(body).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('the database is not configured (local dev): nothing is called', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      expect(await serveFromStore(NEWS, NEWS_PARAMS)).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});

describe('serveFromStore: the real database call', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://db.example');
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts to feed_page with the service key and never shows the key in the answer', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(page()), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const body = await serveFromStore(NEWS, NEWS_PARAMS, SOON);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://db.example/rest/v1/rpc/feed_page');
    expect(init.headers.apikey).toBe(SECRET);
    expect(JSON.parse(init.body)).toMatchObject({ p_tier: 'finance', p_variant: '' });
    expect(body.served).toBe('store');
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it('a database error goes live without showing the key anywhere', async () => {
    const lines = [];
    vi.spyOn(console, 'warn').mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: `bad key ${SECRET}` }), { status: 401 })));
    expect(await serveFromStore(NEWS, NEWS_PARAMS)).toBeNull();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain(SECRET);
  });

  it('gives up on a database that never answers', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const started = Date.now();
    expect(await serveFromStore(NEWS, NEWS_PARAMS, { timeoutMs: 60 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('serveFromStore: only while the items are fresh', () => {
  const MIN = 60_000;
  const at = (minutes) => ({ now: () => FETCHED + minutes * MIN });
  const serveAfter = (minutes, over = {}) => serveFromStore(NEWS, NEWS_PARAMS, { rpc: rpcReturning(page(over)), ...at(minutes) });
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it('allows three intervals or two hours, whichever is more', () => {
    expect(STORE_MIN_FRESH_MINUTES).toBe(120);
    expect(storeMaxAgeMinutes(15)).toBe(120); // markets
    expect(storeMaxAgeMinutes(30)).toBe(120); // news: 90 minutes is under the two hours
    expect(storeMaxAgeMinutes(40)).toBe(120); // exactly 120
    expect(storeMaxAgeMinutes(60)).toBe(180); // official, events, charts
    expect(storeMaxAgeMinutes(360)).toBe(1080); // Statement Tracker leaders
    expect(storeMaxAgeMinutes(1440)).toBe(4320); // reference: three days
    expect(storeMaxAgeMinutes(null)).toBe(120);
    expect(storeMaxAgeMinutes('x')).toBe(120);
  });

  it('a news module (30 min): served just inside two hours, live just outside', async () => {
    expect((await serveAfter(119.9, { interval_minutes: 30 }))?.served).toBe('store');
    expect((await serveAfter(120, { interval_minutes: 30 }))?.served).toBe('store');
    expect(await serveAfter(120.1, { interval_minutes: 30 })).toBeNull();
  });

  it('a 15-minute market module: the two-hour minimum, not 45 minutes', async () => {
    expect((await serveAfter(60, { interval_minutes: 15, class: 'markets', kind: 'measurement' }))?.served).toBe('store');
    expect((await serveAfter(119, { interval_minutes: 15 }))?.served).toBe('store');
    expect(await serveAfter(121, { interval_minutes: 15 })).toBeNull();
  });

  it('an hourly module is allowed three hours', async () => {
    expect((await serveAfter(179, { interval_minutes: 60 }))?.served).toBe('store');
    expect(await serveAfter(181, { interval_minutes: 60 })).toBeNull();
  });

  it('a daily reference module: three days', async () => {
    const day = 24 * 60;
    expect((await serveAfter(3 * day - 1, { interval_minutes: 1440, class: 'reference', kind: 'reference' }))?.served).toBe('store');
    expect(await serveAfter(3 * day + 1, { interval_minutes: 1440 })).toBeNull();
    // Two hours would have been far too strict for it.
    expect((await serveAfter(5 * 60, { interval_minutes: 1440 }))?.served).toBe('store');
  });

  it('a state with no usable interval gets the two-hour minimum', async () => {
    expect((await serveAfter(100, { interval_minutes: undefined }))?.served).toBe('store');
    expect(await serveAfter(130, { interval_minutes: undefined })).toBeNull();
  });

  it('says why the live path answers, in the log', async () => {
    const lines = [];
    console.warn.mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    await serveAfter(300, { interval_minutes: 30 });
    expect(lines.join(' ')).toMatch(/300 min old.*limit of 120/);
  });
});

describe('the answer keeps the stored timeline', () => {
  it('metaFor keeps a small timeline and the store answer returns it', async () => {
    const timeline = [{ date: '2026-10-01', text: 'Talks begin' }, { date: '2026-10-09', text: 'Talks stall' }];
    const meta = metaFor({ source: { adapter: 'api', links: [] }, coverage: {}, timeline }, '2026-10-15T10:00:00.000Z');
    expect(meta.timeline).toEqual(timeline);
    const body = await serveFromStore(NEWS, NEWS_PARAMS, { rpc: rpcReturning(page({ meta })), ...SOON });
    expect(body.timeline).toEqual(timeline);
  });

  it('a timeline over 4 KB is left out, never the links or note', () => {
    const timeline = Array.from({ length: 60 }, (_, i) => ({ date: '2026-10-01', text: `event ${i} ${'x'.repeat(200)}` }));
    const meta = metaFor({ source: { adapter: 'api', links: ['https://a.example/x'], note: 'Note' }, coverage: {}, timeline }, '2026-10-15T10:00:00.000Z');
    expect(meta.timeline).toBeUndefined();
    expect(meta.links).toEqual(['https://a.example/x']);
    expect(meta.note).toBe('Note');
    expect(Buffer.byteLength(JSON.stringify(meta))).toBeLessThanOrEqual(16 * 1024);
  });

  it('a timeline is the first thing dropped when the meta is over its 16 KB limit', () => {
    const links = Array.from({ length: 25 }, (_, i) => `https://a.example/${i}/${'p'.repeat(480)}`);
    const timeline = Array.from({ length: 12 }, (_, i) => ({ date: '2026-10-01', text: `event ${i} ${'x'.repeat(200)}` }));
    const small = metaFor({ source: { adapter: 'api', links: links.slice(0, 5) }, coverage: {}, timeline }, '2026-10-15T10:00:00.000Z');
    expect(small.timeline).toEqual(timeline);
    const meta = metaFor({ source: { adapter: 'api', links }, coverage: {}, timeline }, '2026-10-15T10:00:00.000Z');
    expect(meta.timeline).toBeUndefined();
    expect(meta.links.length).toBeGreaterThan(5);
    expect(Buffer.byteLength(JSON.stringify(meta))).toBeLessThanOrEqual(12 * 1024);
  });

  it('an answer with no timeline stores none', () => {
    expect(metaFor({ source: {}, coverage: {} }, '2026-10-15T10:00:00.000Z').timeline).toBeUndefined();
    expect(metaFor({ source: {}, coverage: {}, timeline: [] }, '2026-10-15T10:00:00.000Z').timeline).toBeUndefined();
  });
});

describe('scheduledModuleId', () => {
  beforeEach(() => resetFeedCache());

  it('names a scheduled module by its schedule id, whatever tier alias or spelling the page used', () => {
    expect(scheduledModuleId(NEWS_PARAMS)).toBe(NEWS);
    expect(scheduledModuleId(new URLSearchParams({ tier: 'economics', feature: 'AI & the Tech Industry' }))).toBe(NEWS);
    expect(scheduledModuleId(new URLSearchParams({ tier: 'national', feature: 'cabinet decisions' }))).toBe('national:Cabinet Decisions');
  });

  it('answers the schedule id of every scheduled module from its own tier and feature', () => {
    for (const id of Object.keys(FEED_SCHEDULE)) {
      const [tier, feature] = id.split(/:(.*)/s);
      expect(scheduledModuleId(new URLSearchParams({ tier, feature })), id).toBe(id);
    }
  });

  it('is empty for a module outside the schedule, an unknown one and the home tier', () => {
    expect(scheduledModuleId(new URLSearchParams({ tier: 'national', feature: 'Bill Passage Probability Index' }))).toBe('');
    expect(scheduledModuleId(new URLSearchParams({ tier: 'national', feature: 'No Such Module' }))).toBe('');
    expect(scheduledModuleId(new URLSearchParams({ tier: 'home', feature: 'markets' }))).toBe('');
    expect(scheduledModuleId(new URLSearchParams())).toBe('');
  });
});

describe('serveFeatureFeedStoredFirst: the route', () => {
  const live = () => vi.fn(async () => ({ ok: true, rows: [{ title: 'Live story' }], source: { adapter: 'api' }, fallback: false }));
  beforeEach(() => resetFeedCache());

  it('serves a scheduled module from the store and does not start the live path', async () => {
    const liveFn = live();
    const store = vi.fn(async () => ({ ok: true, rows: [{ title: 'Stored story' }], served: 'store', fallback: false }));
    const body = await serveFeatureFeedStoredFirst(NEWS_PARAMS, { store, live: liveFn });
    expect(store).toHaveBeenCalledWith(NEWS, NEWS_PARAMS, { allowStale: true });
    expect(body.rows).toEqual([{ title: 'Stored story' }]);
    expect(body.served).toBe('store');
    expect(body.fallback).toBe(false);
    expect(liveFn).not.toHaveBeenCalled();
  });

  it('goes live, exactly as today, when the store has nothing', async () => {
    const liveFn = live();
    const body = await serveFeatureFeedStoredFirst(NEWS_PARAMS, { store: vi.fn(async () => null), live: liveFn });
    expect(liveFn).toHaveBeenCalledTimes(1);
    expect(body.served).toBe('live');
    expect(body.rows).toEqual([{ title: 'Live story' }]);
  });

  it('goes live when the store call throws', async () => {
    const liveFn = live();
    const body = await serveFeatureFeedStoredFirst(NEWS_PARAMS, { store: vi.fn(async () => { throw new Error('boom'); }), live: liveFn });
    expect(body.served).toBe('live');
  });

  it('never asks the store about a module outside the schedule', async () => {
    const store = vi.fn();
    const liveFn = live();
    const body = await serveFeatureFeedStoredFirst(new URLSearchParams({ tier: 'national', feature: 'Bill Passage Probability Index' }), { store, live: liveFn });
    expect(store).not.toHaveBeenCalled();
    expect(body.served).toBe('live');
  });

  it('never calls the database for a module outside the schedule, even when it is configured', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://db.example');
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await serveFeatureFeedStoredFirst(new URLSearchParams({ tier: 'national', feature: 'Bill Passage Probability Index' }), { live: live() });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('a store answer never reaches the backup pass', async () => {
    // The backup pass replaces an answer that has no real rows. A store answer is returned as it is.
    const store = vi.fn(async () => ({ ok: true, tier: 'finance', feature: 'AI & the Tech Industry', rows: [{ title: 'Stored story' }], source: { adapter: 'api' }, served: 'store', fallback: false }));
    const body = await serveFeatureFeedStoredFirst(NEWS_PARAMS, { store, live: vi.fn() });
    expect(body.source.kind).not.toBe('backup-pack');
    expect(body.fallback).toBe(false);
    expect(body.rows).toEqual([{ title: 'Stored story' }]);
  });
});

// Task B (2026-10-16): a good stored copy is never hidden by an empty or failed live answer. Past its
// freshness limit the store answer is kept aside (allowStale) and the live path is tried; the stored copy
// answers unless the live path brought real live rows.
describe('serveFromStore: allowStale keeps an old stored copy for the route to weigh', () => {
  const MIN = 60_000;
  const at = (minutes) => ({ now: () => FETCHED + minutes * MIN });
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it('past the limit: null without allowStale (as before), the answer marked stale with it', async () => {
    expect(await serveFromStore(NEWS, NEWS_PARAMS, { rpc: rpcReturning(page()), ...at(300) })).toBeNull();
    const body = await serveFromStore(NEWS, NEWS_PARAMS, { rpc: rpcReturning(page()), ...at(300), allowStale: true });
    expect(body).toMatchObject({ served: 'store', stale: true, fallback: false, fetchedAt: '2026-10-15T10:00:00.000Z' });
    expect(body.rows.map((r) => r.title)).toEqual(['Newer story', 'Older story']);
  });

  it('inside the limit the answer is not marked stale', async () => {
    const body = await serveFromStore(NEWS, NEWS_PARAMS, { rpc: rpcReturning(page()), ...SOON, allowStale: true });
    expect(body.served).toBe('store');
    expect(body).not.toHaveProperty('stale');
  });

  it('allowStale never serves what is not served: serve off, no items, no fetched time', async () => {
    for (const over of [{ serve: false }, { items: [], total: 0 }, { fetched_at: null, meta: { note: 'x', links: [] } }]) {
      expect(await serveFromStore(NEWS, NEWS_PARAMS, { rpc: rpcReturning(page(over)), ...at(300), allowStale: true })).toBeNull();
    }
  });
});

describe('liveAnswerIsUsable: a live answer that may replace a stored copy', () => {
  const liveBody = (over = {}) => ({ ok: true, rows: [{ title: 'Live story' }], source: { adapter: 'api' }, fallback: false, served: 'live', ...over });
  it('real live rows, served live, not a fallback', () => {
    expect(liveAnswerIsUsable(liveBody())).toBe(true);
  });
  it('not: no rows, only a status row, a fallback, the archive, the backup pack, ok false, nothing', () => {
    expect(liveAnswerIsUsable(liveBody({ rows: [] }))).toBe(false);
    expect(liveAnswerIsUsable(liveBody({ rows: [{ title: 'Source offline or empty', status: 'source_status' }] }))).toBe(false);
    expect(liveAnswerIsUsable(liveBody({ fallback: true }))).toBe(false);
    expect(liveAnswerIsUsable(liveBody({ served: 'archive' }))).toBe(false);
    expect(liveAnswerIsUsable(liveBody({ source: { adapter: 'embedded', kind: 'backup-pack' } }))).toBe(false);
    expect(liveAnswerIsUsable(liveBody({ ok: false }))).toBe(false);
    expect(liveAnswerIsUsable(null)).toBe(false);
  });
});

describe('serveFeatureFeedStoredFirst: an old stored copy and the live path', () => {
  // The real store reader over a fake feed_page, five hours after the items were fetched (a news
  // module's limit is two hours): the copy is good but old.
  const staleStore = () => vi.fn((id, params, opts) => serveFromStore(id, params, { ...opts, rpc: rpcReturning(page()), now: () => FETCHED + 300 * 60_000 }));
  beforeEach(() => {
    resetFeedCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('asks the store for its copy even when old, and tries the live path', async () => {
    const store = staleStore();
    const liveFn = vi.fn(async () => ({ ok: true, rows: [], source: { adapter: 'api' }, fallback: false }));
    await serveFeatureFeedStoredFirst(NEWS_PARAMS, { store, live: liveFn });
    expect(store).toHaveBeenCalledWith(NEWS, NEWS_PARAMS, { allowStale: true });
    expect(liveFn).toHaveBeenCalledTimes(1);
  });

  const hiding = {
    'an empty live answer': async () => ({ ok: true, rows: [], source: { adapter: 'api' }, fallback: false }),
    'a status row only': async () => ({ ok: true, rows: [{ title: 'Source offline or empty', status: 'source_status', fail_reason: 'x' }], source: { adapter: 'api' }, fallback: false }),
    'stored rows standing in for a failed source': async () => ({ ok: true, rows: [{ title: 'Archive row' }], source: { adapter: 'embedded' }, fallback: true }),
    'a live attempt that throws': async () => { throw new Error('upstream down'); },
  };
  for (const [name, liveFn] of Object.entries(hiding)) {
    it(`keeps serving the stored copy over ${name}`, async () => {
      const body = await serveFeatureFeedStoredFirst(NEWS_PARAMS, { store: staleStore(), live: vi.fn(liveFn) });
      expect(body.served).toBe('store');
      expect(body.rows.map((r) => r.title)).toEqual(['Newer story', 'Older story']);
      expect(body.fetchedAt).toBe('2026-10-15T10:00:00.000Z');
    });
  }

  it('real live rows still replace an old stored copy', async () => {
    const liveFn = vi.fn(async () => ({ ok: true, rows: [{ title: 'Live story' }], source: { adapter: 'api' }, fallback: false }));
    const body = await serveFeatureFeedStoredFirst(NEWS_PARAMS, { store: staleStore(), live: liveFn });
    expect(body.served).toBe('live');
    expect(body.rows).toEqual([{ title: 'Live story' }]);
  });
});

// F201: a handbook register's variant (a table, or one whole-year block of a large table) is read whole:
// up to four feed_page calls of 500, made at once, which must agree with each other.
describe('serveFromStore: a whole handbook variant (F201)', () => {
  const FISCAL = 'state:State Fiscal Deep-Dive';
  const LOADED = '2026-01-10T00:00:00.000Z';
  const NOW = { now: () => Date.parse('2026-10-15T10:00:00.000Z') };
  const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ state: `S${i % 32}`, indicator: `I${Math.floor(i / 32)}`, year: '2025', value: i, i }));
  const VIEW = { heading: 'Table 176', table: 176, block: { from: '2023', through: '2025' }, blocks: [{ value: '', variant: '176', from: '2023', through: '2025', count: 1824 }, { value: '2020', variant: '176@2020', from: '2020', through: '2022', count: 1822 }], years: ['2025', '2024', '2023', '2022', '2021', '2020'] };
  /** feed_page over `rows`, one window per call, as the database pages a variant. */
  function store(rows, { view = VIEW, over = () => ({}) } = {}) {
    return vi.fn(async (_name, a) => ({
      tier: 'state', feature: 'State Fiscal Deep-Dive', variant: a.p_variant, class: 'register', kind: 'reference', serve: true,
      fetched_at: LOADED, interval_minutes: 43200, total: rows.length,
      meta: { note: 'Table 176', links: [], coverage: { from: '2025-12-11', through: '2025-12-11', exhaustive: false }, adapter: 'register', kind: 'register', fetched_at: LOADED, ...(view ? { view } : {}) },
      items: rows.slice(a.p_offset, a.p_offset + a.p_limit).map((row) => ({ item_key: `k${row.i}`, row })),
      ...over(a),
    }));
  }
  const ask = (params, rpc) => serveFromStore(FISCAL, new URLSearchParams({ tier: 'state', feature: 'State Fiscal Deep-Dive', ...params }), { rpc, ...NOW });
  const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
  afterEach(() => vi.restoreAllMocks());

  it('a 1,824-item block is served whole, in order, from four reads made at once', async () => {
    const rows = rowsOf(1824);
    const rpc = store(rows);
    const body = await ask({ table: '176' }, rpc);
    expect(rpc.mock.calls.map(([n, a]) => [n, a.p_variant, a.p_limit, a.p_offset])).toEqual([0, 500, 1000, 1500].map((o) => ['feed_page', '176', STORE_PAGE_ROWS, o]));
    expect(body.rows).toEqual(rows);
    expect(body).toMatchObject({ served: 'store', register: true, storeTotal: 1824 });
    expect(body.meta.blocks).toHaveLength(2);
  });

  it('`years` names an older block', async () => {
    const rpc = store(rowsOf(10));
    await ask({ table: '176', years: '2020' }, rpc);
    expect(new Set(rpc.mock.calls.map(([, a]) => a.p_variant))).toEqual(new Set(['176@2020']));
    expect(storeVariant(FISCAL, new URLSearchParams({ table: '176', years: '2020' }))).toBe('176@2020');
    expect(storeVariant(FISCAL, new URLSearchParams({ table: '176', years: 'x' }))).toBe('176');
    expect(storeVariant(FISCAL, new URLSearchParams({ years: '2020' }))).toBe('164');
  });

  it('today\'s capped data (480 items, a view with no blocks) is served as today', async () => {
    const rows = rowsOf(480);
    const body = await ask({ table: '176' }, store(rows, { view: { heading: 'Table 176', table: 176, tables: 15, as_of: '2025-12-11', status: 'RBI HANDBOOK · STATE LEVEL' } }));
    expect(body.rows).toEqual(rows);
    expect(body.storeTotal).toBe(480);
    expect(body.meta.blocks).toBeUndefined();
  });

  it('reads that disagree on the load time or the total, or that do not add up to the total, give the live path', async () => {
    warn();
    const rows = rowsOf(1824);
    expect(await ask({ table: '176' }, store(rows, { over: (a) => (a.p_offset === 1000 ? { fetched_at: '2026-10-15T00:00:00.000Z' } : {}) }))).toBeNull();
    expect(await ask({ table: '176' }, store(rows, { over: (a) => (a.p_offset === 500 ? { total: 1825 } : {}) }))).toBeNull();
    expect(await ask({ table: '176' }, store(rows, { over: (a) => (a.p_offset === 1500 ? { items: [] } : {}) }))).toBeNull();
  });

  it('one read failing or passing the time limit gives the live path', async () => {
    warn();
    const rows = rowsOf(1824);
    const base = store(rows);
    const failing = vi.fn(async (n, a) => (a.p_offset === 1000 ? Promise.reject(new Error('boom')) : base(n, a)));
    expect(await ask({ table: '176' }, failing)).toBeNull();
    const slow = vi.fn((n, a) => (a.p_offset === 1500 ? new Promise(() => {}) : base(n, a)));
    expect(await serveFromStore(FISCAL, new URLSearchParams({ table: '176' }), { rpc: slow, timeoutMs: 30, ...NOW })).toBeNull();
  });

  it('`serve` off, or no state for the variant, gives the live path', async () => {
    expect(await ask({ table: '176' }, store(rowsOf(10), { over: () => ({ serve: false }) }))).toBeNull();
    expect(await ask({ table: '176' }, vi.fn(async () => null))).toBeNull();
  });

  it('a module without whole variants still makes exactly one feed_page call; MLA Directory\'s page across states is unchanged', async () => {
    const rpc = rpcReturning(page());
    await serveFromStore(NEWS, NEWS_PARAMS, { rpc, ...SOON });
    expect(rpc).toHaveBeenCalledTimes(1);
    const across = vi.fn(async () => ({ all_served: false }));
    expect(await serveFromStore('state:MLA Directory', new URLSearchParams({ tier: 'state', feature: 'MLA Directory' }), { rpc: across, ...SOON })).toBeNull();
    expect(across.mock.calls.map(([n]) => n)).toEqual(['feed_page_across']);
  });
});
