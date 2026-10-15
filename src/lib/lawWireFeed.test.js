import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F128: Google News RSS names each item's publisher in a <source> element. The server keeps it as
 * `publisher`, so a Law wire panel can say who published the item. A feed without the element is
 * unchanged. Google News is stubbed with the shape it serves. It tests server/featureFeed.mjs and
 * lives here because Vitest collects tests from src/ only.
 */
// Each story has its own link (F202: an answer keeps each link once, as Google News's real links are).
const item = (title, source) => `<item><title>${title}</title><link>https://news.google.com/rss/articles/${encodeURIComponent(title)}</link><pubDate>Mon, 12 Oct 2026 09:00:00 GMT</pubDate><description>Summary text</description>${source}</item>`;
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

  it('reads Google News\'s entity-encoded description as plain text, not as markup source', async () => {
    const encoded = '&lt;a href="https://news.google.com/rss/articles/abc" target="_blank"&gt;Court hears plea&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;LiveLaw&lt;/font&gt;';
    const body = rss([item('Court hears plea - LiveLaw', '<source url="https://www.livelaw.in">LiveLaw</source>')]).replace('<description>Summary text</description>', `<description>${encoded}</description>`);
    stubFeed(body);
    const feed = await wireFeed('ICC Proceedings');
    expect(feed.rows[0].summary).toBe('Court hears plea LiveLaw');
    const escaped = rss([item('Tribunal fees revised', '')]).replace('<description>Summary text</description>', '<description>Fees &amp;lt;b&amp;gt; rise &amp;amp; fall</description>');
    vi.resetModules();
    stubFeed(escaped);
    expect((await wireFeed('ICC Proceedings')).rows[0].summary).toBe('Fees &lt;b&gt; rise & fall');
  });

  it('adds no publisher when the feed names none', async () => {
    stubFeed(rss([item('Court hears plea', '')]));
    const feed = await wireFeed('ICC Proceedings');
    expect(feed.rows[0].title).toBe('Court hears plea');
    expect(feed.rows[0]).not.toHaveProperty('publisher');
  });
});

/**
 * F84: each Law news-wire module searches with a forum-specific query (the court's or tribunal's
 * own name with legal terms), not the source registry's product-name query such as
 * India ("ICC" OR "Proceedings"), which returned cricket for ICC Proceedings.
 */
describe('Law wire feed queries (F84)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  const QUERIES = {
    'UP High Court (Allahabad) Order Feed': /^\("Allahabad High Court" OR "High Court of Judicature at Allahabad"\)/,
    'District Court Case Tracker': /"district court" OR "sessions court"/,
    'NGT Environmental Litigation Tracker': /^\("National Green Tribunal" OR NGT\)/,
    'CAT & Consumer Disputes (NCDRC) Watch': /"Central Administrative Tribunal" OR NCDRC/,
    'HC Judge Profiles & Bench Analytics': /collegium/,
    'ICC Proceedings': /^\("International Criminal Court".*\) -cricket$/,
    'ICJ Proceedings': /^\("International Court of Justice"/,
    'Sector Tribunals (ITAT / TDSAT / SAT / DRT)': /"Income Tax Appellate Tribunal" OR ITAT/,
  };

  // F129: WTO serves the stored WTO register first; its forum query is only the fallback.
  it('serves WTO Dispute Settlement from the WTO register, with no news request', async () => {
    const asked = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => { asked.push(String(url)); throw new Error('no network'); }));
    const feed = await wireFeed('WTO Dispute Settlement');
    expect(feed.rows.length).toBeGreaterThanOrEqual(646);
    expect(feed.rows[0].ds_number).toMatch(/^DS\d+$/);
    expect(feed.rows[0].ds).toBeGreaterThan(feed.rows.at(-1).ds);
    expect(asked.filter((u) => /news\.google\.com|gdeltproject/.test(u))).toEqual([]);
  });

  for (const [feature, expected] of Object.entries(QUERIES)) {
    it(`searches Google News for ${feature} with its forum's own terms`, async () => {
      const asked = [];
      vi.stubGlobal('fetch', vi.fn(async (url) => {
        asked.push(String(url));
        const body = rss([item('A court report', '<source url="https://www.livelaw.in">LiveLaw</source>')]);
        return { ok: true, status: 200, url: String(url), headers: new Headers({ 'content-type': 'application/rss+xml' }), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
      }));
      await wireFeed(feature);
      const news = asked.find((u) => /news\.google\.com\/rss\/search/.test(u));
      expect(news, feature).toBeTruthy();
      const q = new URL(news).searchParams.get('q').replace(/ when:7d$/, '');
      expect(q).toMatch(expected);
      // Not the product-name query the registry holds, e.g. India ("ICC" OR "Proceedings").
      expect(q).not.toMatch(/^India \("[A-Za-z]+" OR "[A-Za-z]+"/);
    });
  }
});
