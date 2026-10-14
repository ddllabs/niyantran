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
});
