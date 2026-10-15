import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newsRssUrlForFeature } from '../../server/featureFeed.mjs';

/**
 * F180: the source registry and the feature map name no GDELT address. Nothing asks GDELT (F169 T4);
 * the loader once read these addresses only to choose a route. The routes are now named by the
 * Google News topic search the loader really asks (newsRssUrlForFeature), and the loader's answers
 * were checked identical before and after (apart from one status row that stops naming GDELT).
 */
const readJson = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const registry = readJson('source-registry.json');
const featureMap = readJson('html-feature-map.json');
// The one row whose fallback was never a GDELT address: its own MLA coverage search (it has its own route in the loader).
const MLA_REPORT_CARD = 'state-mla-performanc-meter';

describe('no GDELT address in the source data (F180)', () => {
  it('the source registry holds no gdeltproject address in any field', () => {
    const found = registry.flatMap((row) => Object.entries(row).filter(([, v]) => /gdeltproject/i.test(String(v))).map(([k]) => `${row.key}.${k}`));
    expect(found).toEqual([]);
  });

  it('the feature map holds no gdeltproject address in any field', () => {
    const found = featureMap.flatMap((row) => Object.entries(row).filter(([, v]) => /gdeltproject/i.test(JSON.stringify(v))).map(([k]) => `${row.htmlFeature}.${k}`));
    expect(found).toEqual([]);
  });

  it('the registry does not list GDELT as a source or a domain', () => {
    const found = registry.filter((row) => /gdelt/i.test(`${row.source} ${row.domains}`)).map((row) => row.key);
    expect(found).toEqual([]);
  });

  it('every endpoint count matches the addresses the row lists, as it did before', () => {
    // 134 rows matched before F180; 4 never did (global-transit, national-policy-pipeline,
    // national-morning-brief, state-election-results-2017-2024). None of those four is changed here.
    const mismatched = registry
      .filter((row) => String(row.sourceUrls || '').split('\n').filter((l) => l.trim()).length !== Number(row.endpointCount))
      .map((row) => row.key)
      .sort();
    expect(mismatched).toEqual(['global-transit', 'national-morning-brief', 'national-policy-pipeline', 'state-election-results-2017-2024']);
  });
});

describe('the news route the registry names is the one the loader asks (F180)', () => {
  it("a row's openLiveFallback is its Google News topic search", () => {
    const wrong = registry
      .filter((row) => row.openLiveFallback && /news\.google\.com\/rss\/search/.test(row.openLiveFallback))
      .filter((row) => row.openLiveFallback !== newsRssUrlForFeature(row.htmlFeature) && row.key !== MLA_REPORT_CARD)
      .map((row) => row.key);
    expect(wrong).toEqual([]);
  });

  it('only rows whose adapter reads the news search keep a fallback; a table, scrape or licensed row names none', () => {
    const newsAdapters = new Set(['api', 'source-library', 'embedded', 'news-search']);
    const stray = registry.filter((row) => row.openLiveFallback && !newsAdapters.has(String(row.adapter).split(/[|,]/)[0].trim().toLowerCase())).map((row) => row.key);
    expect(stray).toEqual([]);
  });

  it('a module with no registry row and a news topic source is answered by that wire', () => {
    const wires = featureMap.filter((f) => !(f.registryKeys || []).length && f.source && f.source === newsRssUrlForFeature(f.htmlFeature)).map((f) => f.htmlFeature);
    expect(wires).toHaveLength(16);
    expect(wires).toContain('Ward/Panchayat Results Database');
  });
});
