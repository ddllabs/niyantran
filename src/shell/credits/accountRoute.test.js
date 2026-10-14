import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_SECTIONS, accountHash, goAccount, parseAccountHash, takeAccountPlan } from './accountRoute.js';

// F184: the credits page has its own address in the terminal, one per section, so back and forward
// and a bookmark work like a desk.
describe('the account route', () => {
  afterEach(() => { vi.unstubAllGlobals(); takeAccountPlan(); });

  it('names four sections in order', () => {
    expect(ACCOUNT_SECTIONS.map((s) => [s.id, s.label])).toEqual([
      ['credits', 'Overview'], ['usage', 'Usage'], ['activity', 'Activity'], ['billing', 'Plan and invoices'],
    ]);
  });

  it('reads #/account/<section>, defaults a bare or unknown section to Overview, and ignores desks', () => {
    expect(parseAccountHash('#/account/usage')).toBe('usage');
    expect(parseAccountHash('#/account/billing?x=1')).toBe('billing');
    expect(parseAccountHash('#/account')).toBe('credits');
    expect(parseAccountHash('#/Account/nope')).toBe('credits');
    expect(parseAccountHash('#/economics')).toBeNull();
    expect(parseAccountHash('#/accounts')).toBeNull();
    expect(parseAccountHash('')).toBeNull();
    expect(accountHash('activity')).toBe('#/account/activity');
  });

  it('navigates by setting the hash, and hands a chosen plan to the billing section once', () => {
    const loc = { hash: '#/economics' };
    vi.stubGlobal('location', loc);
    goAccount('billing', { plan: 'pro' });
    expect(loc.hash).toBe('#/account/billing');
    expect(takeAccountPlan()).toBe('pro');
    expect(takeAccountPlan()).toBeNull();
    goAccount('nope');
    expect(loc.hash).toBe('#/account/credits');
  });
});
