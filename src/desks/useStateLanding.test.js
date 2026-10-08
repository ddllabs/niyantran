import { describe, expect, it, vi } from 'vitest';
import { loadStateSummaries } from './useStateLanding.js';
const module = { tier: 'local', feature: 'Booth-level Results Database', configured: true };
describe('State summary loading', () => {
  it('requests canonical Local identity and rejects an incorrect response', async () => {
    const calls = [], summaries = [];
    await loadStateSummaries({ modules: [module], onSummary: summary => summaries.push(summary), fetcher: async request => { calls.push(request); return { ok: true, tier: 'state', feature: request.feature, rows: [{ title: 'wrong tier' }], source: { adapter: 'embedded' } }; } });
    expect(calls[0]).toMatchObject({ tier: 'local', feature: module.feature });
    expect(summaries[0]).toMatchObject({ count: null, availability: 'error' });
  });
  it('does not fetch planned entries or publish cancelled results', async () => {
    let calls = 0;
    const summaries = [];
    await loadStateSummaries({ modules: [{ ...module, configured: false }], onSummary: summary => summaries.push(summary), fetcher: async () => { calls++; } });
    expect(calls).toBe(0);
    expect(summaries[0]).toMatchObject({ count: null, availability: 'unavailable' });
    const controller = new AbortController();
    await loadStateSummaries({ modules: [module], signal: controller.signal, onSummary: summary => summaries.push(summary), fetcher: async () => { controller.abort(); throw new Error('abort'); } });
    expect(summaries).toHaveLength(1);
  });
  it('settles a timed-out source even when its adapter ignores cancellation', async () => {
    vi.useFakeTimers();
    try {
      const summaries = [];
      const pending = loadStateSummaries({ modules: [module], onSummary: summary => summaries.push(summary), fetcher: () => new Promise(() => {}) });
      await vi.advanceTimersByTimeAsync(30000);
      await pending;
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({ count: null, availability: 'error' });
    } finally { vi.useRealTimers(); }
  });
  it('bounds concurrent source requests to three and reports independent failures', async () => {
    let running = 0, peak = 0;
    const summaries = [];
    const modules = Array.from({ length: 7 }, (_, i) => ({ ...module, feature: String(i) }));
    await loadStateSummaries({ modules, onSummary: summary => summaries.push(summary), fetcher: async () => { peak = Math.max(peak, ++running); await new Promise(resolve => setTimeout(resolve, 1)); running--; throw new Error('unavailable'); } });
    expect(peak).toBe(3);
    expect(summaries).toHaveLength(7);
    expect(summaries.every(summary => summary.count === null)).toBe(true);
  });
});
