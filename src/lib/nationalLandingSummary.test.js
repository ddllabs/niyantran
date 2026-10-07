import { describe, it, expect } from 'vitest';
import { projectNationalSummary, aggregateNationalSummaries, NATIONAL_FEATURES } from './nationalLandingSummary.js';
import featureMap from '../data/html-feature-map.json';
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

const added = ['Policy Pipeline Tracker (Draft-to-Gazette)', 'Delimitation Impact Simulator', 'LS Manifestos & Promises Tracker', 'National Morning Brief (Auto-digest)', 'Statement & Quote Tracker with Contradiction Detection'];
describe('National v6 data coverage', () => {
  it('appends the five reference identities without changing established indexes', () => {
    expect(NATIONAL_FEATURES.slice(12)).toEqual(added);
    expect(new Set(NATIONAL_FEATURES).size).toBe(17);
    expect(new Set(NATIONAL_FEATURES)).toEqual(new Set(featureMap.filter(m => m.htmlTier === 'national').map(m => m.htmlFeature)));
  });
  it('projects stages from prepared bills, retaining missing classifications and all real labels', () => {
    const raw = feed(bill, [{ current_stage: ' Pending ', sector: 'Finance' }, { current_stage: 'Pending' }, { current_stage: 'Lapsed' }, { current_stage: '' }, { current_stage: null }, { status: 'source_status', current_stage: 'Fake' }]);
    const summary = projectNationalSummary(raw);
    expect(summary.stages).toEqual([{ label: 'Not classified', count: 2 }, { label: 'Pending', count: 2 }, { label: 'Lapsed', count: 1 }]);
    expect(summary.stages.reduce((n, stage) => n + stage.count, 0)).toBe(summary.count);
    const graph = projectNationalSummary({ ...raw, feature: NATIONAL_FEATURES[1] });
    expect(graph.stages).toEqual(summary.stages);
    expect(aggregateNationalSummaries([summary, graph])).toEqual({ count: 5, loaded: 1 });
    expect(projectNationalSummary(feed(bill, [], { ok: false })).stages).toEqual([]);
    expect(projectNationalSummary(feed(NATIONAL_FEATURES[2], [{ current_stage: 'Pending' }])).stages).toEqual([]);
  });
  it.each(added.slice(1))('labels reporting coverage truthfully for %s', feature => {
    const s = projectNationalSummary(feed(feature, [{ title: 'Actual report', date: '2026-10-01', source_url: 'https://example.org/report' }], { source: { adapter: 'news-search', links: ['https://example.org/report'] } }));
    expect(s.count).toBe(1);
    expect(s.sourceMode).toBe('feed-backed');
    expect(s.unit).toBe('reports');
    expect(s.columns).toContainEqual({ key: 'title', label: 'Headline' });
    expect(s.limitations).toMatch(/reporting|news/i);
    expect(s.limitations).toMatch(/not/i);
    expect(s).not.toHaveProperty('rows');
  });
  it('distinguishes planned/discovery-only empty envelopes from genuine successful zero results', () => {
    const planned = projectNationalSummary(feed(added[3], [], { source: { adapter: 'planned', links: [] } }));
    expect(planned.ok).toBe(false); expect(planned.count).toBe(null); expect(planned.availability).toBe('error');
    const empty = projectNationalSummary(feed(added[1], [], { source: { adapter: 'news-search', links: [] } }));
    expect(empty.ok).toBe(true); expect(empty.count).toBe(0); expect(empty.availability).toBe('empty');
    const failed = projectNationalSummary(feed(added[2], [{ status: 'source_status', title: 'Unavailable' }]));
    expect(failed.count).toBe(null); expect(failed.columns).toEqual([]);
    const pipeline = projectNationalSummary(feed(added[0], [{ policy_name: 'A published policy', stage: 'Draft' }]));
    expect(pipeline.sourceMode).toBe('stored'); expect(pipeline.limitations).toMatch(/timeline|gazette/i);
  });
});
