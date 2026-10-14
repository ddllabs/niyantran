import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDeskHash } from '../../lib/deskRoute.js';
import { ACCOUNT_SECTIONS, accountHash, accountPlan, deskRouteFor, goAccount, parseAccountHash } from './accountRoute.js';

// F184: the credits page has its own address in the terminal, one per section, so back and forward
// and a bookmark work like a desk.
describe('the account route', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

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

  it('navigates by setting the hash, with a chosen plan in the billing address only', () => {
    const loc = { hash: '#/economics' };
    vi.stubGlobal('location', loc);
    goAccount('billing', { plan: 'pro' });
    expect(loc.hash).toBe('#/account/billing?plan=pro');
    expect(parseAccountHash(loc.hash)).toBe('billing');
    expect(accountPlan(loc.hash)).toBe('pro');
    goAccount('credits', { plan: 'pro' });
    expect(loc.hash).toBe('#/account/credits');
    goAccount('nope');
    expect(loc.hash).toBe('#/account/credits');
    expect(accountPlan('#/account/billing?plan=<x>')).toBeNull();
    expect(accountPlan('#/account/billing')).toBeNull();
  });
});

describe('back and forward', () => {
  it('leaves the desk alone on a credits address and reads a desk address as before', () => {
    expect(deskRouteFor('#/account/usage')).toBeNull();
    expect(deskRouteFor('#/account/billing?plan=pro')).toBeNull();
    expect(deskRouteFor('#/economics')).toEqual(parseDeskHash('#/economics'));
    expect(deskRouteFor('#/')).toEqual({ tab: 'home', feature: '' });
  });
});
