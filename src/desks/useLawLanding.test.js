import { describe, it, expect } from 'vitest';
import { loadLawSummaries } from './useLawLanding.js';
import { LAW_FEATURES } from '../lib/lawLandingSummary.js';
describe('progressive Law summaries', () => {
  it('bounds requests, accepts shared source identity and preserves errors as unknown', async () => {
    let active = 0, peak = 0; const shown = [];
    await loadLawSummaries({ features: LAW_FEATURES, onSummary: value => shown.push(value), fetcher: async url => {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
      const feature = new URL(url, 'http://localhost').searchParams.get('feature');
      if (feature === LAW_FEATURES[2]) throw new Error('Offline');
      return { ok: true, json: async () => ({ ok: true, version: 1, feature, resourceKey: LAW_FEATURES.slice(0,2).includes(feature) ? 'judiciary-sc-orders' : feature, sourceMode: 'stored', count: 0, availability: 'empty' }) };
    } });
    expect(peak).toBe(3); expect(shown).toHaveLength(12);
    expect(shown.find(s => s.feature === LAW_FEATURES[0]).resourceKey).toBe('judiciary-sc-orders');
    expect(shown.find(s => s.feature === LAW_FEATURES[2]).count).toBe(null);
  });
  it('aborts queued work without publishing stale summaries', async () => {
    const controller = new AbortController(); const shown = []; let requests = 0;
    await loadLawSummaries({ features: LAW_FEATURES, signal: controller.signal, onSummary: s => shown.push(s), fetcher: async () => { requests++; controller.abort(); throw new Error('Aborted'); } });
    expect(requests).toBe(1); expect(shown).toEqual([]);
  });
});
