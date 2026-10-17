import { afterEach, describe, expect, it, vi } from 'vitest';
import { manifoldPoliticalRows, mapManifoldIndiaElections, mapManifoldLive } from './econPack.js';
import { itemsFromRows } from '../../server/feedStore.mjs';
import { serveFromStore } from '../../server/feedServe.mjs';

const QUESTION = 'Will BJP remain the ruling party in India for the rest of this decade?';
const FETCHED = '2026-10-17T12:00:00.000Z';
const market = (id, creator = 'author') => ({
  id,
  question: QUESTION,
  url: `https://manifold.markets/${creator}/market-${id}`,
  outcomeType: 'BINARY',
  probability: 0.797,
  volume: 213,
  volume24Hours: 0,
  closeTime: Date.parse('2030-12-31T00:00:00Z'),
  isResolved: false,
  token: 'MANA',
  isPolitics: true,
});
const boards = [
  { name: 'Political Odds', feature: 'Prediction Market Political Odds', map: mapManifoldLive, loader: 'loadManifoldPolitical' },
  { name: 'Election Forecast', feature: 'Election Forecast Aggregator', map: mapManifoldIndiaElections, loader: 'loadManifoldIndiaElections' },
];

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

describe.each(boards)('$name upstream identity (F222)', ({ feature, map, loader }) => {
  it('preserves separate market IDs for the same question through the real loader', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FETCHED);
    const upstream = [market('market_A-1', '_deleted_'), market('market_B-2')];
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => upstream }));
    vi.stubGlobal('fetch', fetchMock);
    const loaders = await import('../../server/financeApi.mjs');
    const answer = await loaders[loader]();

    expect(answer.rows).toHaveLength(2);
    expect(answer.rows.map(r => r.market_id)).toEqual(['market_A-1', 'market_B-2']);
    expect(answer.rows[0]).toMatchObject({
      question: QUESTION, probability: '79.7', date: '2030-12-31', close_time: '2030-12-31',
      source_url: 'https://manifold.markets/_deleted_/market-market_A-1',
    });
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('https://api.manifold.markets/v0/search-markets?'))).toBe(true);
  });

  it('carries IDs through store serialization and reading without changing existing keys', async () => {
    const rows = map([market('market_A-1'), market('market_B-2')]);
    const legacyRows = rows.map(({ market_id: _marketId, ...row }) => row);
    const legacy = itemsFromRows(legacyRows, 'measurement').items;
    const stored = itemsFromRows(rows, 'measurement').items;

    expect(stored.map(i => i.item_key)).toEqual(legacy.map(i => i.item_key));
    expect(new Set(stored.map(i => i.item_key)).size).toBe(2);
    expect(stored[0].row.market_id).toBe('market_A-1');
    expect(stored[0].content_hash).not.toBe(legacy[0].content_hash);

    const page = {
      tier: 'finance', feature, variant: '', class: 'markets', kind: 'measurement',
      serve: true, fetched_at: FETCHED, checked_at: FETCHED, interval_minutes: 15,
      consecutive_failures: 0, total: stored.length, meta: { adapter: 'api', note: 'Manifold markets' },
      items: stored.map(i => ({ ...i, first_seen: FETCHED, last_seen: FETCHED })),
    };
    const rpc = vi.fn(async () => JSON.parse(JSON.stringify(page)));
    const params = new URLSearchParams({ tier: 'finance', feature });
    const served = await serveFromStore(`finance:${feature}`, params, { rpc, now: () => Date.parse(FETCHED) + 60_000 });
    expect(served.served).toBe('store');
    expect(served.rows.map(r => r.market_id)).toEqual(['market_A-1', 'market_B-2']);

    const legacyPage = { ...page, items: legacy.map(i => ({ ...i, last_seen: FETCHED })) };
    const old = await serveFromStore(`finance:${feature}`, params, {
      rpc: vi.fn(async () => legacyPage), now: () => Date.parse(FETCHED) + 60_000,
    });
    expect(old.rows).toEqual(legacyRows);
    expect(old.rows.every(r => !Object.hasOwn(r, 'market_id'))).toBe(true);
  });

  it.each([undefined, null, '', 123, {}, 'with spaces', 'bad/id', 'x'.repeat(201)])(
    'omits invalid or absent IDs (%j) without dropping the market', (id) => {
      const upstream = { ...market('legacy'), id };
      const rows = map([upstream]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).not.toHaveProperty('market_id');
      expect(rows[0].source_url).toBe(upstream.url);
    },
  );
});

it('keeps an existing market_id through the political-row projector without inventing one for old rows', () => {
  const raw = { question: QUESTION, is_political: 'Yes', probability: 0.797, source_url: 'https://manifold.markets/a/market' };
  const [identified] = manifoldPoliticalRows([{ ...raw, market_id: 'market_A-1' }]);
  const [legacy] = manifoldPoliticalRows([raw]);
  expect(identified.market_id).toBe('market_A-1');
  expect(legacy).not.toHaveProperty('market_id');
});
