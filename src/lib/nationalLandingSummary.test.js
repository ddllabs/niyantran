import { describe, it, expect } from 'vitest';
import { projectNationalSummary, aggregateNationalSummaries, NATIONAL_FEATURES } from './nationalLandingSummary.js';
import { prepareDeskFeed } from './prepareDeskFeed.js';
const bill = NATIONAL_FEATURES[0];
const feed = (feature, rows, extra = {}) => ({ ok: true, tier: 'national', feature, rows, source: { adapter: 'embedded', links: [] }, ...extra });
describe('National landing evidence', () => {
  it('uses sectors rather than stage labels and does not include sentinel rows', () => {
    const s = projectNationalSummary(feed(bill, [{ sector: 'Finance', current_stage: 'Passed' }, { sector: '', current_stage: 'Pending' }, { status: 'source_status' }]));
    expect(s.count).toBe(2);
    expect(s.sectors).toEqual([{ label: 'Finance', count: 1 }, { label: 'Not classified', count: 1 }]);
    expect(s.sourceMode).toBe('stored');
    expect(s.asOf).toBe(null);
    expect(s).not.toHaveProperty('rows');
  });
  it('counts a shared bill resource once and keeps errors distinct from zero', () => {
    const s = projectNationalSummary(feed(bill, [{ sector: 'Finance' }]));
    expect(aggregateNationalSummaries([s, { ...s, feature: NATIONAL_FEATURES[1] }, { resourceKey: 'failed', count: null, availability: 'error' }])).toEqual({ count: 1, loaded: 1 });
    expect(projectNationalSummary({ ok: false, feature: bill, rows: [] }).count).toBe(null);
    expect(projectNationalSummary(feed(bill, [])).count).toBe(0);
  });
  it('applies the same expiry filter as the tender workspace', () => {
    const raw = feed(NATIONAL_FEATURES[6], [{ title: 'Expired', deadline: '2000-01-01' }]);
    const expected = prepareDeskFeed(raw).rows.filter(r => r.status !== 'source_status').length;
    expect(expected).toBe(0);
    const s = projectNationalSummary(raw);
    expect(s.count).toBe(expected);
    expect(s.availability).toBe('empty');
  });
  it('does not claim curated allocation data is utilisation or live', () => {
    const s = projectNationalSummary(feed(NATIONAL_FEATURES[10], [{ title: 'Scheme', allocation: 10 }]));
    expect(s.sourceMode).toBe('curated');
    expect(s.limitations).toMatch(/allocations/i);
    expect(s.columns.some(c => /utilisation/i.test(c.label))).toBe(false);
  });
});
