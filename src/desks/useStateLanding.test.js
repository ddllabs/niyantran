import { describe, expect, it, vi } from 'vitest';
import { loadStateSummaries } from './useStateLanding.js';
import { STATE_MODULES } from '../lib/stateLandingSummary.js';
const module = { tier: 'local', feature: 'Booth-level Results Database', configured: true };
const answer = (overrides = {}) => ({ ok: true, version: 1, tier: 'local', feature: module.feature, resourceKey: 'goa-booths', count: 1731, unit: 'booth records', availability: 'ready', sourceMode: 'stored', columns: [], sources: [], districts: [], served: 'live', ...overrides });
const respond = (body, ok = true) => async () => ({ ok, json: async () => body });
async function run(fetcher, modules = [module], options = {}) {
  const summaries = [];
  await loadStateSummaries({ modules, onSummary: summary => summaries.push(summary), fetcher, retryAfterMs: [0, 0], ...options });
  return summaries;
}

describe('State summary loading (F157: /api/state-landing)', () => {
  it('asks the count-only route for the module, never the whole module feed', async () => {
    const fetcher = vi.fn(respond(answer()));
    const [summary] = await run(fetcher);
    const url = new URL(fetcher.mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/api/state-landing');
    expect([...url.searchParams.keys()]).toEqual(['feature']);
    expect(url.searchParams.get('feature')).toBe(module.feature);
    expect(summary).toMatchObject({ count: 1731, unit: 'booth records', availability: 'ready', tier: 'local' });
  });
  it('rejects an answer for another tier, module or version instead of counting it', async () => {
    for (const wrong of [{ tier: 'state' }, { feature: 'Constituency Register' }, { version: 2 }, { count: -1 }, { count: 3, availability: 'unavailable' }, { count: null, availability: 'ready' }, { availability: 'available' }]) {
      const [summary] = await run(respond(answer(wrong)));
      expect(summary).toMatchObject({ count: null, availability: 'error', feature: module.feature, tier: 'local' });
    }
  });
  it('keeps a measured-unavailable answer and a failed request apart', async () => {
    expect((await run(respond(answer({ count: null, availability: 'unavailable', sourceMode: 'unknown', unit: 'source entries' }))))[0]).toMatchObject({ count: null, availability: 'unavailable', unit: 'source entries' });
    expect((await run(respond({ ok: false, error: 'State summary unavailable' }, false)))[0]).toMatchObject({ count: null, availability: 'error' });
    expect((await run(async () => { throw new Error('offline'); }))[0]).toMatchObject({ count: null, availability: 'error' });
  });
  it('does not request planned modules and summarises them as unavailable', async () => {
    const fetcher = vi.fn();
    const summaries = await run(fetcher, [{ ...module, configured: false }]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(summaries).toEqual([expect.objectContaining({ count: null, availability: 'unavailable', sourceMode: 'unknown' })]);
  });
  it('shows a count served from the archive after the live time limit as pending, then asks again', async () => {
    const pending = answer({ ok: false, count: null, availability: 'error', sourceMode: 'unknown', served: 'archive' });
    const fetcher = vi.fn().mockImplementationOnce(respond(pending, false)).mockImplementationOnce(respond(answer()));
    const summaries = await run(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(summaries.map(summary => [summary.pending === true, summary.count])).toEqual([[true, null], [false, 1731]]);
  });
  it('requests the 26 configured modules three at a time and summarises all 41', async () => {
    let running = 0, peak = 0;
    const fetcher = vi.fn(async url => {
      peak = Math.max(peak, ++running);
      await new Promise(resolve => setTimeout(resolve, 1));
      running--;
      const item = STATE_MODULES.find(entry => entry.feature === new URL(url, 'http://localhost').searchParams.get('feature'));
      return { ok: true, json: async () => answer({ tier: item.tier, feature: item.feature, count: 0, availability: 'empty' }) };
    });
    const summaries = await run(fetcher, STATE_MODULES);
    expect(peak).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(26);
    expect(summaries).toHaveLength(41);
  });
  it('stops queued work and publications on abort', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => { controller.abort(); throw new DOMException('Aborted', 'AbortError'); });
    const summaries = await run(fetcher, STATE_MODULES.filter(item => item.configured), { signal: controller.signal });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(summaries).toEqual([]);
  });
  it('settles a request that never answers after 45 s', async () => {
    vi.useFakeTimers();
    try {
      let seen;
      const pending = run((url, { signal }) => new Promise((_, reject) => { seen = signal; signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); }));
      await vi.advanceTimersByTimeAsync(45000);
      const summaries = await pending;
      expect(seen.aborted).toBe(true);
      expect(summaries).toEqual([expect.objectContaining({ count: null, availability: 'error' })]);
    } finally { vi.useRealTimers(); }
  });
});
