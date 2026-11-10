import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDataState } from './dataState.js';

/**
 * F320: a curated news module whose search answered with headlines, none on topic in the window, is
 * verified empty (F317 records it ok). Its status row said "Source offline or empty" and resolveDataState
 * read that wording as OFFLINE. It now says there were no on-topic stories in the last N days and is not
 * offline; an outage keeps the offline wording and state. Search results are faked.
 */
const NOW = Date.parse('2026-11-10T12:00:00Z');
const FEATURE = 'Governor Assent Tracker'; // 30 day window
const FEATURE_7 = 'Cabinet Decisions'; // 7 day window
const OFF_TOPIC = ['Local team wins the district cricket final - Example Times', 'Monsoon arrives early over the coast - Example Herald'];
const rssOf = (titles) => `<?xml version="1.0"?><rss><channel>${titles
  .map((t, i) => `<item><title>${t}</title><link>https://example.com/${i}</link><pubDate>Fri, 06 Nov 2026 10:0${i}:00 GMT</pubDate></item>`)
  .join('')}</channel></rss>`;
const answer = (body, { status = 200, type = 'application/rss+xml' } = {}) => new Response(body, { status, headers: { 'content-type': type } });
const feed = async (feature) => {
  const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
  return serveFeatureFeed(new URLSearchParams({ tier: 'state', feature }));
};

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('F320: verified-empty versus outage', () => {
  it.each([[FEATURE, 30], [FEATURE_7, 7]])('%s: a verified-empty answer says no on-topic stories in the last %i days, not offline', async (feature, days) => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(rssOf(OFF_TOPIC))));
    const out = await feed(feature);
    expect(out.meta?.nothing_new).toBe(true);
    const row = out.rows[0];
    expect(row.status).toBe('source_status');
    expect(row.title).toBe('No on-topic stories');
    expect(row.detail).toContain(`No on-topic stories in the last ${days} days`);
    expect(row.readiness).toBe('empty');
    expect(`${row.title} ${row.detail}`).not.toMatch(/offline/i);
    const state = resolveDataState(out);
    expect(state.id).toBe('empty');
    expect(state.id).not.toBe('offline');
    expect(state.detail).toContain(`last ${days} days`);
  });

  it('an outage keeps the offline wording and state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer('Server Error', { status: 500, type: 'text/html' })));
    const out = await feed(FEATURE);
    expect(out.meta?.nothing_new).toBeUndefined();
    expect(out.rows[0].title).toBe('Source offline or empty');
    expect(out.rows[0].readiness).toBe('offline');
    expect(resolveDataState(out).id).toBe('offline');
  });

  it('a parser fault (untitled rows) is not called verified-empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(rssOf(['', '  ']))));
    const out = await feed(FEATURE);
    expect(out.rows[0].title).toBe('Source offline or empty');
    expect(resolveDataState(out).id).toBe('offline');
  });

  it('dataState does not read an empty-flagged row as offline even when its text carries outage words', () => {
    const feed = {
      rows: [{ status: 'source_status', readiness: 'empty', title: 'No on-topic stories', detail: 'A search that failed to find anything new.', fail_reason: 'timed out earlier' }],
      source: { adapter: 'news-search', note: 'Source unavailable elsewhere' },
    };
    expect(resolveDataState(feed).id).toBe('empty');
  });
});
