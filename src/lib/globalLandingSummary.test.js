import { describe, it, expect } from 'vitest';
import { GLOBAL_FEATURES, projectGlobalSummary } from './globalLandingSummary.js';
import { modulesForTier } from '../desks/catalog.js';

describe('Global landing source integrity', () => {
  it('matches the existing canonical catalog', () => {
    expect(new Set(GLOBAL_FEATURES)).toEqual(new Set(modulesForTier('geopolitics').map(m => m.htmlFeature)));
  });
  it('never counts illustrative commodity benchmarks as measured records', () => {
    const summary = projectGlobalSummary({ ok: true, feature: 'Global Commodities', rows: [{ title: 'Gold', level: '$2,720' }], source: { adapter: 'embedded', note: 'Illustrative levels' } });
    expect(summary.count).toBe(null);
    expect(summary.sourceMode).toBe('unknown');
    expect(summary.availability).toBe('unavailable');
    expect(JSON.stringify(summary)).not.toContain('$2,720');
  });
  it('reports actual mineral and appeal fields rather than generic shaped columns', () => {
    const energy = projectGlobalSummary({ ok: true, feature: 'Energy', source: { adapter: 'embedded' }, rows: [{ name: 'Lithium', use: 'Batteries', topProducers: 'Australia', chinaShare: '60%', intensity: 45 }] });
    expect(energy.columns.map(c => c.key)).toEqual(expect.arrayContaining(['name', 'use', 'topProducers', 'chinaShare', 'intensity']));
    const aid = projectGlobalSummary({ ok: true, feature: 'Global Aid', source: { adapter: 'embedded' }, rows: [{ title: 'Appeal', people_target: 100, period: '2026', dataThrough: '2026-07-01' }] });
    expect(aid.columns.map(c => c.key)).toEqual(expect.arrayContaining(['people_target', 'period', 'dataThrough']));
    expect(aid.asOf).toBe(null);
  });
  it('describes dossier details and never labels a narrative as verification', () => {
    const project = projectGlobalSummary({ ok: true, feature: 'Infra', source: { adapter: 'embedded' }, rows: [{ title: 'Port', expected: '2030', detail: 'Planned corridor' }] });
    expect(project.columns.map(c => c.key)).toEqual(expect.arrayContaining(['expected', 'detail']));
    const nuclear = projectGlobalSummary({ ok: true, feature: 'Nuclear Watch', source: { adapter: 'embedded' }, rows: [{ title: 'Site', latest: 'Reporting context' }] });
    expect(nuclear.columns.find(c => c.key === 'latest')?.label).toBe('Notes');
    const choke = projectGlobalSummary({ ok: true, feature: 'Maritime Choke-Points', source: { adapter: 'embedded' }, rows: [{ title: 'Strait', width: 20, operators: 'Operator', risk: 'High', note: 'Context' }] });
    expect(choke.columns.map(c => c.key)).toEqual(expect.arrayContaining(['width', 'operators', 'risk', 'note']));
  });
  it('preserves an empty register separately from an upstream failure', () => {
    const raw = { feature: 'Open Fronts', source: { adapter: 'embedded' }, rows: [] };
    expect(projectGlobalSummary({ ...raw, ok: true }).count).toBe(0);
    expect(projectGlobalSummary({ ...raw, ok: false }).count).toBe(null);
  });
  it('maps only valid source coordinates and retains qualifiers; rejects empty and out-of-range coordinates', () => {
    const summary = projectGlobalSummary({ ok: true, feature: 'Nuclear Watch', rows: [
      { title: 'Site', lat: 47, lon: 34, precision: 'approximate' },
      { title: 'Missing', lat: '', lon: '' }, { title: 'Invalid', lat: 120, lon: 34 },
    ], source: { adapter: 'embedded', links: ['javascript:alert(1)', 'https://pris.iaea.org/'] }, meta: { asOf: '2026-08-24' } });
    expect(summary.locations).toEqual([{ name: 'Site', lat: 47, lon: 34, precision: 'approximate' }]);
    expect(summary.asOf).toBe('2026-08-24');
    expect(summary.sources).toHaveLength(1);
    expect(summary).not.toHaveProperty('rows');
  });
  it('excludes shaped Not reported fields and keeps mixed observation years separate from freshness', () => {
    const s = projectGlobalSummary({ ok: true, feature: 'Growth Indicators', rows: [{ country: 'India', year: 2024, gdp_growth: 6 }, { country: 'UK', year: 2023, gdp_growth: 1 }], source: { adapter: 'live' } });
    expect(s.asOf).toBe(null);
    expect(s.period).toBe('2023–2024');
    expect(s.columns.some(c => c.key === 'fiscal_balance')).toBe(false);
  });
  it('describes upcoming launch fields without promising a constellation inventory', () => {
    const s = projectGlobalSummary({ ok: true, feature: 'Satellite Infrastructure', rows: [{ title: 'Launch', provider: 'Provider', pad: 'Pad', net: '2026-10-10' }], source: { adapter: 'live' } });
    expect(s.columns.map(c => c.label)).toEqual(['Launch', 'Provider', 'Launchpad', 'Scheduled launch']);
  });
});
