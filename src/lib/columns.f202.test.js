import { describe, expect, it } from 'vitest';
import { cellOf, feedColumns } from './columns.js';

/**
 * F202 (docs/research/2026-10-15-module-quality-audit.md, C9): column presets that did not match the
 * rows. The rows below are copied from the production answers of 2026-10-15
 * (GET /api/feature-feed?tier=…&feature=…), trimmed to a few rows each.
 */
const PROJECTS = [
  { programme: 'PM Gati Shakti', domain: 'Multi-modal logistics master plan', verifiable_status: 'National master plan operational; NMP portal live', activity: 'Active', title: 'PM Gati Shakti' },
  { programme: 'Smart Cities Mission', domain: 'Urban', verifiable_status: 'Mission period closed; projects transitioned to states', activity: 'Inactive', title: 'Smart Cities Mission' },
];

const MLA = [
  { person: 'Khalilur Rahman Chowdhury', personLabel: 'Khalilur Rahman Chowdhury', positionLabel: 'Member of the Assam Legislative Assembly', stateLabel: 'Assam', position: 'Member of the Assam Legislative Assembly', state: 'Assam', date: '', title: 'Khalilur Rahman Chowdhury', source_url: 'https://www.wikidata.org/entity/Q27663060', mla_name: 'Khalilur Rahman Chowdhury', section: 'MLA profiles' },
  { date: 'Mon, 12 Oct 2026 13:23:55 GMT', title: 'Ex-Rajasthan BJP MLA Killed By Villagers Following Dispute Over Stone Crusher - NDTV', source_url: 'https://news.google.com/rss/articles/x', summary: 'Ex-Rajasthan BJP MLA Killed By Villagers Following Dispute Over Stone Crusher NDTV', publisher: 'NDTV', section: 'Statement / coverage wire', reporting_search: 'Google News RSS — coverage mentions, not an official scorecard' },
];

const DISTRICTS = [
  { district: 'Ariyalur district', population: '754894', area: '1949.31', districtLabel: 'Ariyalur district', date: '', title: 'Ariyalur district', source_url: 'https://www.wikidata.org/entity/Q15112' },
  { district: 'Bhilwara district', population: '2408523', districtLabel: 'Bhilwara district', date: '', title: 'Bhilwara district', source_url: 'https://www.wikidata.org/entity/Q41991' },
];

const ENERGY = [
  { id: 'li', title: 'Lithium', name: 'Lithium', region: 'Battery metals', lat: -23.5, lon: -67, status: 'active', intensity: 74, use: 'EV & grid batteries', topProducers: 'Australia, Chile, China', chinaShare: '~60% refining', latest: 'Price recovering after 2024 glut; refining concentration is the choke.', note: 'Price recovering after 2024 glut; refining concentration is the choke.', sources: [['USGS', 'https://www.usgs.gov/']], source_url: 'https://www.usgs.gov/' },
];

const shown = (feature, rows) => feedColumns(feature, rows).filter((c) => c.default).map((c) => c.label);
const all = (feature, rows) => feedColumns(feature, rows).map((c) => c.label);
// A raw source field name: SPARQL's "…LABEL" variables, map coordinates, internal ids.
const RAW = /LABEL$|^(ID|LAT|LON|PERSON|SOURCES|SOURCE URL|REPORTING SEARCH)$/;

describe('column presets match the rows the modules actually send (F202)', () => {
  it('Centre-sanctioned projects shows the programme register, not World Bank fields', () => {
    const cols = feedColumns('Centre-sanctioned Projects & Completion Rate', PROJECTS);
    expect(cols.filter((c) => c.default).map((c) => c.label)).toEqual(['PROGRAMME', 'DOMAIN', 'VERIFIABLE STATUS', 'ACTIVITY']);
    expect(cols.map((c) => cellOf(PROJECTS[1], c))).toEqual(['Smart Cities Mission', 'Urban', 'Mission period closed; projects transitioned to states', 'Inactive']);
  });

  it('MLA Report Card names its columns and hides raw Wikidata fields', () => {
    expect(shown('MLA Report Card + Statement Tracker', MLA)).toEqual(['MLA / HEADLINE', 'SECTION', 'STATE', 'POSITION', 'DATE', 'PUBLISHER']);
    for (const label of all('MLA Report Card + Statement Tracker', MLA)) expect(label).not.toMatch(RAW);
    const cols = feedColumns('MLA Report Card + Statement Tracker', MLA);
    expect(cols.map((c) => cellOf(MLA[0], c)).slice(0, 4)).toEqual(['Khalilur Rahman Chowdhury', 'MLA profiles', 'Assam', 'Member of the Assam Legislative Assembly']);
  });

  it('District Performance Tracker names its columns and hides DISTRICTLABEL', () => {
    expect(shown('District Performance Tracker (Composite)', DISTRICTS)).toEqual(['DISTRICT', 'POPULATION', 'AREA (AS RECORDED)']);
    for (const label of all('District Performance Tracker (Composite)', DISTRICTS)) expect(label).not.toMatch(RAW);
  });

  it('Energy & Critical Minerals shows the dossier fields, not ID / LAT / LON', () => {
    expect(shown('Energy', ENERGY)).toEqual(['MINERAL', 'GROUP', 'USE', 'TOP PRODUCERS', 'CHINA SHARE', 'SUPPLY STATUS', 'LATEST CONTEXT']);
    for (const label of all('Energy', ENERGY)) expect(label).not.toMatch(RAW);
  });

  it('the prediction-market volumes say they are play money (mana)', () => {
    const odds = [{ question: 'Q', probability: '59.0', volume_24h: 10, total_volume: 100, date: '2026-11-03', close_time: '2026-11-03' }];
    expect(all('Prediction Market Political Odds', odds).filter((l) => /VOL/.test(l)).every((l) => /MANA/.test(l))).toBe(true);
    expect(all('Election Forecast Aggregator', odds).filter((l) => /VOL/.test(l)).every((l) => /MANA/.test(l))).toBe(true);
  });
});

describe('table cells show HTML entities as text (F202)', () => {
  it('decodes the entities feeds leave in titles', () => {
    const col = { key: 'title' };
    expect(cellOf({ title: '6th Schedule, Provisions - Vajiram &amp; Ravi' }, col)).toBe('6th Schedule, Provisions - Vajiram & Ravi');
    expect(cellOf({ title: 'Variety&#8217;s &quot;Best&quot; &#x27;list&#39;' }, col)).toBe('Variety’s "Best" \'list\'');
  });

  it('is idempotent: a title the server already decoded is unchanged, a double-escaped one ends the same', () => {
    const col = { key: 'title' };
    const once = cellOf({ title: 'Tom &amp;amp; Jerry' }, col);
    expect(once).toBe('Tom & Jerry');
    expect(cellOf({ title: once }, col)).toBe(once);
    expect(cellOf({ title: 'Plain & simple' }, col)).toBe('Plain & simple');
  });

  it('never turns escaped angle brackets back into markup', () => {
    expect(cellOf({ title: '&lt;b&gt;x&lt;/b&gt;' }, { key: 'title' })).toBe('&lt;b&gt;x&lt;/b&gt;');
  });

  it('decodes a fallback value the same way', () => {
    expect(cellOf({ name: 'A &amp; B' }, { key: 'title', fallback: 'name' })).toBe('A & B');
  });
});
