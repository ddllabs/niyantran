// F156 (spec docs/specs/2026-10-14-paged-module-lists.md, section 8.2): the deployed router answered
// /api/feature-feed and the National, Global and Law landings without the backup packs that the Vite
// middleware falls back to, so a module whose live source failed showed nothing on the site. Both now
// call one shared function, a backup answer keeps `served: 'archive'`, and a pack is read bounded.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { API_CACHE } from '../../api/router.js';
import { handleFeatureFeedRequest, resetFeedCache } from '../../server/featureFeed.mjs';
import { loadBackupForFeature } from '../../server/backupFeed.mjs';

const ATHLETES = 'tier=sports&feature=Athlete%20Index';

function vercelResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader: vi.fn((name, value) => { res.headers[name.toLowerCase()] = value; }),
    status: vi.fn((code) => { res.statusCode = code; return res; }),
    json: vi.fn((body) => { res.body = JSON.parse(JSON.stringify(body)); return res; }),
    end: vi.fn(() => res),
  };
  return res;
}

const routerGet = async (route) => {
  const [path, query] = route.split('?');
  const res = vercelResponse();
  await handler({ method: 'GET', url: `/api/router?__route=${path}&${query}`, query: { __route: path }, headers: { host: 'localhost' } }, res);
  return res;
};

const middlewareGet = async (route) => {
  const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(raw) { this.body = raw ? JSON.parse(raw) : undefined; } };
  await handleFeatureFeedRequest({ method: 'GET', url: `/api/${route}`, headers: { host: 'localhost' } }, res, () => { throw new Error('not handled'); });
  return res;
};

const realRows = (body) => (body?.rows || []).filter((r) => r?.status !== 'source_status');

describe('backup packs behind the deployed router (F156)', () => {
  const originalFetch = globalThis.fetch;
  // Every live source fails at once; the archive has no Athlete Index rows, the backup pack does.
  beforeEach(() => {
    resetFeedCache();
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('answers backup rows on /api/feature-feed when live and archive are empty, like the Vite middleware', async () => {
    const router = await routerGet(`feature-feed?${ATHLETES}`);
    expect(router.statusCode).toBe(200);
    expect(router.body.source.kind).toBe('backup-pack');
    expect(realRows(router.body).length).toBeGreaterThan(0);

    resetFeedCache();
    const local = await middlewareGet(`feature-feed?${ATHLETES}`);
    expect(local.statusCode).toBe(200);
    expect(router.body).toEqual(local.body);
  });

  it('keeps served: archive on a backup answer, so the edge keeps it for one minute only', async () => {
    const router = await routerGet(`feature-feed?${ATHLETES}`);
    expect(router.body.served).toBe('archive');
    expect(router.headers['vercel-cdn-cache-control']).toBe(API_CACHE.cdnArchive);
  });

  it('a Global landing count comes from the backup pack, as it does locally', async () => {
    const router = await routerGet('global-landing?feature=Growth%20Indicators');
    expect(router.statusCode).toBe(200);
    expect(router.body.count).toBeGreaterThan(0);
    expect(router.body.served).toBe('archive');
  });
});

describe('the bounded backup read (F156)', () => {
  it('reads the largest pack (5.9 MB, Key Financial Indicators) without reading it whole (well under a second alone)', () => {
    const started = performance.now();
    const pack = loadBackupForFeature('Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop)', 'economics', { cap: 500 });
    const took = performance.now() - started;
    expect(pack.rows).toHaveLength(500);
    // F174: well under a second alone; the full suite on a busy machine has taken over 2.5 s
    // (2026-10-15), so the bound guards against an unbounded read (tens of seconds), not against a
    // slow machine.
    expect(took).toBeLessThan(10_000);
  }, 30_000);
});

describe('the router without the packs (as deployed today)', () => {
  afterEach(() => {
    vi.doUnmock('../../server/backupFeed.mjs');
    vi.resetModules();
  });

  it('answers the empty feed unchanged when no pack can be found', async () => {
    vi.resetModules();
    vi.doMock('../../server/backupFeed.mjs', () => ({ loadBackupForFeature: () => null }));
    const { serveFeatureFeedWithBackup } = await import('../../server/featureFeed.mjs');
    const empty = { ok: true, feature: 'Athlete Index', rows: [{ status: 'source_status' }], source: { adapter: 'api' }, served: 'live' };
    const body = await serveFeatureFeedWithBackup(new URLSearchParams(ATHLETES), { live: async () => empty });
    expect(body).toEqual(empty);
  });
});
