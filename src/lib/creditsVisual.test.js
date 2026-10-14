import { describe, expect, it } from 'vitest';
import { groupByChat, heatmapCells, paceModel, periodBar, roleSegments, statusMessages } from './creditsVisual.js';

// F184 (owner 2026-10-15): the credits page's pictures, as pure functions of data the client
// already has (my_credits, my_usage_timeseries, my_usage_activity).
const DAY = 86400000;
const CREDITS = {
  balance: 880, held: 20, available: 860, plan: 'plus', allowance: 2000, usedThisCycle: 1240,
  cycleStartsAt: '2026-10-12T18:30:00Z', cycleEndsAt: '2026-11-11T18:30:00Z',
  lots: [
    { kind: 'monthly', remaining: 760, expiresAt: '2026-11-11T18:30:00Z' },
    { kind: 'rollover', remaining: 120, expiresAt: '2026-11-11T18:30:00Z' },
  ],
};

describe('periodBar', () => {
  it('splits the period into used, held and what is left by kind, held taken from the first lot', () => {
    const bar = periodBar(CREDITS);
    expect(bar.total).toBe(2120);
    expect(bar.segments.map((s) => [s.key, s.value])).toEqual([['used', 1240], ['held', 20], ['monthly', 740], ['rollover', 120]]);
    expect(bar.left).toBe(860);
    expect(bar.overdrawn).toBe(0);
  });

  it('shows an overdrawn balance as its own amount, and nothing left', () => {
    const bar = periodBar({ ...CREDITS, balance: -50, held: 0, available: -50, usedThisCycle: 2050, lots: [] });
    expect(bar.segments.map((s) => s.key)).toEqual(['used']);
    expect(bar.overdrawn).toBe(50);
    expect(bar.left).toBe(0);
  });

  it('copes with no cycle and no lots', () => {
    const bar = periodBar({ balance: 0, held: 0, usedThisCycle: null, lots: [] });
    expect(bar.total).toBe(0);
    expect(bar.segments).toEqual([]);
  });
});

describe('paceModel', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const points = [
    { bucket: '2026-10-13', credits: 100 }, { bucket: '2026-10-13', credits: 20 },
    { bucket: '2026-10-18', credits: 500 }, { bucket: '2026-10-24', credits: 620 },
  ];

  it('accumulates credits per day from the period start and draws the even pace', () => {
    const m = paceModel({ credits: CREDITS, points, now });
    expect(m.totalDays).toBe(30);
    expect(m.days[0]).toEqual({ day: 0, date: '2026-10-13', cumulative: 120 });
    expect(m.days[5].cumulative).toBe(620);
    expect(m.days.at(-1)).toEqual({ day: 11, date: '2026-10-24', cumulative: 1240 });
    expect(m.total).toBe(2120);
    expect(Math.round(m.evenToday)).toBe(Math.round(2120 * 12 / 30));
  });

  it('estimates the run-out day at the average daily rate when it falls before renewal', () => {
    const m = paceModel({ credits: CREDITS, points, now });
    // 1,240 over 12 days is about 103 a day; 860 left lasts about 8.3 days.
    expect(m.projection.runOutAt.slice(0, 10)).toBe('2026-11-01');
    expect(m.projection.leftAtRenewal).toBeNull();
  });

  it('estimates what is left at renewal when credits last the period', () => {
    const m = paceModel({ credits: { ...CREDITS, usedThisCycle: 240, balance: 1880, available: 1860 }, points: [{ bucket: '2026-10-20', credits: 240 }], now });
    expect(m.projection.runOutAt).toBeNull();
    expect(m.projection.leftAtRenewal).toBeGreaterThan(1000);
  });

  it('makes no estimate before three days or without a period', () => {
    expect(paceModel({ credits: CREDITS, points, now: Date.parse('2026-10-14T12:00:00Z') }).projection).toBeNull();
    expect(paceModel({ credits: { ...CREDITS, cycleStartsAt: null }, points, now })).toBeNull();
  });
});

describe('heatmapCells', () => {
  it('gives one cell per IST day, oldest first, with five levels against the busiest day', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const cells = heatmapCells([{ bucket: '2026-10-24', credits: 100 }, { bucket: '2026-10-24', credits: 60 }, { bucket: '2026-10-20', credits: 40 }], now, 90);
    expect(cells).toHaveLength(90);
    expect(cells.at(-1)).toMatchObject({ date: '2026-10-24', value: 160, level: 4 });
    expect(cells.at(-5)).toMatchObject({ date: '2026-10-20', value: 40, level: 1 });
    expect(cells[0]).toMatchObject({ value: 0, level: 0 });
    expect(Date.parse(cells[1].date) - Date.parse(cells[0].date)).toBe(DAY);
  });
});

describe('groupByChat', () => {
  it('totals the rows of each chat, most credits first, and keeps the latest time', () => {
    const rows = [
      { conversationId: 'a', title: 'GST', credits: 10, calls: 2, createdAt: '2026-10-20T10:00:00Z' },
      { conversationId: 'b', title: 'Bills', credits: 40, calls: 3, createdAt: '2026-10-21T10:00:00Z' },
      { conversationId: 'a', title: 'GST', credits: 35, calls: 1, createdAt: '2026-10-22T10:00:00Z' },
      { conversationId: null, title: null, credits: 0, calls: 1, createdAt: '2026-10-23T10:00:00Z', kind: 'dictation' },
    ];
    expect(groupByChat(rows).map((c) => [c.key, c.credits, c.answers, c.calls, c.latest])).toEqual([
      ['a', 45, 2, 3, '2026-10-22T10:00:00Z'],
      ['b', 40, 1, 3, '2026-10-21T10:00:00Z'],
      ['none', 0, 1, 1, '2026-10-23T10:00:00Z'],
    ]);
  });
});

describe('roleSegments', () => {
  it('sums the calls of an answer by role, in a fixed order, free calls marked', () => {
    const segs = roleSegments([
      { role: 'answer', model: 'anthropic/claude-sonnet', effort: 'high', credits: 58, free: false },
      { role: 'search', model: 'google/gemini-flash', effort: 'low', credits: 12, free: false },
      { role: 'search', model: 'google/gemini-flash', effort: 'low', credits: 6, free: false },
      { role: 'repair', model: 'google/gemini-flash', effort: null, credits: 0, free: true },
    ]);
    expect(segs.map((s) => [s.role, s.credits, s.calls, s.free])).toEqual([['search', 18, 2, false], ['answer', 58, 1, false], ['repair', 0, 1, true]]);
    expect(segs[1].model).toBe('anthropic/claude-sonnet');
  });
});

describe('statusMessages', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  it('says nothing when all is well', () => {
    expect(statusMessages({ credits: { ...CREDITS, held: 0 }, now })).toEqual([]);
  });
  it('keeps every message the app shows today', () => {
    const keys = (c, extra = {}) => statusMessages({ credits: c, now, ...extra }).map((m) => m.key);
    expect(keys({ ...CREDITS, balance: 150, available: 150, held: 0 })).toEqual(['low']);
    expect(keys({ ...CREDITS, balance: 0, available: 0, held: 0 })).toEqual(['empty']);
    expect(keys({ ...CREDITS, balance: -40, available: -40, held: 0 })).toEqual(['overdrawn']);
    expect(keys(CREDITS, { now: Date.parse('2026-11-08T12:00:00Z') })).toEqual(['held', 'renews']);
    expect(keys(null, { failed: true })).toEqual(['unchecked']);
  });
});

describe('modelLabel', () => {
  it('turns a model id into a readable name', async () => {
    const { modelLabel } = await import('./creditUsage.js');
    expect(modelLabel('google/gemini-3.7-flash')).toBe('Gemini 3.7 Flash');
    expect(modelLabel('anthropic/claude-sonnet-4.6')).toBe('Claude Sonnet 4.6');
    expect(modelLabel('deepseek/deepseek-v4-flash')).toBe('DeepSeek V4 Flash');
    expect(modelLabel('openai/gpt-5-mini')).toBe('GPT-5 Mini');
    expect(modelLabel('openai/whisper-large-v3-turbo')).toBe('Whisper Large V3 Turbo');
    expect(modelLabel(null)).toBe('Unknown model');
  });
});
