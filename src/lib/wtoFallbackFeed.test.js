import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F129: when the WTO register is missing (here, empty), the module falls back to the live news
 * search with its forum query (F84), not to an empty table. It tests server/featureFeed.mjs and lives
 * here because Vitest collects tests from src/ only.
 */
vi.mock('./lawPack.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, lawRows: (slice, packs) => (slice === 'wto' ? [] : actual.lawRows(slice, packs)) };
});

const rss = '<?xml version="1.0"?><rss><channel><item><title>WTO panel rules on tariffs - Reuters</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Mon, 12 Oct 2026 09:00:00 GMT</pubDate><description>x</description><source url="https://www.reuters.com">Reuters</source></item></channel></rss>';

describe('WTO feed without the register', () => {
  // Publisher tests use a fixed story date; keep it inside the live seven-day window.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T10:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('searches Google News with the WTO dispute query', async () => {
    const asked = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      asked.push(String(url));
      return { ok: true, status: 200, url: String(url), headers: new Headers({ 'content-type': 'application/rss+xml' }), text: async () => rss, arrayBuffer: async () => new TextEncoder().encode(rss).buffer };
    }));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const feed = await serveFeatureFeed(new URLSearchParams({ tier: 'judiciary', feature: 'WTO Dispute Settlement' }));
    const news = asked.find((u) => /news\.google\.com\/rss\/search/.test(u));
    expect(new URL(news).searchParams.get('q')).toMatch(/^\("World Trade Organization" OR WTO\) \("dispute settlement"/);
    expect(feed.rows[0]).toMatchObject({ publisher: 'Reuters' });
    expect(feed.rows[0]).not.toHaveProperty('ds_number');
  });
});
