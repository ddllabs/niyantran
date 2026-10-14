// F164: technical source notes ("GDELT paced ≥5s; primary DOC 2.0 search retries…") reached the
// screen. The helper turns a feed's note into plain words for readers without changing the feed.
import { describe, expect, it } from 'vitest';
import { isTechnicalNote, plainLabel, plainNote, plainSourceLine, sourceLinks, sourceName, sourceNames, technicalTitle } from './plainSourceNote.js';

// Wording a reader must never see in what the helper produces.
const DEVELOPER_WORDING =
  /GDELT DOC|DOC 2\.0|TimelineVol|rate.?limit|≥|\b\d{1,2}\s?s between|paced|\barchives?\b|\bhost\b|backend|adapter|\/api\/|\bRSS\b|https?:|unavailable:|HTTP \d|SPARQL|proxy|last-known-good|shipped backup|feature map|browser-reachable|\.csv|\.xlsx|geopolitics_|NIY_/i;

const BBC = 'https://feeds.bbci.co.uk/news/world/rss.xml';
const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc?query=x&mode=artlist&format=json';

// Real notes: the production answers of 2026-10-14 and the notes the server and the shipped archive
// write (server/featureFeed.mjs, server/nationalFeed.mjs, src/lib/archiveFeed.js, src/desks/*).
const TECHNICAL = [
  ['24 stories · GDELT paced ≥5s; primary DOC 2.0 search retries on the next refresh', ''],
  ['Live BBC World RSS (GDELT DOC 2.0 unavailable: api.gdeltproject.org: GDELT rate limited (need ≥5s between calls)).', ''],
  ['Exhaustive shipped backup · 38 rows · Published source scope loaded. Live and archive returned no rows.', ''],
  ['Exhaustive shipped backup · 500 rows (pack has 4,104; capped for display) · Published source scope loaded. Live and archive returned no rows.', ''],
  ['No live rows and no archive on this host.', ''],
  ['No shipped register for this module on this host.', ''],
  ['Live host only on the static archive.', ''],
  ['GDELT wire unreachable from this network — it will retry automatically.', ''],
  ['PIB releases arrive through the backend (/api/rss) and it is not reachable.', ''],
  ['Live RSS proxy is not deployed on this host.', ''],
  ['No matching HTML FEATURE MAP row.', ''],
  ['Open Fronts conflict register (geopolitics_war_tracker). Structured theatres, not a news search.', 'Structured theatres, not a news search.'],
  ['Apple Music most-played songs, India. iTunes Top Songs is the fallback. Not a GDELT search.', 'Apple Music most-played songs, India.'],
  ['Variety RSS — screen-trade headlines. Not a GDELT search.', ''],
  ['Google News RSS for India hockey, badminton, kabaddi, athletics and chess (7 days). Not a GDELT search.', ''],
  ['Constitute Project constitutions currently in force. Cached up to 7 days.', 'Constitute Project constitutions currently in force.'],
  ['NSE allIndices via proxy. Quotes are delayed by the exchange, not a recommendation.', 'Quotes are delayed by the exchange, not a recommendation.'],
  [
    'This adapter is listed in the source map, but table extraction is not scheduled. Intended coverage ships when the family adapter is ready. No records were invented to fill this table.',
    'No records were invented to fill this table.',
  ],
  ['api.gdeltproject.org did not return rows and there is no last-known-good archive for this module. No records were invented.', 'No records were invented.'],
  [
    'Ingested Goa geography pack — SIR final roll 2026 · elections 2017–2024 only. The workbook GitHub URL is the extract source, not the live table. Constituency Register is seat-level (AC).',
    'Constituency Register is seat-level (AC).',
  ],
  ['Live GDELT DOC 2.0 media mentions for "Narendra Modi". Coverage volume, not statements. No contradiction verdict.', 'Coverage volume, not statements. No contradiction verdict.'],
  ['Original HTML maritime chokepoint register. Live IMF PortWatch transits are served at /api/portwatch.', ''],
  ['national_bill_tracker.csv — 1952–present. Sansad getBills is not wired for refresh on this host.', ''],
  ['World Bank NV.IND.MANF.ZS / NV.IND.TOTL.ZS — India, % of GDP. Units and issuing authority on the chart.', 'Units and issuing authority on the chart.'],
];

const PLAIN = [
  'Showing the latest stored records. Live data is still loading.',
  'The live source isn’t responding. Showing the latest stored records.',
  'Live data is taking longer than usual.',
  'Search covers all 8,000 questions. Answers are not in this dataset yet, so "Has answer" shows Not reported.',
  'Curated supply-concentration register on a USGS Mineral Commodity Summaries basis. Not a live mine-output feed.',
  'World Bank open data — GDP growth, inflation and unemployment.',
  '40 articles · reporting search, not an official feed',
  'ESPN empty; TheSportsDB ISL.',
  'Dated historical snapshot. Not a live feed.',
  'No implemented data source for this reference module.',
  'Editorial / reference dataset.',
  'Judgements of the Supreme Court, by date.',
];

describe('plainNote', () => {
  it.each(TECHNICAL)('keeps only the plain sentences of %j', (note, kept) => {
    expect(isTechnicalNote(note)).toBe(true);
    expect(plainNote(note)).toBe(kept);
    expect(plainNote(note)).not.toMatch(DEVELOPER_WORDING);
  });

  it.each(PLAIN)('passes a plain note through as written: %j', (note) => {
    expect(isTechnicalNote(note)).toBe(false);
    expect(plainNote(note)).toBe(note);
    expect(plainNote(note, 'Fallback line')).toBe(note);
  });

  it("puts the caller's plain line before what it kept", () => {
    expect(plainNote('Live data is taking longer than usual.', 'x')).toBe('Live data is taking longer than usual.');
    expect(plainNote('No live rows and no archive on this host.', 'This module has no records yet.')).toBe('This module has no records yet.');
    expect(plainNote('api.gdeltproject.org did not return rows and there is no last-known-good archive for this module. No records were invented.', 'The source isn’t responding right now.'))
      .toBe('The source isn’t responding right now. No records were invented.');
    expect(plainNote('Variety RSS — screen-trade headlines. Not a GDELT search.', 'Live · 10 stories from Variety')).toBe('Live · 10 stories from Variety');
  });

  it('an empty note stays empty', () => {
    expect(plainNote('')).toBe('');
    expect(plainNote(null, 'x')).toBe('');
  });
});

describe('plainLabel', () => {
  it.each([
    ['TOP WORLD STORIES — BBC WORLD RSS', 'TOP WORLD STORIES — BBC WORLD'],
    ['TOP WORLD STORIES — GDELT 2.0', 'TOP WORLD STORIES'],
    ['GDELT 2.0 · 3-DAY WINDOW', '3-DAY WINDOW'],
    ['MEDIA MENTIONS — GDELT 2.0', 'MEDIA MENTIONS'],
    ['LIVE · PIB / NEWS RSS', 'LIVE · PIB / NEWS'],
    ['BACKUP · EXHAUSTIVE PACK', ''],
    ['LIVE · BBC WORLD', 'LIVE · BBC WORLD'],
    ['MORNING BRIEF', 'MORNING BRIEF'],
  ])('%j → %j', (label, shown) => {
    expect(plainLabel(label)).toBe(shown);
  });
});

describe('source names', () => {
  it('names the sources the feeds use', () => {
    expect(sourceName(BBC)).toBe('BBC World');
    expect(sourceName(GDELT)).toBe('GDELT news search');
    expect(sourceName('https://news.google.com/rss/search?q=India')).toBe('Google News');
    expect(sourceName('https://www.pib.gov.in/RssMain.aspx?ModId=6')).toBe('Press Information Bureau');
    expect(sourceName('https://api.worldbank.org/v2/country/IND')).toBe('World Bank');
    expect(sourceName('https://www.example.gov.in/data/x.json')).toBe('example.gov.in');
    expect(sourceName('/backup/geopolitics/F12_Geopolitics_News_Wire.xlsx')).toBe('');
    expect(sourceName('javascript:alert(1)')).toBe('');
    expect(sourceNames([BBC, GDELT, BBC])).toEqual(['BBC World', 'GDELT news search']);
    expect(sourceLinks(`${BBC}, ${GDELT}`)).toEqual([{ name: 'BBC World', url: BBC }, { name: 'GDELT news search', url: GDELT }]);
  });
});

describe('plainSourceLine', () => {
  const rows = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ title: `Story ${i}`, ...extra }));
  const cases = [
    // Geopolitics News Wire on BBC World when GDELT is paced out (server/featureFeed.mjs).
    [{ rows: rows(24, { outlet: 'BBC World' }), source: { adapter: 'news-search', links: [BBC, GDELT] }, served: 'live' }, 'Live · 24 stories from BBC World'],
    [{ rows: rows(40, {}), source: { adapter: 'news-search', links: [GDELT], gdelt: true }, served: 'live' }, 'Live · 40 stories from GDELT news search'],
    [{ rows: rows(25), source: { adapter: 'api', links: ['https://rss.applemarketingtools.com/api/v2/in/music/most-played/25/songs.json'] } }, 'Live · 25 records from Apple Music'],
    [{ rows: rows(38), fallback: true, served: 'archive', source: { adapter: 'embedded', kind: 'backup-pack', links: ['/backup/x.xlsx'] } }, 'Latest stored records'],
    [{ rows: rows(88), source: { adapter: 'embedded', links: [], kind: 'table' } }, 'Stored records from the published source'],
    [{ rows: rows(40), source: { adapter: 'embedded', links: ['https://www.wikidata.org/'], kind: 'geo-pack' } }, 'Stored records from Wikidata'],
    [{ rows: rows(3), updatedLive: true, source: { adapter: 'api' } }, 'Updated live.'],
    [{ rows: [{ status: 'source_status' }], source: { adapter: 'api', links: [GDELT] } }, 'Source: GDELT news search'],
  ];
  it.each(cases)('%#: names what is on screen in plain words', (feed, line) => {
    expect(plainSourceLine(feed)).toBe(line);
    expect(plainSourceLine(feed)).not.toMatch(DEVELOPER_WORDING);
    expect(isTechnicalNote(plainSourceLine(feed))).toBe(false);
  });
});

it('keeps the original as a title only when what is shown differs', () => {
  expect(technicalTitle('No live rows and no archive on this host.', 'This module has no records yet.')).toBe('No live rows and no archive on this host.');
  expect(technicalTitle('Live data is taking longer than usual.', 'Live data is taking longer than usual.')).toBeUndefined();
  expect(technicalTitle('', 'x')).toBeUndefined();
});
