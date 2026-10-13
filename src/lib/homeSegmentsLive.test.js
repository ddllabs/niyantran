// F142 (owner 2026-10-14): the coverage carousel takes bills, ministries and fronts from the same live
// counts as the hero, so the two never disagree; without live counts it keeps its snapshot figures.
import { describe, expect, it } from 'vitest';
import { serveHomeSegments } from '../../server/homeApi.mjs';

const live = async () => ({ bills: 9901, documents: 3500, ministries: 57, fronts: 90, as_of: 'x', source: 'live' });
// Fallback counts unlike the snapshot's, so using them by mistake would show.
const down = async () => ({ bills: 1234, documents: 3431, ministries: 5, fronts: 6, as_of: 'x', source: 'fallback' });
const segment = (data, id) => data.segments.find((s) => s.id === id);
const metricValue = (seg, label) => seg.keyMetrics.find((m) => m.label === label)?.value;

describe('carousel counts', () => {
  it('uses the live counts when the database answered', async () => {
    const data = await serveHomeSegments({ figures: live });
    const bills = segment(data, 'legislative');
    expect(bills.liveCount).toBe(9901);
    expect(String(metricValue(bills, 'Ministries'))).toBe('57');
    expect(data.segments.find((x) => x.liveCountLabel === 'MONITORED FRONTS').liveCount).toBe(90);
  });

  it('keeps its snapshot figures when the counts are only the fallback', async () => {
    const snapshot = await serveHomeSegments({ figures: async () => { throw new Error('no db'); } });
    const fallback = await serveHomeSegments({ figures: down });
    expect(segment(fallback, 'legislative').liveCount).toBe(segment(snapshot, 'legislative').liveCount);
    expect(segment(fallback, 'legislative').liveCount).not.toBe(1234);
    expect(String(metricValue(segment(fallback, 'legislative'), 'Ministries'))).toBe(String(metricValue(segment(snapshot, 'legislative'), 'Ministries')));
  });
});
