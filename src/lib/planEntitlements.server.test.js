// F2 (docs/specs/2026-09-29-f2-entitlements.md): the browser's plan comes from
// my_entitlement() on the server. A session user edited in sessionStorage
// unlocks nothing, and nothing about the plan is stored in the browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ userId: 'u1', rpc: null }));
vi.mock('./supabaseClient.js', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: auth.userId ? { user: { id: auth.userId }, access_token: 't' } : null }, error: null }) },
    rpc: (...args) => auth.rpc(...args),
  },
}));

import {
  canAccessDesk, canExport, entitlementOf, rowCapForUser, trialDaysLeft, FREE_ROW_CAP, TRIAL_ROW_CAP,
} from './planEntitlements.js';
import { clearEntitlement, refreshEntitlement, serverEntitlement, startTrial } from './entitlementStore.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k), values };
}

const DAY = 86400000;
const tampered = { id: 'u1', email: 'a@example.test', type: 'analyst', plan: 'enterprise', planStatus: 'active', trialEndsAt: null };

beforeEach(() => {
  auth.userId = 'u1';
  auth.rpc = vi.fn(async () => ({ data: null, error: { message: 'unset' } }));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('localStorage', memoryStorage());
  clearEntitlement();
});
afterEach(() => vi.unstubAllGlobals());

function serve(data) {
  auth.rpc = vi.fn(async (name) => (name === 'my_entitlement' ? { data, error: null } : { data: null, error: { message: 'no' } }));
}

describe('a session user cannot grant itself a plan', () => {
  it('ignores plan fields on the session user until the server has answered', () => {
    expect(entitlementOf(tampered)).toMatchObject({ plan: 'explorer', status: 'free' });
    expect(canExport(tampered)).toBe(false);
    expect(rowCapForUser(tampered)).toBe(FREE_ROW_CAP);
    expect(canAccessDesk(tampered, 'state')).toBe(false);
  });

  it('keeps ignoring them after the server says free', async () => {
    serve({ plan: 'explorer', status: 'free', period_end: null, lapsed: false, trial_used: false });
    await refreshEntitlement();
    expect(entitlementOf(tampered)).toMatchObject({ plan: 'explorer', status: 'free', loaded: true });
    expect(canExport(tampered)).toBe(false);
  });

  it("does not apply one account's entitlement to another", async () => {
    serve({ plan: 'enterprise', status: 'active', period_end: null });
    await refreshEntitlement();
    expect(entitlementOf({ id: 'u2', email: 'b@example.test' })).toMatchObject({ plan: 'explorer', status: 'free' });
  });

  it('writes nothing about the plan to browser storage', async () => {
    serve({ plan: 'enterprise', status: 'active', period_end: null });
    await refreshEntitlement();
    expect([...sessionStorage.values.keys(), ...localStorage.values.keys()]).toEqual([]);
  });
});

describe('the server entitlement drives the locks', () => {
  it('a paid plan unlocks every desk and export, with no row cap', async () => {
    serve({ plan: 'professional', status: 'active', period_end: new Date(Date.now() + 30 * DAY).toISOString(), lapsed: false });
    await refreshEntitlement();
    const user = { id: 'u1', email: 'a@example.test', type: 'analyst' };
    expect(entitlementOf(user)).toMatchObject({ plan: 'pro', status: 'active' });
    expect(canExport(user)).toBe(true);
    expect(rowCapForUser(user)).toBe(null);
    expect(canAccessDesk(user, 'state')).toBe(true);
  });

  it('a trial opens desks with the trial cap and counts its days', async () => {
    serve({ plan: 'enterprise', status: 'trial', period_end: new Date(Date.now() + 3.5 * DAY).toISOString(), trial_used: true });
    await refreshEntitlement();
    const user = { id: 'u1', email: 'a@example.test' };
    expect(entitlementOf(user)).toMatchObject({ plan: 'enterprise', status: 'trial', trialUsed: true });
    expect(rowCapForUser(user)).toBe(TRIAL_ROW_CAP);
    expect(canExport(user)).toBe(false);
    expect(trialDaysLeft(user)).toBe(4);
  });

  it('a trial that ends during the session reads as free', async () => {
    serve({ plan: 'professional', status: 'trial', period_end: new Date(Date.now() - 1000).toISOString(), trial_used: true });
    await refreshEntitlement();
    expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'explorer', status: 'free', trialExpired: true });
  });

  it('a lapsed period from the server reads as free', async () => {
    serve({ plan: 'explorer', status: 'free', lapsed: true, source: 'payment', granted_plan: 'professional' });
    await refreshEntitlement();
    expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'explorer', status: 'free' });
  });

  it('keeps the last answer when a refresh fails', async () => {
    serve({ plan: 'professional', status: 'active', period_end: null });
    await refreshEntitlement();
    auth.rpc = vi.fn(async () => ({ data: null, error: { message: 'offline' } }));
    await refreshEntitlement();
    expect(serverEntitlement('u1')).toMatchObject({ plan: 'professional' });
  });

  it('drops the entitlement when there is no session', async () => {
    serve({ plan: 'professional', status: 'active', period_end: null });
    await refreshEntitlement();
    auth.userId = null;
    await refreshEntitlement();
    expect(serverEntitlement('u1')).toBe(null);
  });
});

describe('startTrial', () => {
  it('asks the server for the trial and applies its answer', async () => {
    auth.rpc = vi.fn(async () => ({ data: { plan: 'professional', status: 'trial', period_end: new Date(Date.now() + 14 * DAY).toISOString(), trial_used: true }, error: null }));
    const result = await startTrial('pro');
    expect(auth.rpc).toHaveBeenCalledWith('start_trial', { p_plan: 'pro' });
    expect(result.ok).toBe(true);
    expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'pro', status: 'trial' });
  });

  it("passes the server's refusal back and grants nothing", async () => {
    auth.rpc = vi.fn(async () => ({ data: null, error: { message: 'This account has already used its trial' } }));
    expect(await startTrial('enterprise')).toEqual({ ok: false, reason: 'This account has already used its trial' });
    expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'explorer', status: 'free' });
  });
});
