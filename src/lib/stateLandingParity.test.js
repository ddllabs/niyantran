// F157: /api/state-landing must give the State landing the numbers and labels it showed when the
// browser downloaded each whole module and counted it. For every State module this runs both ways
// against the same in-process server and the shipped files, with the network off: the old way is
// fetchFeature (the API, then the shipped archive in the browser) projected in the browser; the new
// way is the server's count-only answer.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { serveFeatureFeedWithBackup } from '../../server/featureFeed.mjs';
import { serveStateLanding } from '../../server/stateLandingSummary.mjs';
import { hasRealRows } from './archiveFeed.js';
import { fetchFeature } from './featureFeed.js';
import { STATE_FEATURES, STATE_MODULES, projectStateSummary } from './stateLandingSummary.js';

const PUBLIC = new URL('../../public/', import.meta.url);
const configured = STATE_MODULES.filter(module => module.configured);
// The live attempt as it would be past the server's time limit: refused at once.
const liveDown = () => Promise.reject(new Error('live source down'));
let feedOptions;
// The API answer the browser received per module, to tell when it fell back to its own archive.
const apiAnswers = new Map();

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
async function fakeFetch(input) {
  const url = new URL(String(input?.url || input), 'http://localhost');
  if (url.host === 'localhost' && url.pathname === '/api/feature-feed') {
    const body = await serveFeatureFeedWithBackup(url.searchParams, feedOptions);
    apiAnswers.set(url.searchParams.get('feature'), body);
    return json(200, body);
  }
  if (url.host === 'localhost' && url.pathname.startsWith('/data/')) {
    try {
      const text = await readFile(new URL(`.${decodeURIComponent(url.pathname)}`, PUBLIC), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
    } catch {
      return json(404, null);
    }
  }
  throw new TypeError(`network off in this test: ${url.href}`);
}

// What a landing card reads; `ok`, `served` and `pending` are the route's own fields.
const shown = ({ ok: _ok, served: _served, pending: _pending, ...summary }) => summary;
async function before(module) {
  return projectStateSummary(module, await fetchFeature({ tier: module.tier, feature: module.feature }));
}
async function after(module) {
  return serveStateLanding(new URLSearchParams({ feature: module.feature }), params => serveFeatureFeedWithBackup(params, feedOptions));
}

async function whileTimersRun(promise) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  while (!settled) {
    await vi.advanceTimersByTimeAsync(500);
    await new Promise(resolve => setImmediate(resolve));
  }
  return promise;
}

beforeAll(() => { vi.stubGlobal('fetch', fakeFetch); });
afterAll(() => { vi.unstubAllGlobals(); });

describe('State landing counts: count-only route vs the whole module (F157)', () => {
  it('answers every configured State module and only those', () => {
    expect(STATE_FEATURES).toEqual(configured.map(module => module.feature));
    expect(configured).toHaveLength(37); // F173: State Fiscal Deep-Dive and Municipal & Panchayat Tender are planned; F196 built four (the party map among them), then ten (RBI handbook, Comparison Engine, SDL auctions); F202 planned the State Tender Aggregator
  });

  // First: a live answer with rows is kept for later requests (LATE_LIVE_MS) and would mask this.
  describe('live sources past the server time limit (archive pass)', () => {
    beforeAll(() => { feedOptions = { live: liveDown }; });
    it.each(configured.map(module => [module.feature, module]))('%s shows the same summary, or a pending count where the old landing fell back to its archive', async (_name, module) => {
      const [old, now] = await Promise.all([before(module), after(module)]);
      expect(now.served).toBe('archive');
      if (hasRealRows(apiAnswers.get(module.feature))) expect(shown(now)).toEqual(old);
      else expect(now).toEqual({ ...old, availability: 'error', count: null, ok: false, served: 'archive' });
    }, 20000);
  });

  describe('live sources answering in time with records', () => {
    // A live answer shaped like the news and API feeds, with rows the projection reads.
    const liveRows = params => ({
      ok: true, tier: params.get('tier'), feature: params.get('feature'), served: 'live', fallback: false, meta: { as_of: '2026-10-14' },
      rows: [
        { title: 'Assembly passes budget', date: '2026-10-13', district: 'North Goa', source_url: 'https://www.example.org/a', outlet: 'Example' },
        { title: 'Cabinet clears scheme', date: '2026-10-12', district: 'South Goa', source_url: 'https://news.example.com/b', summary: 'Approved' },
      ],
      source: { adapter: 'news-search', links: ['https://news.google.com/rss/search?q=goa'], note: 'Live news search.' },
    });
    beforeAll(() => { feedOptions = { live: async params => liveRows(params) }; });
    it.each(configured.map(module => [module.feature, module]))('%s shows the same count, unit, labels and fields', async (_name, module) => {
      const [old, now] = await Promise.all([before(module), after(module)]);
      expect(old.count).toBe(2);
      expect(shown(now)).toEqual(old);
    }, 20000);
  });

  describe('live sources answering in time (network off, so they fail; no time limit)', () => {
    // The server spaces GDELT requests 5.5 s apart; fake timers run those waits at once.
    beforeAll(() => { feedOptions = { limitMs: 120000 }; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
    afterAll(() => { vi.useRealTimers(); });
    it.each(configured.map(module => [module.feature, module]))('%s shows the same count, unit, labels and fields', async (_name, module) => {
      const [old, now] = await whileTimersRun(Promise.all([before(module), after(module)]));
      expect(shown(now)).toEqual(old);
      expect(now).not.toHaveProperty('rows');
    }, 20000);
  });
});
