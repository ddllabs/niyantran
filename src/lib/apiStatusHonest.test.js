import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// F169 T10: the admin API status screen showed statuses from a hand-written list ("Regulatory Body
// Watch: archive", "Geopolitics News Wire: live") and a rule that any Google News address is live,
// and promoted or demoted probe results by special case. A row's status now comes only from asking
// the module, and a stored answer is "Stored", not "Live".
const store = new Map();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal('CustomEvent', class { constructor(type) { this.type = type; } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('API status comes from checks, not a list (F169 T10)', () => {
  it('before any check every row is "Not checked"', async () => {
    const { classifyApis, apiStats } = await import('./apiStatus.js');
    const rows = classifyApis();
    expect(rows.length).toBeGreaterThan(100);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['unchecked']));
    expect(apiStats(rows).unchecked).toBe(rows.length);
  });

  it('a check decides the status: live rows, stored rows, planned, nothing', async () => {
    const { checkOutcome } = await import('./refreshFeeds.js');
    expect(checkOutcome({ rows: [{ title: 'A' }], served: 'live', source: { adapter: 'api' } }).status).toBe('live');
    expect(checkOutcome({ rows: [{ title: 'A' }], served: 'archive', source: { adapter: 'api' } }).status).toBe('archive');
    expect(checkOutcome({ rows: [{ title: 'A' }], fallback: true, source: { adapter: 'news-search' } }).status).toBe('archive');
    expect(checkOutcome({ rows: [{ title: 'A' }], source: { adapter: 'embedded' } }).status).toBe('archive');
    expect(checkOutcome({ rows: [], source: { adapter: 'planned', note: 'Module planned.' } })).toMatchObject({ status: 'inactive', error: 'Module planned.' });
    expect(checkOutcome({ rows: [{ status: 'source_status', title: 'x' }], source: { adapter: 'api', note: 'Source offline' } }).status).toBe('inactive');
  });

  it('a check result is shown as it was, never promoted or demoted', async () => {
    const { saveProbe } = await import('./refreshStore.js');
    saveProbe('global-geopolitics-news-wire', { status: 'archive', rows: 24, fallback: true, at: 1 });
    saveProbe('national-regulatory-watch', { status: 'live', rows: 171, at: 1 });
    const { decorateApis } = await import('./refreshFeeds.js');
    const { classifyApis } = await import('./apiStatus.js');
    const rows = decorateApis(classifyApis());
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by['global-geopolitics-news-wire']?.status).toBe('archive');
    expect(by['global-geopolitics-news-wire']?.statusLabel).toBe('Stored');
    expect(by['national-regulatory-watch']?.status).toBe('live');
    // A module never checked stays "Not checked", whatever its configuration says.
    expect(rows.filter((r) => !['global-geopolitics-news-wire', 'national-regulatory-watch'].includes(r.key)).every((r) => r.status === 'unchecked')).toBe(true);
  });
});
