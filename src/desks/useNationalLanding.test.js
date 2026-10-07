import { describe, it, expect } from 'vitest';
import { loadNationalSummaries } from './useNationalLanding.js';
import { NATIONAL_FEATURES } from '../lib/nationalLandingSummary.js';
describe('progressive National summaries', () => {
  it('preserves validated unavailable coverage while rejecting mismatched or inconsistent envelopes', async () => {
    const feature = NATIONAL_FEATURES[12];
    const envelope = { ok:false, version:1, feature, resourceKey:feature, count:null, availability:'error', sourceMode:'unknown', columns:[], sources:[{ name:'Source', url:'https://example.org/' }], limitations:'A complete draft-to-gazette timeline is not established.' };
    const run = async payload => {
      const shown=[];
      await loadNationalSummaries({features:[feature],onSummary:s=>shown.push(s),fetcher:async()=>({ok:true,json:async()=>payload})});
      return shown[0];
    };
    const summary = await run(envelope);
    expect(summary.limitations).toBe(envelope.limitations);
    expect(summary.sources).toEqual(envelope.sources);
    expect(summary.count).toBe(null);
    expect((await run({...envelope,feature:NATIONAL_FEATURES[0]})).limitations).toBeUndefined();
    expect((await run({...envelope,count:20})).limitations).toBeUndefined();
  });
  it('bounds requests, shares bills with the graph, and isolates failures', async () => {
    let active = 0, peak = 0, requests = 0;
    const shown = [];
    await loadNationalSummaries({ features: NATIONAL_FEATURES, onSummary: s => shown.push(s), fetcher: async url => {
      active++; peak = Math.max(peak, active); requests++;
      await new Promise(r => setTimeout(r, 2)); active--;
      const feature = new URL(url, 'http://localhost').searchParams.get('feature');
      if (feature === NATIONAL_FEATURES[2]) throw new Error('Offline');
      return { ok: true, json: async () => ({ ok: true, version: 1, feature, resourceKey: feature, count: 0, availability: 'empty', columns: [], graphColumns: [], sectors: [], sources: [] }) };
    } });
    expect(peak).toBe(3); expect(requests).toBe(16); expect(shown).toHaveLength(17);
    expect(shown.find(s => s.feature === NATIONAL_FEATURES[2]).count).toBe(null);
    expect(shown.find(s => s.feature === NATIONAL_FEATURES[1]).resourceKey).toBe(NATIONAL_FEATURES[0]);
  });
  it('stops queued work and publications on abort', async () => {
    const ac = new AbortController(); let requests = 0; const shown = [];
    await loadNationalSummaries({ features: NATIONAL_FEATURES, signal: ac.signal, onSummary: s => shown.push(s), fetcher: async () => {
      requests++; ac.abort(); throw new DOMException('Aborted', 'AbortError');
    } });
    expect(requests).toBe(1); expect(shown).toEqual([]);
  });
});
