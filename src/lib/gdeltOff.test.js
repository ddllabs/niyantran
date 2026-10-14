import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';

/**
 * F169 T4 (owner, 2026-10-14: drop GDELT from the request path). GDELT refused every request in the
 * audit and each attempt added up to 11 s of waiting (a 5.5 s gap and a retry). No module and no
 * home feed asks it any more; Geopolitics News Wire reads BBC World first, then Google News.
 */
const rss = (items) =>
  `<?xml version="1.0"?><rss><channel>${items
    .map(([t, link]) => `<item><title>${t}</title><link>${link}</link><pubDate>Tue, 14 Oct 2026 10:00:00 GMT</pubDate></item>`)
    .join('')}</channel></rss>`;

function stub(routes = []) {
  const seen = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    seen.push(u);
    const hit = routes.find(([re]) => re.test(u));
    if (!hit) {
      // GDELT as measured: 429 with its rate-limit text.
      const body = /gdeltproject/i.test(u) ? 'Please limit requests to one every 5 seconds' : '';
      return { ok: false, status: /gdeltproject/i.test(u) ? 429 : 404, url: u, headers: new Headers(), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer, json: async () => ({}) };
    }
    const body = hit[1];
    return { ok: true, status: 200, url: u, headers: new Headers({ 'content-type': 'application/rss+xml' }), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer, json: async () => JSON.parse(body) };
  }));
  return seen;
}

describe('GDELT is not asked (F169 T4)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('no desk module asks GDELT', async () => {
    const seen = stub();
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    for (const m of DESK_CATALOGUE) {
      await serveFeatureFeed(new URLSearchParams({ tier: m.tier, feature: m.feature })).catch(() => null);
    }
    expect(seen.filter((u) => /gdeltproject/i.test(u))).toEqual([]);
  }, 120_000);

  it('the home conflict feed does not ask GDELT when its snapshot is stale', async () => {
    // Only Date is faked: years later, the stored conflict snapshot is too old to serve.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2031-01-01T00:00:00Z'));
    try {
      const seen = stub();
      const { serveConflict } = await import('../../server/homeApi.mjs');
      await serveConflict(2, '').catch(() => null);
      expect(seen.filter((u) => /gdeltproject/i.test(u))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Geopolitics News Wire reads BBC World first, quickly', async () => {
    const seen = stub([[/feeds\.bbci\.co\.uk/i, rss([['Leaders meet at the UN on the ceasefire', 'https://www.bbc.co.uk/news/world-1']])]]);
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const t = Date.now();
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'geopolitics', feature: 'Geopolitics News Wire' }));
    expect(Date.now() - t).toBeLessThan(1000);
    expect(out.rows[0].title).toMatch(/Leaders meet at the UN/);
    expect(seen[0]).toMatch(/feeds\.bbci\.co\.uk/);
  });

  it('Geopolitics News Wire falls back to Google News when BBC is down', async () => {
    stub([[/news\.google\.com/i, rss([['Foreign ministers agree a new framework - Example', 'https://example.com/fm']])]]);
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'geopolitics', feature: 'Geopolitics News Wire' }));
    expect(out.rows[0].title).toMatch(/Foreign ministers agree/);
  });
});
