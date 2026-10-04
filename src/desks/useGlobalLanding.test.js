import { describe, it, expect } from 'vitest';
import { loadGlobalSummaries } from './useGlobalLanding.js';
import { GLOBAL_FEATURES } from '../lib/globalLandingSummary.js';

describe('progressive Global summaries', () => {
  it('bounds requests and allows unavailable illustrative coverage without inventing zero', async () => {
    let active = 0, peak = 0; const shown = [];
    await loadGlobalSummaries({ features: GLOBAL_FEATURES, onSummary: value => shown.push(value), fetcher: async url => {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
      const feature = new URL(url, 'http://localhost').searchParams.get('feature');
      if (feature === 'Open Fronts') throw new Error('Offline');
      return { ok: true, json: async () => ({ ok: true, version: 1, feature, resourceKey: feature, count: feature === 'Global Commodities' ? null : 0, availability: feature === 'Global Commodities' ? 'unavailable' : 'empty' }) };
    } });
    expect(peak).toBe(3); expect(shown).toHaveLength(16);
    expect(shown.find(s => s.feature === 'Global Commodities').availability).toBe('unavailable');
    expect(shown.find(s => s.feature === 'Open Fronts').count).toBe(null);
  });
  it('aborts queued work without publishing stale summaries', async () => {
    const controller = new AbortController(); const shown = []; let requests = 0;
    await loadGlobalSummaries({ features: GLOBAL_FEATURES, signal: controller.signal, onSummary: s => shown.push(s), fetcher: async () => { requests++; controller.abort(); throw new Error('Aborted'); } });
    expect(requests).toBe(1); expect(shown).toEqual([]);
  });
});
