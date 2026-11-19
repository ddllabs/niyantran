// F366 slice B: the verdict filter, the shown-result rule and the latest-claim pick are pure.
import { describe, expect, it } from 'vitest';
import { FILTER_KEYS, filterClaims, latestVerdictClaim, shownResult, verdictCounts } from './claimFilter.js';

const checked = (id, verdict, over = {}) => ({ id, claim_en: `claim ${id}`, status: 'checked', verdict, reason: 'r', sources: [], ...over });
const pending = (id) => ({ id, claim_en: `claim ${id}`, status: 'pending' });
const ctx = (over = {}) => ({ rechecks: {}, price: null, ...over });

describe('FILTER_KEYS', () => {
  it('are the five verdicts in the display order', () => {
    expect(FILTER_KEYS).toEqual(['supported', 'contradicted', 'partly_true', 'no_evidence', 'opinion']);
  });
});

describe('shownResult (the one rule for a re-checked claim)', () => {
  const claim = checked('a', 'supported');
  const newer = checked('a2', 'contradicted');
  it('is the claim itself without a price or without earlier results', () => {
    expect(shownResult(claim, undefined, false)).toBe(claim);
    expect(shownResult(claim, { results: [newer] }, false)).toBe(claim);
    expect(shownResult(claim, { results: [] }, true)).toBe(claim);
  });
  it('is the newest result when priced and results exist (the panel keeps them newest first)', () => {
    expect(shownResult(claim, { results: [newer, checked('a3', 'opinion')] }, true)).toBe(newer);
  });
});

describe('verdictCounts', () => {
  it('counts the five verdicts and ignores claims without one', () => {
    const claims = [checked('1', 'supported'), checked('2', 'supported'), checked('3', 'opinion'), pending('4'), { id: '5', status: 'error', fail_reason: 'no_sources' }];
    expect(verdictCounts(claims, ctx())).toEqual({ supported: 2, contradicted: 0, partly_true: 0, no_evidence: 0, opinion: 1 });
  });
  it('counts a re-checked claim by its newest result', () => {
    const claims = [checked('1', 'supported')];
    const c = ctx({ price: 5, rechecks: { 1: { results: [checked('1b', 'contradicted')] } } });
    expect(verdictCounts(claims, c)).toMatchObject({ supported: 0, contradicted: 1 });
  });
});

describe('filterClaims', () => {
  const claims = [checked('1', 'supported'), checked('2', 'contradicted'), pending('3'), checked('4', 'supported')];
  it('shows everything, verdict or not, when no filter is on', () => {
    expect(filterClaims(claims, [], ctx()).map((c) => c.id)).toEqual(['1', '2', '3', '4']);
  });
  it('keeps only the chosen verdicts, so claims without a verdict are hidden', () => {
    expect(filterClaims(claims, ['supported'], ctx()).map((c) => c.id)).toEqual(['1', '4']);
    expect(filterClaims(claims, ['supported', 'contradicted'], ctx()).map((c) => c.id)).toEqual(['1', '2', '4']);
  });
  it('is empty when nothing matches', () => {
    expect(filterClaims(claims, ['opinion'], ctx())).toEqual([]);
  });
  it('filters a re-checked claim by its newest result', () => {
    const c = ctx({ price: 5, rechecks: { 1: { results: [checked('1b', 'opinion')] } } });
    expect(filterClaims(claims, ['opinion'], c).map((x) => x.id)).toEqual(['1']);
    expect(filterClaims(claims, ['supported'], c).map((x) => x.id)).toEqual(['4']);
  });
});

describe('latestVerdictClaim', () => {
  it('is the newest claim with a verdict, skipping ones still being checked', () => {
    const claims = [checked('1', 'supported'), checked('2', 'opinion'), pending('3')];
    const got = latestVerdictClaim(claims, ctx());
    expect(got.claim.id).toBe('2');
    expect(got.badge).toMatchObject({ key: 'opinion', label: 'Opinion' });
  });
  it('is null with no verdict yet', () => {
    expect(latestVerdictClaim([pending('1')], ctx())).toBeNull();
    expect(latestVerdictClaim([], ctx())).toBeNull();
  });
  it('uses the newest result of a re-checked claim', () => {
    const c = ctx({ price: 5, rechecks: { 1: { results: [checked('1b', 'contradicted')] } } });
    expect(latestVerdictClaim([checked('1', 'supported')], c).badge.key).toBe('contradicted');
  });
});
