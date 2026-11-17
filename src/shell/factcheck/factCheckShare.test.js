// F344 S3: pure helpers for "Checked parts of this video": ranges, labels, the view-model of a part,
// the part that covers a position, and the plain words for unlock and report errors.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckError } from '../../lib/factcheck/client.js';
import {
  claimsLabel, coveringPart, dateLabel, formatPosition, formatRange, minutesLabel, partModel, reportErrorText, unlockErrorText, viewErrorText,
} from './factCheckShare.js';

describe('formatPosition / formatRange', () => {
  it.each([[0, '00:00'], [5, '00:05'], [65, '01:05'], [600, '10:00'], [3599, '59:59'], [3600, '1:00:00'], [3725, '1:02:05'], [36000, '10:00:00']])('%s -> %s', (s, out) => {
    expect(formatPosition(s)).toBe(out);
  });
  it('is 00:00 for bad numbers', () => {
    for (const v of [-4, Number.NaN, null, undefined, 'x']) expect(formatPosition(v)).toBe('00:00');
  });
  it('rounds fractions down', () => { expect(formatPosition(65.9)).toBe('01:05'); });
  it('joins a range with an en dash', () => {
    expect(formatRange(130, 460)).toBe('02:10–07:40');
    expect(formatRange(3500, 3700)).toBe('58:20–1:01:40');
  });
});

describe('labels', () => {
  it('minutes and claims in words', () => {
    expect(minutesLabel(1)).toBe('1 minute');
    expect(minutesLabel(7)).toBe('7 minutes');
    expect(minutesLabel(null)).toBe('');
    expect(claimsLabel(0)).toBe('No claims');
    expect(claimsLabel(1)).toBe('1 claim');
    expect(claimsLabel(12)).toBe('12 claims');
    expect(claimsLabel(undefined)).toBe('');
  });
  it('a date from a date or a timestamp, nothing for rubbish', () => {
    expect(dateLabel('2026-11-16')).toMatch(/16.*Nov|Nov.*16/);
    expect(dateLabel('2026-11-16')).toMatch(/2026/);
    expect(dateLabel('2026-01-01')).toMatch(/Jan/);
    expect(dateLabel('2026-01-01')).toMatch(/\b1\b/);
    expect(dateLabel('2026-11-16T10:00:00Z')).toMatch(/Nov/);
    expect(dateLabel('nope')).toBe('');
    expect(dateLabel(null)).toBe('');
  });
});

const lines = [{ pos_start_s: 130, text: 'first words' }, { pos_start_s: 140, text: 'more words' }];
const claims = [{ id: 'k1', position_s: 135, claim_en: 'A', status: 'checked', verdict: 'supported', sources: [], reported: false }];
const stretch = (over = {}) => ({
  stretch_id: 's1', from_s: 130, to_s: 460, minutes: 6, checked_on: '2026-11-16', claims_count: 1, access: 'locked', price: 600, ...over,
});

describe('partModel', () => {
  it('own: readable, free, with lines and cards, not reportable', () => {
    const m = partModel(stretch({ access: 'own', lines, claims }));
    expect(m).toMatchObject({ id: 's1', range: '02:10–07:40', minutes: '6 minutes', claimsLabel: '1 claim', access: 'own', readable: true, locked: false, reportable: false });
    expect(m.lines).toHaveLength(2);
    expect(m.claims).toHaveLength(1);
    expect(m.priceLabel).toBeNull();
    expect(m.date).toMatch(/Nov/);
  });
  it('unlocked: readable and reportable', () => {
    const m = partModel(stretch({ access: 'unlocked', lines, claims }));
    expect(m).toMatchObject({ readable: true, locked: false, reportable: true });
  });
  it('locked: shows the price and never any text, even if the server sent some', () => {
    const m = partModel(stretch({ access: 'locked', lines, claims, price: 600 }));
    expect(m).toMatchObject({ locked: true, readable: false, reportable: false, priceLabel: 'Unlock · 600 credits', price: 600 });
    expect(m.lines).toEqual([]);
    expect(m.claims).toEqual([]);
  });
  it('an unknown access is treated as locked', () => {
    expect(partModel(stretch({ access: 'weird', lines, claims })).readable).toBe(false);
  });
  it('a one-credit price reads "1 credit"', () => {
    expect(partModel(stretch({ price: 1 })).priceLabel).toBe('Unlock · 1 credit');
  });
});

describe('coveringPart', () => {
  const parts = [stretch({ stretch_id: 'a', from_s: 100, to_s: 200 }), stretch({ stretch_id: 'b', from_s: 300, to_s: 400 })];
  it('finds the part whose range holds the position, ends included', () => {
    expect(coveringPart(parts, 150)?.stretch_id).toBe('a');
    expect(coveringPart(parts, 100)?.stretch_id).toBe('a');
    expect(coveringPart(parts, 400)?.stretch_id).toBe('b');
  });
  it('is null between parts, or for no position', () => {
    expect(coveringPart(parts, 250)).toBeNull();
    expect(coveringPart(parts, null)).toBeNull();
    expect(coveringPart(parts, undefined)).toBeNull();
    expect(coveringPart([], 10)).toBeNull();
  });
  it('the first (newest) wins when two overlap', () => {
    expect(coveringPart([stretch({ stretch_id: 'n', from_s: 0, to_s: 100 }), stretch({ stretch_id: 'o', from_s: 0, to_s: 100 })], 50)?.stretch_id).toBe('n');
  });
});

describe('view error words', () => {
  it('a rate limit and anything else', () => {
    expect(viewErrorText(new FactCheckError(429, 'rate_limited'))).toBe('Too many lookups just now. Wait a minute and try again.');
    expect(viewErrorText(new FactCheckError(500, 'server_error'))).toBe('The checked parts could not be loaded. Try again later.');
    expect(viewErrorText(undefined)).toBe('The checked parts could not be loaded. Try again later.');
  });
});

describe('error words', () => {
  const err = (status, reason, extra) => new FactCheckError(status, reason, extra);
  it.each([
    [err(402, 'insufficient', { needed: 600, available: 250 }), 'Not enough credits: this needs 600 credits and you have 250 credits.'],
    [err(409, 'own'), 'You ran this part yourself, so it is already yours.'],
    [err(409, 'price_changed'), 'The price changed. Review it and unlock again.'],
    [err(429, 'rate_limited'), 'Too many tries just now. Wait a minute and try again.'],
    [err(404, 'not_found'), 'This part could no longer be found.'],
    [err(404, 'claim_not_found'), 'This part could no longer be found.'],
    [err(403, 'off'), 'Shared results are switched off.'],
    [err(403, 'not_allowed'), 'Shared results are not available for this account.'],
    [err(401, 'signed_out'), 'Your sign-in has expired. Sign in again.'],
    [err(0, 'network'), 'The server did not answer. If you were charged, your balance will show it.'],
    [err(500, 'server_error'), 'Something went wrong on the server. If you were charged, your balance will show it.'],
  ])('unlock %#', (e, text) => { expect(unlockErrorText(e)).toBe(text); });
  it.each([
    [err(409, 'already'), 'You have already reported this verdict.'],
    [err(429, 'rate_limited'), 'You have sent many reports today. Try again tomorrow.'],
    [err(404, 'not_found'), 'This verdict could no longer be found.'],
    [err(404, 'claim_not_found'), 'This verdict could no longer be found.'],
    [err(403, 'off'), 'Shared results are switched off.'],
    [err(0, 'network'), 'The report could not be sent. Check your connection and try again.'],
    [err(500, 'server_error'), 'The report could not be sent. Try again later.'],
  ])('report %#', (e, text) => { expect(reportErrorText(e)).toBe(text); });
});
