// F111: the signed-in user's AI credits, read only from my_credits() and
// my_conversation_credits(). Shapes, formatting and the session guard.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userId: 'u1', rpc: null, afterUserId: null, sessionOf: null }));
vi.mock('./supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: async () => {
        if (state.sessionOf) { const who = state.sessionOf(); return { data: { session: who ? { user: { id: who } } : null }, error: null }; }
        const id = state.afterUserId && state.reads++ > 0 ? state.afterUserId : state.userId;
        return { data: { session: id ? { user: { id } } : null }, error: null };
      },
    },
    rpc: (...args) => state.rpc(...args),
  },
}));

import {
  OPEN_CONVERSATION_EVENT, clearCredits, conversationCredits, creditEstimateText, creditsText, formatCredits, loadCreditEstimates,
  LOW_BALANCE_WITHOUT_ALLOWANCE, lowBalance, openConversation, refreshCredits, rupeeHint, serverCredits, shapeCredits, takeWantedConversation,
} from './creditsStore.js';

const SERVER = {
  balance: 1520.4567, held: 300, debt: 0, plan: 'plus', inr_per_credit: 0.1,
  cycle: { allowance: 2000, starts_at: '2026-10-14T00:00:00Z', ends_at: '2026-11-14T00:00:00Z' }, used_this_cycle: 479.5433,
  lots: [{ kind: 'monthly', remaining: 1520.4567, expires_at: '2026-11-14T00:00:00Z' }],
  recent: [{ conversation_id: 'c1', title: 'Budget scrutiny', credits: 38.25, created_at: '2026-10-14T10:00:00Z' }],
};

beforeEach(() => {
  state.userId = 'u1';
  state.afterUserId = null;
  state.sessionOf = null;
  state.reads = 0;
  state.rpc = vi.fn(async () => ({ data: SERVER, error: null }));
  clearCredits();
});
afterEach(() => vi.restoreAllMocks());

describe('shapeCredits', () => {
  it('keeps credits and the rupees per credit, and nothing in dollars', () => {
    const c = shapeCredits('u1', SERVER);
    expect(c).toEqual({
      userId: 'u1', balance: 1520.4567, held: 300, available: 1220.4567, debt: 0, plan: 'plus', inrPerCredit: 0.1,
      allowance: 2000, cycleStartsAt: '2026-10-14T00:00:00Z', cycleEndsAt: '2026-11-14T00:00:00Z', usedThisCycle: 479.5433,
      lots: [{ kind: 'monthly', remaining: 1520.4567, expiresAt: '2026-11-14T00:00:00Z' }],
      recent: [{ conversationId: 'c1', title: 'Budget scrutiny', credits: 38.25, createdAt: '2026-10-14T10:00:00Z' }],
    });
    expect(JSON.stringify(c)).not.toMatch(/usd|cost/i);
  });

  it('reads a negative balance and debt as they are', () => {
    const c = shapeCredits('u1', { ...SERVER, balance: -50, held: 0, debt: 50 });
    expect(c.balance).toBe(-50);
    expect(c.debt).toBe(50);
    expect(c.available).toBe(-50);
  });

  it('reads credits used this cycle as a number, and as null when there is no cycle or it is unreadable (review R, I2)', () => {
    expect(shapeCredits('u1', { ...SERVER, used_this_cycle: 0 }).usedThisCycle).toBe(0);
    expect(shapeCredits('u1', { ...SERVER, used_this_cycle: '12.5' }).usedThisCycle).toBe(12.5);
    for (const v of [null, undefined, 'x', NaN]) expect(shapeCredits('u1', { ...SERVER, used_this_cycle: v }).usedThisCycle).toBeNull();
  });

  it('returns null without a user or a usable answer', () => {
    expect(shapeCredits('', SERVER)).toBeNull();
    expect(shapeCredits('u1', null)).toBeNull();
  });
});

describe('refreshCredits', () => {
  it('reads my_credits for the session user and keeps it in memory', async () => {
    const c = await refreshCredits();
    expect(state.rpc).toHaveBeenCalledWith('my_credits');
    expect(c.balance).toBe(1520.4567);
    expect(serverCredits('u1')).toBe(c);
    expect(serverCredits('someone-else')).toBeNull();
  });

  it('is null when signed out, and never calls the server', async () => {
    state.userId = null;
    expect(await refreshCredits()).toBeNull();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('drops an answer whose session changed while it was in flight', async () => {
    state.afterUserId = 'u2';
    expect(await refreshCredits()).toBeNull();
    expect(serverCredits('u1')).toBeNull();
  });

  it('keeps the last good read on a server error', async () => {
    const first = await refreshCredits();
    state.rpc = vi.fn(async () => ({ data: null, error: { message: 'down' } }));
    expect(await refreshCredits()).toBe(first);
  });
});

describe('refreshCredits while a read is in flight (review R, M3)', () => {
  /** An rpc whose answers the test releases one at a time. */
  function gated() {
    const pending = [];
    state.rpc = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
    return pending;
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('runs exactly one more read after it, so a refresh asked for after a charge is never answered by the read before it', async () => {
    const pending = gated();
    const first = refreshCredits();
    await flush();
    const second = refreshCredits();
    await flush();
    expect(state.rpc).toHaveBeenCalledTimes(1);
    pending[0]({ data: { ...SERVER, balance: 100 }, error: null });
    expect((await first).balance).toBe(100);
    await flush();
    expect(state.rpc).toHaveBeenCalledTimes(2);
    pending[1]({ data: { ...SERVER, balance: 40 }, error: null });
    expect((await second).balance).toBe(40);
    expect(serverCredits('u1').balance).toBe(40);
  });

  it('coalesces every further call into that one follow-up read', async () => {
    const pending = gated();
    const first = refreshCredits();
    await flush();
    const later = [refreshCredits(), refreshCredits(), refreshCredits()];
    pending[0]({ data: SERVER, error: null });
    await first;
    await flush();
    pending[1]?.({ data: { ...SERVER, balance: 7 }, error: null });
    const results = await Promise.all(later);
    expect(state.rpc).toHaveBeenCalledTimes(2);
    for (const r of results) expect(r.balance).toBe(7);
  });

  it('reads again for a call made after everything settled', async () => {
    await refreshCredits();
    await refreshCredits();
    expect(state.rpc).toHaveBeenCalledTimes(2);
  });

  it('never lets the read in flight for one account satisfy a call made for another', async () => {
    const pending = gated();
    state.sessionOf = () => 'u1';
    const first = refreshCredits();
    await flush();
    state.sessionOf = () => 'u2';
    const second = refreshCredits();
    pending[0]({ data: { ...SERVER, balance: 111 }, error: null });
    expect(await first).toBeNull();
    await flush();
    pending[1]({ data: { ...SERVER, balance: 222 }, error: null });
    const c = await second;
    expect(c.userId).toBe('u2');
    expect(c.balance).toBe(222);
    expect(serverCredits('u1')).toBeNull();
    expect(serverCredits('u2').balance).toBe(222);
  });
});

describe('clearCredits', () => {
  it('drops the cached balance, so another account never sees it', async () => {
    await refreshCredits();
    expect(serverCredits('u1')).not.toBeNull();
    clearCredits();
    expect(serverCredits('u1')).toBeNull();
  });

  it('also discards a read that was in flight when it was called', async () => {
    let release;
    state.rpc = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const read = refreshCredits();
    await new Promise((r) => setTimeout(r, 0));
    clearCredits();
    release({ data: SERVER, error: null });
    expect(await read).toBeNull();
    expect(serverCredits('u1')).toBeNull();
  });
});

describe('creditsText', () => {
  it('says credits, and "credit" for exactly one', () => {
    expect(creditsText(1520.4)).toBe('1,520 credits');
    expect(creditsText(0)).toBe('0 credits');
    expect(creditsText(1)).toBe('1 credit');
    expect(creditsText(-50)).toBe('−50 credits');
    expect(creditsText(-1)).toBe('−1 credit');
  });

  it('is singular for anything that shows as "1", and plural for anything that does not', () => {
    expect(creditsText(1.004)).toBe('1 credit');
    expect(creditsText(0.996)).toBe('1 credit');
    expect(creditsText(1.01)).toBe('1.01 credits');
    expect(creditsText(0.5)).toBe('0.5 credits');
    expect(creditsText(100.4)).toBe('100 credits');
    expect(creditsText(null)).toBe('— credits');
  });
});

describe('conversationCredits', () => {
  it('maps each charged answer to its credits', async () => {
    state.rpc = vi.fn(async () => ({ data: [{ message_id: 'm1', credits: 12.5 }, { message_id: 'm2', credits: 0.04 }], error: null }));
    const m = await conversationCredits('c1');
    expect(state.rpc).toHaveBeenCalledWith('my_conversation_credits', { p_conversation: 'c1' });
    expect(m.get('m1')).toBe(12.5);
    expect(m.get('m2')).toBe(0.04);
    expect(m.has('m3')).toBe(false);
  });

  it('is empty on an error or without a conversation', async () => {
    state.rpc = vi.fn(async () => ({ data: null, error: { message: 'x' } }));
    expect((await conversationCredits('c1')).size).toBe(0);
    expect((await conversationCredits('')).size).toBe(0);
  });
});

describe('formatCredits', () => {
  it('shows whole credits from 100, one decimal from 10, two below', () => {
    expect(formatCredits(75000)).toBe('75,000');
    expect(formatCredits(1520.4567)).toBe('1,520');
    expect(formatCredits(38.25)).toBe('38.3');
    expect(formatCredits(5.1443)).toBe('5.14');
    expect(formatCredits(0)).toBe('0');
  });

  it('marks a negative balance with a minus sign', () => {
    expect(formatCredits(-50)).toBe('−50');
    expect(formatCredits(-2.2327)).toBe('−2.23');
  });

  it('shows a dash for an unknown amount', () => {
    expect(formatCredits(null)).toBe('—');
    expect(formatCredits(Number.NaN)).toBe('—');
  });
});

describe('rupeeHint', () => {
  it('gives the rupee value of credits at the published rate', () => {
    expect(rupeeHint(2000, 0.1)).toBe('≈ ₹200');
    expect(rupeeHint(38.25, 0.1)).toBe('≈ ₹3.83');
    expect(rupeeHint(75000, 0.1)).toBe('≈ ₹7,500');
    // Less than a paisa is said as such (F153), and zero stays zero.
    expect(rupeeHint(0.02, 0.1)).toBe('< ₹0.01');
    expect(rupeeHint(0, 0.1)).toBe('≈ ₹0');
  });

  it('is empty without a rate or an amount', () => {
    expect(rupeeHint(100, null)).toBe('');
    expect(rupeeHint(null, 0.1)).toBe('');
  });
});

describe('lowBalance', () => {
  it('is true at or below 10% of the cycle allowance, and false when out of credits', () => {
    expect(lowBalance({ balance: 200, allowance: 2000 })).toBe(true);
    expect(lowBalance({ balance: 201, allowance: 2000 })).toBe(false);
    expect(lowBalance({ balance: 0, allowance: 2000 })).toBe(false);
  });

  // F162: an account with no allowance (top-ups only) was never warned.
  it('without an allowance, is low at 200 credits or fewer', () => {
    expect(LOW_BALANCE_WITHOUT_ALLOWANCE).toBe(200);
    expect(lowBalance({ balance: 5, allowance: null })).toBe(true);
    expect(lowBalance({ balance: 200, allowance: 0 })).toBe(true);
    expect(lowBalance({ balance: 201, allowance: null })).toBe(false);
    expect(lowBalance({ balance: 0, allowance: null })).toBe(false);
    expect(lowBalance(null)).toBe(false);
  });
});

// F149: Plan & billing asks the AI panel to open a saved conversation.
describe('openConversation (F149)', () => {
  it('announces the conversation id on window and remembers it until a panel takes it, once', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    try {
      const seen = vi.fn();
      target.addEventListener(OPEN_CONVERSATION_EVENT, seen);
      expect(OPEN_CONVERSATION_EVENT).toBe('niy-open-conversation');
      openConversation('c1');
      expect(seen).toHaveBeenCalledOnce();
      expect(seen.mock.calls[0][0].detail).toEqual({ conversationId: 'c1' });
      expect(takeWantedConversation()).toBe('c1');
      expect(takeWantedConversation()).toBe('');
    } finally { vi.unstubAllGlobals(); }
  });

  it('ignores an empty id and a missing window', () => {
    expect(() => openConversation('c1')).not.toThrow();
    takeWantedConversation();
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    try {
      const seen = vi.fn();
      target.addEventListener(OPEN_CONVERSATION_EVENT, seen);
      openConversation('');
      openConversation(null);
      expect(seen).not.toHaveBeenCalled();
      expect(takeWantedConversation()).toBe('');
    } finally { vi.unstubAllGlobals(); }
  });
});

// F151: what a typical answer costs, per model, in credits only.
describe('loadCreditEstimates (F151)', () => {
  const ROWS = [
    { model_id: 'google/gemini-3.5-flash-lite', credits: 4, basis: 'measured' },
    { model_id: 'anthropic/claude-sonnet-5', credits: 170.4, basis: 'list_price' },
  ];
  beforeEach(() => { state.rpc = vi.fn(async () => ({ data: ROWS, error: null })); });

  it('reads model_credit_estimates and keys whole credits by model id', async () => {
    expect(await loadCreditEstimates()).toEqual({ 'google/gemini-3.5-flash-lite': 4, 'anthropic/claude-sonnet-5': 170.4 });
    expect(state.rpc).toHaveBeenCalledWith('model_credit_estimates');
  });

  it('asks the server once per session, even for concurrent callers', async () => {
    const [a, b] = await Promise.all([loadCreditEstimates(), loadCreditEstimates()]);
    await loadCreditEstimates();
    expect(a).toBe(b);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing for a row without a usable number, and no dollars or basis', async () => {
    state.rpc = vi.fn(async () => ({
      data: [{ model_id: 'a', credits: null }, { model_id: 'b', credits: 'x' }, { model_id: 'c', credits: 0 }, { model_id: 'd', credits: -3 },
        { model_id: '', credits: 5 }, { model_id: 'e', credits: 9, basis: 'measured', usd: 0.9 }, null],
      error: null,
    }));
    const found = await loadCreditEstimates();
    expect(found).toEqual({ e: 9 });
    expect(JSON.stringify(found)).not.toMatch(/usd|basis/i);
  });

  it('is empty on an error and tries again next time, because a failure is not kept', async () => {
    state.rpc = vi.fn(async () => ({ data: null, error: { message: 'down' } }));
    expect(await loadCreditEstimates()).toEqual({});
    state.rpc = vi.fn(async () => { throw new Error('offline'); });
    expect(await loadCreditEstimates()).toEqual({});
    state.rpc = vi.fn(async () => ({ data: ROWS, error: null }));
    expect(Object.keys(await loadCreditEstimates())).toHaveLength(2);
  });

  it('is forgotten on sign-out, so another account asks again', async () => {
    await loadCreditEstimates();
    clearCredits();
    await loadCreditEstimates();
    expect(state.rpc).toHaveBeenCalledTimes(2);
  });

  it('does not ask the server when nobody is signed in', async () => {
    state.userId = null;
    expect(await loadCreditEstimates()).toEqual({});
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe('creditEstimateText (F151)', () => {
  it('writes "≈ N credits" in the credit formatting, and nothing without a number', () => {
    expect(creditEstimateText(170.4)).toBe('≈ 170 credits');
    expect(creditEstimateText(4)).toBe('≈ 4 credits');
    expect(creditEstimateText(1)).toBe('≈ 1 credit');
    expect(creditEstimateText(0.5)).toBe('≈ 0.5 credits');
    for (const v of [undefined, null, NaN, 0, -2, 'x']) expect(creditEstimateText(v)).toBe('');
  });
});
