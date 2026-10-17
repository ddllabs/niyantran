import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Owner decision 2026-10-16: MLA Report Card + Statement Tracker holds Wikidata MLA identity profiles
 * plus Google News coverage; there is no attendance, questions or funds data (its UP pack is empty).
 * Its envelope note says so plainly, with data and without. The feature key is unchanged.
 */
const RSS = `<?xml version="1.0"?><rss><channel><item><title>Assembly session begins - Example News</title><link>https://news.google.com/rss/articles/a1</link><pubDate>Thu, 15 Oct 2026 08:00:00 GMT</pubDate><description>Assembly session begins</description><source url="https://news.example">Example News</source></item></channel></rss>`;
const reply = (url, body, ok = true) => ({
  ok, status: ok ? 200 : 503, url: String(url), headers: new Headers({ 'content-type': /wikidata/i.test(String(url)) ? 'application/json' : 'application/rss+xml' }),
  text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer,
});

async function mlaReportCard() {
  const { serveFeatureFeed, resetFeedCache } = await import('../../server/featureFeed.mjs');
  resetFeedCache();
  return serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'MLA Report Card + Statement Tracker' }));
}

describe('MLA Report Card + Statement Tracker note', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('says it is Wikidata profiles plus Google News coverage, not a scorecard, when it has rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (/wikidata/i.test(String(url)) ? reply(url, JSON.stringify({ results: { bindings: [{ person: {value:'http://www.wikidata.org/entity/Q123'}, personLabel: {value:'Sample Member'} }] } })) : reply(url, RSS))));
    const feed = await mlaReportCard();
    expect(feed.rows.some((r) => r.status !== 'source_status')).toBe(true);
    expect(feed.source.note).toMatch(/MLA profiles/);
    expect(feed.source.note).toMatch(/not a complete current assembly register or a scorecard/);
    expect(feed.source.note).toMatch(/no attendance, questions or funds data/);
    expect(feed.source.note).not.toMatch(/report card/i);
  }, 30_000);

  it('coverage alone cannot stand in for a missing profile directory', async () => {
    vi.stubGlobal('fetch', vi.fn(async url => /wikidata/i.test(String(url)) ? reply(url, '', false) : reply(url, RSS)));
    const feed = await mlaReportCard();
    expect(feed.rows.every(r => r.status === 'source_status')).toBe(true);
  });

  it('says the same when no row could be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => reply(url, '', false)));
    const feed = await mlaReportCard();
    expect(feed.source.note).toMatch(/Wikidata MLA identity profiles plus Google News coverage/);
    expect(feed.source.note).toMatch(/not a scorecard \(no attendance, questions or funds data yet\)/);
    expect(feed.source.note).toMatch(/No rows were invented/);
  }, 30_000);
});
