// B3: the numbers of the Summary tab, from the claims the panel already holds.
import { describe, expect, it } from 'vitest';
import { summarizeClaims, summarySentence } from './claimSummary.js';

const c = (id, status, verdict = null, extra = {}) => ({ id, status, verdict, claim_en: `Claim ${id}`, ...extra });
const ctx = { rechecks: {}, price: null };

describe('summarizeClaims', () => {
  it('counts verdicts and the other statuses', () => {
    const s = summarizeClaims([
      c('1', 'checked', 'supported'), c('2', 'checked', 'supported'), c('3', 'checked', 'contradicted'),
      c('4', 'checked', 'partly_true'), c('5', 'checked', 'opinion'), c('6', 'checked', 'no_evidence'),
      c('7', 'not_checkable'), c('8', 'unchecked'), c('9', 'pending'), c('10', 'needs_context'), c('11', 'error'),
      c('12', 'error', null, { fail_reason: 'no_sources' }),
    ], ctx);
    expect(s.total).toBe(12);
    expect(s.verdicts).toEqual({ supported: 2, contradicted: 1, partly_true: 1, no_evidence: 1, opinion: 1 });
    expect(s.withVerdict).toBe(6);
    expect(s).toMatchObject({ notCheckable: 1, notChecked: 1, checking: 1, needsContext: 1, failed: 1, noSources: 1 });
  });
  it('uses the newest re-check result when the panel is priced, as the cards do', () => {
    const claims = [c('1', 'checked', 'supported')];
    const rechecks = { 1: { results: [{ status: 'checked', verdict: 'contradicted' }] } };
    expect(summarizeClaims(claims, { rechecks, price: 100 }).verdicts.contradicted).toBe(1);
    expect(summarizeClaims(claims, { rechecks, price: null }).verdicts.supported).toBe(1);
  });
  it('lists Contradicted first, then Partly true, each in session order', () => {
    const s = summarizeClaims([c('1', 'checked', 'partly_true'), c('2', 'checked', 'contradicted'), c('3', 'checked', 'supported'), c('4', 'checked', 'contradicted'), c('5', 'checked', 'partly_true')], ctx);
    expect(s.attention.map((a) => a.claim.id)).toEqual(['2', '4', '1', '5']);
    expect(s.attention[0].badge.key).toBe('contradicted');
  });
  it('is all zero for no claims', () => {
    expect(summarizeClaims([], ctx)).toMatchObject({ total: 0, withVerdict: 0, attention: [] });
  });
});

describe('summarySentence', () => {
  it('names the real statuses and leaves out the empty ones', () => {
    const s = summarizeClaims([
      ...Array.from({ length: 9 }, (_, i) => c(`v${i}`, 'checked', 'supported')),
      ...Array.from({ length: 3 }, (_, i) => c(`n${i}`, 'not_checkable')), c('u1', 'unchecked'), c('u2', 'unchecked'),
    ], ctx);
    expect(summarySentence(s)).toBe('14 claims in this session: 9 with a verdict, 3 not checkable, 2 not checked');
  });
  it('says claim for one, and has a plain empty sentence', () => {
    expect(summarySentence(summarizeClaims([c('1', 'checked', 'opinion')], ctx))).toBe('1 claim in this session: 1 with a verdict');
    expect(summarySentence(summarizeClaims([], ctx))).toBe('No claims yet.');
  });
  it('names checking, needs context, failed and no-source claims', () => {
    const s = summarizeClaims([c('1', 'pending'), c('2', 'needs_context'), c('3', 'error'), c('4', 'error', null, { fail_reason: 'no_sources' })], ctx);
    expect(summarySentence(s)).toBe('4 claims in this session: 1 being checked, 1 needing context, 1 failed, 1 without a source');
  });
});
