import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ECONOMICS_FEATURES as F, projectEconomicsSummary } from './economicsLandingSummary.js';
import { marketQuoteRows, manifoldPoliticalRows, dgftRows } from './econPack.js';
const raw = (feature, rows = [], adapter = 'api', extra = {}) => ({ ok: true, tier: 'finance', feature, rows, source: { adapter }, ...extra });
const snapshot = name => JSON.parse(readFileSync(new URL(`../../public/data/embedded_csv/${name}.json`, import.meta.url), 'utf8'));
describe('Economics source projection', () => {
  it('counts the actual projected snapshots rather than the raw Manifold pack', () => {
    expect(projectEconomicsSummary(raw(F[0], marketQuoteRows(snapshot('finance_market_feed')), 'embedded')).count).toBe(144);
    expect(projectEconomicsSummary(raw(F[9], manifoldPoliticalRows(snapshot('finance_manifold_markets')), 'embedded')).count).toBe(31);
    expect(projectEconomicsSummary(raw(F[9], snapshot('finance_manifold_markets'), 'embedded')).count).toBe(31);
    expect(projectEconomicsSummary(raw(F[6], dgftRows(snapshot('national_dgft_notifications')), 'embedded')).count).toBe(229);
  });
  it('rejects provider status counts, preserves valid empty and deliberate unavailable', () => {
    const status = [{ status: 'source_status', title: 'Offline', date: '2026-10-08' }];
    expect(projectEconomicsSummary(raw(F[1], status))).toMatchObject({ availability: 'error', count: null, columns: [], observationPeriod: null });
    expect(projectEconomicsSummary(raw(F[1]))).toMatchObject({ availability: 'empty', count: 0 });
    expect(projectEconomicsSummary(raw(F[10], status))).toMatchObject({ ok: true, availability: 'unavailable', count: null, columns: [] });
    expect(projectEconomicsSummary(raw(F[0], [], 'embedded', { ok: false })).count).toBeNull();
  });
  it('does not present news as market or macro data', () => {
    for (const feature of F.filter(f => f !== F[8] && f !== F[10])) {
      expect(projectEconomicsSummary(raw(feature, [{ title: 'Report', last: 1 }], 'news-search'))).toMatchObject({ count: null, availability: 'error', exchangeDistribution: [] });
    }
    expect(projectEconomicsSummary(raw(F[8], [{ title: 'PIB release', date: '2026-10-01' }]))).toMatchObject({ unit: 'reports', count: 1 });
  });
  it('keeps historical periods separate from retrieval and market close dates', () => {
    const summary = projectEconomicsSummary(raw(F[5], [{ year: '2023', gdp_growth_pct: 6 }, { year: '2024', gdp_growth_pct: 7 }], 'api', { meta: { lastupdated: '2026-09-30' } }), '2026-10-08T00:00:00Z');
    expect(summary).toMatchObject({ period: '2023–2024', observationPeriod: { from: '2023', through: '2024' }, asOf: '2026-09-30', retrievedAt: '2026-10-08T00:00:00Z' });
    expect(projectEconomicsSummary(raw(F[9], [{ question: 'Politics?', is_political: 'Yes', date: '2030-01-01' }])).observationPeriod).toBeNull();
    expect(projectEconomicsSummary(raw(F[0], [{ name: 'Quote', last: 0 }])).asOf).toBeNull();
  });
  it('exposes only reported fields and source-specific units, no PMI or scenario fields', () => {
    const fixtures = [
      [{ name: 'Nifty', exchange: 'NSE', last: 10 }, 'quotes'], [{ name: 'S&P', venue: 'NYSE', last: 100 }, 'quotes'],
      [{ country: 'India', year: '2024', gdp_usd_bn: 3900 }, 'countries'], [{ country: 'India', year: '2024', gdp_growth: 7, inflation: 4, emp_to_pop: '—', pmi: 54 }, 'countries'],
      [{ country: 'India', year: '2023', indicator: 'Access to electricity', value: 99 }, 'observations'], [{ year: '2024', gdp_growth_pct: 7, forecast: 10 }, 'observations'],
      [{ subject: 'Notification', date: '2025-01-01' }, 'notifications'], [{ person: 'CEO', company: 'Company' }, 'identities'],
      [{ title: 'PIB release', date: '2026-01-01' }, 'reports'], [{ question: 'Election?', probability: 50, is_political: 'Yes' }, 'markets'], [[], 'forecasts'],
    ];
    F.forEach((feature, i) => {
      const [row, unit] = fixtures[i];
      const summary = projectEconomicsSummary(raw(feature, Array.isArray(row) ? row : [row]));
      expect(summary.unit).toBe(unit);
      expect(summary.columns.some(c => ['pmi', 'forecast', 'emp_to_pop'].includes(c.key))).toBe(false);
      expect(summary).not.toHaveProperty('rows');
      expect(summary.resourceKey).toBe(feature);
    });
    expect(projectEconomicsSummary(raw(F[3], [fixtures[3][0]])).limitations).toMatch(/PMI.*not/i);
    expect(projectEconomicsSummary(raw(F[5], [fixtures[5][0]])).limitations).toMatch(/historical|baseline/i);
  });
  it('counts only actual exchange labels without assigning unreported quotes', () => {
    const summary = projectEconomicsSummary(raw(F[0], [{ name: 'A', last: 1, exchange: 'NSE' }, { name: 'B', last: 0, exchange: 'BSE' }, { name: 'C', last: 2 }, { name: 'D', last: 3, exchange: '—' }]));
    expect(summary.exchangeDistribution).toEqual([{ label: 'BSE', count: 1 }, { label: 'NSE', count: 1 }]);
    expect(summary.exchangeUnreported).toBe(2);
  });
  it('keeps stored versus API provenance and excludes unsafe links', () => {
    const fixture = [{ name: 'Quote', last: 1, source_url: 'javascript:bad' }];
    expect(projectEconomicsSummary(raw(F[0], fixture, 'embedded', { fallback: true }))).toMatchObject({ sourceMode: 'stored', sourceAdapter: 'embedded', fallback: true, sources: [] });
    expect(projectEconomicsSummary(raw(F[0], fixture, 'api'))).toMatchObject({ sourceMode: 'feed-backed', sourceAdapter: 'api' });
    expect(() => projectEconomicsSummary(raw('unknown'))).toThrow('Unknown');
  });
  it('rejects generic backup tables as economic measurements', () => {
    for (const feature of [F[1], F[3], F[4]]) {
      const summary=projectEconomicsSummary(raw(feature,[{title:'Generic row',country:'India',year:'2024'}],'embedded', { source: { adapter: 'embedded', kind: 'backup-pack' } }));
      expect(summary).toMatchObject({count:null,availability:'error',columns:[],exchangeDistribution:[]});
    }
  });

});
