import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F185: District Performance Tracker reads Wikidata's SPARQL JSON. When the body was not valid JSON
 * (cut off part-way) the loader fell back to reading it as CSV, line by line, and stored rows such as
 * {"{": "value : Bhojpur district"}. The fixture has the shape of the real answer (checked 2026-10-15:
 * pretty-printed, head.vars district/districtLabel/population/area, `district` an entity URI, the
 * label an English literal, population and area optional) with three of its real districts.
 */
const cell = (value, extra = {}) => ({ type: 'literal', value, ...extra });
const binding = (qid, label, population, area) => ({
  district: { type: 'uri', value: `http://www.wikidata.org/entity/${qid}` },
  ...(population ? { population: cell(population, { datatype: 'http://www.w3.org/2001/XMLSchema#decimal' }) } : {}),
  ...(area ? { area: cell(area, { datatype: 'http://www.w3.org/2001/XMLSchema#decimal' }) } : {}),
  districtLabel: cell(label, { 'xml:lang': 'en' }),
});
const answer = {
  head: { vars: ['district', 'districtLabel', 'population', 'area'] },
  results: {
    bindings: [
      binding('Q15112', 'Ariyalur district', '754894', '1949.31'),
      binding('Q15116', 'Chennai district', '4646732', '174'),
      binding('Q140805546', 'Outer North Delhi district'),
    ],
  },
};
// Wikidata prints `"key" : value`.
const pretty = (o) => JSON.stringify(o, null, 2).replace(/": /g, '" : ');

function stubWikidata(body, contentType = 'application/sparql-results+json;charset=utf-8') {
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    status: 200,
    url: String(url),
    headers: new Headers({ 'content-type': contentType }),
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  })));
}

// The module is planned (2026-10-16), so the server answers the planned state and never reaches the
// Wikidata reader. These tests keep the reader's F185 guards proven for when the module is built:
// they take it off the planned list for the test only (the Set is a fresh one for every test).
async function districtFeed() {
  const { PLANNED_MODULES } = await import('./plannedModules.js');
  PLANNED_MODULES.delete('state:District Performance Tracker (Composite)');
  const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
  return serveFeatureFeed(new URLSearchParams({ tier: 'state', feature: 'District Performance Tracker (Composite)' }));
}

describe('District Performance Tracker (F185; planned since 2026-10-16, reader kept proven)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('maps the SPARQL answer to one row per district with its real fields', async () => {
    stubWikidata(pretty(answer));
    const feed = await districtFeed();
    expect(feed.source.adapter).toBe('api');
    expect(feed.rows.map((r) => r.district)).toEqual(['Ariyalur district', 'Chennai district', 'Outer North Delhi district']);
    expect(feed.rows[0]).toMatchObject({
      district: 'Ariyalur district',
      title: 'Ariyalur district',
      population: '754894',
      area: '1949.31',
      source_url: 'https://www.wikidata.org/entity/Q15112',
    });
    // population and area are optional in Wikidata: a district without them has neither, not a junk value
    expect(feed.rows[2].population ?? '').toBe('');
    for (const r of feed.rows) expect(r.status).not.toBe('source_status');
  });

  it('answers a plain status row, not line-by-line rows, when the answer is cut off part-way', async () => {
    const whole = pretty(answer);
    stubWikidata(whole.slice(0, whole.indexOf('Q15116'))); // cut off inside the second district
    const feed = await districtFeed();
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0]).toMatchObject({ status: 'source_status', readiness: 'offline' });
    expect(feed.rows.some((r) => Object.keys(r).includes('{'))).toBe(false);
    expect(JSON.stringify(feed.rows)).not.toMatch(/value : /);
  });

  it('does not read a JSON body served as text or CSV as lines, whatever the content type', async () => {
    const whole = pretty(answer);
    for (const ct of ['text/csv', 'text/plain']) {
      stubWikidata(whole.slice(0, 400), ct);
      const feed = await districtFeed();
      expect(feed.rows.every((r) => r.status === 'source_status'), ct).toBe(true);
      vi.resetModules();
    }
  });

  it('still reads a real CSV that contains commas', async () => {
    stubWikidata('name,value\nAlpha,1\nBeta,2\n', 'text/csv');
    const feed = await districtFeed();
    expect(feed.rows.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
  });
});
