import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F189: a module with no registry row is answered by the Google News topic wire because its
 * feature-map entry says `"route": "news-topic"`, not because its `source` happens to equal the URL
 * the loader would generate. A registry row falls back to the same wire when its `openLiveFallback`
 * is the same marker. Renaming a module, or changing the loader's topic words, moves the wire's URL
 * but not the route.
 */
const readJson = (name) => JSON.parse(fs.readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const realRead = fs.readFileSync.bind(fs);
const MARKER = 'news-topic';

const rss = (items) =>
  `<?xml version="1.0"?><rss><channel>${items
    .map(([t, link]) => `<item><title>${t}</title><link>${link}</link><pubDate>${new Date(Date.now() - 60000).toUTCString()}</pubDate></item>`)
    .join('')}</channel></rss>`;
const respond = (u, ok, status, body, type) => ({
  ok, status, url: u, headers: new Headers(type ? { 'content-type': type } : {}),
  text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer, json: async () => JSON.parse(body || '{}'),
});

/** Google News answers one story named after the search; every other address answers 404. */
function stubGoogleOnly() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    if (/news\.google\.com\/rss\/search/i.test(u)) {
      const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [])[1] || '').replace(/[<>&]/g, ' ');
      return respond(u, true, 200, rss([[`Google story for ${q} - Example Wire`, 'https://example.com/g/1']]), 'application/rss+xml');
    }
    return respond(u, false, 404, '');
  }));
}

/** Serve the loader with the feature map (and registry) rewritten by the given functions. */
async function loaderWith({ features = (f) => f, registry = (r) => r } = {}) {
  vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => {
    const text = realRead(file, ...rest);
    if (String(file).endsWith('html-feature-map.json')) return JSON.stringify(features(JSON.parse(text)));
    if (String(file).endsWith('source-registry.json')) return JSON.stringify(registry(JSON.parse(text)));
    return text;
  });
  const mod = await import('../../server/featureFeed.mjs');
  mod.resetFeedCache();
  return mod;
}

const featureMap = readJson('html-feature-map.json');
const registry = readJson('source-registry.json');
const marked = featureMap.filter((f) => f.route === MARKER);
// One of the 16, named here so the rename and unmarked-address tests do not depend on the marker existing.
const WARD = featureMap.find((f) => f.htmlFeature === 'Ward/Panchayat Results Database');
const ask = (serve, tier, feature) => serve(new URLSearchParams({ tier, feature }));

describe('the feature map marks the modules that read the news topic wire (F189)', () => {
  it('16 modules carry the marker, and none of them has a registry row', () => {
    expect(marked).toHaveLength(16);
    expect(marked.filter((f) => (f.registryKeys || []).length)).toEqual([]);
    expect(marked.map((f) => f.htmlFeature)).toContain('Ward/Panchayat Results Database');
  });

  // A module with a registry row keeps its feature-map `source` as a source link readers see; only
  // a module without one was ever routed by it.
  it('no module without a registry row stores a generated topic address as its source', async () => {
    const { newsRssUrlForFeature } = await import('../../server/featureFeed.mjs');
    const stored = featureMap
      .filter((f) => !(f.registryKeys || []).length && f.source && f.source === newsRssUrlForFeature(f.htmlFeature))
      .map((f) => f.htmlFeature);
    expect(stored).toEqual([]);
  });
});

describe('the loader reroutes by the marker, not by an address (F189)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

  it('every marked module reaches the topic wire, whose address is built from its own name', async () => {
    stubGoogleOnly();
    const { serveFeatureFeed, newsRssUrlForFeature } = await loaderWith();
    const missed = [];
    for (const f of marked) {
      const out = await ask(serveFeatureFeed, f.htmlTier, f.htmlFeature);
      const ok = out?.source?.adapter === 'news-search' && out.source.links?.[0] === newsRssUrlForFeature(f.htmlFeature) && out.rows?.[0]?.section === 'Coverage wire';
      if (!ok) missed.push(f.htmlFeature);
    }
    expect(missed).toEqual([]);
  });

  it('renaming a marked module keeps its route (the wire follows the new name)', async () => {
    stubGoogleOnly();
    const renamed = 'Booth-level Turnout Archive for Gram Sabhas';
    const target = WARD;
    const { serveFeatureFeed, newsRssUrlForFeature } = await loaderWith({
      features: (list) => list.map((f) => (f.htmlFeature === target.htmlFeature ? { ...f, htmlFeature: renamed } : f)),
    });
    const out = await ask(serveFeatureFeed, target.htmlTier, renamed);
    expect(out.source.adapter).toBe('news-search');
    expect(out.source.links).toEqual([newsRssUrlForFeature(renamed)]);
    expect(newsRssUrlForFeature(renamed)).not.toBe(newsRssUrlForFeature(target.htmlFeature));
  });

  it('a stored source that equals the module\'s own topic address routes nothing without the marker', async () => {
    stubGoogleOnly();
    const target = WARD;
    const { serveFeatureFeed, newsRssUrlForFeature } = await loaderWith({
      features: (list) => list.map((f) => {
        if (f.htmlFeature !== target.htmlFeature) return f;
        const { route: _route, ...rest } = f;
        return { ...rest, source: newsRssUrlForFeature(f.htmlFeature) };
      }),
    });
    const out = await ask(serveFeatureFeed, target.htmlTier, target.htmlFeature);
    expect(out.source.adapter).not.toBe('news-search');
  });

  it('a module with a registry row is not rerouted, marker or not', async () => {
    stubGoogleOnly();
    const withRow = featureMap.find((f) => f.htmlFeature === 'Cricket Wire');
    const { serveFeatureFeed } = await loaderWith({
      features: (list) => list.map((f) => (f.htmlFeature === withRow.htmlFeature ? { ...f, route: MARKER } : f)),
    });
    const out = await ask(serveFeatureFeed, withRow.htmlTier, withRow.htmlFeature);
    expect(withRow.registryKeys).not.toHaveLength(0);
    expect(out.rows[0].section).not.toBe('Coverage wire');
    expect(out.rows[0].status).toBe('source_status');
  });
});

describe('a registry row falls back to the topic wire by the same marker (F189)', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });
  const MLA_REPORT_CARD = 'state-mla-performanc-meter';
  const fallbackRows = registry.filter((r) => r.openLiveFallback);

  it('every fallback is the marker: no row stores an address that could go stale', () => {
    expect(fallbackRows.filter((r) => r.openLiveFallback !== MARKER).map((r) => r.key)).toEqual([]);
    // F196: three State news rows added with the marker; Election Forecast Aggregator (Manifold) dropped it.
    expect(fallbackRows.filter((r) => r.openLiveFallback === MARKER)).toHaveLength(120);
    expect(fallbackRows.map((r) => r.key)).toContain(MLA_REPORT_CARD);
  });

  it('renaming a module with the marker keeps its fallback (the wire follows the new name)', async () => {
    stubGoogleOnly();
    const name = 'District Performance Tracker (Composite)';
    const renamed = 'District Scorecard of Composite Outcomes';
    const { serveFeatureFeed, newsRssUrlForFeature } = await loaderWith({
      features: (list) => list.map((f) => (f.htmlFeature === name ? { ...f, htmlFeature: renamed } : f)),
    });
    const out = await ask(serveFeatureFeed, 'state', renamed);
    expect(out.source.adapter).toBe('news-search');
    expect(out.source.links).toEqual([newsRssUrlForFeature(renamed)]);
  });

  it('a row with no fallback does not reach the wire', async () => {
    stubGoogleOnly();
    const name = 'District Performance Tracker (Composite)';
    const { serveFeatureFeed } = await loaderWith({
      registry: (rows) => rows.map((r) => (r.htmlFeature === name ? { ...r, openLiveFallback: '' } : r)),
    });
    const out = await ask(serveFeatureFeed, 'state', name);
    expect(out.source.adapter).not.toBe('news-search');
  });
});
