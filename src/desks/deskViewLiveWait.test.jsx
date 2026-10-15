// F159 (owner, 2026-10-14): modules showed "the 4-second limit has passed" and an error card
// "Something went wrong · feature-feed HTTP 404". A module page now says what is happening in plain
// words, asks again while live data loads (moduleLiveRetry.js), and stops when the reader leaves.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ index: 0, overrides: {}, setters: {}, runEffects: false, cleanups: [] }));
vi.mock('react', async (original) => ({ ...await original(),
  useState: (init) => {
    const i = hooks.index++;
    hooks.setters[i] ??= vi.fn();
    return [i in hooks.overrides ? hooks.overrides[i] : typeof init === 'function' ? init() : init, hooks.setters[i]];
  },
  useEffect: (fn) => {
    if (!hooks.runEffects) return;
    const cleanup = fn();
    if (typeof cleanup === 'function') hooks.cleanups.push(cleanup);
  },
  useMemo: (fn) => fn(), useRef: (v) => ({ current: v }), useDeferredValue: (v) => v,
}));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
const api = vi.hoisted(() => ({ page: vi.fn(), whole: vi.fn() }));
vi.mock('../lib/featureFeed.js', () => ({ fetchFeaturePage: api.page, fetchFeature: api.whole }));
vi.mock('../lib/apiMode.js', () => ({ featureFeedApiEnabled: () => true, liveApiEnabled: () => true }));
import DeskView from './DeskView.jsx';
import DeskStateShell from '../shell/DeskStateShell.jsx';
import { LIVE_WAIT_TEXT, MODULE_UNAVAILABLE_TEXT } from './moduleLiveRetry.js';

// DeskView's useState order: q 0, sort 1, feed 2, err 3, loading 4 (deskViewPaging.test.jsx).
const FEATURE = 'Test feed';
const DEVELOPER = /\b\d+\s*s\b|time limit|HTTP|feature-feed|archive|adapter|Something went wrong|last-known-good|Exhaustive shipped/i;
const STATUS = { status: 'source_status', title: 'Source offline or empty', detail: 'No live rows and no last-known-good archive were available. No records were invented.', fail_reason: 'Live sources passed the 4 s time limit' };
const pending = { ok: false, feature: FEATURE, rows: [STATUS], source: { adapter: 'api', links: [], note: 'Live data is taking longer than usual.' }, served: 'archive', meta: {} };
const stored = { ok: true, feature: FEATURE, rows: [{ title: 'Stored decision' }], fallback: true, source: { adapter: 'embedded', note: 'Showing the latest stored records. Live data is still loading.' }, served: 'archive', meta: {} };
const live = { ok: true, feature: FEATURE, rows: [{ title: 'Live decision' }], fallback: false, source: { adapter: 'api', note: 'Live PIB' }, served: 'live', meta: {} };

function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const text = (tree) => nodes(tree).flatMap((n) => [n.props?.children].flat()).filter((c) => typeof c === 'string' || typeof c === 'number').map(String);
const render = (props = {}) => DeskView({ featureName: FEATURE, tier: 'national', selected: null, onSelect: vi.fn(), onFeed: vi.fn(), onLoading: vi.fn(), ...props });
const shellOf = (tree) => nodes(tree).find((n) => n.type === DeskStateShell);
// What a reader sees: the page itself and the state card it hands its props to.
function onScreen(tree) {
  const shell = shellOf(tree);
  return [...text(tree), ...(shell ? text(DeskStateShell(shell.props)) : [])];
}

beforeEach(() => {
  hooks.index = 0; hooks.overrides = {}; hooks.setters = {}; hooks.runEffects = false; hooks.cleanups = [];
  api.page.mockReset(); api.whole.mockReset();
});

describe('what a module page says (F159)', () => {
  it("with backup-pack rows: never shows the pack's own internal note", () => {
    const backup = { ...stored, source: { adapter: 'backup-pack', note: 'Showing the latest stored records.' },
      meta: { note: 'Exhaustive shipped backup · 38 rows · Published source scope loaded. Live and stored snapshot returned no rows.' } };
    hooks.overrides = { 2: backup, 4: false };
    const all = onScreen(render());
    expect(all.filter((t) => /Exhaustive shipped backup/i.test(t))).toEqual([]);
  });

  it('while live data is still loading with nothing stored: taking longer than usual, retrying', () => {
    hooks.overrides = { 2: pending, 4: false };
    const tree = render();
    const all = onScreen(tree);
    expect(all).toContain(LIVE_WAIT_TEXT);
    expect(shellOf(tree)).toBeUndefined();
    expect(all.filter((t) => DEVELOPER.test(t))).toEqual([]);
  });

  it('while the first answer loads', () => {
    hooks.overrides = { 2: null, 4: true };
    const all = onScreen(render());
    expect(all).toContain('Fetching rows…');
    expect(all.filter((t) => DEVELOPER.test(t))).toEqual([]);
  });

  it('a specialised desk waits on the same plain page', () => {
    hooks.overrides = { 2: { ...pending, feature: 'Alliances', rows: [] }, 4: false };
    expect(onScreen(render({ featureName: 'Alliances' }))).toContain(LIVE_WAIT_TEXT);
  });

  it('after giving up: the module could not load, with Retry', () => {
    hooks.overrides = { 2: { ...pending, liveGaveUp: true }, 4: false };
    const tree = render();
    const all = onScreen(tree);
    expect(all).toContain(MODULE_UNAVAILABLE_TEXT);
    expect(all).toContain('Retry');
    expect(typeof shellOf(tree).props.onRetry).toBe('function');
    expect(all.filter((t) => DEVELOPER.test(t))).toEqual([]);
  });

  it('a failed load: the plain message and Retry, not the request’s status', () => {
    hooks.overrides = { 2: null, 3: MODULE_UNAVAILABLE_TEXT, 4: false };
    const all = onScreen(render());
    expect(all).toContain(MODULE_UNAVAILABLE_TEXT);
    expect(all).toContain('Retry');
    expect(all.filter((t) => DEVELOPER.test(t))).toEqual([]);
  });

  it('stored records shown because live was slow say so in plain words', () => {
    hooks.overrides = { 2: stored, 4: false };
    const all = onScreen(render());
    expect(all).toContain('Showing the latest stored records. Live data is still loading.');
    expect(all.filter((t) => DEVELOPER.test(t))).toEqual([]);
  });

  // F159 review: role="status" already announces politely; a second aria-live was redundant.
  it('the waiting message is a status region without a redundant aria-live', () => {
    hooks.overrides = { 2: pending, 4: false };
    const region = nodes(render()).find((n) => n.props?.role === 'status' && /feed-loader/.test(n.props?.className || ''));
    expect(region).toBeDefined();
    expect(region.props['aria-live']).toBeUndefined();
  });

  // F159 review: a server 404/500 is not the reader's connection.
  it('a failed load that reached the server does not blame the reader’s connection', () => {
    hooks.overrides = { 2: null, 3: MODULE_UNAVAILABLE_TEXT, 4: false };
    const all = onScreen(render());
    expect(all).toContain('The source did not respond. Try again.');
    expect(all.filter((t) => /connection/i.test(t))).toEqual([]);
  });

  it('a failed load while the reader is offline asks them to check their connection', () => {
    // DeskView's useState order continues: … mlaPick 12, errOffline 13.
    hooks.overrides = { 2: null, 3: MODULE_UNAVAILABLE_TEXT, 4: false, 13: true };
    expect(onScreen(render())).toContain('Check your connection and try again.');
  });

  it('nothing stored after a failed live source: the module could not load, with Retry, not a wait', () => {
    hooks.overrides = { 2: { ...pending, source: { ...pending.source, note: 'The live source isn’t responding.', liveFailed: true } }, 4: false };
    const tree = render();
    const all = onScreen(tree);
    expect(all).not.toContain(LIVE_WAIT_TEXT);
    expect(all).toContain(MODULE_UNAVAILABLE_TEXT);
    expect(all).toContain('Retry');
    expect(all.filter((t) => /taking longer/i.test(t))).toEqual([]);
  });

  it('a backup pack is described as stored records, not by its file', () => {
    const backup = { ...stored, source: { adapter: 'embedded', kind: 'backup-pack', note: 'Exhaustive shipped backup · 500 rows (pack has 4,104; capped for display). Live and archive returned no rows.' } };
    hooks.overrides = { 2: backup, 4: false };
    const all = onScreen(render());
    expect(all).toContain('Showing the latest stored records.');
    expect(all.filter((t) => DEVELOPER.test(t))).toEqual([]);
  });
});

describe('what a module page asks for (F159)', () => {
  let warn;
  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  it('a failed load shows the plain message and keeps the reason for debugging', async () => {
    api.whole.mockRejectedValue(new Error('feature-feed HTTP 404'));
    hooks.runEffects = true;
    render();
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.setters[3]).toHaveBeenLastCalledWith(MODULE_UNAVAILABLE_TEXT);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/feature-feed HTTP 404/);
  });

  it('asks again after 6 s and 15 s while nothing is stored, and shows live rows when they come', async () => {
    api.whole.mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(live);
    hooks.runEffects = true;
    render();
    await vi.advanceTimersByTimeAsync(5999);
    expect(api.whole).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.whole).toHaveBeenCalledTimes(2);
    expect(api.whole.mock.calls[1][0]).toMatchObject({ tier: 'national', feature: FEATURE });
    expect(api.whole.mock.calls[1][0].onUpdate).toBeUndefined();
    await vi.advanceTimersByTimeAsync(9000);
    expect(api.whole).toHaveBeenCalledTimes(3);
    const shown = hooks.setters[2].mock.calls.at(-1)[0];
    expect(shown.rows.map((r) => r.title)).toEqual(['Live decision']);
    expect(shown.updatedLive).toBe(true);
  });

  it('gives up after the 15 s request', async () => {
    api.whole.mockResolvedValue(pending);
    hooks.runEffects = true;
    render();
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.whole).toHaveBeenCalledTimes(3);
    expect(hooks.setters[2].mock.calls.at(-1)[0].liveGaveUp).toBe(true);
  });

  it('stops asking when the reader leaves the module', async () => {
    api.whole.mockResolvedValue(pending);
    hooks.runEffects = true;
    render();
    await vi.advanceTimersByTimeAsync(0);
    const shownBefore = hooks.setters[2].mock.calls.length;
    for (const cleanup of hooks.cleanups) cleanup();
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.whole).toHaveBeenCalledTimes(1);
    expect(hooks.setters[2].mock.calls.length).toBe(shownBefore);
  });

  it('with stored records on screen asks once after 8 s and swaps in live rows', async () => {
    api.whole.mockResolvedValueOnce(stored).mockResolvedValueOnce(live);
    hooks.runEffects = true;
    render();
    await vi.advanceTimersByTimeAsync(7999);
    expect(api.whole).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.whole).toHaveBeenCalledTimes(2);
    const shown = hooks.setters[2].mock.calls.at(-1)[0];
    expect(shown.rows.map((r) => r.title)).toEqual(['Live decision']);
    expect(shown.updatedLive).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.whole).toHaveBeenCalledTimes(2);
  });

  it('a stored answer that arrives as the live update is followed up too', async () => {
    api.whole.mockImplementationOnce(async ({ onUpdate }) => {
      setTimeout(() => onUpdate(stored), 1000);
      return { ...stored, served: undefined, refreshing: true };
    }).mockResolvedValueOnce(live);
    hooks.runEffects = true;
    render();
    await vi.advanceTimersByTimeAsync(8999);
    expect(api.whole).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.whole).toHaveBeenCalledTimes(2);
  });

  it('notes whether the reader was offline when a load failed', async () => {
    api.whole.mockRejectedValue(new Error('feature-feed HTTP 404'));
    hooks.runEffects = true;
    render();
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.setters[13]).toHaveBeenLastCalledWith(false);

    vi.stubGlobal('navigator', { onLine: false });
    try {
      hooks.index = 0; hooks.setters = {};
      render();
      await vi.advanceTimersByTimeAsync(0);
      expect(hooks.setters[13]).toHaveBeenLastCalledWith(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not retry stored records after a failed live source', async () => {
    api.whole.mockResolvedValue({ ...stored, source: { ...stored.source, liveFailed: true } });
    hooks.runEffects = true;
    render();
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.whole).toHaveBeenCalledTimes(1);
  });

  it('does not retry a genuine failure', async () => {
    api.whole.mockResolvedValue({ ...pending, served: 'live' });
    hooks.runEffects = true;
    render();
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.whole).toHaveBeenCalledTimes(1);
  });

  it('a paged module is unaffected: no whole-module load and no retry, even for a stored answer', async () => {
    const BILLS = 'Bill Passage Probability Index';
    const page = { ok: true, paged: true, prepared: true, feature: BILLS, tier: 'national', rows: [], page: 1, pageSize: 100, total: 0, totalAll: 9819,
      columns: [{ key: 'bill_name', label: 'Bill', default: true }], filterGroups: [], overview: { kpis: [], charts: [] }, meta: {}, source: { adapter: 'embedded', note: '' }, served: 'archive' };
    api.page.mockResolvedValue(page);
    hooks.runEffects = true;
    render({ featureName: BILLS });
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.page).toHaveBeenCalledTimes(1);
    expect(api.whole).not.toHaveBeenCalled();
    hooks.index = 0; hooks.runEffects = false;
    hooks.overrides = { 0: 'zzz', 2: page, 4: false, 9: true };
    const all = onScreen(render({ featureName: BILLS }));
    expect(all).toContain('No rows in this view.');
    expect(all).not.toContain(LIVE_WAIT_TEXT);
  });
});
