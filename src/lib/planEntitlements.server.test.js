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
  canAccessDesk, canExport, entitlementOf, rowCapForUser, canCopy, applyRowCap,
} from './planEntitlements.js';
import { clearEntitlement, refreshEntitlement, serverEntitlement, watchEntitlementTransitions } from './entitlementStore.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k), values };
}

const DAY = 86400000;
const tampered = { id: 'u1', email: 'a@example.test', type: 'analyst', plan: 'max', planStatus: 'active' };

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
  auth.rpc = vi.fn(async (name) => (name === 'my_entitlement_manual' ? { data, error: null } : { data: null, error: { message: 'no' } }));
}

describe('a session user cannot grant itself a plan', () => {
  it('ignores plan fields on the session user until the server has answered', () => {
    expect(entitlementOf(tampered)).toMatchObject({ plan: 'free', status: 'free' });
    expect(canExport(tampered)).toBe(true);
    expect(rowCapForUser(tampered)).toBe(null);
    expect(canAccessDesk(tampered, 'state')).toBe(true);
  });

  it('keeps ignoring them after the server says free', async () => {
    serve({ plan: 'free', status: 'free', period_end: null, lapsed: false });
    await refreshEntitlement();
    expect(entitlementOf(tampered)).toMatchObject({ plan: 'free', status: 'free', loaded: true });
    expect(canExport(tampered)).toBe(true);
  });

  it("does not apply one account's entitlement to another", async () => {
    serve({ plan: 'max', status: 'active', period_end: null });
    await refreshEntitlement();
    expect(entitlementOf({ id: 'u2', email: 'b@example.test' })).toMatchObject({ plan: 'free', status: 'free' });
  });

  it('writes nothing about the plan to browser storage', async () => {
    serve({ plan: 'max', status: 'active', period_end: null });
    await refreshEntitlement();
    expect([...sessionStorage.values.keys(), ...localStorage.values.keys()]).toEqual([]);
  });
});

describe('subscription facts remain accurate without commercial desk locks', () => {
  it('retains only server-authorized model access through the exact grace deadline', async () => {
    const paidEnd = new Date(Date.now() - 1000).toISOString();
    const accessUntil = new Date(Date.now() + 1000).toISOString();
    auth.rpc = vi.fn(async () => ({ data: { plan: 'pro', status: 'active', period_end: paidEnd,
      access_until: accessUntil, grace_until: accessUntil, in_grace: true }, error: null }));
    await refreshEntitlement();
    expect(auth.rpc).toHaveBeenCalledWith('my_entitlement_manual');
    expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'pro', periodEnd: paidEnd, accessUntil, inGrace: true });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(accessUntil));
    try { expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'free', status: 'free', lapsed: true }); }
    finally { clock.mockRestore(); }
  });
  it('a paid plan unlocks every desk and export, with no row cap', async () => {
    serve({ plan: 'pro', status: 'active', period_end: new Date(Date.now() + 30 * DAY).toISOString(), lapsed: false });
    await refreshEntitlement();
    const user = { id: 'u1', email: 'a@example.test', type: 'analyst' };
    expect(entitlementOf(user)).toMatchObject({ plan: 'pro', status: 'active' });
    expect(canExport(user)).toBe(true);
    expect(rowCapForUser(user)).toBe(null);
    expect(canAccessDesk(user, 'state')).toBe(true);
  });

  it('reads Plus and Max, and maps older plan names to their successors', async () => {
    const user = { id: 'u1' };
    for (const [stored, plan] of [['plus', 'plus'], ['max', 'max'], ['professional', 'pro'], ['enterprise', 'max']]) {
      serve({ plan: stored, status: 'active', period_end: null });
      await refreshEntitlement();
      expect(entitlementOf(user)).toMatchObject({ plan, status: 'active' });
    }
  });

  it('a month that ends during the session reads as free', async () => {
    serve({ plan: 'pro', status: 'active', period_end: new Date(Date.now() - 1000).toISOString() });
    await refreshEntitlement();
    expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'free', status: 'free' });
  });

  it('an old trial status grants nothing', async () => {
    serve({ plan: 'pro', status: 'trial', period_end: new Date(Date.now() + 3 * DAY).toISOString() });
    await refreshEntitlement();
    expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'free', status: 'free' });
  });

  it('a lapsed period from the server reads as free', async () => {
    serve({ plan: 'free', status: 'free', lapsed: true, source: 'payment', granted_plan: 'pro' });
    await refreshEntitlement();
    expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'free', status: 'free' });
  });

  it('keeps the last answer when a refresh fails', async () => {
    serve({ plan: 'pro', status: 'active', period_end: null });
    await refreshEntitlement();
    auth.rpc = vi.fn(async () => ({ data: null, error: { message: 'offline' } }));
    await refreshEntitlement();
    expect(serverEntitlement('u1')).toMatchObject({ plan: 'pro' });
  });

  it('drops the entitlement when there is no session', async () => {
    serve({ plan: 'pro', status: 'active', period_end: null });
    await refreshEntitlement();
    auth.userId = null;
    await refreshEntitlement();
    expect(serverEntitlement('u1')).toBe(null);
  });
});

describe('free desk capabilities', () => {
  it.each(['policy', 'journalist', 'student', 'analyst', 'lawyer', 'academic'])('allows every desk, copying and full feeds for a free %s', type => {
    const user = { id: 'u1', type };
    for (const desk of ['home', 'national', 'global', 'state', 'law', 'economics', 'carbon', 'sports', 'entertainment']) expect(canAccessDesk(user, desk)).toBe(true);
    expect(canCopy(user)).toBe(true);
    expect(canExport(user)).toBe(true);
    const feed = { rows: Array.from({ length: 55 }, (_, id) => ({ id })), note: 'Original source note' };
    expect(applyRowCap(feed, user)).toBe(feed);
    expect(feed.rows).toHaveLength(55);
    expect(rowCapForUser(user)).toBe(null);
  });
  it('rejects unknown desks and does not grant capabilities to signed-out or disabled accounts', () => {
    expect(canAccessDesk({ id: 'u1' }, 'unknown')).toBe(false);
    for (const user of [null, {}, { id: 'u1', active: false }]) {
      expect(canAccessDesk(user, 'national')).toBe(false);
      expect(canCopy(user)).toBe(false);
      expect(canExport(user)).toBe(false);
    }
  });
});


describe('open-session renewal transitions', () => {
  afterEach(() => vi.useRealTimers());

  it('refreshes at paid expiry and clamps model access at the grace deadline without polling', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    const paidEnd = Date.now() + 1000;
    const graceEnd = paidEnd + 48 * 3600000;
    auth.rpc = vi.fn(async () => ({ data: { plan: 'pro', status: 'active',
      period_end: new Date(paidEnd).toISOString(), access_until: new Date(graceEnd).toISOString(),
      grace_until: new Date(graceEnd).toISOString(), in_grace: Date.now() >= paidEnd }, error: null }));
    await refreshEntitlement();
    const changed = vi.fn();
    const refreshWallet = vi.fn();
    const stop = watchEntitlementTransitions(changed, refreshWallet);
    try {
      await vi.advanceTimersByTimeAsync(999);
      expect(auth.rpc).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(auth.rpc).toHaveBeenCalledTimes(2);
      expect(refreshWallet).toHaveBeenCalledTimes(1);
      expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'pro', inGrace: true });
      await vi.advanceTimersByTimeAsync(48 * 3600000);
      expect(entitlementOf({ id: 'u1' }).plan).toBe('free');
      expect(changed).toHaveBeenCalled();
      expect(auth.rpc).toHaveBeenCalledTimes(3);
    } finally { stop(); }
  });

  it('recovers from a failed expiry read without navigation or polling', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    const paidEnd = Date.now() + 1000;
    const graceEnd = paidEnd + 48 * 3600000;
    const paid = { plan: 'pro', status: 'active', period_end: new Date(paidEnd).toISOString() };
    auth.rpc = vi.fn().mockResolvedValueOnce({ data: paid, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
      .mockResolvedValue({ data: { ...paid, access_until: new Date(graceEnd).toISOString(),
        grace_until: new Date(graceEnd).toISOString(), in_grace: true }, error: null });
    await refreshEntitlement();
    const stop = watchEntitlementTransitions(vi.fn());
    try {
      await vi.advanceTimersByTimeAsync(1001);
      expect(entitlementOf({ id: 'u1' }).plan).toBe('free');
      await vi.advanceTimersByTimeAsync(1000);
      expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'pro', inGrace: true });
      expect(auth.rpc).toHaveBeenCalledTimes(3);
    } finally { stop(); }
  });

  it('bounds failed retries and recovers when the connection returns', async () => {
    vi.useFakeTimers();
    const paid = { plan: 'pro', status: 'active', period_end: new Date(Date.now() + 1000).toISOString() };
    serve(paid);
    await refreshEntitlement();
    auth.rpc = vi.fn(async () => ({ data: null, error: { message: 'offline' } }));
    const stop = watchEntitlementTransitions(vi.fn());
    try {
      await vi.advanceTimersByTimeAsync(120000);
      const attempts = auth.rpc.mock.calls.length;
      expect(attempts).toBeGreaterThan(1);
      expect(attempts).toBeLessThanOrEqual(4);
      await vi.advanceTimersByTimeAsync(120000);
      expect(auth.rpc).toHaveBeenCalledTimes(attempts);
      serve({ ...paid, access_until: new Date(Date.now() + 10000).toISOString(), in_grace: true });
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
      expect(entitlementOf({ id: 'u1' })).toMatchObject({ plan: 'pro', inGrace: true });
    } finally { stop(); }
  });

  it('cancels deadlines and focus refreshes when the shell unmounts', async () => {
    vi.useFakeTimers();
    serve({ plan: 'pro', status: 'active', period_end: new Date(Date.now() + 1000).toISOString() });
    await refreshEntitlement();
    const changed = vi.fn();
    const refreshWallet = vi.fn();
    const stop = watchEntitlementTransitions(changed, refreshWallet);
    stop();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(changed).not.toHaveBeenCalled();
    expect(refreshWallet).not.toHaveBeenCalled();
    expect(auth.rpc).toHaveBeenCalledTimes(1);
  });
});
