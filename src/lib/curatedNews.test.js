import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURATED_NEWS, curatedNewsFor, curatedNewsRows } from './curatedNews.js';

/**
 * F196: four planned modules built from a curated Google News search. Headlines below are real
 * Google News results for each module's search on 2026-10-15; the off-topic ones are what the
 * search also returned (or what a looser search returned).
 */
const SAMPLES = {
  'sports:Sports Governance & Policy': {
    on: [
      '‘Federations have to deliver’: Sports Ministry questions Asian Games returns despite financial support - Telegraph India',
      "Gulveer Singh's former coach Mohammad Yunus Khan provisionally suspended by NADA - India Today",
      'PT Usha hails IOA elections as governance milestone - Inside The Games',
      'Not just NSFs, sports ministry should review its policies - The New Indian Express',
    ],
    off: ['India tests its LA28 plan on the ground - Inside The Games', 'News On AIR | April 16, 2026 3:49 PM - News On AIR'],
  },
  "state:Governor Friction & President's Rule Tracker": {
    on: [
      'CM Stalin says Governor’s walkout of TN Assembly violates constitutional provisions - The New Indian Express',
      'Do states need governors? Karnataka row revives debate on relevance of Raj Bhavan - Deccan Herald',
      'Mic switched off, text had inaccuracies, says Lok Bhavan on Tamil Nadu Governor address row - The Tribune',
    ],
    off: ['Karnataka BJP accuses Congress of phone tapping, row erupts in Assembly - India Today', 'Siang dam row: Congress demands release of 4 Adi activists, pause on field activities - India Today NE'],
  },
  'state:Legislative Productivity Comparison': {
    on: [
      'Karnataka Assembly session curtailed by 3 days, House adjourned \'sine die\' amid Opposition protest - Deccan Herald',
      'Gujarat Assembly Monsoon Session ends after 18 hours, seven bills passed - FM Bharat',
      'Himachal Budget session to have 3 sittings, extension possible: Assembly Speaker Kuldeep Pathania - The Tribune',
    ],
    off: ['National Assembly session adjourned until Wednesday amid oppn’ obstruction - myRepublica', 'Monsoon Session of Parliament adjourns sine die - PIB'],
  },
  'state:MLA Defection & Anti-defection Case Tracker': {
    on: [
      'Telangana HC disqualifies BRS-turned-Congress MLA Danam Nagender under anti-defection law - CNBC TV18',
      '111 sitting MPs, MLAs switched parties in 4 years, 26% of them joined BJP: ADR - India Today',
      "NPP faces major blow as four MLAs defect to People's Party of Arunachal - India Today NE",
    ],
    off: ['Khairatabad Assembly seat officially declared vacant - The Siasat Daily', 'Ernakulam revenue district science fair to be held on Nov 9, 10 - The Times of India'],
  },
};

describe('curated news modules (F196)', () => {
  it('are exactly the four batch-1 news modules, found by any tier name a request uses', () => {
    expect(Object.keys(CURATED_NEWS).sort()).toEqual(Object.keys(SAMPLES).sort());
    expect(curatedNewsFor('sports', 'Sports Governance & Policy')).toBe(CURATED_NEWS['sports:Sports Governance & Policy']);
    expect(curatedNewsFor('state', ' Legislative Productivity Comparison ')).toBeTruthy();
    expect(curatedNewsFor('state', 'Governor Assent Tracker')).toBeNull();
    expect(curatedNewsFor('sports', 'Cricket Wire')).toBeNull();
  });

  it.each(Object.entries(SAMPLES))('%s keeps on-topic headlines and drops off-topic ones', (id, { on, off }) => {
    const spec = CURATED_NEWS[id];
    const rows = [...on, ...off].map((title, i) => ({ title, source_url: `https://example.com/${i}`, date: 'Wed, 15 Oct 2026 10:00:00 GMT' }));
    expect(curatedNewsRows(rows, spec).map((r) => r.title).sort()).toEqual([...on].sort());
  });

  it('keeps each link once, dates rows as YYYY-MM-DD and lists the newest first', () => {
    const spec = CURATED_NEWS['state:MLA Defection & Anti-defection Case Tracker'];
    const rows = curatedNewsRows([
      { title: 'Court disqualifies Mukul Roy as Trinamool MLA', source_url: 'https://a.example/1', date: 'Fri, 14 Nov 2025 08:00:00 GMT' },
      { title: 'Telangana HC disqualifies MLA under anti-defection law', source_url: 'https://a.example/2', date: 'Thu, 18 Sep 2026 08:00:00 GMT' },
      { title: 'Telangana HC disqualifies MLA under anti-defection law (updated)', source_url: 'https://a.example/2', date: 'Thu, 18 Sep 2026 09:00:00 GMT' },
    ], spec);
    expect(rows.map((r) => [r.date, r.source_url])).toEqual([['2026-09-18', 'https://a.example/2'], ['2025-11-14', 'https://a.example/1']]);
  });

  it('every module says it is news coverage, and Legislative Productivity says it measures nothing', () => {
    for (const spec of Object.values(CURATED_NEWS)) expect(spec.note).toMatch(/Google News/);
    expect(CURATED_NEWS['state:Legislative Productivity Comparison'].note).toMatch(/not measured/);
  });
});

describe('curated news in the source data and the loader (F196)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  const registry = JSON.parse(readFileSync(new URL('../data/source-registry.json', import.meta.url), 'utf8'));
  const featureMap = JSON.parse(readFileSync(new URL('../data/html-feature-map.json', import.meta.url), 'utf8'));

  it('the registry and the feature map name the search the loader asks, with a 30-minute refresh', async () => {
    const { newsRssUrlForFeature } = await import('../../server/featureFeed.mjs');
    for (const id of Object.keys(CURATED_NEWS)) {
      const [tier, feature] = id.split(/:(.*)/s);
      const url = newsRssUrlForFeature(feature);
      // A curated search, not the words of the module's name.
      expect(url, id).not.toMatch(/%22(?:Governance|Friction|Productivity|Defection)%22/);
      const fm = featureMap.find((f) => f.htmlTier === tier && f.htmlFeature === feature);
      expect(fm.mapping, id).not.toBe('HTML-ONLY');
      expect(fm.source, id).toBe(url);
      expect(fm.registryKeys, id).toHaveLength(1);
      const entry = registry.find((r) => r.key === fm.registryKeys[0]);
      expect(entry, id).toMatchObject({ htmlTier: tier, htmlFeature: feature, adapter: 'news-search', primaryFeedUrl: url, sourceUrls: url, refreshMinutes: 30, endpointCount: '1.0' });
    }
  }, 30_000);

  it.each(Object.keys(SAMPLES))('%s answers its on-topic headlines from the curated search', async (id) => {
    const [tier, feature] = id.split(/:(.*)/s);
    const asked = [];
    const items = [...SAMPLES[id].on, ...SAMPLES[id].off]
      .map((t, i) => `<item><title>${t.replace(/&/g, '&amp;')}</title><link>https://example.com/${i}</link><pubDate>Wed, 15 Oct 2026 10:0${i}:00 GMT</pubDate></item>`)
      .join('');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      asked.push(String(url));
      const body = `<?xml version="1.0"?><rss><channel>${items}</channel></rss>`;
      return { ok: true, status: 200, url: String(url), headers: new Headers({ 'content-type': 'application/rss+xml' }), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    }));
    const { serveFeatureFeed, newsRssUrlForFeature } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier, feature }));
    expect(asked).toEqual([newsRssUrlForFeature(feature)]);
    expect(out.source.adapter).toBe(CURATED_NEWS[id].adapter);
    expect(out.source.note).toBe(CURATED_NEWS[id].note);
    expect(out.rows.map((r) => r.title).sort()).toEqual([...SAMPLES[id].on].sort());
  }, 30_000);
});
