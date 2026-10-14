import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { config } from '../api/router.js';
import { backupPackAllowed, LIVE_BACKUP_PACKS, loadBackupForFeature } from '../server/backupFeed.mjs';
import { resetFeedCache } from '../server/featureFeed.mjs';

// F169 T1 (owner, 2026-10-14; spec docs/specs/2026-10-14-module-data-repair.md, question 1): the
// live function carries no backup pack and reads none unless its module is on LIVE_BACKUP_PACKS,
// which starts empty. Several packs hold a different kind of record from their module (Box Office
// showed news headlines). The local dev server still reads every pack. Replaces the F156 test that
// listed four packs by name in includeFiles.
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const routerFn = vercel.functions['api/router.js'];
const globs = (value) => String(value || '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);

// The modules the audit found showing another dataset from a pack, and the four F156 had listed.
const PACKED = [
  ['Box Office Tracker', 'entertainment'],
  ['OTT & Studio Intelligence', 'entertainment'],
  ['Sports Governance & Policy', 'sports'],
  ['Satellite Infrastructure', 'geopolitics'],
  ['Growth Indicators', 'geopolitics'],
  ['Global Trade', 'geopolitics'],
  ['Athlete Index', 'sports'],
];

describe('backup packs on the live function (F169)', () => {
  it('lists the same files in vercel.json and the router config', () => {
    expect(config.includeFiles).toEqual([routerFn.includeFiles]);
    expect(config.excludeFiles).toEqual([routerFn.excludeFiles]);
  });

  it('includes no backup path and excludes the whole backup folder', () => {
    for (const p of [...globs(routerFn.includeFiles), ...config.includeFiles.flatMap(globs)]) {
      expect(p.includes('backup'), p).toBe(false);
    }
    expect(routerFn.excludeFiles).toBe('backup/**');
    expect(config.excludeFiles).toContain('backup/**');
  });

  it('starts with an empty allow-list', () => {
    expect(LIVE_BACKUP_PACKS).toEqual([]);
    expect(Object.isFrozen(LIVE_BACKUP_PACKS)).toBe(true);
  });
});

describe('reading a pack, on Vercel and locally (F169)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each(PACKED)('on Vercel, %s gets no backup rows', (feature, tier) => {
    vi.stubEnv('VERCEL', '1');
    expect(loadBackupForFeature(feature, tier, { cap: 5 })).toBeNull();
  });

  it.each(PACKED)('locally, %s still gets its backup rows', (feature, tier) => {
    vi.stubEnv('VERCEL', '');
    expect(loadBackupForFeature(feature, tier, { cap: 5 })?.rows?.length).toBeGreaterThan(0);
  });

  it('on Vercel, a module on the allow-list may read its pack and one off it may not', () => {
    const env = { VERCEL: '1' };
    expect(backupPackAllowed('Athlete Index', { env, allowList: ['Athlete Index'] })).toBe(true);
    expect(backupPackAllowed('Box Office Tracker', { env, allowList: ['Athlete Index'] })).toBe(false);
    expect(backupPackAllowed('Athlete Index', { env })).toBe(false);
    expect(backupPackAllowed('Athlete Index', { env: {} })).toBe(true);
  });
});

describe('the deployed router without packs (F169)', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    resetFeedCache();
    // Every live source fails at once, as in the F156 route test; the archive has no Athlete Index rows.
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
    vi.stubEnv('VERCEL', '1');
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('answers the plain empty feed, not a backup pack, when live and archive are empty', async () => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; },
      end() { return this; },
    };
    const route = 'feature-feed';
    await handler({ method: 'GET', url: `/api/router?__route=${route}&tier=sports&feature=Athlete%20Index`, query: { __route: route }, headers: { host: 'localhost' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.source?.kind).not.toBe('backup-pack');
    expect((res.body.rows || []).filter((r) => r?.status !== 'source_status')).toEqual([]);
  });
});
