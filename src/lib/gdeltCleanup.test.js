import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';

/**
 * F176 (dead GDELT code removed). GDELT has been switched off since F169 T4; its branches are now
 * deleted from the server loaders and the browser fallback. Before the removal, every desk module's
 * rows and source adapter were recorded with the old code and compared with the new (identical, with
 * sources up and down; Top Stories alone drops its false `gdelt` flag). That one-off comparison is in
 * the commit record. Server fetches of GDELT are already refused by GDELT_OFF (gdeltOff.test.js);
 * these tests cover what that guard does not: the browser loader, Top Stories and the conflict note.
 */
const rss = (items) =>
  `<?xml version="1.0"?><rss><channel>${items
    .map(([t, link]) => `<item><title>${t}</title><link>${link}</link><pubDate>Tue, 14 Oct 2026 10:00:00 GMT</pubDate></item>`)
    .join('')}</channel></rss>`;

function respond(u, ok, status, body, type) {
  return {
    ok, status, url: u, headers: new Headers(type ? { 'content-type': type } : {}),
    text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer, json: async () => JSON.parse(body || '{}'),
  };
}

/** GDELT answers 429; Google News, BBC and PIB answer one story named after the search; the rest 404. */
function stubWorld(down = false) {
  const seen = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    seen.push(u);
    if (/gdeltproject/i.test(u)) return respond(u, false, 429, 'Please limit requests to one every 5 seconds');
    if (down) return respond(u, false, 404, '');
    if (/news\.google\.com\/rss\/search/i.test(u)) {
      const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [])[1] || '').replace(/[<>&]/g, ' ');
      return respond(u, true, 200, rss([[`Google story for ${q} - Example Wire`, `https://example.com/g/${encodeURIComponent(q).slice(0, 40)}`]]), 'application/rss+xml');
    }
    if (/feeds\.bbci\.co\.uk/i.test(u)) return respond(u, true, 200, rss([['BBC world story', 'https://www.bbc.co.uk/news/world-1']]), 'application/rss+xml');
    if (/pib\.gov\.in/i.test(u)) return respond(u, true, 200, rss([['PIB press release', 'https://pib.gov.in/PressReleasePage.aspx?PRID=1']]), 'application/rss+xml');
    return respond(u, false, 404, '');
  }));
  return seen;
}

describe('F176: no loader asks GDELT', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('home Top Stories no longer claims a GDELT search', async () => {
    stubWorld();
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'home', feature: 'Top Stories' }));
    expect(Boolean(out?.source?.gdelt)).toBe(false);
  });

  it('the home conflict note names no GDELT', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdelt-cleanup-'));
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('TMPDIR', tmp);
    stubWorld(true);
    try {
      const { serveHomePulse } = await import('../../server/homeApi.mjs');
      const out = await serveHomePulse({ fresh: true });
      expect(out.note).not.toMatch(/gdelt/i);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the browser archive loader never contacts GDELT, for any module', async () => {
    const seen = stubWorld();
    const { fetchArchiveFeature } = await import('./archiveFeed.js');
    for (const m of DESK_CATALOGUE) await fetchArchiveFeature({ tier: m.tier, feature: m.feature }).catch(() => null);
    await fetchArchiveFeature({ tier: 'geopolitics', feature: 'Geopolitics News Wire' });
    expect(seen.filter((u) => /gdeltproject/i.test(u))).toEqual([]);
  }, 120_000);
});
