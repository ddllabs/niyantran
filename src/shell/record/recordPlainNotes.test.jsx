// F165: the record panel showed developer words: a row's `reporting_search` field ("GDELT DOC 2.0 —
// news reporting search, not an official dataset") as a tile, "GDELT DOC 2.0", "BBC World RSS", an
// "RSS" badge, "first seen by GDELT", "Link host", "(embedded pack)", "last-known-good archive" and
// "benchmark pack". The panels now name sources in plain words; their honesty notes ("not an
// official dataset", "not a full history") stay.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: null }));
import NationalRecord from '../../desks/NationalRecord.jsx';
import newsWire from './adapters/newsWire.js';
import nationalMorningBrief from './adapters/nationalMorningBrief.js';
import lawWire, { LAW_WIRE_FEATURES } from './adapters/lawWire.js';
import nationalCabinet from './adapters/nationalCabinet.js';
import nationalRegulatory from './adapters/nationalRegulatory.js';
import nationalPipeline from './adapters/nationalPipeline.js';
import commodities from './adapters/commodities.js';
import headsOfState from './adapters/headsOfState.js';
import sanctions from './adapters/sanctions.js';
import alliances from './adapters/alliances.js';
import lawInsolvency from './adapters/lawInsolvency.js';

const FORBIDDEN =
  /GDELT|DOC 2\.0|\bRSS\b|adapter|archive|\bhosts?\b|backend|\bAPI\b|endpoint|\bpacks?\b|fallback|\/api\/|\bsync\b|embedded|proxy|last-known-good|ontology|ingest|source_url/i;
const GDELT_FIELD = 'GDELT DOC 2.0 — news reporting search, not an official dataset';

// Every string the panel can show; links, prompts and keys are not shown as text.
const HIDDEN_KEYS = new Set(['url', 'href', 'prompt', 'key', 'id', 'code']);
function shownStrings(value, key = '') {
  if (HIDDEN_KEYS.has(key)) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((v) => shownStrings(v));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => shownStrings(v, k));
  return [];
}
const developer = (model) => shownStrings(model).filter((t) => FORBIDDEN.test(t));

const gdeltStory = { title: 'Talks resume', domain: 'reuters.com', seendate: '20261012T143000Z', language: 'English', sourcecountry: 'United Kingdom', source_url: 'https://www.reuters.com/x', reporting_search: GDELT_FIELD };
const rssStory = { title: 'Summit ends', outlet: 'BBC World', summary: 'Leaders met.', date: 'Mon, 12 Oct 2026 10:00:00 GMT', source_url: 'https://www.bbc.co.uk/news/x' };

const CASES = [
  ['news wire, news search', newsWire(gdeltStory, { rows: [gdeltStory], feed: { source: { gdelt: true }, coverage: { through: '3d' } } })],
  ['news wire, BBC World feed', newsWire(rssStory, { rows: [rssStory], feed: { source: { gdelt: false } } })],
  ['morning brief, news search', nationalMorningBrief({ ...gdeltStory, section: 'Top of the Day' }, { rows: [gdeltStory] })],
  ['morning brief, PIB', nationalMorningBrief({ title: 'Cabinet approves', source: 'PIB', section: 'India Government', date: '2026-10-12', source_url: 'https://pib.gov.in/x' }, { rows: [] })],
  ['morning brief, Google News', nationalMorningBrief({ title: 'Rupee steady', source: 'Google News', section: 'Economy', date: '2026-10-12', source_url: 'https://news.google.com/x' }, { rows: [] })],
  ...LAW_WIRE_FEATURES.flatMap((feature) => [
    [`${feature}, news search`, lawWire({ ...gdeltStory, section: 'COVERAGE — GDELT 2.0' }, { rows: [], feed: { feature } })],
    [`${feature}, Google News`, lawWire({ title: 'Court stays drive - The Hindu', publisher: 'The Hindu', section: 'COVERAGE — GOOGLE NEWS RSS', date: '2026-10-12', source_url: 'https://news.google.com/x' }, { rows: [], feed: { feature } })],
  ]),
  ['cabinet, live feed', nationalCabinet({ title: 'Cabinet approves scheme', date: 'Mon, 12 Oct 2026 10:00:00 GMT', source_url: 'https://pib.gov.in/x' }, { rows: [], feed: { source: { adapter: 'api' } } })],
  ['cabinet, stored register', nationalCabinet({ title: 'Cabinet approves scheme', as_of: '2026-09-07' }, { rows: [], feed: { fallback: true } })],
  ['regulator, live feed', nationalRegulatory({ title: 'RBI circular', date: '2026-10-13', source_url: 'https://www.rbi.org.in/x' }, { rows: [] })],
  ['regulator, stored register', nationalRegulatory({ title: 'RBI circular', regulator: 'RBI', action_type: 'circular', date: '2026-10-13' }, { rows: [] })],
  ['policy pipeline, press release', nationalPipeline({ title: 'Draft rules notified', stage: 'PIB press release', source: 'Press Information Bureau' }, { rows: [] })],
  ['commodities', commodities({ name: 'Brent crude', level: '82', unit: 'USD/bbl', group: 'Energy' }, { rows: [], feed: { meta: { asOf: '2026-09' } } })],
  ['heads of state', headsOfState({ country: 'India', name: 'Leader' }, { rows: [] })],
  ['sanctions', sanctions({ title: 'Programme', programme: 'Programme' }, { rows: [] })],
  ['alliances', alliances({ name: 'Bloc', title: 'Bloc' }, { rows: [] })],
  ['insolvency, IBBI', lawInsolvency({ court: 'IBBI', title: 'Announcement' }, { rows: [] })],
  ['insolvency, NCLT', lawInsolvency({ court: 'NCLT', title: 'Order' }, { rows: [] })],
];

describe('record panels name their sources in plain words (F165)', () => {
  it.each(CASES)('%s', (_, model) => {
    expect(developer(model)).toEqual([]);
  });

  it('keeps the honesty notes', () => {
    const [, gdelt] = CASES[0];
    expect(gdelt.footer.provenance.source).toBe('News search (not an official dataset)');
    expect(shownStrings(gdelt).some((t) => /not an official dataset/.test(t))).toBe(true);
  });
});

describe('the National record panel (F165)', () => {
  const text = (html) => html.replace(/<[^>]+>/g, '\n').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').split('\n').map((t) => t.trim()).filter(Boolean);

  it("says how a news item was found instead of showing the row's reporting_search field", () => {
    const row = { title: 'Cabinet clears plan', date: '2026-10-12', source: 'reuters.com', reporting_search: GDELT_FIELD, backup_part: 'FULL', source_url: 'https://news.google.com/x' };
    const shown = text(renderToStaticMarkup(<NationalRecord row={row} feature="Industry Updates (Ministry Data)" onClear={() => {}} feed={{ rows: [row] }} />));
    expect(shown).toContain('Found by a news search, not an official dataset.');
    expect(shown.filter((t) => FORBIDDEN.test(t))).toEqual([]);
    expect(shown.join(' ')).not.toMatch(/reporting search|backup part/i);
  });

  it('a statement hit names the news search, not GDELT', () => {
    const shown = text(renderToStaticMarkup(<NationalRecord row={{ title: 'Mention', date: '2026-10-12', source: 'GDELT' }} feature="Statement & Quote Tracker with Contradiction Detection" onClear={() => {}} />));
    expect(shown).toContain('News search');
    expect(shown.filter((t) => FORBIDDEN.test(t))).toEqual([]);
  });
});
