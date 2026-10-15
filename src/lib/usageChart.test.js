// F153: the Credits usage chart's model - buckets, stacking, the top seven plus Other, stable colours,
// legend toggles, ticks and highlights (docs/specs/2026-10-14-credits-usage-page.md, Charts).
import { describe, expect, it } from 'vitest';
import { MAX_SERIES, OTHER, OTHER_SLOT, bucketLabel, bucketTotals, buildChart, colorSlots, highlights, niceTicks, shareText } from './usageChart.js';

const p = (bucket, model, credits, calls = 1, tokens = 100) => ({ bucket, model, credits, calls, tokens });
const empty = (bucket) => ({ bucket, model: null, credits: 0, calls: 0, tokens: 0 });

const POINTS = [
  empty('2026-10-12'),
  p('2026-10-13', 'google/gemini-3.7-flash', 30, 3, 3000),
  p('2026-10-13', 'anthropic/claude-sonnet-5', 10, 1, 500),
  p('2026-10-14', 'google/gemini-3.7-flash', 20, 2, 2000),
  p('2026-10-14', 'openai/whisper-large-v3-turbo', 0, 2, 50),
];

describe('buildChart', () => {
  it('keeps every bucket the server sent, in order, the empty ones too', () => {
    const chart = buildChart(POINTS);
    expect(chart.buckets.map((b) => b.bucket)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(chart.buckets[0]).toMatchObject({ total: 0, segments: [] });
    expect(chart.buckets.map((b) => b.label)).toEqual(['12 Oct', '13 Oct', '14 Oct']);
  });

  it('stacks each bucket by series for the chosen measure, largest series first', () => {
    const chart = buildChart(POINTS, { measure: 'credits' });
    expect(chart.series.map((s) => [s.label, s.total])).toEqual([['Gemini 3.7 Flash', 50], ['Claude Sonnet 5', 10], ['Whisper Large V3 Turbo', 0]]);
    const day = chart.buckets[1];
    expect(day.total).toBe(40);
    expect(day.segments.map((s) => [s.label, s.y0, s.y1])).toEqual([['Gemini 3.7 Flash', 0, 30], ['Claude Sonnet 5', 30, 40]]);
    expect(chart.grand).toBe(60);
    expect(Math.round(chart.series[0].share)).toBe(83);
  });

  it('switches measure without changing the buckets', () => {
    const calls = buildChart(POINTS, { measure: 'calls' });
    expect(calls.buckets.map((b) => b.total)).toEqual([0, 4, 4]);
    expect(calls.series[0].label).toBe('Gemini 3.7 Flash');
    const tokens = buildChart(POINTS, { measure: 'tokens' });
    expect(tokens.buckets[2].total).toBe(2050);
  });

  it('groups by provider on request', () => {
    const chart = buildChart(POINTS, { groupBy: 'provider' });
    expect(chart.series.map((s) => s.label)).toEqual(['Google', 'Anthropic', 'OpenAI']);
  });

  it('gives the seven largest a colour of their own and folds the rest into Other', () => {
    const many = Array.from({ length: 10 }, (_, i) => p('2026-10-14', `vendor/model-${i}`, 100 - i));
    const chart = buildChart(many);
    expect(chart.series).toHaveLength(MAX_SERIES + 1);
    const other = chart.series.at(-1);
    expect(other).toMatchObject({ key: OTHER, label: 'Other', slot: OTHER_SLOT, total: 93 + 92 + 91 });
    expect(new Set(chart.series.slice(0, MAX_SERIES).map((s) => s.slot)).size).toBe(MAX_SERIES);
    expect(chart.buckets[0].segments.find((s) => s.key === OTHER).value).toBe(276);
  });

  it('leaves Other out of the legend when the models past the seventh have nothing on this measure', () => {
    const many = Array.from({ length: 10 }, (_, i) => p('2026-10-14', `vendor/model-${i}`, i < MAX_SERIES ? 100 - i : 0));
    const chart = buildChart(many);
    expect(chart.series).toHaveLength(MAX_SERIES);
    expect(chart.series.some((s) => s.key === OTHER)).toBe(false);
  });

  it('hides a toggled series from the bars and the scale, but keeps it in the legend', () => {
    const shown = buildChart(POINTS);
    const hidden = buildChart(POINTS, { hidden: new Set(['google/gemini-3.7-flash']) });
    expect(hidden.series[0]).toMatchObject({ key: 'google/gemini-3.7-flash', hidden: true, total: 50 });
    expect(hidden.buckets[1].segments.map((s) => s.key)).toEqual(['anthropic/claude-sonnet-5']);
    expect(hidden.buckets[1].total).toBe(10);
    expect(hidden.ticks.at(-1)).toBeLessThan(shown.ticks.at(-1));
    // Toggled back, the chart is as before.
    expect(buildChart(POINTS, { hidden: new Set() })).toEqual(shown);
  });

  it('says when there is nothing to draw', () => {
    expect(buildChart([empty('2026-10-14')]).empty).toBe(true);
    expect(buildChart(null).buckets).toEqual([]);
  });

  it('labels months for the lifetime range', () => {
    expect(bucketLabel('2026-09-01', 'month')).toMatch(/Sept? 2026/);
    expect(buildChart([p('2026-10-01', 'a/b', 1)], { bucketKind: 'month' }).buckets[0].label).toMatch(/Oct 2026/);
  });
});

describe('colours', () => {
  it('are stable for a model whatever else is in the range, unless two collide', () => {
    const a = colorSlots(['google/gemini-3.7-flash', 'anthropic/claude-sonnet-5']);
    const b = colorSlots(['anthropic/claude-sonnet-5', 'google/gemini-3.7-flash']);
    expect(a).toEqual(b);
    const alone = colorSlots(['google/gemini-3.7-flash']);
    const crowd = colorSlots(['google/gemini-3.7-flash', 'deepseek/deepseek-v4-flash']);
    expect([...new Set(crowd.values())]).toHaveLength(2);
    if (alone.get('google/gemini-3.7-flash') !== crowd.get('google/gemini-3.7-flash')) {
      // Only a hash collision with a key sorted before it may move it.
      expect(crowd.get('deepseek/deepseek-v4-flash')).toBe(alone.get('google/gemini-3.7-flash'));
    }
  });
});

describe('niceTicks', () => {
  it('gives zero and four round steps reaching the top', () => {
    expect(niceTicks(40)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(47)).toEqual([0, 20, 40, 60, 80]);
    expect(niceTicks(9)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(2270000).at(-1)).toBeGreaterThanOrEqual(2270000);
  });
});

describe('highlights', () => {
  const summary = {
    byModel: [
      { model: 'google/gemini-3.7-flash', provider: 'google', credits: 300, calls: 30 },
      { model: 'anthropic/claude-sonnet-5', provider: 'anthropic', credits: 600, calls: 4 },
      { model: 'google/gemini-3.5-flash-lite', provider: 'google', credits: 20, calls: 10 },
      { model: 'openai/text-embedding-3-small', provider: 'openai', credits: 0.5, calls: 50 },
    ],
  };
  it('names the top provider by credits, the most used model and the best value with at least 5 calls', () => {
    const h = highlights(summary);
    expect(h.topProvider.provider).toBe('anthropic');
    expect(Math.round(h.topProvider.share)).toBe(65);
    expect(highlights({ byModel: [{ model: 'openai/text-embedding-3-small', provider: 'openai', credits: 1, calls: 9 }] }).topProvider.provider).toBe('openai');
    // The embedding model (50 calls) is plumbing, not a model anyone picks: left out of both.
    expect(h.mostUsed).toEqual({ model: 'google/gemini-3.7-flash', calls: 30 });
    // Sonnet has only 4 calls, so it does not qualify.
    expect(h.bestValue).toEqual({ model: 'google/gemini-3.5-flash-lite', perCall: 2 });
  });
  it('is empty without usage', () => {
    expect(highlights({ byModel: [] })).toEqual({ topProvider: null, mostUsed: null, bestValue: null });
  });
});

describe('small helpers', () => {
  it('totals each bucket for the sparkline and writes shares', () => {
    expect(bucketTotals(POINTS)).toEqual([{ bucket: '2026-10-12', value: 0 }, { bucket: '2026-10-13', value: 40 }, { bucket: '2026-10-14', value: 20 }]);
    expect([shareText(0), shareText(0.4), shareText(37.6)]).toEqual(['0%', '<1%', '38%']);
  });
});
