// F156 (owner request 2026-10-14; spec docs/specs/2026-10-14-paged-module-lists.md): Bills and
// Questions downloaded their whole register (0.9 MB and 0.6 MB as sent) to show 100 rows. The server
// now answers one page, worked out with the browser's own functions in the browser's order.
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import handler, { API_CACHE } from '../../api/router.js';
import { handleFeatureFeedRequest, serveFeatureFeedWithBackup, serveFeatureFeedWithinLimit } from '../../server/featureFeed.mjs';
import { serveFeaturePage } from '../../server/featurePage.mjs';
import { prepareDeskFeed } from './prepareDeskFeed.js';
import { filterRows, sortRows } from './normalise.js';
import { buildTableSearchIndex, searchTableRows, shouldIndexSearch } from './tableSearch.js';
import { applyVizFilter } from './nationalKpi.js';
import { matchesChoice } from './choiceFilter.js';
import { feedColumns } from './columns.js';
import { feedOverview, tableFilterGroups } from './analytics.js';
import { deskRowKey } from './deskRows.js';
import { PAGED_FEATURES, PAGED_THRESHOLD, UNPAGED_LARGE_FEATURES, pageQuery, parsePageQuery } from './pagedFeatures.js';

const BILLS = 'Bill Passage Probability Index';
const QUESTIONS = 'Parliamentary Question Database';
const json = (value) => JSON.parse(JSON.stringify(value));

// Today's browser pipeline, as DeskView.jsx runs it over the whole answer (its `filtered` memo).
function browserView(body, { q = '', vizFilter = null, answer = '', sort = { key: '', dir: 'asc' } }) {
  const feed = prepareDeskFeed(json(body));
  const base = feed.rows || [];
  const searchIndex = shouldIndexSearch(base.length) ? buildTableSearchIndex(base) : null;
  let rows = shouldIndexSearch(base.length) ? searchTableRows(base, searchIndex, q) : filterRows(base, q);
  rows = rows.filter((r) => applyVizFilter(r, vizFilter));
  if (feed.feature === QUESTIONS && answer) rows = rows.filter((r) => matchesChoice(answer, r.has_answer_key || 'unknown'));
  return { feed, rows: sortRows(rows, sort.key || undefined, sort.dir) };
}

const VIEWS = {
  [BILLS]: [
    {},
    { q: 'Finance' },
    { q: '  constitution amendment ' },
    { sort: { key: 'date_introduced', dir: 'desc' } },
    { sort: { key: 'bill_name', dir: 'asc' } },
    { vizFilter: [{ col: 'sector', value: 'FINANCE' }] },
    { vizFilter: [{ col: 'house', value: 'Lok Sabha' }, { col: 'current_stage', value: 'Lapsed' }, { col: 'current_stage', value: 'Assented' }], sort: { key: 'house', dir: 'desc' } },
    { q: 'tax', vizFilter: [{ col: 'bill_type', value: 'Government' }], sort: { key: 'date_introduced', dir: 'asc' } },
  ],
  [QUESTIONS]: [
    {},
    { q: 'railway' },
    { q: 'Health  hospital' },
    { sort: { key: 'date', dir: 'desc' } },
    { sort: { key: 'mp_name', dir: 'asc' } },
    { vizFilter: [{ col: 'ministry', value: 'RAILWAYS' }] },
    { answer: ['unknown'] },
    { answer: ['yes', 'no'] },
    { q: 'water', vizFilter: [{ col: 'question_type', value: 'STARRED' }], answer: ['unknown', 'yes'], sort: { key: 'date', dir: 'asc' } },
  ],
};

const pageOf = async (feature, view, page = 1, pageSize = 100) => {
  const query = pageQuery({ tier: 'national', feature, page, pageSize, q: view.q, sort: view.sort?.key, dir: view.sort?.dir, filter: view.vizFilter, answer: view.answer });
  const out = await serveFeaturePage(new URLSearchParams(query), serveFeatureFeedWithBackup);
  return { status: out.status, body: json(out.body) };
};

describe.each([BILLS, QUESTIONS])('%s: a server page is the browser view (F156)', (feature) => {
  let whole;
  beforeAll(async () => {
    whole = await serveFeatureFeedWithBackup(new URLSearchParams({ tier: 'national', feature }));
  });

  it.each(VIEWS[feature].map((view) => [JSON.stringify(view), view]))('%s', async (_name, view) => {
    const expected = browserView(whole, view);
    for (const page of [1, 2, Math.ceil(expected.rows.length / 100)]) {
      const { status, body } = await pageOf(feature, view, Math.max(1, page));
      expect(status).toBe(200);
      expect(body.total).toBe(expected.rows.length);
      expect(body.rows).toEqual(expected.rows.slice((Math.max(1, page) - 1) * 100, Math.max(1, page) * 100));
    }
  });

  it('sends the register’s columns, filter menu and side-panel figures, already prepared', async () => {
    const { feed, rows } = browserView(whole, {});
    const { body } = await pageOf(feature, {});
    expect(body).toMatchObject({ ok: true, paged: true, prepared: true, page: 1, pageSize: 100, totalAll: rows.length });
    expect(body.columns).toEqual(json(feedColumns(feed.feature, rows)));
    expect(body.filterGroups).toEqual(json(tableFilterGroups(feed)));
    expect(body.overview).toEqual(json(feedOverview(feed)));
    expect(body.meta).toEqual(feed.meta);
  });

  it('is small: the first page and summary are at most 100 KB raw and 20 KB compressed', async () => {
    const { body } = await pageOf(feature, {});
    const raw = Buffer.from(JSON.stringify(body));
    expect(raw.length).toBeLessThanOrEqual(100 * 1024);
    expect(gzipSync(raw).length).toBeLessThanOrEqual(20 * 1024);
  });

  it('a page past the end is empty with the real total; pageSize is honoured', async () => {
    const past = await pageOf(feature, {}, 999);
    expect(past.body.rows).toEqual([]);
    expect(past.body.total).toBe(past.body.totalAll);
    expect((await pageOf(feature, {}, 1, 200)).body.rows).toHaveLength(200);
  });

  it('finds one cited row by its desk key', async () => {
    const { rows } = browserView(whole, {});
    const row = rows[1234];
    const out = await serveFeaturePage(new URLSearchParams(pageQuery({ tier: 'national', feature, key: deskRowKey(row) })), serveFeatureFeedWithBackup);
    expect(json(out.body.rows).map(deskRowKey)).toContain(deskRowKey(row));
    expect(out.body.total).toBeGreaterThanOrEqual(1);
  });
});

describe('server time (F156)', () => {
  it('a warm search over Bills takes at most 100 ms', async () => {
    await pageOf(BILLS, {});
    const started = performance.now();
    await pageOf(BILLS, { q: 'education' });
    expect(performance.now() - started).toBeLessThan(100);
  });
});

function vercelResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader: vi.fn((name, value) => { res.headers[name.toLowerCase()] = value; }),
    status: vi.fn((code) => { res.statusCode = code; return res; }),
    json: vi.fn((body) => { res.body = json(body); return res; }),
    end: vi.fn(() => res),
  };
  return res;
}
const routerGet = async (query) => {
  const res = vercelResponse();
  await handler({ method: 'GET', url: `/api/router?__route=feature-feed&${query}`, query: { __route: 'feature-feed' }, headers: { host: 'localhost' } }, res);
  return res;
};

describe('/api/feature-feed with page (F156)', () => {
  it('a good page is kept by the edge', async () => {
    const res = await routerGet(pageQuery({ tier: 'national', feature: BILLS, q: 'finance' }));
    expect(res.statusCode).toBe(200);
    expect(res.body.paged).toBe(true);
    expect(res.headers['vercel-cdn-cache-control']).toBe(API_CACHE.cdn);
  });

  it.each([
    'page=0', 'page=abc', 'page=1&pageSize=75', 'page=1&dir=up', 'page=1&sort=no_such_column', 'page=1&sort=a;b',
    `page=1&q=${'x'.repeat(101)}`, 'page=1&filter=not-json', 'page=1&filter={"col":"house"}', 'page=1&filter=[{"col":"house","value":"x","evil":1}]',
    `page=1&filter=${encodeURIComponent(JSON.stringify([{ col: 'sector', value: 'x'.repeat(2100) }]))}`, 'page=1&answer=maybe', `page=1&key=${'k'.repeat(201)}`,
  ])('a bad parameter (%s) answers 400 and is never cached', async (bad) => {
    const res = await routerGet(`tier=national&feature=${encodeURIComponent(QUESTIONS)}&${bad}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['vercel-cdn-cache-control']).toBeUndefined();
  });

  it('a request without page is unchanged: the whole register, no page fields', async () => {
    const res = await routerGet(`tier=national&feature=${encodeURIComponent(BILLS)}`);
    const whole = json(await serveFeatureFeedWithBackup(new URLSearchParams({ tier: 'national', feature: BILLS })));
    expect(res.body).toEqual(whole);
    expect(res.body.paged).toBeUndefined();
    expect(res.body.rows).toHaveLength(9819);
  });

  it('the Vite middleware answers pages and bad parameters the same way', async () => {
    const local = async (query) => {
      const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(raw) { this.body = JSON.parse(raw); } };
      await handleFeatureFeedRequest({ method: 'GET', url: `/api/feature-feed?${query}`, headers: { host: 'localhost' } }, res, () => {});
      return res;
    };
    const good = pageQuery({ tier: 'national', feature: QUESTIONS, q: 'railway', sort: 'date', dir: 'desc' });
    expect((await local(good)).body).toEqual((await routerGet(good)).body);
    expect((await local(`feature=${encodeURIComponent(QUESTIONS)}&page=0`)).statusCode).toBe(400);
  });

  it('page is ignored for a module that is not paged', async () => {
    const query = `tier=judiciary&feature=${encodeURIComponent('WTO Dispute Settlement')}`;
    const withPage = await routerGet(`${query}&page=2&q=x`);
    expect(withPage.body.paged).toBeUndefined();
    expect(withPage.body.rows.length).toBeGreaterThan(100);
  });
});

describe('the page URL (F156)', () => {
  it('always has the same parameters in the same order, search text trimmed and lower case, defaults left out', () => {
    const view = { tier: 'national', feature: QUESTIONS, page: 3, q: '  Railway SAFETY ', sort: 'date', dir: 'desc', answer: ['no', 'yes'],
      filter: [{ col: 'ministry', value: 'RAILWAYS', label: 'Railways', n: 375 }, { col: 'party', value: 'BJP', map: '' }] };
    expect(pageQuery(view)).toBe(pageQuery({ ...view, filter: [...view.filter].reverse(), answer: ['yes', 'no'], q: 'railway safety' }));
    expect(pageQuery(view)).toBe(
      'tier=national&feature=Parliamentary+Question+Database&page=3&q=railway+safety&sort=date&dir=desc'
      + `&filter=${encodeURIComponent('[{"col":"ministry","value":"RAILWAYS"},{"col":"party","value":"BJP"}]').replace(/%20/g, '+')}&answer=yes%2Cno`,
    );
    expect(pageQuery({ feature: BILLS, pageSize: 100, sort: 'house', dir: 'asc', q: '   ', filter: null, answer: '' })).toBe('feature=Bill+Passage+Probability+Index&page=1&sort=house');
  });

  it('reads back what it writes', () => {
    const parsed = parsePageQuery(new URLSearchParams(pageQuery({ feature: BILLS, page: 2, pageSize: 50, q: 'Tax', sort: 'house', dir: 'desc', filter: [{ col: 'sector', value: 'FINANCE', values: ['FINANCE', 'TAX'] }], key: 'k1' })));
    expect(parsed).toEqual({ ok: true, page: 2, pageSize: 50, q: 'tax', sort: 'house', dir: 'desc', filter: [{ col: 'sector', value: 'FINANCE', values: ['FINANCE', 'TAX'] }], answer: [], key: 'k1' });
  });
});

describe('which modules are paged (F156)', () => {
  it('exactly the modules over 250 KB compressed or 5,000 rows, apart from the graph', async () => {
    const modules = JSON.parse(readFileSync(new URL('../data/html-feature-map.json', import.meta.url), 'utf8'));
    const fail = async () => { throw new Error('stored register only'); };
    const over = [];
    for (const m of modules) {
      const body = await serveFeatureFeedWithinLimit(new URLSearchParams({ tier: m.htmlTier, feature: m.htmlFeature }), { live: fail });
      const rows = (body.rows || []).length;
      if (rows > PAGED_THRESHOLD.rows || gzipSync(JSON.stringify(body)).length > PAGED_THRESHOLD.gzipBytes) over.push(m.htmlFeature);
    }
    expect([...new Set(over)].sort()).toEqual([...PAGED_FEATURES, ...UNPAGED_LARGE_FEATURES].sort());
  });
});
