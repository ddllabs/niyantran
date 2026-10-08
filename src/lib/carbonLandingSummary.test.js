import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CARBON_FEATURES as F, projectCarbonSummary } from './carbonLandingSummary.js';
import { carbonRows, carbonDataset, carbonSlice } from './carbonPack.js';
const raw = (feature, rows = [], adapter = 'embedded', extra = {}) => ({ ok: true, tier: 'climate', feature, rows, source: { adapter, kind: adapter === 'embedded' ? 'carbon-pack' : '' }, ...extra });
const packs = Object.fromEntries(['pricing', 'monitor', 'ets', 'cbam', 'ccts', 'registry', 'news'].map(slice => [slice, JSON.parse(readFileSync(new URL(`../../public/data/embedded_csv/${carbonDataset(slice).replace('.csv', '.json')}`, import.meta.url), 'utf8'))]));
describe('Carbon source summaries', () => {
  it.each(F)('projects actual embedded source for %s with bounded populated fields', feature => {
    const slice = carbonSlice(feature);
    const expected = { pricing: 52, monitor: 242, ets: 52, cbam: 7, ccts: 6, registry: 24, news: 38 }[slice];
    const summary = projectCarbonSummary(raw(feature, carbonRows(slice, packs)));
    expect(summary).toMatchObject({ ok: true, count: expected, sourceMode: 'stored', version: 1, feature, resourceKey: feature });
    expect(summary.columns.length).toBeGreaterThan(0);
    expect(summary).not.toHaveProperty('rows');
    expect(summary).not.toHaveProperty('priceTotal');
    expect(summary.asOf).toBeNull();
  });
  it('status and provider errors remain unknown rather than zero; valid empty is zero', () => {
    expect(projectCarbonSummary(raw(F[0], [{ status: 'source_status', title: 'Offline', date: '2026-10-08' }]))).toMatchObject({ ok: false, availability: 'error', count: null, columns: [], jurisdictionDistribution: [], observationPeriod: null });
    expect(projectCarbonSummary(raw(F[0], [], 'api', { ok: false })).count).toBeNull();
    expect(projectCarbonSummary(raw(F[0]))).toMatchObject({ availability: 'empty', count: 0 });
  });
  it('rejects generic backup packs, news substitution and emissions as prices', () => {
    const price = [{ title: 'India', jurisdiction: 'India', weighted_price_usd: 1 }];
    for (const source of [{ adapter: 'embedded', kind: 'backup-pack' }, { adapter: 'news-search' }, { adapter: 'world-bank' }, { adapter: 'unmapped' }]) expect(projectCarbonSummary({ ...raw(F[0], price), source })).toMatchObject({ availability: 'error', count: null, columns: [], jurisdictionDistribution: [] });
    expect(projectCarbonSummary(raw(F[1], [{ title: 'CO2 emissions', jurisdiction: 'India', year: '2024', value: 100, indicator_id: 'EN.GHG.CO2' }], 'api'))).toMatchObject({ availability: 'error', count: null });
    expect(projectCarbonSummary(raw(F[3], [{ title: 'Headline' }], 'news-search')).count).toBeNull();
  });
  it('future milestone dates are an observation period, not a source update date', () => {
    const summary = projectCarbonSummary(raw(F[3], [{ milestone: 'Transition', date: '2023-10-01' }, { milestone: 'Policy effective', date: '2027-01-01' }]), '2026-10-08T00:00:00Z');
    expect(summary).toMatchObject({ asOf: null, observationPeriod: { from: '2023-10-01', through: '2027-01-01' }, period: '2023-10-01–2027-01-01', retrievedAt: '2026-10-08T00:00:00Z' });
    expect(projectCarbonSummary(raw(F[3], [], 'embedded', { meta: { as_of: '2026-09-01' } })).asOf).toBe('2026-09-01');
  });
  it('measures jurisdiction record counts, exposes unshown labels, never sums prices', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ jurisdiction: `Region ${String(i).padStart(2, '0')}`, weighted_price_usd: 999 }));
    rows.push({ jurisdiction: 'Region 00', weighted_price_usd: 1 }, { jurisdiction: '—', weighted_price_usd: 0 });
    const summary = projectCarbonSummary(raw(F[0], rows));
    expect(summary.jurisdictionDistribution).toHaveLength(12);
    expect(summary.jurisdictionDistribution[0]).toEqual({ label: 'Region 00', count: 2 });
    expect(summary.jurisdictionUnreported).toBe(3);
    expect(summary.jurisdictionDistribution.reduce((sum, item) => sum + item.count, 0) + summary.jurisdictionUnreported).toBe(summary.count);
    expect(projectCarbonSummary(raw(F[3], [{ milestone: 'CBAM', jurisdiction: 'EU' }])).jurisdictionDistribution).toEqual([]);
  });
  it('discloses the registry live/stored blend and treats outlet RSS as articles', () => {
    expect(projectCarbonSummary(raw(F[5], [{ title: 'Verra notice', registry: 'Verra' }, { title: 'Stored notice', registry: 'Isometric' }], 'api'))).toMatchObject({ sourceMode: 'feed-backed', unit: 'publications' });
    expect(projectCarbonSummary(raw(F[5], [], 'api')).limitations).toMatch(/live Verra.*stored/i);
    expect(projectCarbonSummary(raw(F[6], [{ title: 'Outlet article', outlet: 'Carbon Brief' }], 'api')).unit).toBe('articles');
  });
  it('filters empty fields and unsafe URLs while preserving useful error metadata', () => {
    const summary = projectCarbonSummary(raw(F[3], [{ milestone: 'CBAM', detail: '', source_url: 'javascript:bad' }], 'embedded', { source: { adapter: 'embedded', kind: 'carbon-pack', links: ['https://commission.europa.eu/'] } }));
    expect(summary.sources).toEqual([{ name: 'commission.europa.eu', url: 'https://commission.europa.eu/' }]);
    expect(summary.columns.some(c => c.key === 'detail')).toBe(false);
    expect(() => projectCarbonSummary(raw('unknown'))).toThrow('Unknown');
  });
});
