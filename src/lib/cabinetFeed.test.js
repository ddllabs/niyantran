import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F125: the National Cabinet Decisions feed keeps only releases whose issuing body (the
 * MinistryName field on PIB's own release page) is the Cabinet or one of its committees. PIB is
 * stubbed with the shapes seen on 2026-10-13: an RSS of Hindi titles and links, Hindi release pages
 * that link an English sibling, and English pages naming the issuing body.
 */
const rss = (items) => `<?xml version="1.0"?><rss><channel>${items.map(([t, prid]) => `<item><title>${t}</title><link>https://pib.gov.in/PressReleaseIframePage.aspx?PRID=${prid}</link></item>`).join('')}</channel></rss>`;
const hindiPage = (enPrid, ministry) => `<html><head><meta property="og:title" content="हिंदी शीर्षक जो लंबा है और अंग्रेज़ी नहीं है" /></head><body>
  <div class="MinistryNameSubhead">${ministry}</div>
  <a href="/PressReleasePage.aspx?PRID=${enPrid}&Lang=1">English</a> Posted On: 12 Oct 2026</body></html>`;
const englishPage = (title, ministry) => `<html><head><meta property="og:title" content="${title} | Press Information Bureau" /></head><body>
  <div class="MinistryNameSubhead">
    ${ministry}
  </div> Posted On: 12 Oct 2026</body></html>`;

function stubPib(pages, items) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    const body = /RssMain/i.test(u) ? rss(items) : (pages[(/PRID=(\d+)/.exec(u) || [])[1]] ?? null);
    if (body == null) return { ok: false, status: 404, url: u, headers: new Headers(), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, url: u, headers: new Headers({ 'content-type': /RssMain/i.test(u) ? 'application/rss+xml' : 'text/html' }), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  }));
}

async function cabinetFeed() {
  const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
  return serveFeatureFeed(new URLSearchParams({ tier: 'national', feature: 'Cabinet Decisions' }));
}

describe('National Cabinet Decisions feed (F125)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('keeps only releases that PIB says the Cabinet or a Cabinet committee issued, naming that body', async () => {
    stubPib({
      111: hindiPage(1111, 'आर्थिक मामलों की मंत्रिमंडलीय समिति'),
      1111: englishPage('Cabinet approves the Example Scheme for 2026-27', 'Cabinet Committee on Economic Affairs (CCEA)'),
      222: hindiPage(2222, 'वित्त मंत्रालय'),
      2222: englishPage('Finance Minister addresses an investment forum in New Delhi', 'Ministry of Finance'),
      333: hindiPage(3333, 'मंत्रिमंडल सचिवालय'),
      3333: englishPage('Cabinet Secretary reviews disaster preparedness in the states', 'Cabinet Secretariat'),
    }, [['एक', 111], ['दो', 222], ['तीन', 333]]);
    const feed = await cabinetFeed();
    expect(feed.rows.map((r) => r.title)).toEqual(['Cabinet approves the Example Scheme for 2026-27']);
    expect(feed.rows[0].ministry).toBe('Cabinet Committee on Economic Affairs (CCEA)');
  });

  it('shows the stored Cabinet decisions, and says so, when the live window holds none', async () => {
    stubPib({
      222: hindiPage(2222, 'वित्त मंत्रालय'),
      2222: englishPage('Finance Minister addresses an investment forum in New Delhi', 'Ministry of Finance'),
    }, [['दो', 222]]);
    const feed = await cabinetFeed();
    expect(feed.rows.length).toBeGreaterThan(0);
    for (const r of feed.rows) expect(r.ministry).toMatch(/^Cabinet Committee|^Cabinet$/);
    expect(feed.rows.some((r) => /Finance Minister addresses/.test(r.title))).toBe(false);
    expect(feed.source.note).toMatch(/no Cabinet decision in the latest PIB window/i);
  });

  // F187: PIB releases one decision twice on one day (the ministry's and the Cabinet's); both pass the
  // filter, so the live answer used to list it twice. English RSS titles and pages as seen 2026-08-19.
  it('lists a decision once when the ministry and the CCEA both released it', async () => {
    const title = 'Cabinet approves four multitracking projects covering eight Districts in West Bengal, Odisha, Tamil Nadu and Andhra Pradesh, increasing the existing network of Indian Railways by about 410 Kms';
    const other = 'Cabinet approves the Example Scheme for 2026-27';
    stubPib({
      2301143: englishPage(title, 'Ministry of Railways'),
      2301142: englishPage(title, 'Cabinet Committee on Economic Affairs (CCEA)'),
      2301200: englishPage(other, 'Ministry of Finance'),
    }, [[title, 2301143], [other, 2301200], [title, 2301142]]);
    const feed = await cabinetFeed();
    expect(feed.rows.filter((r) => r.title === title)).toHaveLength(1);
    expect(feed.rows.find((r) => r.title === title).ministry).toBe('Cabinet Committee on Economic Affairs (CCEA)');
    expect(feed.rows.find((r) => r.title === title).source_url).toMatch(/PRID=2301142/);
    expect(feed.rows.filter((r) => r.title === other)).toHaveLength(1);
    expect(feed.rows.map((r) => r.title)).toEqual([other, title]); // the feed's order is kept
  });
});
