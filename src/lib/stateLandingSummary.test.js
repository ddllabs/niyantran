import { describe, expect, it } from 'vitest';
import { STATE_MODULES, projectStateSummary } from './stateLandingSummary.js';
const constituency = STATE_MODULES.find(module => module.feature === 'Constituency Register');
const raw = { ok: true, tier: 'state', feature: constituency.feature, source: { adapter: 'embedded', kind: 'geo-pack', note: 'Goa pack' }, meta: { vintage: '2026 roll' }, rows: [{ district: 'North Goa', title: 'Mandrem' }, { district: 'South Goa', title: 'Margao' }] };
describe('State measured source coverage', () => {
  it('rejects wrong tier or feature responses instead of counting siblings', () => {
    expect(() => projectStateSummary(constituency, { ...raw, tier: 'local' })).toThrow('identity');
    expect(() => projectStateSummary(constituency, { ...raw, feature: 'Cabinet Decisions' })).toThrow('identity');
  });
  it('reports Goa constituency coverage and district record counts, not statewide totals', () => {
    const summary = projectStateSummary(constituency, raw);
    expect(summary).toMatchObject({ count: 2, unit: 'constituency records', sourceMode: 'stored', asOf: null, districts: [{ label: 'North Goa', count: 1 }, { label: 'South Goa', count: 1 }] });
    expect(summary.limitations).toContain('Goa coverage only');
  });
  it('does not count generic backup or source-status placeholder rows', () => {
    expect(projectStateSummary(constituency, { ...raw, source: { adapter: 'embedded', kind: 'backup-pack' } })).toMatchObject({ count: null, availability: 'unavailable' });
    expect(projectStateSummary(constituency, { ...raw, source: { adapter: 'scrape' }, rows: [{ status: 'source_status' }] })).toMatchObject({ count: null, availability: 'unavailable' });
  });
  it('never upgrades an HTML-only module to available because an API returned news', () => {
    const planned = STATE_MODULES.find(module => !module.configured);
    expect(projectStateSummary(planned, { ...raw, tier: planned.tier, feature: planned.feature, source: { adapter: 'news-search' } })).toMatchObject({ count: null, availability: 'unavailable', sourceMode: 'unknown' });
  });
  it('labels news, district directories and budget lines by the returned unit', () => {
    for (const [feature, source, unit] of [['Cabinet Decisions', { adapter: 'news-search' }, 'articles'], ['District Performance Tracker (Composite)', { adapter: 'api' }, 'directory entries'], ['Centre-State Fund Flow Tracker', { adapter: 'api', kind: 'budget-xlsx' }, 'budget lines']]) {
      const module = STATE_MODULES.find(item => item.feature === feature);
      expect(projectStateSummary(module, { ...raw, feature, source }).unit).toBe(unit);
    }
  });
  it('labels estimated community models and deduplicates the shared Goa entities', () => {
    const model = STATE_MODULES.find(module => module.feature === 'Community Bloc Matrix');
    const summary = projectStateSummary(model, { ...raw, feature: model.feature });
    expect(summary).toMatchObject({ sourceMode: 'curated', unit: 'modelled constituency entries', resourceKey: 'goa-constituencies' });
    expect(summary.limitations).toContain('not a census');
    expect(projectStateSummary(constituency, raw).resourceKey).toBe(summary.resourceKey);
  });
  it('does not label the no-shipped-register fallback as a verified zero', () => {
    const module = STATE_MODULES.find(item => item.feature === 'State Fiscal Deep-Dive');
    expect(projectStateSummary(module, { ok: true, tier: 'state', feature: module.feature, rows: [], source: { adapter: 'embedded', note: 'No shipped register for this module on this host.' } })).toMatchObject({ count: null, availability: 'unavailable' });
  });
  it('keeps verified empty coverage distinct from failed and unavailable sources', () => {
    expect(projectStateSummary(constituency, { ...raw, rows: [] })).toMatchObject({ count: 0, availability: 'empty' });
    expect(projectStateSummary(constituency, { ...raw, ok: false })).toMatchObject({ count: null, availability: 'error' });
  });
});
