import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F128: Google News RSS names each item's publisher in a <source> element. The server keeps it as
 * `publisher`, so a Law wire panel can say who published the item. A feed without the element is
 * unchanged. Google News is stubbed with the shape it serves.
 */
const item = (title, source) => `<item><title>${title}</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Mon, 12 Oct 2026 09:00:00 GMT</pubDate><description>Summary text</description>${source}</item>`;
const rss = (items) => `<?xml version="1.0"?><rss><channel>${items.join('')}</channel></rss>`;

function stubFeed(body) {
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true, status: 200, url: String(url), headers: new Headers({ 'content-type': 'application/rss+xml' }),
    text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  })));
}

async function wireFeed(feature) {
  const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
  return serveFeatureFeed(new URLSearchParams({ tier: 'judiciary', feature }));
}

describe('Law wire feed publisher (F128)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('keeps the publisher Google News names for each item', async () => {
    stubFeed(rss([
      item('Court hears plea - LiveLaw', '<source url="https://www.livelaw.in">LiveLaw</source>'),
      item('Tribunal order reported - Bar &amp; Bench', '<source url="https://www.barandbench.com">Bar &amp; Bench</source>'),
    ]));
    const feed = await wireFeed('ICC Proceedings');
    expect(feed.rows.map((r) => r.publisher)).toEqual(['LiveLaw', 'Bar & Bench']);
  });

  it('adds no publisher when the feed names none', async () => {
    stubFeed(rss([item('Court hears plea', '')]));
    const feed = await wireFeed('ICC Proceedings');
    expect(feed.rows[0].title).toBe('Court hears plea');
    expect(feed.rows[0]).not.toHaveProperty('publisher');
  });
});
