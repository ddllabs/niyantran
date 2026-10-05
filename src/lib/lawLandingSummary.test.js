import { describe, it, expect } from 'vitest';
import { projectLawSummary, aggregateLawSummaries, LAW_FEATURES } from './lawLandingSummary.js';
const raw = (feature, rows, source = { adapter: 'embedded' }) => ({ ok: true, feature, tier: 'judiciary', rows, source });
describe('Law landing source identity', () => {
  it('counts a shared Supreme Court table once across its two views', () => {
    const summaries = [0, 1].map(i => projectLawSummary(raw(LAW_FEATURES[i], [{ title: 'An order', court: 'Supreme Court' }])));
    expect(summaries[0].resourceKey).toBe(summaries[1].resourceKey);
    expect(aggregateLawSummaries(summaries)).toEqual({ count: 1, loaded: 1 });
  });
  it('exposes news coverage as reporting, never an official docket or analytics', () => {
    const summary = projectLawSummary(raw(LAW_FEATURES[6], [{ title: 'A report', date: '2026-10-01' }], { adapter: 'news-search' }));
    expect(summary.sourceMode).toBe('feed-backed');
    expect(summary.unit).toBe('reports');
    expect(summary.limitations).toMatch(/not.*(docket|analytics)/i);
    expect(summary.asOf).toBeNull();
  });
  it('retains unknown for errors and removes status rows from counts', () => {
    const summary = projectLawSummary(raw(LAW_FEATURES[2], [{ status: 'source_status', title: 'Unavailable' }]));
    expect(summary.count).toBeNull(); expect(summary.availability).toBe('error');
    expect(projectLawSummary(raw(LAW_FEATURES[2], [])).count).toBe(0);
  });
  it('bounds projection and removes unsafe links and empty fields', () => {
    const summary = projectLawSummary(raw(LAW_FEATURES[0], [{ title: 'Order', diary_no: '', source_url: 'javascript:alert(1)' }], { adapter: 'embedded', links: ['https://www.sci.gov.in/', 'javascript:bad'] }));
    expect(summary.sources).toEqual([{ name: 'sci.gov.in', url: 'https://www.sci.gov.in/' }]);
    expect(summary).not.toHaveProperty('rows'); expect(summary.columns.some(c => c.key === 'diary_no')).toBe(false);
  });
});
