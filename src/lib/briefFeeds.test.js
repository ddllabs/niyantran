import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F169 T3 (F166). Morning Brief and the Statement Tracker read /api/feature-feed on the live site.
 * The server builds both from PIB and Google News, asks the sources together, never asks GDELT
 * (which refuses every request), and the Statement Tracker answers for the leader it is asked for.
 */
const rss = (items) =>
  `<?xml version="1.0"?><rss><channel>${items
    .map(([t, link]) => `<item><title>${t}</title><link>${link}</link><pubDate>Tue, 14 Oct 2026 10:00:00 GMT</pubDate><source url="https://example.com">Example Times</source></item>`)
    .join('')}</channel></rss>`;

function stub(routes) {
  const seen = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    seen.push(u);
    const hit = routes.find(([re]) => re.test(decodeURIComponent(u)));
    if (!hit) return { ok: false, status: 404, url: u, headers: new Headers(), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    const body = hit[1];
    return { ok: true, status: 200, url: u, headers: new Headers({ 'content-type': 'application/rss+xml' }), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  }));
  return seen;
}

async function feed(params) {
  const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
  return serveFeatureFeed(new URLSearchParams({ tier: 'national', ...params }));
}

describe('Morning Brief and Statement Tracker on the server (F169 T3)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-15T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  it('Morning Brief has all three sections from PIB and Google News, without GDELT', async () => {
    const seen = stub([
      [/RssMain\.aspx/i, rss([['Government launches the national logistics portal', 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=1']])],
      [/news\.google\.com.*(RBI|economy)/i, rss([['Rupee steadies as RBI holds rates', 'https://example.com/rupee']])],
      [/news\.google\.com.*parliament/i, rss([['Parliament panel reviews the data bill', 'https://example.com/panel']])],
    ]);
    const out = await feed({ feature: 'National Morning Brief (Auto-digest)' });
    const bySection = Object.groupBy(out.rows, (r) => r.section);
    expect(bySection['Top of the Day']?.[0]?.title).toMatch(/Parliament panel/);
    expect(bySection['Government Wire']?.[0]?.title).toMatch(/logistics portal/);
    expect(bySection.Economy?.[0]?.title).toMatch(/Rupee steadies/);
    expect(seen.some((u) => /gdeltproject/i.test(u))).toBe(false);
  });

  it('the Statement Tracker answers for the leader asked for, from Google News', async () => {
    const seen = stub([
      [/news\.google\.com.*"Amit Shah"/i, rss([['Amit Shah reviews border security', 'https://example.com/shah']])],
      [/news\.google\.com/i, rss([['Somebody else entirely', 'https://example.com/other']])],
    ]);
    const out = await feed({ feature: 'Statement & Quote Tracker with Contradiction Detection', person: 'Amit Shah' });
    expect(out.rows[0].title).toMatch(/Amit Shah reviews/);
    expect(out.rows.every((r) => r.person === 'Amit Shah')).toBe(true);
    expect(seen.some((u) => /gdeltproject/i.test(u))).toBe(false);
  });

  it('an unlisted leader name falls back to the first listed leader', async () => {
    const seen = stub([[/news\.google\.com/i, rss([['Prime Minister addresses the nation', 'https://example.com/pm']])]]);
    const out = await feed({ feature: 'Statement & Quote Tracker with Contradiction Detection', person: 'Anyone <script>' });
    expect(out.rows[0].person).toBe('Narendra Modi');
    expect(seen.every((u) => !/Anyone/i.test(decodeURIComponent(u)))).toBe(true);
  });
});
