import { describe, expect, it } from 'vitest';
import {
  rowTitle, rowFields, effectivePlan, creditsSummary, planAllows, recordAttachment, splitCitationMarkers,
  normalizeBrief, mergeFigures, hostOf, pickColumns,
} from './shape.js';

describe('records', () => {
  it('titles a record from its most telling field', () => {
    expect(rowTitle({ bill_name: 'The Tribunals Reforms Bill, 2026', house: 'Lok Sabha' })).toBe('The Tribunals Reforms Bill, 2026');
    expect(rowTitle({ name: 'S&P 500', last: 7697 })).toBe('S&P 500');
    expect(rowTitle({}, 'Fallback')).toBe('Fallback');
  });
  it('shows a value once even when two fields carry it', () => {
    const f = rowFields({ bill_name: 'X Bill', title: 'X Bill', date: '2026-08-10', date_introduced: '2026-08-10T00:00:00+05:30', house: 'Lok Sabha', source_url: 'https://sansad.in' });
    expect(f.map((x) => x.key)).toEqual(['bill_name', 'date', 'house']);
  });
  it('picks columns from the rows when the feed sends none', () => {
    const cols = pickColumns([{ bill_name: 'A', house: 'LS', id: 1 }, { bill_name: 'B', house: 'RS' }]);
    expect(cols.map((c) => c.key)).toEqual(['bill_name', 'house']);
  });
  it('keeps a record attachment inside research-chat limits', () => {
    const row = Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`f${i}`, 'x'.repeat(900)]));
    const a = recordAttachment({ row, module: { title: 'M', feature: 'M', desk: 'national' } });
    expect(a.kind).toBe('row');
    expect(a.text.length).toBeLessThanOrEqual(40000);
    expect(a.text.split('\n').length).toBe(65); // module line + 64 fields
    expect(a.text.split('\n')[1].length).toBeLessThanOrEqual(504);
    expect(a.tier).toBe('national');
  });
  it('reads hosts safely', () => {
    expect(hostOf('https://www.sansad.in/ls')).toBe('sansad.in');
    expect(hostOf('not a url')).toBe('');
  });
});

describe('plans and credits', () => {
  const future = new Date(Date.now() + 864e5).toISOString();
  it('counts a paid plan only while it is active and in date', () => {
    expect(effectivePlan(null)).toBe('free');
    expect(effectivePlan({ plan: 'pro', status: 'active', access_until: future })).toBe('pro');
    expect(effectivePlan({ plan: 'pro', status: 'active', lapsed: true })).toBe('free');
    expect(effectivePlan({ plan: 'pro', status: 'active', access_until: '2020-01-01' })).toBe('free');
    expect(effectivePlan({ plan: 'plus', status: 'cancelled' })).toBe('free');
  });
  it('gates models by plan, treating a missing minimum as Plus', () => {
    expect(planAllows('free', 'free')).toBe(true);
    expect(planAllows('free', undefined)).toBe(false);
    expect(planAllows('plus', 'plus')).toBe(true);
    expect(planAllows('pro', 'max')).toBe(false);
  });
  it('works out available credits and the low-balance warning', () => {
    const c = creditsSummary({ balance: 12000, held: 500, cycle: { allowance: 65000, ends_at: future }, used_this_cycle: 53000 });
    expect(c.available).toBe(11500);
    expect(c.low).toBe(false);
    expect(creditsSummary({ balance: 1500, held: 0, cycle: { allowance: 10000 } }).low).toBe(true);
  });
});

describe('citations and briefs', () => {
  it('splits markers like the server writes them', () => {
    expect(splitCitationMarkers('A [1] and [2, 3] then [4-6].')).toEqual(['A ', { citation: 1 }, ' and ', { citation: 2 }, { citation: 3 }, ' then ', { citation: 4 }, { citation: 5 }, { citation: 6 }, '.']);
    expect(splitCitationMarkers('a [link](https://x.y) and [0] stay text')).toEqual(['a [link](https://x.y) and [0] stay text']);
  });
  it('reads both brief formats', () => {
    expect(normalizeBrief({ state: 'ready', format: 2, brief: 'Lead', why: 'W', watch: 'X', tags: ['t'] })).toMatchObject({ lead: 'Lead', why: 'W', watch: 'X', tags: ['t'] });
    expect(normalizeBrief({ state: 'ready', format: 1, headline: 'H', points: ['a', 'b'] })).toMatchObject({ lead: 'H', points: ['a', 'b'] });
    expect(normalizeBrief({ state: 'missing' })).toBeNull();
  });
  it('takes live site figures only when they are sensible', () => {
    expect(mergeFigures({ bills: 9900, ministries: -1 })).toMatchObject({ bills: 9900, ministries: 56, modules: 120 });
  });
});
