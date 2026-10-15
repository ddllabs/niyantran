import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIndiaElectionMarket, mapManifoldIndiaElections } from './econPack.js';

/**
 * F196: Election Forecast Aggregator shows Manifold markets on Indian elections, found by search and
 * filtered to questions about an Indian election. The questions below are real Manifold questions
 * returned on 2026-10-15 by the searches "India election", "BJP", "assembly election" and "Modi".
 */
const INDIAN = [
  'PM Modi (BJP) wins Bihar election?',
  'How many seats will BJP win in the 2027 Uttar Pradesh Assembly election?',
  '2026 West Bengal Legislative Assembly Elections Winner',
  'Tamil Nadu 2026 Elections - Will DMK-led Alliance retain its majority?',
  'Will UDF win in the coming Kerala state assembly elections of 2026?',
  'Which party will win the Bankipur (Bihar, India) by-election?',
  'Will Narendra Modi be Prime Minister of India after 2029 election?',
  'Who will be the prime minister of India after the next election?',
  'Will BJP remain the ruling party in India for the rest of this decade?',
  'Who will win the 2025 Delhi Elections?',
  'Will KCR be the next CM of Telangana ?',
];

// Search hits that are not about an Indian election: US, Australian, Israeli and other elections,
// Indian questions that are not about an election, and markets that mention neither.
const NOT_INDIAN_ELECTION = [
  'Who will win the 2026 Indiana governor election?',
  'Which party will control Congress after the 2026 midterm elections?',
  'Who will win the California State Assembly 12th District Seat?',
  'Who will win the 2026 election for California\'s 51st State Assembly district',
  '2026 Victorian state election – 2PP count winner',
  'Israel election: Who will be the next prime minister?',
  'Will Viktor Orban remain Hungary\'s prime minister after the 2026 elections?',
  'Conditional on Trump getting elected, how will the US democracy index have changed by the end of his term.',
  'Will Sadhguru announce support the BJP or the Republican Party?',
  'Will Donald Trump and Narendra Modi meet in person in year 2026?',
  'Will India and Bangladesh go to war by EOY 2026?',
  'Will Prime Minister of India, Narendra Modi, win the Nobel Peace Prize in 2023?',
  'Will India go into Recession by the end of 2024?',
  'Large-scale internet blackout in G20 country by EOY2025?',
  'Double Chance Saloon – bet YES to have two chances to win',
];

const market = (over) => ({
  id: over.id || over.question,
  question: 'Who will win the 2025 Delhi Elections?',
  url: `https://manifold.markets/x/${encodeURIComponent(over.id || over.question || 'm')}`,
  outcomeType: 'BINARY',
  probability: 0.5,
  volume: 100,
  volume24Hours: 1,
  closeTime: Date.parse('2027-03-10T00:00:00Z'),
  isResolved: false,
  token: 'MANA',
  ...over,
});

describe('which Manifold markets are about an Indian election (F196)', () => {
  it.each(INDIAN)('keeps %s', (q) => expect(isIndiaElectionMarket(q)).toBe(true));
  it.each(NOT_INDIAN_ELECTION)('drops %s', (q) => expect(isIndiaElectionMarket(q)).toBe(false));
});

describe('election market rows (F196)', () => {
  it('maps question, probability, top outcome, volume, close date, resolved and link', () => {
    const rows = mapManifoldIndiaElections([
      market({ id: 'a', question: 'PM Modi (BJP) wins Bihar election?', probability: 0.987, volume: 4643.4, volume24Hours: 0, isResolved: true, closeTime: Date.parse('2025-11-23T00:00:00Z') }),
      market({ id: 'b', question: 'Who will be the prime minister of India after the next election?', outcomeType: 'MULTIPLE_CHOICE', probability: undefined, volume: 1952 }),
    ], new Map([['b', { answers: [{ text: 'Amit Shah', probability: 0.146 }, { text: 'Narendra Modi', probability: 0.412 }] }]]));
    expect(rows).toEqual([
      expect.objectContaining({
        title: 'Who will be the prime minister of India after the next election?',
        question: 'Who will be the prime minister of India after the next election?',
        market_type: 'Multiple choice', probability: '', top_outcome: 'Narendra Modi', top_outcome_pct: '41.2',
        total_volume: 1952, close_time: '2027-03-10', resolved: 'No', source_url: 'https://manifold.markets/x/b',
      }),
      expect.objectContaining({
        question: 'PM Modi (BJP) wins Bihar election?', market_type: 'Yes / no', probability: '98.7', top_outcome: '',
        total_volume: 4643, close_time: '2025-11-23', resolved: 'Yes',
      }),
    ]);
  });

  it('names no leading answer when the lead is tied (an untraded number-range market)', () => {
    const rows = mapManifoldIndiaElections(
      [market({ id: 'n', question: 'How many seats will BJP win in the 2027 Goa Assembly election?', outcomeType: 'MULTI_NUMERIC', probability: undefined })],
      new Map([['n', { answers: [{ text: '0 - 17', probability: 0.2 }, { text: '18 - 21', probability: 0.2 }, { text: '22 - 40', probability: 0.2 }] }]]),
    );
    expect(rows[0]).toMatchObject({ market_type: 'Number range', top_outcome: '', top_outcome_pct: '' });
  });

  it('drops markets that are not about an Indian election, polls, and real-money markets', () => {
    const rows = mapManifoldIndiaElections([
      market({ id: 'us', question: 'Who will win the 2026 Indiana governor election?' }),
      market({ id: 'poll', question: 'Do you think DMK will win in the Tamilnadu state election?', outcomeType: 'POLL' }),
      market({ id: 'cash', question: 'Who will win the 2025 Delhi Elections?', token: 'CASH' }),
      market({ id: 'ok', question: 'Will UDF win in the coming Kerala state assembly elections of 2026?' }),
    ]);
    expect(rows.map((r) => r.question)).toEqual(['Will UDF win in the coming Kerala state assembly elections of 2026?']);
  });

  it('lists open markets first by volume, then resolved ones newest first, each once', () => {
    const rows = mapManifoldIndiaElections([
      market({ id: 'r-old', question: 'Will KCR be the next CM of Telangana ?', isResolved: true, closeTime: Date.parse('2023-12-07T00:00:00Z') }),
      market({ id: 'open-small', question: 'Who will win the 2025 Delhi Elections?', volume: 10 }),
      market({ id: 'r-new', question: 'PM Modi (BJP) wins Bihar election?', isResolved: true, closeTime: Date.parse('2025-11-23T00:00:00Z') }),
      market({ id: 'open-big', question: 'Will Narendra Modi be Prime Minister of India after 2029 election?', volume: 1765 }),
      market({ id: 'open-big', question: 'Will Narendra Modi be Prime Minister of India after 2029 election?', volume: 1765 }),
    ]);
    expect(rows.map((r) => r.source_url.split('/').pop())).toEqual(['open-big', 'open-small', 'r-new', 'r-old']);
  });
});

describe('the Manifold election loader (F196)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('searches together, then asks only open multiple-choice markets for their answers', async () => {
    const seen = [];
    let open = 0;
    let most = 0;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      seen.push(u);
      open += 1;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 20));
      open -= 1;
      if (/search-markets/.test(u)) {
        return { ok: true, status: 200, json: async () => [
          market({ id: 'mc', question: 'Who will be the prime minister of India after the next election?', outcomeType: 'MULTIPLE_CHOICE' }),
          market({ id: 'bin', question: 'PM Modi (BJP) wins Bihar election?' }),
          market({ id: 'us', question: 'Which party will control Congress after the 2026 midterm elections?', outcomeType: 'MULTIPLE_CHOICE' }),
        ] };
      }
      if (/\/v0\/market\/mc$/.test(u)) return { ok: true, status: 200, json: async () => ({ answers: [{ text: 'Narendra Modi', probability: 0.41 }] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }));
    const { loadManifoldIndiaElections, MANIFOLD_INDIA_SEARCH } = await import('../../server/financeApi.mjs');
    const out = await loadManifoldIndiaElections();
    expect(most).toBeGreaterThan(1);
    expect(seen.filter((u) => /search-markets/.test(u)).sort()).toEqual([...MANIFOLD_INDIA_SEARCH].sort());
    expect(seen.filter((u) => /\/v0\/market\//.test(u))).toEqual(['https://api.manifold.markets/v0/market/mc']);
    expect(out.rows.map((r) => r.question)).toEqual(['Who will be the prime minister of India after the next election?', 'PM Modi (BJP) wins Bihar election?']);
    expect(out.rows[0].top_outcome).toBe('Narendra Modi');
  });

  it('keeps a market whose answers did not arrive, without a top outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (/search-markets/.test(String(url))
      ? { ok: true, status: 200, json: async () => [market({ id: 'mc', question: '2026 West Bengal Legislative Assembly Elections Winner', outcomeType: 'MULTIPLE_CHOICE' })] }
      : { ok: false, status: 500, json: async () => ({}) })));
    const { loadManifoldIndiaElections } = await import('../../server/financeApi.mjs');
    const out = await loadManifoldIndiaElections();
    expect(out.rows).toEqual([expect.objectContaining({ question: '2026 West Bengal Legislative Assembly Elections Winner', top_outcome: '' })]);
  });

  it('the module answers the Indian election markets live, as an API source', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (/search-markets/.test(String(url))
      ? { ok: true, status: 200, json: async () => [
        market({ id: 'in', question: 'Who will win the 2025 Delhi Elections?' }),
        market({ id: 'us', question: 'Who will win the 2026 Indiana governor election?' }),
      ] }
      : { ok: false, status: 404, json: async () => ({}) })));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'economics', feature: 'Election Forecast Aggregator' }));
    expect(out.source.adapter).toBe('api');
    expect(out.rows.map((r) => r.question)).toEqual(['Who will win the 2025 Delhi Elections?']);
    expect(out.source.note).toMatch(/Manifold/);
    expect(out.source.note).toMatch(/not polls/i);
  }, 30_000);
});

/**
 * F202 (module-quality audit 2026-10-15): 33 of 50 Election Forecast rows were markets already
 * resolved (2022-2026), and the Political Odds board showed markets that had closed and two
 * "never resolves" markets closing on 9999-12-31. Both boards now list open markets only, and a
 * close date of 9999-12-31 (Manifold's "no close date") is shown as none.
 */
describe('only open markets on the prediction boards (F202)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  const PAST = Date.parse('2024-06-04T00:00:00Z');
  const FUTURE = Date.parse('2029-05-31T00:00:00Z');
  const NEVER = Date.parse('9999-12-31T23:59:59Z');
  const searchAnswer = (markets) => vi.fn(async (url) => (/search-markets/.test(String(url))
    ? { ok: true, status: 200, json: async () => markets }
    : { ok: false, status: 404, json: async () => ({}) }));

  it('Election Forecast drops resolved and closed markets', async () => {
    vi.stubGlobal('fetch', searchAnswer([
      market({ id: 'open', question: 'Will Narendra Modi be Prime Minister of India after 2029 election?', closeTime: FUTURE }),
      market({ id: 'resolved', question: 'PM Modi (BJP) wins Bihar election?', isResolved: true, closeTime: Date.parse('2025-11-23T00:00:00Z') }),
      market({ id: 'closed', question: 'How many seats will the ruling BJP-led National Democratic Alliance win in the 2024 Indian General Election?', closeTime: PAST }),
      market({ id: 'resolved-future', question: 'Who will win the 2025 Delhi Elections?', isResolved: true, closeTime: FUTURE }),
    ]));
    const { loadManifoldIndiaElections } = await import('../../server/financeApi.mjs');
    const out = await loadManifoldIndiaElections();
    expect(out.rows.map((r) => r.source_url.split('/').pop())).toEqual(['open']);
    expect(out.rows.every((r) => r.resolved === 'No')).toBe(true);
  });

  it('Political Odds drops resolved and closed markets and shows no 9999-12-31 close date', async () => {
    const political = (over) => ({ ...market(over), groupSlugs: ['politics'], isPolitics: true });
    vi.stubGlobal('fetch', searchAnswer([
      political({ id: 'open', question: 'Who will win the 2026 United States Senate election in Iowa?', closeTime: FUTURE, volume24Hours: 50 }),
      political({ id: 'closed', question: 'Will Jeremy Corbyn lead a registered political party by the end of 2025?', closeTime: PAST, volume24Hours: 40 }),
      political({ id: 'resolved', question: 'Nothing Ever Happens: Febuary', isResolved: true, closeTime: FUTURE, volume24Hours: 30 }),
      political({ id: 'stock', question: 'Political opinions stock market', closeTime: NEVER, volume24Hours: 0 }),
    ]));
    const { loadManifoldPolitical } = await import('../../server/financeApi.mjs');
    const out = await loadManifoldPolitical();
    expect(out.rows.map((r) => r.question)).toEqual(['Who will win the 2026 United States Senate election in Iowa?', 'Political opinions stock market']);
    const stock = out.rows.find((r) => r.question === 'Political opinions stock market');
    expect(stock.date).toBe('');
    expect(stock.close_time).toBe('');
    expect(out.rows.some((r) => /^9999/.test(`${r.date}${r.close_time}`))).toBe(false);
  });
});
