import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F317: a curated news module whose search answered but kept no on-topic headline in its window
 * (Legislative Productivity Comparison, MLA Defection & Anti-defection Case Tracker) was recorded as
 * failed on every run: 257 and 147 consecutive failures on 2026-11-10, against M1's "no scheduled
 * source above 3 consecutive failures". A source that answered with nothing on topic is verified
 * empty (meta.nothing_new, which the refresh records as ok); a search that could not be read at all
 * (HTTP error, an empty or unparseable response) stays a failure. Search results are faked.
 */
const NOW = Date.parse('2026-11-10T12:00:00Z');
const FEEDS = ['Legislative Productivity Comparison', 'MLA Defection & Anti-defection Case Tracker'];
const OFF_TOPIC = ['Local team wins the district cricket final - Example Times', 'Monsoon arrives early over the coast - Example Herald'];
const ON_TOPIC_BY_FEED = {
  'Legislative Productivity Comparison': 'Assembly passed only three bills in the monsoon session as sittings lost to adjournments - Example Times',
  'MLA Defection & Anti-defection Case Tracker': 'Telangana HC disqualifies MLA under anti-defection law - Example Times',
};

const rssOf = (titles) => `<?xml version="1.0"?><rss><channel>${titles
  .map((t, i) => `<item><title>${t}</title><link>https://example.com/${i}</link><pubDate>Fri, 06 Nov 2026 10:0${i}:00 GMT</pubDate></item>`)
  .join('')}</channel></rss>`;
const answer = (body, { status = 200, type = 'application/rss+xml' } = {}) => new Response(body, { status, headers: { 'content-type': type } });

const feed = async (feature) => {
  const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
  return serveFeatureFeed(new URLSearchParams({ tier: 'state', feature }));
};

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe.each(FEEDS)('%s: the loader', (feature) => {
  it('flags a search that answered with nothing on topic as nothing_new, beside its status row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(rssOf(OFF_TOPIC))));
    const out = await feed(feature);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].status).toBe('source_status');
    expect(out.meta?.nothing_new).toBe(true);
  });

  it('searches the same 30 days its rows and note use (the default search is 7 days)', async () => {
    const { newsRssUrlForFeature } = await import('../../server/featureFeed.mjs');
    expect(decodeURIComponent(newsRssUrlForFeature(feature, 'state'))).toContain('when:30d');
  });

  it('does not flag rows without titles (a parser fault) as nothing_new', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(rssOf(['', '  ']))));
    const out = await feed(feature);
    expect(out.meta?.nothing_new).toBeUndefined();
  });

  it.each([
    ['an HTTP 500', () => answer('Server Error', { status: 500, type: 'text/html' })],
    ['an endpoint that is not found', () => answer('Not Found', { status: 404, type: 'text/html' })],
    ['an empty feed', () => answer(rssOf([]))],
    ['an unparseable answer', () => answer('<html><body>blocked</body></html>', { type: 'text/html' })],
    ['a network error', () => { throw new Error('connect ECONNRESET'); }],
  ])('does not flag %s as nothing_new: an outage stays a failure', async (_name, respond) => {
    vi.stubGlobal('fetch', vi.fn(async () => respond()));
    const out = await feed(feature);
    expect(out.meta?.nothing_new).toBeUndefined();
  });

  it('answers on-topic headlines as an ordinary answer, without the flag', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer(rssOf([ON_TOPIC_BY_FEED[feature], ...OFF_TOPIC]))));
    const out = await feed(feature);
    expect(out.rows.some((r) => r.title === ON_TOPIC_BY_FEED[feature])).toBe(true);
    expect(out.meta?.nothing_new).toBeUndefined();
  });
});

describe('the scheduled refresh of a curated news module', () => {
  const token = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  function fakeDb(features) {
    const queue = features.map((feature, i) => ({ tier: 'state', feature, variant: '', class: 'news', kind: 'news', interval_minutes: 30, lease_token: token(i) }));
    const records = [];
    const rpc = vi.fn(async (name, args) => {
      if (name === 'feed_claim_due') return queue.splice(0, args.p_limit);
      if (name === 'feed_record') { records.push(args.p); return { status: args.p.status }; }
      throw new Error(`unexpected rpc ${name}`);
    });
    return { rpc, records };
  }
  const refresh = async (fetchImpl) => {
    vi.stubGlobal('fetch', vi.fn(fetchImpl));
    const { refreshDue } = await import('../../server/feedStore.mjs');
    const db = fakeDb([FEEDS[0]]);
    await refreshDue({ rpc: db.rpc });
    return db.records;
  };

  it('records a search with nothing on topic as ok / nothing_new, not failed', async () => {
    const [rec] = await refresh(async () => answer(rssOf(OFF_TOPIC)));
    expect(rec).toMatchObject({ status: 'ok', nothing_new: true, items: [], error: null });
  });

  it('records an outage as failed', async () => {
    const [rec] = await refresh(async () => answer('Server Error', { status: 500, type: 'text/html' }));
    expect(rec.status).toBe('failed');
    expect(rec).not.toHaveProperty('nothing_new');
  });

  it('records on-topic headlines as ok with items', async () => {
    const [rec] = await refresh(async () => answer(rssOf([ON_TOPIC_BY_FEED[FEEDS[0]], ...OFF_TOPIC])));
    expect(rec).toMatchObject({ status: 'ok' });
    expect(rec.items.length).toBe(1);
    expect(rec).not.toHaveProperty('nothing_new');
  });
});
