// Task B follow-up (2026-10-16): a stored answer never shows rows the module's current live code would
// not show. Production, with serve on, showed State Governance Brief's undated national PIB releases
// (stored before the F202 fixes, with raw "&amp;"), and Prediction Market Political Odds' closed
// markets (not in the latest run). The store path now applies the live branch's own row rules
// (server/feedRows.mjs) and, for measurement and events modules, serves only the latest run.
// It tests server/feedServe.mjs and server/feedRows.mjs and lives here because Vitest collects tests
// from src/ only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serveFromStore } from '../../server/feedServe.mjs';
import { FEED_CLASSES, FEED_SCHEDULE, OFF_TIMER } from '../../server/feedSchedule.mjs';
import { STORE_ROWS_AS_STORED, STORE_ROW_RULES, isTechTitle, storeRowsFor, withinDays } from '../../server/feedRows.mjs';
import { CURATED_NEWS } from './curatedNews.js';
import { isLawExtract, isUsScotusDesk } from './lawPack.js';

const FETCHED = Date.parse('2026-10-15T10:00:00.000Z');
const SOON = { now: () => FETCHED + 5 * 60_000 };
const AT = (ms) => new Date(ms).toISOString();
const RUN = AT(FETCHED);
const EARLIER_RUN = AT(FETCHED - 60 * 60_000);

let n = 0;
/** One feed_page item: in the latest run unless `seen` says otherwise. */
function item(row, { seen = RUN, published = row.date ? AT(Date.parse(row.date)) : null } = {}) {
  n += 1;
  return { item_key: `k:${n}`, row, published_at: published, first_seen: seen, last_seen: seen };
}

function page(id, items, over = {}) {
  const [tier, feature] = id.split(/:(.*)/s);
  const cls = FEED_SCHEDULE[id];
  return {
    tier,
    feature,
    variant: '',
    class: cls,
    kind: FEED_CLASSES[cls].kind,
    serve: true,
    fetched_at: RUN,
    interval_minutes: FEED_CLASSES[cls].every,
    total: items.length,
    meta: { note: 'stored note', links: [], coverage: {}, adapter: 'news-search', fetched_at: RUN },
    items,
    ...over,
  };
}

async function served(id, items, over = {}, params = {}) {
  const [tier, feature] = id.split(/:(.*)/s);
  const body = await serveFromStore(id, new URLSearchParams({ tier, feature, ...params }), { rpc: vi.fn(async () => page(id, items, over)), ...SOON });
  return body;
}
const titles = (body) => (body?.rows || []).map((r) => r.title);

afterEach(() => vi.restoreAllMocks());

describe('measurement modules: only the items of the latest run', () => {
  it('Prediction Market Political Odds: a market missing from the latest run (closed or dropped) is not served', async () => {
    const body = await served('finance:Prediction Market Political Odds', [
      item({ title: 'Will the incumbent win?', probability: 0.6, date: '2026-10-15', source_url: 'https://manifold.markets/a' }),
      item({ title: 'Closed market', probability: 0.1, date: '2026-10-10', source_url: 'https://manifold.markets/closed' }, { seen: EARLIER_RUN }),
      item({ title: 'Undated market', probability: 0.4, source_url: 'https://manifold.markets/b' }),
    ]);
    expect(titles(body)).toEqual(['Will the incumbent win?', 'Undated market']);
  });

  it('Election Forecast Aggregator: the same', async () => {
    const body = await served('finance:Election Forecast Aggregator', [
      item({ title: 'Bihar 2030: NDA majority?', date: '2026-10-15', source_url: 'https://manifold.markets/c' }),
      item({ title: 'Old Kerala market', date: '2026-10-01', source_url: 'https://manifold.markets/d' }, { seen: AT(FETCHED - 3 * 3_600_000) }),
    ]);
    expect(titles(body)).toEqual(['Bihar 2030: NDA majority?']);
  });

  it('Live Global Stock Exchanges: a venue the latest run could not read still shows its last stored value', async () => {
    // Review of 1d2bdb7 (finding 4): a venue does not vanish when one quote fails; feed_purge drops one
    // not seen for 30 days (the measurement retention), so only the latest-run rule is left out here.
    const venues = ['S&P 500', 'NASDAQ', 'TSX', 'Tadawul', 'ASX 200'];
    const items = venues.map((v, i) => item({ title: v, name: v, exchange: v, date: '2026-10-15' }, { seen: i < 3 ? RUN : EARLIER_RUN }));
    expect(titles(await served('finance:Live Global Stock Exchanges', items))).toEqual(venues);
  });

  it('Live Global Stock Exchanges: a failed run leaves the previous run as the latest, so every quote is served', async () => {
    // A failed run moves neither fetched_at nor last_seen (feed_record): the previous run is the latest.
    const venues = ['S&P 500', 'NASDAQ', 'TSX', 'Tadawul', 'ASX 200'];
    const items = venues.map((v) => item({ title: v, name: v, exchange: v, date: '2026-10-15' }, { seen: EARLIER_RUN }));
    const body = await served('finance:Live Global Stock Exchanges', items, { fetched_at: EARLIER_RUN });
    expect(titles(body)).toEqual(venues);
  });

  it('Prediction Market Political Odds: a variant of more than one page is read whole before the latest run is picked', async () => {
    // feed_page orders a measurement module by position, so the latest run's markets can sit past the first
    // 500 items (each run renumbers only the items it lists). 450 markets of an earlier run lead the order,
    // the latest run's 150 follow; the first page alone would serve 50 of them.
    const all = Array.from({ length: 600 }, (_v, i) => item(
      { title: `Market ${i}`, probability: 0.5, source_url: `https://manifold.markets/m${i}` },
      { seen: i < 450 ? EARLIER_RUN : RUN },
    ));
    const id = 'finance:Prediction Market Political Odds';
    const rpc = vi.fn(async (_name, args) => page(id, all.slice(args.p_offset, args.p_offset + args.p_limit), { total: all.length }));
    const body = await serveFromStore(id, new URLSearchParams(), { rpc, ...SOON });
    expect(titles(body)).toEqual(all.slice(450).map((i) => i.row.title));
    // The first page, then the second, read once each (pages past the total are not asked for).
    expect(rpc.mock.calls.map(([, args]) => args.p_offset).sort((a, b) => a - b)).toEqual([0, 500]);
  });

  it('Prediction Market Political Odds: a variant that fits one page is read once', async () => {
    const id = 'finance:Prediction Market Political Odds';
    const items = [item({ title: 'Market A', source_url: 'https://manifold.markets/a' })];
    const rpc = vi.fn(async () => page(id, items));
    expect(titles(await serveFromStore(id, new URLSearchParams(), { rpc, ...SOON }))).toEqual(['Market A']);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('Prediction Market Political Odds: pages that disagree (a refresh between the reads) leave the answer to the live path', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = 'finance:Prediction Market Political Odds';
    const all = Array.from({ length: 600 }, (_v, i) => item({ title: `Market ${i}`, source_url: `https://manifold.markets/m${i}` }));
    const rpc = vi.fn(async (_name, args) => page(id, all.slice(args.p_offset, args.p_offset + args.p_limit), {
      total: all.length,
      fetched_at: args.p_offset ? AT(FETCHED + 60_000) : RUN,
    }));
    expect(await serveFromStore(id, new URLSearchParams(), { rpc, ...SOON })).toBeNull();
  });

  it('an item stamped a few seconds off the fetched time still counts as the latest run', async () => {
    const body = await served('finance:Prediction Market Political Odds', [
      item({ title: 'Market A', source_url: 'https://manifold.markets/e' }, { seen: AT(FETCHED - 2_000) }),
    ]);
    expect(titles(body)).toEqual(['Market A']);
  });
});

describe('events modules: only the items of the latest run', () => {
  it("TV & Streaming Tonight: yesterday's schedule is not served as tonight's", async () => {
    const body = await served('entertainment:TV & Streaming Tonight', [
      item({ title: 'Tonight show', date: '2026-10-15', source_url: 'https://tvmaze.com/e/1' }),
      item({ title: 'Last night show', date: '2026-10-14', source_url: 'https://tvmaze.com/e/0' }, { seen: AT(FETCHED - 24 * 3_600_000) }),
    ]);
    expect(titles(body)).toEqual(['Tonight show']);
  });

  it('Satellite Infrastructure: a launch no longer listed as upcoming is not served', async () => {
    const body = await served('geopolitics:Satellite Infrastructure', [
      item({ title: 'Falcon 9 | Upcoming', source_url: 'https://ll.thespacedevs.com/1' }),
      item({ title: 'Falcon 9 | Launched last week', source_url: 'https://ll.thespacedevs.com/0' }, { seen: EARLIER_RUN }),
    ]);
    expect(titles(body)).toEqual(['Falcon 9 | Upcoming']);
  });
});

describe('news modules: the live branch row rules, on stored rows', () => {
  const STATE = 'state:State Governance Brief';
  const stateRow = (title, date, extra = {}) => ({ title, date, publisher: 'The Hindu', source_url: `https://news.example/${encodeURIComponent(title)}`, section: 'State coverage', ...extra });

  it('State Governance Brief: no undated national PIB release, no Union story, nothing past 7 days, one row per story, entities decoded', async () => {
    const body = await served(STATE, [
      item(stateRow('Kerala cabinet approves new health scheme', '2026-10-14')),
      item(stateRow('Kerala cabinet approves new health scheme for the state', '2026-10-13', { publisher: 'NDTV' })),
      item(stateRow('Punjab CM &amp; ministers meet farmers in Chandigarh', '2026-10-14')),
      item(stateRow('Tamil Nadu Chief Minister launches breakfast scheme', '2026-10-01')),
      // Stored before F202 by the PIB wire: undated, national, with raw entities. One from an older run …
      item({ title: 'Legislative Department, Ministry of Law &amp; Justice organises workshop on E-Waste Disposal', section: 'Government wire (PIB)', source: 'PIB', source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2001' }, { seen: EARLIER_RUN }),
      // … and one even in the latest run: the title guard leaves out a Union minister's release.
      item({ title: 'Union Minister of Culture inaugurates exhibition in Delhi', section: 'Government wire (PIB)', source: 'PIB', source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2002' }),
    ]);
    expect(titles(body)).toEqual(['Kerala cabinet approves new health scheme', 'Punjab CM & ministers meet farmers in Chandigarh']);
    expect(body.rows.every((r) => r.section === 'State coverage')).toBe(true);
  });

  it('State Governance Brief: when no stored row passes the rules, the live path answers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = await served(STATE, [
      item({ title: 'Union Minister of Culture inaugurates exhibition in Delhi', section: 'Government wire (PIB)', source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2002' }),
    ]);
    expect(body).toBeNull();
  });

  it('a stale copy kept for the route is held to the window at the time of the request', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const items = [item(stateRow('Kerala cabinet approves new health scheme', '2026-10-14'))];
    const ask = (days) => serveFromStore(STATE, new URLSearchParams(), { rpc: vi.fn(async () => page(STATE, items)), now: () => FETCHED + days * 86_400_000, allowStale: true });
    expect(titles(await ask(5))).toEqual(['Kerala cabinet approves new health scheme']);
    // Six days on (2026-10-21T10:00Z) the day 2026-10-14 is still within 7 days at its end (23:59:59Z) …
    expect(titles(await ask(6))).toEqual(['Kerala cabinet approves new health scheme']);
    // … seven days on it is past State Governance Brief's 7 days: nothing to serve, the live path answers.
    expect(await ask(7)).toBeNull();
  });

  it("Municipal Watch: a New York mayor's story is left out, an Indian municipal one kept", async () => {
    const body = await served('local:Municipal Watch', [
      item({ title: 'Pune Municipal Corporation passes budget for 2026-27', date: '2026-10-14', publisher: 'The Times of India', source_url: 'https://n.example/pune' }),
      item({ title: 'New York mayor wins primary after long campaign', date: '2026-10-14', publisher: 'Bloomberg.com', source_url: 'https://n.example/ny' }),
    ]);
    expect(titles(body)).toEqual(['Pune Municipal Corporation passes budget for 2026-27']);
  });

  it('Assembly Proceedings Digest: a UPSC study guide is left out', async () => {
    const body = await served('state:Assembly Proceedings Digest (Vernacular, Translated)', [
      item({ title: 'Kerala Assembly passes resolution against delimitation', date: '2026-10-14', publisher: 'ThePrint', source_url: 'https://n.example/kla' }),
      item({ title: 'Assembly passes bill on anti-defection: UPSC notes', date: '2026-10-14', publisher: 'Vajiram & Ravi', source_url: 'https://n.example/upsc' }),
    ]);
    expect(titles(body)).toEqual(['Kerala Assembly passes resolution against delimitation']);
  });

  it('a Law wire (UP High Court): nothing past its 7 days', async () => {
    const body = await served('judiciary:UP High Court (Allahabad) Order Feed', [
      item({ title: 'Allahabad High Court grants bail to accused in land case', date: 'Wed, 14 Oct 2026 09:00:00 GMT', publisher: 'Live Law', source_url: 'https://n.example/hc1', section: 'COVERAGE — GOOGLE NEWS RSS' }),
      item({ title: 'Allahabad High Court stays demolition order in Prayagraj', date: 'Mon, 05 Oct 2026 09:00:00 GMT', publisher: 'Live Law', source_url: 'https://n.example/hc0', section: 'COVERAGE — GOOGLE NEWS RSS' }),
    ]);
    expect(titles(body)).toEqual(['Allahabad High Court grants bail to accused in land case']);
    expect(body.rows[0]).toMatchObject({ section: 'COVERAGE — GOOGLE NEWS RSS', reporting_search: expect.stringMatching(/not an official court dataset/) });
  });

  it("Geopolitics News Wire: BBC World's weather story is left out", async () => {
    const body = await served('geopolitics:Geopolitics News Wire', [
      item({ title: 'Ceasefire talks resume in Doha', date: '2026-10-14', outlet: 'BBC World', source: 'BBC World', source_url: 'https://bbc.example/1' }),
      item({ title: 'Heatwave grips southern Europe for a third week', date: '2026-10-14', outlet: 'BBC World', source: 'BBC World', source_url: 'https://bbc.example/2' }),
      item({ title: 'UN Security Council meets on Sudan crisis', date: '2026-10-13', publisher: 'UN News', source_url: 'https://n.example/un' }),
    ]);
    expect(titles(body)).toEqual(['Ceasefire talks resume in Doha', 'UN Security Council meets on Sudan crisis']);
  });

  it("Climate Newswire: Mongabay India's wildlife feature is left out", async () => {
    const body = await served('climate:Climate Newswire', [
      item({ title: 'Heat waves push India power demand to record', date: '2026-10-14', outlet: 'Mongabay India', source_url: 'https://mongabay.example/1' }),
      item({ title: 'New frog species found in the Western Ghats', date: '2026-10-14', outlet: 'Mongabay India', source_url: 'https://mongabay.example/2' }),
      item({ title: 'Analysis: what the latest UN talks mean', date: '2026-10-13', outlet: 'Carbon Brief', source_url: 'https://cb.example/1' }),
    ]);
    expect(titles(body)).toEqual(['Heat waves push India power demand to record', 'Analysis: what the latest UN talks mean']);
  });

  it('AI & the Tech Industry: a PIB release that is not about technology is left out; news search rows are kept', async () => {
    const body = await served('finance:AI & the Tech Industry', [
      item({ title: 'MeitY launches IndiaAI compute portal', date: '2026-10-14', publisher: 'Press Information Bureau', source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=3001' }),
      item({ title: 'Ayurveda institute showcases its digital initiatives', date: '2026-10-14', publisher: 'Press Information Bureau', source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=3002' }),
      item({ title: 'Startup raises funds for chips', date: '2026-10-13', publisher: 'Reuters', source_url: 'https://news.google.com/rss/articles/x' }),
    ]);
    expect(titles(body)).toEqual(['MeitY launches IndiaAI compute portal', 'Startup raises funds for chips']);
  });

  it('National Morning Brief: a top story past its 3 days is left out, and an economy story the top stories tell is shown once', async () => {
    const body = await served('national:National Morning Brief (Auto-digest)', [
      item({ title: 'Parliament panel meets on data protection rules', date: '2026-10-14', publisher: 'The Hindu', source: 'The Hindu', section: 'Top of the Day', source_url: 'https://n.example/t1' }),
      item({ title: 'Government announces new rail corridors for freight', date: '2026-10-08', publisher: 'India Today', source: 'India Today', section: 'Top of the Day', source_url: 'https://n.example/t0' }),
      item({ title: 'Parliament panel meets on data protection rules', date: '2026-10-14', publisher: 'The Hindu', source: 'The Hindu', section: 'Economy', source_url: 'https://n.example/t1' }),
      item({ title: 'RBI keeps repo rate unchanged at 5.5 per cent', date: '2026-10-14', publisher: 'Reuters', source: 'Reuters', section: 'Economy', source_url: 'https://n.example/e1' }),
      item({ title: 'Cabinet approves scheme for farmers', date: '2026-10-14', section: 'Government Wire', source: 'Press Information Bureau', source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=4001' }),
    ]);
    expect(body.rows.map((r) => `${r.section}: ${r.title}`)).toEqual([
      'Top of the Day: Parliament panel meets on data protection rules',
      'Government Wire: Cabinet approves scheme for farmers',
      'Economy: RBI keeps repo rate unchanged at 5.5 per cent',
    ]);
  });

  it('Statement Tracker: nothing past its 7 days, and the leader stays on every row', async () => {
    const body = await served('national:Statement & Quote Tracker with Contradiction Detection', [
      item({ title: 'Amit Shah addresses rally in Bihar ahead of polls', date: '2026-10-14', publisher: 'NDTV', person: 'Amit Shah', source_url: 'https://n.example/s1' }),
      item({ title: 'Amit Shah reviews security situation in Manipur', date: '2026-09-30', publisher: 'NDTV', person: 'Amit Shah', source_url: 'https://n.example/s0' }),
    ], { variant: 'Amit Shah' }, { person: 'Amit Shah' });
    expect(titles(body)).toEqual(['Amit Shah addresses rally in Bihar ahead of polls']);
    expect(body.rows[0].person).toBe('Amit Shah');
  });

  it('Bureaucrat Transfer & Posting Tracker: nothing past its 7 days', async () => {
    const body = await served('state:Bureaucrat Transfer & Posting Tracker (State Cadre)', [
      item({ title: 'UP transfers 12 IAS officers in major reshuffle', date: '2026-10-14', publisher: 'Indianmasterminds', source_url: 'https://n.example/b1' }),
      item({ title: 'Bihar transfers 20 IPS officers including SPs', date: '2026-09-20', publisher: 'Indianmasterminds', source_url: 'https://n.example/b0' }),
    ]);
    expect(titles(body)).toEqual(['UP transfers 12 IAS officers in major reshuffle']);
  });

  it('Indian Sports Wire: nothing past the 7 days its search asks for', async () => {
    const body = await served('sports:Indian Sports Wire', [
      item({ title: 'India beat Pakistan in hockey Asia Cup', outlet: 'Google News', date: '2026-10-14', source_url: 'https://n.example/h1' }),
      item({ title: 'Indian shuttlers win doubles title', outlet: 'Google News', date: '2026-09-28', source_url: 'https://n.example/h0' }),
    ]);
    expect(titles(body)).toEqual(['India beat Pakistan in hockey Asia Cup']);
  });

  it('District Performance Tracker: an undated row is served only while the source still lists it', async () => {
    const body = await served('state:District Performance Tracker (Composite)', [
      item({ title: 'Pulwama district', source_url: 'https://www.wikidata.org/wiki/Q1' }),
      item({ title: 'Sagar district', source_url: 'https://www.wikidata.org/wiki/Q2' }, { seen: EARLIER_RUN }),
    ]);
    expect(titles(body)).toEqual(['Pulwama district']);
  });

  it('District Performance Tracker: with Wikidata rows stored, its news fallback rows are not served (live answers with Wikidata alone)', async () => {
    const body = await served('state:District Performance Tracker (Composite)', [
      item({ title: 'Pulwama district', source_url: 'https://www.wikidata.org/wiki/Q1' }),
      item({ title: 'District collector reviews flood relief in Pulwama', date: '2026-10-14', source_url: 'https://news.google.com/rss/articles/new' }),
    ]);
    expect(titles(body)).toEqual(['Pulwama district']);
  });

  it("District Performance Tracker: with no Wikidata row stored, its news fallback answers, held to that fallback's 7 days", async () => {
    const body = await served('state:District Performance Tracker (Composite)', [
      item({ title: 'District collector reviews flood relief in Pulwama', date: '2026-10-14', source_url: 'https://news.google.com/rss/articles/new' }),
      item({ title: 'District collector reviews school results in Sagar', date: '2026-09-20', source_url: 'https://news.google.com/rss/articles/old' }),
    ]);
    expect(titles(body)).toEqual(['District collector reviews flood relief in Pulwama']);
  });
});

describe('age windows: a bare day lasts to its end, and a row dated by another field is aged by it', () => {
  // Review of 1d2bdb7 (finding 3): src/lib/curatedNews.js and carbonPack's newsRows write a day only
  // (YYYY-MM-DD), read as that day's UTC midnight. A story live kept on its full time was then dropped
  // from the store up to a day early. Probe: now 2026-10-16T10:00Z; published 2026-10-09T15:00Z.
  const PROBE_NOW = Date.parse('2026-10-16T10:00:00Z');
  const SEVEN_DAY = [
    ['state:State Governance Brief', 'Kerala cabinet approves new health scheme for districts'],
    ['judiciary:UP High Court (Allahabad) Order Feed', 'Allahabad High Court grants bail to accused in land case'],
    ['national:Statement & Quote Tracker with Contradiction Detection', 'Amit Shah addresses rally in Bihar ahead of polls'],
    ['state:Bureaucrat Transfer & Posting Tracker (State Cadre)', 'UP transfers 12 IAS officers in major reshuffle'],
    ['sports:Indian Sports Wire', 'India beat Pakistan in hockey Asia Cup final'],
    ['finance:AI & the Tech Industry', 'Startup raises funds for AI chips in Bengaluru'],
  ];

  for (const [id, title] of SEVEN_DAY) {
    it(`${id}: a story of 2026-10-09T15:00Z stays in its 7 days at 2026-10-16T10:00Z, live and stored`, () => {
      const raw = { title, date: '2026-10-09T15:00:00Z', publisher: 'Example News', source_url: `https://news.google.com/rss/articles/${encodeURIComponent(title)}` };
      const opts = { now: PROBE_NOW, variant: 'Amit Shah' };
      expect(storeRowsFor(id, [raw], opts).map((r) => r.title), 'live').toEqual([title]);
      expect(storeRowsFor(id, [{ ...raw, date: '2026-10-09' }], opts).map((r) => r.title), 'stored').toEqual([title]);
      // A day earlier is out on both.
      expect(storeRowsFor(id, [{ ...raw, date: '2026-10-08' }], opts), 'a day earlier').toEqual([]);
    });
  }

  it('Climate Newswire: a story of 2026-09-16T15:00Z stored as 2026-09-16 stays in its 30 days, live and stored', () => {
    const raw = { title: 'Heat waves push India power demand to record', date: '2026-09-16T15:00:00Z', outlet: 'Carbon Brief', source_url: 'https://cb.example/1' };
    const id = 'climate:Climate Newswire';
    expect(storeRowsFor(id, [raw], { now: PROBE_NOW }).map((r) => r.title)).toEqual([raw.title]);
    expect(storeRowsFor(id, [{ ...raw, date: '2026-09-16' }], { now: PROBE_NOW }).map((r) => r.title)).toEqual([raw.title]);
  });

  it('withinDays: a bare day is judged at its last millisecond', () => {
    expect(withinDays([{ date: '2026-10-09' }], 7, PROBE_NOW)).toHaveLength(1);
    expect(withinDays([{ date: '2026-10-08' }], 7, PROBE_NOW)).toHaveLength(0);
  });

  // Review of 1d2bdb7 (finding 5): a stored item counts as dated by its published_at (from `published` or
  // `pub_date` when the row has no `date`), so it is kept past its run; the window must then age it too.
  for (const field of ['published_at', 'published', 'pub_date']) {
    it(`a row dated only by ${field} is aged by it`, () => {
      const old = { [field]: '2026-09-20T10:00:00Z', source_url: 'https://n.example/old' };
      expect(withinDays([old], 7, PROBE_NOW), 'withinDays').toEqual([]);
      expect(storeRowsFor('sports:Indian Sports Wire', [{ ...old, title: 'India beat Pakistan in hockey Asia Cup final' }], { now: PROBE_NOW })).toEqual([]);
      expect(storeRowsFor('state:Bureaucrat Transfer & Posting Tracker (State Cadre)', [{ ...old, title: 'UP transfers 12 IAS officers in major reshuffle' }], { now: PROBE_NOW })).toEqual([]);
      expect(storeRowsFor('state:State Governance Brief', [{ ...old, title: 'Kerala cabinet approves new health scheme' }], { now: PROBE_NOW })).toEqual([]);
      const fresh = { [field]: '2026-10-15T10:00:00Z', title: 'UP transfers 12 IAS officers in major reshuffle', source_url: 'https://n.example/new' };
      expect(storeRowsFor('state:Bureaucrat Transfer & Posting Tracker (State Cadre)', [fresh], { now: PROBE_NOW })).toHaveLength(1);
    });
  }

  it('a stored item dated only by `published`, from an earlier run, is not served once past its window', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = await served('state:Bureaucrat Transfer & Posting Tracker (State Cadre)', [
      item({ title: 'Bihar transfers 20 IPS officers including SPs', published: '2026-09-20T10:00:00Z', source_url: 'https://n.example/b0' }, { seen: EARLIER_RUN, published: '2026-09-20T10:00:00.000Z' }),
    ]);
    expect(body).toBeNull();
  });
});

describe('official modules: the live branch row rules, on stored rows', () => {
  it('Policy Pipeline Tracker: a release that is not policy in the making is left out', async () => {
    const body = await served('national:Policy Pipeline Tracker (Draft-to-Gazette)', [
      item({ title: 'Draft rules notified for public consultation on drones', date: '2026-10-14', source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=5001' }),
      item({ title: 'President addresses university convocation in Pune', date: '2026-10-14', source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=5002' }),
    ]);
    expect(titles(body)).toEqual(['Draft rules notified for public consultation on drones']);
  });

  it('Cabinet Decisions: a stored release that is not a Cabinet decision is left out', async () => {
    const body = await served('national:Cabinet Decisions', [
      item({ title: 'Cabinet approves four multitracking projects', date: '2026-08-19', ministry: 'Cabinet Committee on Economic Affairs (CCEA)', source_url: 'https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2301144' }),
      item({ title: 'Minister inaugurates railway station', date: '2026-08-18', ministry: 'Ministry of Railways', source_url: 'https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2301000' }),
    ]);
    expect(titles(body)).toEqual(['Cabinet approves four multitracking projects']);
  });
});

describe('every scheduled module of a kept or latest-run kind is covered', () => {
  const KINDS = new Set(['news', 'official', 'events', 'measurement']);
  const ids = Object.keys(FEED_SCHEDULE).filter((id) => !Object.hasOwn(OFF_TIMER, id) && KINDS.has(FEED_CLASSES[FEED_SCHEDULE[id]].kind));

  it('has a row rule, or a stated reason it needs none, never both', () => {
    expect(ids.length).toBeGreaterThan(40);
    for (const id of ids) {
      const rule = typeof STORE_ROW_RULES[id] === 'function';
      const reason = typeof STORE_ROWS_AS_STORED[id] === 'string' && STORE_ROWS_AS_STORED[id].length > 20;
      expect(rule !== reason, id).toBe(true);
    }
  });

  it('names no module that is not scheduled', () => {
    for (const id of [...Object.keys(STORE_ROW_RULES), ...Object.keys(STORE_ROWS_AS_STORED)]) expect(FEED_SCHEDULE[id], id).toBeTruthy();
  });

  it('every curated news module that is scheduled uses its own curated rule', () => {
    for (const id of Object.keys(CURATED_NEWS)) if (FEED_SCHEDULE[id]) expect(typeof STORE_ROW_RULES[id], id).toBe('function');
  });

  it('the Law wires the store filters as a 7-day wire are not extracted order tables (their live branch is the wire)', () => {
    const wires = Object.keys(STORE_ROW_RULES).filter((id) => id.startsWith('judiciary:') && !CURATED_NEWS[id]);
    expect(wires.length).toBe(5);
    for (const id of wires) {
      const feature = id.split(/:(.*)/s)[1];
      expect(isLawExtract(feature) || isUsScotusDesk(feature), id).toBe(false);
    }
  });

  it('a module with no rule keeps its stored rows as they are', () => {
    const rows = [{ title: 'x' }];
    expect(storeRowsFor('sports:Cricket Wire', rows)).toBe(rows);
    expect(storeRowsFor('state:MLA Directory', rows)).toBe(rows);
  });

  it('the technology filter still reads as Task C left it', () => {
    expect(isTechTitle('Strengthening Digital Data Systems under DAY-NRLM')).toBe(false);
    expect(isTechTitle('IndiaAI Mission opens GPU compute portal')).toBe(true);
  });
});
