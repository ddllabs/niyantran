// F169 phase 4, C5: the "Scheduled feeds" section of the API status screen, rendered from a loaded
// state (the database call is stubbed in feedAdmin.test.js). renderToStaticMarkup, as documents/components.test.jsx.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabaseClient.js', () => ({ supabase: {} }));
vi.mock('../lib/refreshFeeds.js', () => ({
  cancelSweep: vi.fn(), decorateApis: vi.fn((rows) => rows), healStaleInactiveProbes: vi.fn(async () => {}),
  healStaticHostProbes: vi.fn(), refreshOne: vi.fn(), sweepApis: vi.fn(),
}));
vi.mock('../lib/userStore.js', () => ({
  USER_TYPES: [], userTypeOf: vi.fn(), setUserActive: vi.fn(), setUserType: vi.fn(), setUserPlan: vi.fn(),
  loadUsersPage: vi.fn(), usersPaging: vi.fn(() => ({ page: 1, pageSize: 100, total: 0, query: '' })),
}));

import { ApisPage } from './AdminPages.jsx';
import { DatabaseSize, FeedStoreView } from './FeedStoreSection.jsx';
import { formatClock, shapeFeedRows } from './feedAdmin.js';

const GB = 1024 ** 3;
const NOW = Date.parse('2026-10-15T12:00:00Z');
const raw = (over = {}) => ({
  tier: 'news', feature: 'Wire', variant: '', class: 'news', kind: 'news', interval_minutes: 30, serve: true,
  next_due_at: null, fetched_at: '2026-10-15T11:50:00Z', checked_at: '2026-10-15T11:50:00Z', last_error: null,
  consecutive_failures: 0, item_count: 40, leased: false, last_run_status: 'ok', last_run_at: null,
  runs_ok_24h: 40, runs_failed_24h: 1, stale_after_minutes: 120, stale: false, ...over,
});
const ready = (overs, sizes = { database: 2 * GB, tables: [{ name: 'feed_items', bytes: GB }] }) => ({
  status: 'ready', rows: shapeFeedRows(overs.map((o) => raw(o))), sizes, sizesNote: sizes ? '' : 'The database size could not be read.',
});
const view = (state, props = {}) => renderToStaticMarkup(createElement(FeedStoreView, { state, now: NOW, ...props }));

const MIXED = [
  { feature: 'Fine' },
  { feature: 'Broken', consecutive_failures: 3, last_error: 'HTTP 503 from the source', fetched_at: '2026-10-15T11:00:00Z' },
  { feature: 'Old', stale: true, fetched_at: '2026-10-15T07:00:00Z', serve: false },
];

describe('the three states', () => {
  it('shows a calm note, not an error, before the migration is applied', () => {
    const markup = view({ status: 'notSetUp' });
    expect(markup).toContain('Scheduled feeds');
    expect(markup).toMatch(/Not set up yet/);
    expect(markup).not.toMatch(/role="alert"/);
    expect(markup).not.toMatch(/<table/);
  });
  it('shows the error and a way to retry', () => {
    const markup = view({ status: 'error', message: 'Only an admin can read the feed store\'s health' });
    expect(markup).toMatch(/role="alert"/);
    expect(markup).toContain('Could not load the scheduled feeds');
    expect(markup).toContain('Only an admin can read the feed store&#x27;s health');
    expect(markup).toContain('Try again');
  });
  it('says it is loading', () => {
    expect(view({ status: 'loading' })).toContain('Loading the scheduled feeds');
  });
  it('shows a filled table with real table semantics', () => {
    const markup = view(ready(MIXED));
    expect(markup).toContain('<caption');
    expect(markup).toContain('<th scope="col">Last success</th>');
    expect(markup).toContain('<th scope="row"><div class="feat">Fine</div>');
    for (const head of ['Module', 'Class', 'Serve', 'Last success', 'Failures', 'Items', 'Status']) {
      expect(markup).toContain(`<th scope="col">${head}</th>`);
    }
  });
});

describe('a failed background refresh', () => {
  it('keeps the table and says so quietly, with no alert', () => {
    const at = Date.parse('2026-10-15T11:58:00Z');
    const markup = view({ ...ready(MIXED), refreshFailedAt: at });
    expect(markup).toContain(`Last refresh failed at ${formatClock(at)}; showing the earlier reading.`);
    expect(markup).not.toMatch(/role="alert"/);
    expect(markup).not.toMatch(/role="status"/);
    expect(markup).toContain('>Broken<');
    expect(markup).toContain('<table');
  });
  it('says nothing when the last refresh was good', () => {
    expect(view({ ...ready(MIXED), refreshFailedAt: null })).not.toContain('Last refresh failed');
  });
  it('uses the error screen only when nothing has loaded', () => {
    expect(view({ status: 'error', message: 'down' })).toMatch(/role="alert"/);
  });
});

describe('the rows', () => {
  const markup = view(ready(MIXED));
  const order = ['Broken', 'Old', 'Fine'].map((n) => markup.indexOf(`>${n}<`));
  it('lists failing before stale before the rest', () => {
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });
  it('marks a failing module with the word, its failures and its last error', () => {
    expect(markup).toContain('Failing');
    expect(markup).toContain('3 in a row');
    expect(markup).toContain('HTTP 503 from the source');
  });
  it('marks a stale module with the word and its limit', () => {
    expect(markup).toContain('Stale');
    expect(markup).toContain('limit 120 min');
  });
  it('gives the last success as an age and serve as On or Off', () => {
    expect(markup).toContain('10m ago');
    expect(markup).toContain('1h ago');
    expect(markup).toContain('5h ago');
    expect(markup).toContain('<td>Off</td>');
    expect(markup).toContain('<td>On</td>');
  });
  it('says OK for a healthy module', () => {
    expect(view(ready([{ feature: 'Fine' }]))).toContain('<td>OK</td>');
  });
  it('shows "register" in place of the interval for a register variant (C6 option 1)', () => {
    const markup = view(ready([{ feature: 'MLA Directory', variant: 'Kerala', class: 'register', kind: 'official', interval_minutes: 43200, tier: 'state' }]));
    expect(markup).toContain('state · register');
    expect(markup).not.toContain('every 30 days');
  });
  it('shows a module that was never fetched as Never', () => {
    expect(view(ready([{ feature: 'Fresh', fetched_at: null }]))).toContain('Never');
  });
  it('hides a failing module\'s error once it is healthy again', () => {
    expect(view(ready([{ feature: 'Ok', last_error: 'old news', consecutive_failures: 0 }]))).not.toContain('old news');
  });
});

describe('the filter', () => {
  const state = ready(MIXED);
  it('is a group of buttons with aria-pressed and a count each', () => {
    const markup = view(state, { filter: 'stale' });
    expect(markup).toMatch(/role="group" aria-label="Filter scheduled feeds"/);
    expect(markup).toMatch(/class="adm-chip on"[^>]*aria-pressed="true"[^>]*>Stale<span class="adm-chip-count">1<\/span>/);
    expect(markup).toMatch(/class="adm-chip"[^>]*aria-pressed="false"[^>]*>All<span class="adm-chip-count">3<\/span>/);
    expect(markup).toMatch(/>Failing<span class="adm-chip-count">1</);
    expect(markup).toMatch(/>Serve off<span class="adm-chip-count">1</);
  });
  it('shows only the matching modules', () => {
    const failing = view(state, { filter: 'failing' });
    expect(failing).toContain('>Broken<');
    expect(failing).not.toContain('>Fine<');
    expect(failing).not.toContain('>Old<');
    const off = view(state, { filter: 'serveOff' });
    expect(off).toContain('>Old<');
    expect(off).not.toContain('>Broken<');
  });
  it('says so when nothing matches, and when there are no modules at all', () => {
    expect(view(ready([{ feature: 'Fine' }]), { filter: 'failing' })).toContain('No module matches this filter.');
    expect(view(ready([]))).toContain('No scheduled modules recorded yet');
  });
});

describe('the database size', () => {
  const sizes = (database) => ({ database, tables: [{ name: 'feed_items', bytes: 3 * GB }, { name: 'feed_runs', bytes: 1024 }] });
  it('shows the total and each table', () => {
    const markup = renderToStaticMarkup(createElement(DatabaseSize, { sizes: sizes(2 * GB) }));
    expect(markup).toContain('2.0 GB');
    expect(markup).toContain('<th scope="row">feed_items</th><td>3.0 GB</td>');
    expect(markup).toContain('<th scope="row">feed_runs</th><td>1.0 KB</td>');
  });
  it('does not warn just under 5 GB', () => {
    const markup = renderToStaticMarkup(createElement(DatabaseSize, { sizes: sizes(5 * GB - 1) }));
    expect(markup).not.toMatch(/role="alert"/);
    expect(markup).not.toContain('Warning');
  });
  it('warns, in words, at 5 GB', () => {
    const markup = renderToStaticMarkup(createElement(DatabaseSize, { sizes: sizes(5 * GB) }));
    expect(markup).toMatch(/role="alert"/);
    expect(markup).toContain('Warning: the database is 5.0 GB');
  });
  it('keeps the modules and notes the gap when the size could not be read', () => {
    const markup = view(ready([{ feature: 'Fine' }], null));
    expect(markup).toContain('The database size could not be read.');
    expect(markup).toContain('>Fine<');
  });
});

describe('on the API status screen', () => {
  it('adds the section after the existing table, loading first', () => {
    const markup = renderToStaticMarkup(createElement(ApisPage));
    expect(markup).toContain('API status');
    expect(markup.indexOf('Scheduled feeds')).toBeGreaterThan(markup.indexOf('</table>'));
    expect(markup).toContain('Loading the scheduled feeds');
  });
});
