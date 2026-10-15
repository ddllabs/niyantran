import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F181: home Top Stories was GDELT only and answered "no live source" once GDELT was switched off
 * (F169 T4). The owner approved Google News India: its top-stories feed, read the way the news wires
 * read Google News RSS. Items have the shape the feed gave on 2026-10-15: "Headline - Publisher" as the
 * title, a news.google.com article link, an RFC 822 date, an entity-encoded description and the
 * publisher in <source>.
 */
const item = (headline, publisher, id, pub = 'Thu, 15 Oct 2026 06:30:00 GMT') =>
  `<item><title>${headline} - ${publisher}</title><link>https://news.google.com/rss/articles/${id}?oc=5</link>` +
  `<guid isPermaLink="false">${id}</guid><pubDate>${pub}</pubDate>` +
  `<description>&lt;a href="https://news.google.com/rss/articles/${id}?oc=5" target="_blank"&gt;${headline}&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;${publisher}&lt;/font&gt;</description>` +
  `<source url="https://example.com">${publisher}</source></item>`;
const feedXml = (items) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Top stories - Google News</title>${items.join('')}</channel></rss>`;

function stubNews(responder) {
  const seen = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    seen.push(u);
    const out = responder(u);
    const body = out.body ?? '';
    return {
      ok: out.ok !== false, status: out.status ?? 200, url: u,
      headers: new Headers({ 'content-type': 'application/xml; charset=utf-8' }),
      text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    };
  }));
  return seen;
}

async function topStories() {
  const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
  return serveFeatureFeed(new URLSearchParams({ tier: 'home', feature: 'Top Stories' }));
}

describe('Home Top Stories (F181)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('answers the Google News India top stories, as news-search rows with a title, link, date and publisher', async () => {
    const seen = stubNews(() => ({
      body: feedXml([
        item('Cabinet clears new highway corridor', 'The Hindu', 'CBMiAAA'),
        item('Markets close higher on rate-cut hopes', 'Business Standard', 'CBMiBBB', 'Thu, 15 Oct 2026 05:10:00 GMT'),
      ]),
    }));
    const feed = await topStories();
    expect(seen).toEqual(['https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en']);
    expect(feed.ok).toBe(true);
    expect(feed.tier).toBe('home');
    expect(feed.feature).toBe('Top Stories');
    expect(feed.source.adapter).toBe('news-search');
    expect(feed.source.gdelt).toBe(false);
    expect(feed.source.links).toEqual(['https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en']);
    expect(feed.source.note).toMatch(/Google News/i);
    expect(feed.source.note).not.toMatch(/no live/i);
    expect(feed.fallback).toBe(false);
    expect(feed.rows).toHaveLength(2);
    expect(feed.rows[0]).toMatchObject({
      title: 'Cabinet clears new highway corridor - The Hindu',
      source_url: 'https://news.google.com/rss/articles/CBMiAAA?oc=5',
      publisher: 'The Hindu',
    });
    expect(feed.rows[0].date).toMatch(/2026-10-15|15 Oct 2026/);
    for (const r of feed.rows) expect(r.status).not.toBe('source_status');
  });

  it('answers a plain status row, and invents no story, when Google News does not answer', async () => {
    stubNews(() => ({ ok: false, status: 503, body: '' }));
    const feed = await topStories();
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0]).toMatchObject({ status: 'source_status', readiness: 'offline', adapter: 'news-search' });
    expect(feed.source.note).toMatch(/No stories were invented/i);
    expect(feed.source.gdelt).toBe(false);
  });

  it('answers a status row when the feed has no items', async () => {
    stubNews(() => ({ body: feedXml([]) }));
    const feed = await topStories();
    expect(feed.rows.every((r) => r.status === 'source_status')).toBe(true);
  });

  it('serves the same answer for the "stories" alias and never asks GDELT', async () => {
    const seen = stubNews(() => ({ body: feedXml([item('One story', 'Example', 'CBMiCCC')]) }));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const feed = await serveFeatureFeed(new URLSearchParams({ tier: 'home', feature: 'stories' }));
    expect(feed.rows).toHaveLength(1);
    expect(seen.some((u) => /gdelt/i.test(u))).toBe(false);
  });
});
