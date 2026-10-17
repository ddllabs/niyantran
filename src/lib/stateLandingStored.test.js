import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/router.js';
import { handleFeatureFeedRequest, resetFeedCache } from '../../server/featureFeed.mjs';
import { serveStateLanding } from '../../server/stateLandingSummary.mjs';
import { FEED_REGISTERS } from '../../server/feedSchedule.mjs';
import { withoutLoaderCaches } from '../../server/loaderCache.mjs';

const DIRECTORY = 'MLA Directory';
const PROFILES = 'MLA Report Card + Statement Tracker';
const now = Date.parse('2030-01-10T12:00:00Z');
const fetchedAt = '2030-01-10T11:55:00.000Z';
const states = FEED_REGISTERS[`state:${DIRECTORY}`].values;
const bindings = [{ personLabel: { value: 'Member A' }, stateLabel: { value: 'Goa' } }];

function page(feature, variant = '', over = {}) {
  const directory = feature === DIRECTORY;
  const runAt = over.fetched_at || fetchedAt;
  const rows = Array.from({ length: directory ? 16 : 2 }, (_, i) => ({
    title: `${variant || 'Goa'} Member ${i}`, state: variant || 'Goa',
    section: 'MLA profiles', source_url: `https://www.wikidata.org/entity/Q${i + 1}`,
  }));
  return {
    tier: 'state', feature, variant, class: directory ? 'register' : 'reference',
    kind: 'reference', serve: true, interval_minutes: directory ? 43200 : 1440,
    fetched_at: runAt, total: directory ? 100 : 2,
    meta: { adapter: directory ? 'register' : 'api', note: 'Stored MLA source sample', links: ['https://www.wikidata.org/'] },
    items: rows.map((row, i) => ({ item_key: `mla:${variant}:${i}`, row, last_seen: runAt })),
    ...over,
  };
}

function network({ available = true, upstream = false, over = {} } = {}) {
  const fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (u === 'https://db.example/rest/v1/rpc/feed_page_across') {
      expect(JSON.parse(init.body)).toEqual({ p_tier: 'state', p_feature: DIRECTORY, p_per_variant: 16 });
      return Response.json(available ? { all_served: true, pages: states.map(state => page(DIRECTORY, state, over)) } : null);
    }
    if (u === 'https://db.example/rest/v1/rpc/feed_page') {
      expect(JSON.parse(init.body)).toMatchObject({ p_tier: 'state', p_feature: PROFILES, p_variant: '' });
      return Response.json(available ? page(PROFILES, '', over) : null);
    }
    if (upstream && u.startsWith('https://query.wikidata.org/')) return Response.json({ results: { bindings } });
    if (upstream && u.startsWith('https://news.google.com/')) return new Response('<rss><channel/></rss>');
    return new Response('Source unavailable', { status: 503 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function request(local, feature, method = 'GET') {
  const req = { method, url: `/api/state-landing?${new URLSearchParams({ feature })}`, headers: { host: 'localhost' } };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; },
    end(body) { this.body = JSON.parse(body); } };
  await withoutLoaderCaches(() => local ? handleFeatureFeedRequest(req, res, () => { throw new Error('Skipped route'); }) : handler(req, res));
  return res;
}

beforeEach(() => {
  resetFeedCache();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubEnv('SUPABASE_URL', 'https://db.example');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'synthetic-f223-key');
  vi.stubEnv('VERCEL', '1');
});
afterEach(() => { resetFeedCache(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each([false, true])('scoped State stored summaries (local=%s)', local => {
  it.each([DIRECTORY, PROFILES])('%s reads the healthy store without attempting the unavailable upstream', async feature => {
    const fetch = network();
    const res = await request(local, feature);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, availability: 'ready', served: 'store', fetchedAt,
      count: feature === DIRECTORY ? 496 : 2, asOf: null });
    expect(res.body).not.toHaveProperty('rows');
    expect(res.body).not.toHaveProperty('stale');
    expect(res.body.sourceNote).toContain(feature === DIRECTORY ? 'stored register of 3,100' : 'Stored MLA source sample');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retains stale reference metadata when upstream cannot replace the stored profiles', async () => {
    const old = '2030-01-06T12:00:00.000Z';
    network({ over: { fetched_at: old } });
    const res = await request(local, PROFILES);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, count: 2, served: 'store', fetchedAt: old, stale: true, ageMinutes: 5760, asOf: null });
  });

  it.each([DIRECTORY, PROFILES])('%s falls back to the existing live loader if storage is missing', async feature => {
    network({ available: false, upstream: true });
    const res = await request(local, feature);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, availability: 'ready', served: 'live', count: 1 });
    expect(res.body).not.toHaveProperty('fetchedAt');
  });

  it('does not fabricate a zero when both stored and live profiles are unusable', async () => {
    network({ available: false });
    const res = await request(local, PROFILES);
    expect(res.body.count).toBeNull();
    expect(res.body.availability).toBe('unavailable');
    expect(res.body.served).not.toBe('store');
  });

  it('leaves other State summary routing alone even when that module has stored data', async () => {
    const fetch = network();
    await request(local, 'State Governance Brief');
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/rest/v1/rpc/'))).toBe(false);
  });

  it('validates feature and method before attempting any source or logging caller data', async () => {
    const fetch = network();
    expect((await request(local, 'unknown\nPRIVATE')).statusCode).toBe(400);
    expect((await request(local, DIRECTORY, 'POST')).statusCode).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('safe State summary diagnostics', () => {
  it('logs the validated feature and fixed timeout code for an empty archive outcome', async () => {
    const load = async () => ({ ok: true, tier: 'state', feature: DIRECTORY, rows: [], served: 'archive',
      source: { diagnostic: 'timeout · no-stored-records · PRIVATE' } });
    const summary = await serveStateLanding(new URLSearchParams({ feature: DIRECTORY }), load);
    expect(summary).toMatchObject({ ok: false, count: null, availability: 'error', served: 'archive' });
    expect(console.warn).toHaveBeenCalledWith('[state-landing]', { feature: DIRECTORY, code: 'live-timeout', served: 'archive' });
    expect(JSON.stringify(console.warn.mock.calls)).not.toContain('PRIVATE');
  });

  it('logs only a fixed code on a thrown error, without masking it', async () => {
    const error = new Error('PRIVATE URL / credentials');
    await expect(serveStateLanding(new URLSearchParams({ feature: PROFILES }), async () => { throw error; })).rejects.toBe(error);
    expect(console.warn).toHaveBeenCalledWith('[state-landing]', { feature: PROFILES, code: 'summary-error' });
    expect(JSON.stringify(console.warn.mock.calls)).not.toContain('PRIVATE');
  });

  it('does not log untrusted served or diagnostic values for a failed source', async () => {
    const load = async () => ({ ok: false, tier: 'state', feature: PROFILES,
      rows: [{ title: 'Unusable response' }], served: 'PRIVATE', source: { adapter: 'api', diagnostic: 'PRIVATE' } });
    const summary = await serveStateLanding(new URLSearchParams({ feature: PROFILES }), load);
    expect(summary.ok).toBe(false);
    expect(console.warn).toHaveBeenCalledWith('[state-landing]', { feature: PROFILES, code: 'summary-unavailable', served: 'unknown' });
    expect(JSON.stringify(console.warn.mock.calls)).not.toContain('PRIVATE');
  });
});
