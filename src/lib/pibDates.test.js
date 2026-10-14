import { afterEach, describe, expect, it, vi } from 'vitest';

// PIB's English RSS (reg=3) carries no dates (checked 2026-10-14), so Cabinet Decisions and the
// Policy Pipeline lost them when the feed became English (F169 T2). Each release's date now comes
// from its own page ("Posted On").
const rss = `<?xml version="1.0"?><rss><channel><item><title>Cabinet approves the Example Scheme for 2026-27</title><link>https://pib.gov.in/PressReleaseIframePage.aspx?PRID=501</link></item></channel></rss>`;
const page = `<html><head><meta property="og:title" content="Cabinet approves the Example Scheme for 2026-27 | Press Information Bureau" /></head><body>
  <div class="MinistryNameSubhead">Cabinet</div> Posted On: 14 Oct 2026</body></html>`;

describe('English PIB releases are dated from their pages', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it.each(['Cabinet Decisions', 'Policy Pipeline Tracker (Draft-to-Gazette)'])('%s rows carry the release date', async (feature) => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const body = /RssMain/i.test(String(url)) ? rss : page;
      return { ok: true, status: 200, url: String(url), headers: new Headers({ 'content-type': /RssMain/i.test(String(url)) ? 'application/rss+xml' : 'text/html' }), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    }));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'national', feature }));
    const row = out.rows.find((r) => /Example Scheme/.test(r.title));
    expect(row?.date).toBe('2026-10-14');
  });

  it('a release keeps the same id on every refresh: its PRID, not its place in the list', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const body = /RssMain/i.test(String(url)) ? rss : page;
      return { ok: true, status: 200, url: String(url), headers: new Headers({ 'content-type': /RssMain/i.test(String(url)) ? 'application/rss+xml' : 'text/html' }), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    }));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'national', feature: 'Cabinet Decisions' }));
    expect(out.rows.find((r) => /Example Scheme/.test(r.title))?.id).toBe('pib-501');
  });
});

// Review of C6: the id follows the page the row links to, and one answer holds a release once.
describe('a release row id is the PRID of its English page, and unique', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  const feedRss = (items) => `<?xml version="1.0"?><rss><channel>${items.map(([t, prid]) => `<item><title>${t}</title><link>https://pib.gov.in/PressReleaseIframePage.aspx?PRID=${prid}</link></item>`).join('')}</channel></rss>`;
  const hindiPage = (enPrid) => `<html><head><meta property="og:title" content="हिंदी शीर्षक जो लंबा है और अंग्रेज़ी नहीं है" /></head><body>
    <div class="MinistryNameSubhead">Cabinet</div><a href="/PressReleasePage.aspx?PRID=${enPrid}&Lang=1">English</a> Posted On: 12 Oct 2026</body></html>`;
  const englishPage = (title) => `<html><head><meta property="og:title" content="${title} | Press Information Bureau" /></head><body>
    <div class="MinistryNameSubhead">Cabinet</div> Posted On: 12 Oct 2026</body></html>`;
  async function cabinet(items, pages) {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      const rssCall = /RssMain/i.test(u);
      const body = rssCall ? feedRss(items) : pages[(/PRID=(\d+)/.exec(u) || [])[1]];
      if (body == null) return { ok: false, status: 404, url: u, headers: new Headers(), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, status: 200, url: u, headers: new Headers({ 'content-type': rssCall ? 'application/rss+xml' : 'text/html' }), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    }));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    return serveFeatureFeed(new URLSearchParams({ tier: 'national', feature: 'Cabinet Decisions' }));
  }

  it('a Hindi item resolved to its English sibling has the English PRID in its id, link and key', async () => {
    const { itemKeyFor } = await import('../../server/feedSchedule.mjs');
    const out = await cabinet([['हिंदी शीर्षक जो लंबा है और अंग्रेज़ी नहीं है', 111]], {
      111: hindiPage(1111),
      1111: englishPage('Cabinet approves the Example Scheme for 2026-27'),
    });
    const row = out.rows.find((r) => /Example Scheme/.test(r.title));
    expect(row?.id).toBe('pib-1111');
    expect(row?.source_url).toMatch(/PRID=1111\b/);
    expect(itemKeyFor(row)).toBe('url:pib.gov.in/PressRelease?PRID=1111');
  });

  it('a release listed twice is one row, so ids stay unique', async () => {
    const out = await cabinet(
      [
        ['Cabinet approves the Example Scheme for 2026-27', 1111],
        ['Cabinet approves the Example Scheme for 2026-27', 1111],
        ['हिंदी शीर्षक जो लंबा है और अंग्रेज़ी नहीं है', 111],
        ['Cabinet approves a second Example Scheme', 2222],
      ],
      { 111: hindiPage(1111), 1111: englishPage('Cabinet approves the Example Scheme for 2026-27'), 2222: englishPage('Cabinet approves a second Example Scheme') },
    );
    expect(out.rows.filter((r) => /Example Scheme/.test(r.title)).map((r) => r.id)).toEqual(['pib-1111', 'pib-2222']);
    expect(new Set(out.rows.map((r) => r.id)).size).toBe(out.rows.length);
  });
});
