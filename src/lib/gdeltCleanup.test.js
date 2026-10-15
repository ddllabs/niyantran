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

  it('home Top Stories carries no GDELT flag', async () => {
    stubWorld();
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'home', feature: 'Top Stories' }));
    expect(Object.hasOwn(out?.source || {}, 'gdelt')).toBe(false);
  });

  // F179: nothing searches GDELT, so no answer may say it did. In the world where every source is
  // down, 14 State and Local modules used to answer a status row flagged `gdelt: true`; and every
  // other answer carried `gdelt: false`. The flag is gone from the server and from the browser loader.
  const flagKeys = (value, path = '$', found = []) => {
    if (Array.isArray(value)) value.forEach((v, i) => flagKeys(v, `${path}[${i}]`, found));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (/^gdelt$/i.test(k)) found.push(`${path}.${k}`);
        flagKeys(v, `${path}.${k}`, found);
      }
    }
    return found;
  };

  for (const [world, down] of [['sources up', false], ['sources down', true]]) {
    it(`no desk module answers with a gdelt key, server loader, ${world}`, async () => {
      stubWorld(down);
      const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
      const carrying = [];
      for (const m of DESK_CATALOGUE) {
        const out = await serveFeatureFeed(new URLSearchParams({ tier: m.tier, feature: m.feature })).catch(() => null);
        const keys = flagKeys(out);
        if (keys.length) carrying.push(`${m.tier}/${m.feature}: ${keys.join(', ')}`);
      }
      expect(carrying).toEqual([]);
    }, 120_000);

    it(`no desk module answers with a gdelt key, browser loader, ${world}`, async () => {
      stubWorld(down);
      const { fetchArchiveFeature } = await import('./archiveFeed.js');
      const carrying = [];
      for (const m of DESK_CATALOGUE) {
        const out = await fetchArchiveFeature({ tier: m.tier, feature: m.feature }).catch(() => null);
        const keys = flagKeys(out);
        if (keys.length) carrying.push(`${m.tier}/${m.feature}: ${keys.join(', ')}`);
      }
      expect(carrying).toEqual([]);
    }, 120_000);
  }

  // F180: the routes that GDELT addresses in the registry and the feature map used to choose now come
  // from the Google News topic search the loader asks. These answers were identical before and after.
  it('a module with no registry row and a news topic source answers the Google News wire (up) or says it returned no rows (down)', async () => {
    stubWorld();
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const up = await serveFeatureFeed(new URLSearchParams({ tier: 'local', feature: 'Ward/Panchayat Results Database' }));
    expect(up.source.adapter).toBe('news-search');
    expect(up.rows[0]).toMatchObject({ section: 'Coverage wire' });
    expect(up.meta).toMatchObject({ wire: 1, status: 'LIVE · NEWS RSS' });
    expect(up.source.links).toHaveLength(1);
    vi.unstubAllGlobals();
    stubWorld(true);
    const down = await serveFeatureFeed(new URLSearchParams({ tier: 'local', feature: 'Ward/Panchayat Results Database' }));
    expect(down.rows[0]).toMatchObject({ status: 'source_status', host: 'news.google.com' });
    expect(down.source.note).toBe('Topic news wire returned no rows. No records were invented.');
  });

  it('a registry row on the news fallback says the news search returned nothing, and names Google News, never GDELT', async () => {
    stubWorld(true);
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'Governor Assent Tracker' }));
    expect(out.rows[0]).toMatchObject({ status: 'source_status', host: 'news.google.com' });
    expect(out.source.note).toBe('The news search returned nothing. No records were invented.');
    // GPDP had a GDELT address as its primary: its status row used to name api.gdeltproject.org as the host.
    const gpdp = await serveFeatureFeed(new URLSearchParams({ tier: 'local', feature: 'Gram Panchayat Development Plan (GPDP) Fund Tracker' }));
    expect(gpdp.rows[0]).toMatchObject({ status: 'source_status', host: 'news.google.com' });
    expect(JSON.stringify(gpdp)).not.toMatch(/gdelt/i);
  });

  it('a registry row on a table adapter keeps its plain status note, not the news-search one', async () => {
    stubWorld(true);
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    // A scrape row: no live extraction is scheduled, whatever the registry once held as a fallback.
    // F202: the State Tender Aggregator (the scrape row with no stored archive) is now a planned
    // module, so it answers the planned note; still never the news-search one, never GDELT.
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'State Tender Aggregator (State e-Procurement)' }));
    expect(out.source.note).toBe('Module planned. No data source is connected for this module yet.');
    expect(out.source.note).not.toMatch(/news search/i);
    expect(JSON.stringify(out)).not.toMatch(/gdelt/i);
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
