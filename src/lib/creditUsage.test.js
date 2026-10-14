// F153: the Credits usage page's data - IST ranges, the report shapes (credits only), the CSV and the
// report calls (docs/specs/2026-10-14-credits-usage-page.md, Data).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userId: 'u1', rpc: null }));
vi.mock('./supabaseClient.js', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: state.userId ? { user: { id: state.userId } } : null } }) },
    rpc: (...args) => state.rpc(...args),
  },
}));

import { activityCsv } from './usageCsv.js';
import {
  beforeCredits, formatTokens, indianNumber, loadAllActivity, loadUsageActivity, loadUsageSeries, loadUsageSummary,
  modelName, providerOf, rangeWindow, rowChat, shapeActivity, shapeSeries, shapeSummary,
} from './creditUsage.js';

beforeEach(() => {
  state.userId = 'u1';
  state.rpc = vi.fn(async () => ({ data: null, error: null }));
});
afterEach(() => vi.restoreAllMocks());

describe('rangeWindow', () => {
  // 14 Oct 2026, 02:00 IST is still 13 Oct in UTC.
  const now = Date.parse('2026-10-13T20:30:00Z');
  it('ends now and starts at IST midnight, today included', () => {
    expect(rangeWindow('7d', now)).toEqual({ range: '7d', from: '2026-10-07T18:30:00.000Z', to: '2026-10-13T20:30:00.000Z', bucket: 'day' });
    expect(rangeWindow('30d', now).from).toBe('2026-09-14T18:30:00.000Z');
    expect(rangeWindow('90d', now).from).toBe('2026-07-16T18:30:00.000Z');
  });
  it('asks for lifetime by month, and treats an unknown range as 30 days', () => {
    expect(rangeWindow('lifetime', now)).toMatchObject({ from: null, bucket: 'month' });
    expect(rangeWindow('nonsense', now).range).toBe('30d');
  });
});

describe('shapes', () => {
  it('keeps only the credit fields of a summary, so a stray dollar key cannot reach the page', () => {
    const s = shapeSummary({
      credits: '66.5', calls: 9, failed_calls: 2, tokens: 4660, answers: 3, answers_free: 1, web_searches: 2, web_search_credits: 9.5,
      models_used: 6, providers: 4, lifetime_credits: 66.5, cost_usd: 0.07,
      by_model: [{ model: 'google/gemini-3.7-flash', provider: 'google', credits: 47.5, calls: 3, tokens: 3000, cost_usd: 0.05 }],
      by_feature: [{ feature: 'research', calls: 7, credits: 66.5, searches: 2 }],
    });
    expect(s).toMatchObject({ credits: 66.5, calls: 9, failedCalls: 2, answersFree: 1, webSearchCredits: 9.5, lifetimeCredits: 66.5 });
    expect(JSON.stringify(s)).not.toMatch(/usd|cost|0\.07|0\.05/i);
    expect(shapeSummary(null)).toBeNull();
  });

  it('reads the series and the activity rows', () => {
    expect(shapeSeries({ bucket: 'month', series: [{ bucket_start: '2026-09-01', model: null, credits: 0, calls: 0, tokens: 0 }] }))
      .toEqual({ bucket: 'month', points: [{ bucket: '2026-09-01', model: null, credits: 0, calls: 0, tokens: 0 }] });
    const a = shapeActivity({ total: 1, rows: [{ turn_key: 'a1', created_at: '2026-10-14T06:00:00Z', conversation_id: 'c1', title: 'Rate cut',
      question: 'Q', status: 'succeeded', model: 'm', calls: 2, tokens: 10, credits: 5, detail: [{ role: 'answer', model: 'm', effort: 'low', tokens: 5, credits: 5, free: false, status: 'succeeded' }] }] });
    expect(a.rows[0]).toMatchObject({ turnKey: 'a1', conversationId: 'c1', detail: [{ role: 'answer', effort: 'low', free: false }] });
    expect(shapeActivity({ rows: 'x' })).toBeNull();
  });
});

describe('words and numbers', () => {
  it('abbreviates tokens and groups them the Indian way', () => {
    expect([formatTokens(950), formatTokens(12400), formatTokens(2270000), formatTokens(1.1e9)]).toEqual(['950', '12.4K', '2.27M', '1.1B']);
    expect(indianNumber(2270000)).toBe('22,70,000');
  });
  it('names models and providers', () => {
    expect(modelName('google/gemini-3.7-flash')).toBe('gemini-3.7-flash');
    expect(modelName('unknown')).toBe('Unknown model');
    expect(providerOf('~openai/gpt-luna-latest')).toBe('openai');
    expect(providerOf('whisper')).toBe('other');
  });
  it('names the chat of a row: its title, untitled, deleted, or dictation', () => {
    expect(rowChat({ title: 'Rate cut', conversationId: 'c1', turnKey: 'a1' })).toBe('Rate cut');
    expect(rowChat({ title: null, conversationId: 'c1', turnKey: 'a1' })).toBe('Untitled');
    expect(rowChat({ title: null, conversationId: null, turnKey: 'a1' })).toBe('Deleted conversation');
    expect(rowChat({ title: null, conversationId: null, turnKey: null })).toBe('Dictation');
  });
  it('knows which rows predate credits', () => {
    expect(beforeCredits('2026-10-14T05:45:59Z')).toBe(true);
    expect(beforeCredits('2026-10-14T05:46:00Z')).toBe(false);
    expect(beforeCredits(null)).toBe(false);
  });
});

describe('activityCsv', () => {
  const rows = [
    { turnKey: 'a1', createdAt: '2026-10-14T06:30:00Z', conversationId: 'c1', title: 'Rate cut, "again"', question: '=HYPERLINK("x")',
      status: 'succeeded', model: 'google/gemini-3.7-flash', calls: 2, tokens: 3010, credits: 47.5,
      detail: [
        { role: 'search', model: 'openai/text-embedding-3-small', effort: null, tokens: 10, credits: 0, free: false, status: 'succeeded' },
        { role: 'answer', model: 'google/gemini-3.7-flash', effort: 'low', tokens: 3000, credits: 47.5, free: false, status: 'succeeded' },
      ] },
    { turnKey: 'c1', createdAt: '2026-10-14T07:00:00Z', conversationId: null, title: null, question: null, status: 'failed',
      model: null, calls: 1, tokens: 0, credits: 0, detail: [{ role: 'repair', model: 'm', effort: null, tokens: 0, credits: 0, free: true, status: 'failed' }] },
    { turnKey: null, createdAt: '2026-10-14T08:00:00Z', conversationId: null, title: null, question: null, status: 'succeeded',
      model: 'openai/whisper-large-v3-turbo', calls: 1, tokens: 50, credits: 0, detail: [] },
  ];
  const lines = (csv) => csv.trimEnd().split('\r\n');

  it('writes credits only, in IST, never rupees or dollars (F184)', () => {
    const csv = activityCsv(rows);
    const out = lines(csv);
    expect(out[0]).toBe('When (IST),Chat,Question,Kind,Model,Thinking,Status,Calls,Tokens,Credits');
    expect(out[1]).toBe(`2026-10-14 12:00,"Rate cut, ""again""","'=HYPERLINK(""x"")",Row,google/gemini-3.7-flash,,Succeeded,2,3010,47.5`);
    expect(out[2]).toBe(',,,Search and plan,openai/text-embedding-3-small,,Succeeded,1,10,0');
    expect(out[3]).toBe(',,,Answer,google/gemini-3.7-flash,low,Succeeded,1,3000,47.5');
    expect(out[4]).toMatch(/^2026-10-14 12:30,Deleted conversation,,Row,,,Failed,1,0,0$/);
    expect(out[5]).toMatch(/^,,,Repair,m,,Failed,1,0,0$/);
    expect(out[6]).toMatch(/^2026-10-14 13:30,Dictation,,Row,openai\/whisper-large-v3-turbo,,Succeeded,1,50,0$/);
    expect(csv).not.toMatch(/\$|usd|dollar|₹|rupee/i);
  });

  it('leaves the calls out when ungrouped', () => {
    const out = lines(activityCsv(rows, { withCalls: false }));
    expect(out).toHaveLength(4);
    expect(out[1].endsWith(',47.5')).toBe(true);
  });
});

describe('the report calls', () => {
  it('ask each report for the signed-in user with the clamped arguments', async () => {
    state.rpc = vi.fn(async (name) => ({ data: name === 'my_usage_activity' ? { total: 0, rows: [] } : name === 'my_usage_timeseries' ? { bucket: 'day', series: [] } : { credits: 1 }, error: null }));
    expect(await loadUsageSummary('2026-10-01T00:00:00Z', null)).toMatchObject({ credits: 1 });
    expect(await loadUsageSeries(null, '2026-10-14T00:00:00Z', 'week')).toEqual({ bucket: 'day', points: [] });
    expect(await loadUsageActivity({ offset: 50, grouped: false, model: '', status: 'failed', kind: 'dictation' })).toEqual({ total: 0, rows: [] });
    expect(state.rpc.mock.calls).toEqual([
      ['my_usage_summary', { p_from: '2026-10-01T00:00:00Z', p_to: null }],
      ['my_usage_timeseries', { p_from: null, p_to: '2026-10-14T00:00:00Z', p_bucket: 'day' }],
      ['my_usage_activity', { p_offset: 50, p_limit: 50, p_grouped: false, p_model: null, p_status: 'failed', p_kind: 'dictation' }],
    ]);
  });

  it('give null on an error, a throw or when nobody is signed in', async () => {
    state.rpc = vi.fn(async () => ({ data: null, error: { message: 'no' } }));
    expect(await loadUsageSummary(null, null)).toBeNull();
    state.rpc = vi.fn(async () => { throw new Error('offline'); });
    expect(await loadUsageActivity()).toBeNull();
    state.userId = null;
    state.rpc = vi.fn();
    expect(await loadUsageSeries(null, null, 'day')).toBeNull();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('reads every page for the export, a hundred at a time, up to the cap', async () => {
    const row = (i) => ({ turn_key: `t${i}`, created_at: '2026-10-14T06:00:00Z', status: 'succeeded', calls: 1, tokens: 1, credits: 1, detail: [] });
    state.rpc = vi.fn(async (_n, args) => ({ data: { total: 230, rows: Array.from({ length: Math.min(100, 230 - args.p_offset) }, (_, i) => row(args.p_offset + i)) }, error: null }));
    const all = await loadAllActivity({ grouped: true, status: 'all', kind: 'all' });
    expect(all).toHaveLength(230);
    expect(state.rpc.mock.calls.map((c) => [c[1].p_offset, c[1].p_limit])).toEqual([[0, 100], [100, 100], [200, 100]]);
    expect(await loadAllActivity({}, 150)).toHaveLength(150);
    state.rpc = vi.fn(async () => ({ data: null, error: { message: 'no' } }));
    expect(await loadAllActivity({})).toBeNull();
  });
});
