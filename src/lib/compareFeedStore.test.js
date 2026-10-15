import { describe, expect, it, vi } from 'vitest';
import {
  READ_RPCS,
  READ_TABLES,
  SAMPLE_MODULES,
  compareAll,
  compareModule,
  compareServed,
  parseArgs,
  readOnlyClient,
  renderMarkdown,
  selectRuns,
  servedFromStore,
  summarise,
} from '../../scripts/compare-feed-store.mjs';
import { scheduledRuns } from '../../server/feedSchedule.mjs';

/**
 * Task B (2026-10-16): the read-only comparison of each scheduled module's stored copy (the feed store)
 * with its live answer, which decides the order in which serving from the store is switched on.
 */
const NOW = Date.parse('2026-10-16T10:00:00Z');
const MIN = 60_000;

const storedPage = (over = {}) => ({
  tier: 'sports', feature: 'Cricket Wire', variant: '', class: 'news', kind: 'news', serve: false,
  fetched_at: new Date(NOW - 10 * MIN).toISOString(), interval_minutes: 30, consecutive_failures: 0, last_error: null,
  total: 3,
  items: [
    { item_key: 'url:a.example/3', row: { title: 'Three', date: '2026-10-16', source_url: 'https://a.example/3' }, published_at: '2026-10-16T06:00:00Z' },
    { item_key: 'url:a.example/2', row: { title: 'Two', date: '2026-10-15', source_url: 'https://a.example/2' }, published_at: '2026-10-15T06:00:00Z' },
    { item_key: 'url:a.example/1', row: { title: 'One', date: '2026-10-14', source_url: 'https://a.example/1' }, published_at: '2026-10-14T06:00:00Z' },
  ],
  ...over,
});
const liveBody = (rows, over = {}) => ({ ok: true, rows, served: 'live', fallback: false, source: { adapter: 'news-search' }, ...over });
const liveRow = (n, date) => ({ title: `Live ${n}`, date, source_url: `https://a.example/${n}` });
const run = { tier: 'sports', feature: 'Cricket Wire', variant: '', cls: 'news', kind: 'news', every: 30, params: {} };

describe('readOnlyClient: it can only read', () => {
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('calls the read functions with GET (a read-only transaction in PostgREST), never with a body', async () => {
    const fetchImpl = vi.fn(async () => ok({ total: 0 }));
    const db = readOnlyClient({ url: 'https://db.example', key: 'sb_secret_x', fetchImpl });
    await db.rpc('feed_page', { p_tier: 'sports', p_feature: 'Cricket Wire', p_variant: '', p_limit: 500, p_offset: 0 });
    const [href, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    const u = new URL(href);
    expect(u.pathname).toBe('/rest/v1/rpc/feed_page');
    expect(u.searchParams.get('p_feature')).toBe('Cricket Wire');
    expect(u.searchParams.get('p_variant')).toBe('');
  });

  it('selects from feed_state and feed_runs with GET', async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    const db = readOnlyClient({ url: 'https://db.example', key: 'k', fetchImpl });
    await db.select('feed_runs', { select: 'status', tier: 'eq.sports', limit: '1' });
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
    expect(new URL(fetchImpl.mock.calls[0][0]).pathname).toBe('/rest/v1/feed_runs');
  });

  it('refuses every writing function and every other table before any request is made', async () => {
    const fetchImpl = vi.fn();
    const db = readOnlyClient({ url: 'https://db.example', key: 'k', fetchImpl });
    for (const name of ['feed_record', 'feed_claim_due', 'feed_make_due', 'feed_purge', 'anything']) {
      await expect(db.rpc(name, {})).rejects.toThrow(/read-only/);
    }
    for (const table of ['feed_items', 'desk_rows', 'profiles']) {
      await expect(db.select(table, {})).rejects.toThrow(/read-only/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect([...READ_RPCS].sort()).toEqual(['feed_page', 'feed_page_across']);
    expect([...READ_TABLES].sort()).toEqual(['feed_runs', 'feed_state']);
  });

  it('never shows the key in an error', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'bad key sb_secret_abc' }), { status: 401 }));
    const db = readOnlyClient({ url: 'https://db.example', key: 'sb_secret_abc', fetchImpl });
    await expect(db.rpc('feed_page', {})).rejects.toThrow(/^(?!.*sb_secret_abc).*$/);
  });
});

describe('compareModule: the verdict', () => {
  const base = { run, now: NOW, lastRun: { status: 'ok', started_at: new Date(NOW - 10 * MIN).toISOString() } };

  it('store empty: no state, or no items', () => {
    expect(compareModule({ ...base, stored: null, live: liveBody([liveRow(3, '2026-10-16')]) }).verdict).toBe('store empty');
    expect(compareModule({ ...base, stored: storedPage({ items: [], total: 0 }), live: liveBody([]) }).verdict).toBe('store empty');
  });

  it('equal or better: the store holds what live shows, newest dates alike', () => {
    const m = compareModule({ ...base, stored: storedPage(), live: liveBody([liveRow(3, '2026-10-16'), liveRow(2, '2026-10-15')]) });
    expect(m).toMatchObject({ verdict: 'store equal-or-better', storedRows: 3, liveRows: 2, overlap: 2, storedNewest: '2026-10-16', liveNewest: '2026-10-16', class: 'news' });
  });

  it('equal or better when the live answer has no live rows (empty, a status row, a fallback, the archive)', () => {
    for (const live of [
      liveBody([]),
      liveBody([{ title: 'Source offline or empty', status: 'source_status' }]),
      liveBody([liveRow(9, '2026-10-16')], { fallback: true }),
      liveBody([liveRow(9, '2026-10-16')], { served: 'archive' }),
      null,
    ]) {
      const m = compareModule({ ...base, stored: storedPage(), live });
      expect(m.verdict).toBe('store equal-or-better');
      expect(m.reasons.join(' ')).toMatch(/live (answer|request)/);
    }
  });

  it('store worse: the stored copy is past its freshness limit', () => {
    const m = compareModule({ ...base, stored: storedPage({ fetched_at: new Date(NOW - 300 * MIN).toISOString() }), live: liveBody([liveRow(3, '2026-10-16')]) });
    expect(m.verdict).toBe('store worse');
    expect(m.reasons.join(' ')).toMatch(/300 min old.*120/);
  });

  it('store worse: live lists items newer than the newest stored by more than a day', () => {
    const m = compareModule({ ...base, stored: storedPage(), live: liveBody([liveRow(7, '2026-10-18'), liveRow(3, '2026-10-16')]) });
    expect(m.verdict).toBe('store worse');
    expect(m.reasons.join(' ')).toMatch(/1 live item.*newer/);
  });

  it('store worse: a replacing list holds fewer rows than live shows', () => {
    const reference = { ...run, cls: 'reference', kind: 'reference', every: 1440 };
    const rows = Array.from({ length: 20 }, (_v, i) => ({ title: `Country ${i}`, iso3: `C${i}`, value: i, source_url: 'https://wb.example/ind' }));
    const m = compareModule({ ...base, run: reference, stored: storedPage({ kind: 'reference', class: 'reference', interval_minutes: 1440, total: 5, items: [] }), live: liveBody(rows) });
    // Five stored keys are not in this page (items empty) but the total decides the short list.
    expect(m.verdict).toBe('store worse');
    expect(m.reasons.join(' ')).toMatch(/5 stored against 20 live/);
  });

  it('a replacing list is matched by item key only: rows that share a dataset link are not counted as stored', () => {
    const reference = { ...run, cls: 'reference', kind: 'reference', every: 1440 };
    const rows = Array.from({ length: 3 }, (_v, i) => ({ title: `Country ${i}`, iso3: `C${i}`, source_url: 'https://wb.example/ind' }));
    const stored = storedPage({ kind: 'reference', class: 'reference', interval_minutes: 1440, total: 3, items: [{ item_key: 'url:wb.example/ind#other', row: { title: 'Other', source_url: 'https://wb.example/ind' } }] });
    expect(compareModule({ ...base, run: reference, stored, live: liveBody(rows) }).overlap).toBe(0);
  });

  it('store worse: the page the store would serve (its first 500) holds under half of what live shows', () => {
    // 600 stored, the live 12 among the oldest 100: stored, but not on the served page.
    const items = Array.from({ length: 600 }, (_v, i) => ({ item_key: `url:a.example/${i}`, row: { title: `S${i}`, source_url: `https://a.example/${i}` } }));
    const live = liveBody(Array.from({ length: 12 }, (_v, i) => ({ title: `L${i}`, source_url: `https://a.example/${590 - i}` })));
    const m = compareModule({ ...base, stored: storedPage({ total: 600, items }), live });
    expect(m).toMatchObject({ overlap: 12, servedOverlap: 0, verdict: 'store worse' });
    expect(m.reasons.join(' ')).toMatch(/served page .* holds 0 of the 12 live items \(12 of them stored at all\)/);
  });

  it('notes a live answer that came from the store itself (serve on)', () => {
    const m = compareModule({ ...base, stored: storedPage({ serve: true }), live: liveBody([liveRow(3, '2026-10-16')], { served: 'store' }) });
    expect(m.liveServed).toBe('store');
    expect(m.reasons.join(' ')).toMatch(/served from the store/);
  });

  it('reports the last run and its age', () => {
    const m = compareModule({ ...base, stored: storedPage(), live: liveBody([]), lastRun: { status: 'failed', started_at: new Date(NOW - 65 * MIN).toISOString(), error: 'boom' } });
    expect(m).toMatchObject({ lastRunStatus: 'failed', lastRunAgeMin: 65, lastRunError: 'boom' });
  });
});

describe('selection, summary and output', () => {
  it('--module keeps the matching runs (schedule id or part of the feature, any case)', () => {
    const runs = scheduledRuns();
    expect(selectRuns(runs, 'national:Cabinet Decisions').map((r) => `${r.tier}:${r.feature}`)).toEqual(['national:Cabinet Decisions']);
    expect(selectRuns(runs, 'music charts')).toHaveLength(2);
    expect(selectRuns(runs, 'statement & quote').length).toBeGreaterThan(1);
    expect(selectRuns(runs, '')).toHaveLength(runs.length);
  });

  it('parses its options; there is no option that writes', () => {
    expect(parseArgs(['--module', 'Cricket Wire', '--delay', '100', '--json', 'out.json'])).toMatchObject({ module: 'Cricket Wire', delayMs: 100, json: 'out.json' });
    expect(() => parseArgs(['--apply'])).toThrow(/unknown option/);
  });

  it('summarises by verdict and by class, and lists the modules where the store is worse', () => {
    const rows = [
      { id: 'a:A', variant: '', class: 'news', verdict: 'store equal-or-better', reasons: [] },
      { id: 'b:B', variant: '', class: 'news', verdict: 'store worse', reasons: ['stale'] },
      { id: 'c:C', variant: '', class: 'charts', verdict: 'store empty', reasons: [] },
    ];
    const s = summarise(rows);
    expect(s.byVerdict).toEqual({ 'store equal-or-better': 1, 'store worse': 1, 'store empty': 1 });
    expect(s.byClass.news).toEqual({ 'store equal-or-better': 1, 'store worse': 1 });
    expect(s.worse.map((r) => r.id)).toEqual(['b:B']);
    const md = renderMarkdown(rows, s, { generatedAt: '2026-10-16T10:00:00Z' });
    expect(md).toMatch(/\| news \| 1 \| 1 \| 0 \|/);
    expect(md).toMatch(/b:B.*stale/);
  });
});

describe('compareAll: sequential and read-only end to end', () => {
  it('reads each module from the store and the live site one at a time, with GET only', async () => {
    let inFlight = 0;
    let most = 0;
    const calls = [];
    const fetchImpl = vi.fn(async (href, init = {}) => {
      calls.push({ href: String(href), method: init.method || 'GET' });
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      const u = new URL(href);
      if (u.pathname.endsWith('/rpc/feed_page')) return new Response(JSON.stringify(storedPage({ feature: u.searchParams.get('p_feature') })));
      if (u.pathname.endsWith('/feed_runs')) return new Response(JSON.stringify([{ status: 'ok', started_at: new Date(NOW - 5 * MIN).toISOString(), ms: 900 }]));
      if (u.pathname === '/api/feature-feed') return new Response(JSON.stringify(liveBody([liveRow(3, '2026-10-16')])));
      return new Response('not found', { status: 404 });
    });
    const runs = selectRuns(scheduledRuns(), 'wire').slice(0, 3);
    const out = await compareAll({ runs, fetchImpl, url: 'https://db.example', key: 'k', liveBase: 'https://site.example', delayMs: 0, now: () => NOW });
    expect(out.rows).toHaveLength(3);
    expect(most).toBe(1);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    const live = calls.filter((c) => c.href.startsWith('https://site.example/api/feature-feed'));
    expect(live).toHaveLength(3);
    for (const c of live) expect(new URL(c.href).searchParams.get('_cb')).toBeTruthy();
  });
});

/**
 * Task B follow-up (2026-10-16): the stored page passed through the store-serving code locally (serve
 * simulated on, nothing written), against the live answer.
 */
describe('compareServed: the stored page as the store would serve it, against live', () => {
  const NOW_ISO = new Date(NOW - 10 * MIN).toISOString();
  const OLDER = new Date(NOW - 70 * MIN).toISOString();
  const govRun = { tier: 'state', feature: 'State Governance Brief', variant: '', cls: 'news', kind: 'news', every: 30, params: {} };
  const govRow = (n, title, date) => ({ title, date, publisher: 'The Hindu', source_url: `https://g.example/${n}`, section: 'State coverage' });
  const govStored = () => storedPage({
    tier: 'state', feature: 'State Governance Brief', fetched_at: NOW_ISO, total: 4,
    items: [
      { item_key: 'url:g.example/1', row: govRow(1, 'Kerala cabinet approves new health scheme', '2026-10-15'), published_at: '2026-10-15T00:00:00Z', last_seen: NOW_ISO },
      { item_key: 'url:g.example/2', row: govRow(2, 'Punjab chief minister meets farmers in Chandigarh', '2026-10-14'), published_at: '2026-10-14T00:00:00Z', last_seen: OLDER },
      { item_key: 'url:pib/1', row: { title: 'Legislative Department, Ministry of Law &amp; Justice organises workshop', section: 'Government wire (PIB)', source_url: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=1' }, published_at: null, last_seen: OLDER },
      { item_key: 'url:g.example/3', row: govRow(3, 'Bihar chief minister reviews flood relief work', '2026-09-20'), published_at: '2026-09-20T00:00:00Z', last_seen: OLDER },
    ],
  });

  it('serves the stored page through the store code with serve simulated on, and counts the rows each side lacks', async () => {
    const stored = govStored();
    const served = await servedFromStore(govRun, stored, { now: NOW });
    expect(stored.serve).toBe(false);
    const live = liveBody([govRow(1, 'Kerala cabinet approves new health scheme', '2026-10-15'), govRow(9, 'Assam chief minister opens bridge', '2026-10-16')]);
    const s = compareServed({ run: govRun, stored, served, live, now: NOW });
    expect(s).toMatchObject({ servedRows: 2, liveRows: 2, storeOnly: 1, liveOnly: 1, filterFailures: 0, liveDropped: 0, notLatestRun: 0 });
    expect(s.servedTop).toEqual(['Kerala cabinet approves new health scheme', 'Punjab chief minister meets farmers in Chandigarh']);
    expect(s.liveTop).toEqual(['Kerala cabinet approves new health scheme', 'Assam chief minister opens bridge']);
  });

  it('a measurement module: only the latest run is served, and none of it is from an older run', async () => {
    const mRun = { tier: 'finance', feature: 'Prediction Market Political Odds', variant: '', cls: 'markets', kind: 'measurement', every: 15, params: {} };
    const stored = storedPage({
      tier: 'finance', feature: 'Prediction Market Political Odds', class: 'markets', kind: 'measurement', interval_minutes: 15, fetched_at: NOW_ISO, total: 2,
      items: [
        { item_key: 'url:m/1#a', row: { title: 'Open market', source_url: 'https://m.example/1' }, last_seen: NOW_ISO },
        { item_key: 'url:m/2#b', row: { title: 'Closed market', source_url: 'https://m.example/2' }, last_seen: OLDER },
      ],
    });
    const served = await servedFromStore(mRun, stored, { now: NOW });
    const s = compareServed({ run: mRun, stored, served, live: liveBody([{ title: 'Open market', source_url: 'https://m.example/1' }]), now: NOW });
    expect(s).toMatchObject({ servedRows: 1, storeOnly: 0, liveOnly: 0, notLatestRun: 0 });
  });

  it('a measurement variant of more than one page: the store code reads it whole, as the page server would', async () => {
    // Review of 1d2bdb7 (finding 4): feed_page orders a measurement by position; 450 markets of an earlier
    // run come first, the latest run's 150 after them.
    const mRun = { tier: 'finance', feature: 'Prediction Market Political Odds', variant: '', cls: 'markets', kind: 'measurement', every: 15, params: {} };
    const items = Array.from({ length: 600 }, (_v, i) => ({
      item_key: `url:m/${i}`, row: { title: `Market ${i}`, source_url: `https://m.example/${i}` }, last_seen: i < 450 ? OLDER : NOW_ISO,
    }));
    const stored = storedPage({
      tier: 'finance', feature: 'Prediction Market Political Odds', class: 'markets', kind: 'measurement', interval_minutes: 15, fetched_at: NOW_ISO, total: 600, items,
    });
    const served = await servedFromStore(mRun, stored, { now: NOW });
    expect(served.rows.map((r) => r.title)).toEqual(items.slice(450).map((i) => i.row.title));
    const s = compareServed({ run: mRun, stored, served, live: liveBody(items.slice(450).map((i) => i.row)), now: NOW });
    expect(s).toMatchObject({ servedRows: 150, liveRows: 150, storeOnly: 0, liveOnly: 0, notLatestRun: 0 });
  });

  it('says when the store would serve nothing (the live path answers)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored = storedPage({ tier: 'state', feature: 'State Governance Brief', fetched_at: NOW_ISO, total: 1, items: [govStored().items[2]] });
    const served = await servedFromStore(govRun, stored, { now: NOW });
    const s = compareServed({ run: govRun, stored, served, live: liveBody([]), now: NOW });
    expect(s).toMatchObject({ servedRows: 0, servedNote: expect.stringMatching(/live path/) });
    vi.restoreAllMocks();
  });

  it('the report has a served section with the top ten titles of each side for the sample modules', () => {
    expect(SAMPLE_MODULES).toEqual([
      'state:State Governance Brief',
      'local:Municipal Watch',
      'state:Assembly Proceedings Digest (Vernacular, Translated)',
      'finance:Prediction Market Political Odds',
    ]);
    const row = {
      id: 'state:State Governance Brief', variant: '', class: 'news', kind: 'news', verdict: 'store worse', reasons: [],
      served: { servedRows: 2, liveRows: 2, storeOnly: 1, liveOnly: 1, filterFailures: 0, liveDropped: 0, notLatestRun: 0, servedTop: ['A', 'B'], liveTop: ['A', 'C'], servedNote: '' },
    };
    const md = renderMarkdown([row], summarise([row]), { generatedAt: '2026-10-16T10:00:00Z' });
    expect(md).toMatch(/## Served from the store/);
    expect(md).toContain('| state:State Governance Brief |  | news | 2 | 2 | 1 | 1 | 0 | 0 | 0 |');
    expect(md).toMatch(/### state:State Governance Brief[\s\S]*Store[\s\S]*1\. A[\s\S]*Live[\s\S]*2\. C/);
  });
});
