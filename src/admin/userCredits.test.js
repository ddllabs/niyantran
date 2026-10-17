// The admin's credit adjustment: the form's checks, and the request to
// POST /api/users/:id/credits (F111 spec section 9).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ verifiedLocalIdentity: vi.fn(), hydrateUsersFromServer: vi.fn() }));
vi.mock('../lib/userStore.js', () => store);

import { adjustUserCredits, creditRequest, formatBalance, newRequestId } from './userCredits.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const draft = (over = {}) => ({ kind: 'add', amount: '250', reason: 'Goodwill', unitVersion: 'credit-paise-v2', ...over });

describe('creditRequest', () => {
  it('reads the three actions as the signed amount and kind the server takes', () => {
    expect(creditRequest(draft())).toEqual({ ok: true, credits: 250, kind: 'adjustment', reason: 'Goodwill', unitVersion: 'credit-paise-v2' });
    expect(creditRequest(draft({ kind: 'remove', amount: '12.5' }))).toEqual({ ok: true, credits: -12.5, kind: 'adjustment', reason: 'Goodwill', unitVersion: 'credit-paise-v2' });
    expect(creditRequest(draft({ kind: 'topup', amount: '2000' }))).toMatchObject({ ok: true, credits: 2000, kind: 'topup' });
    expect(creditRequest(draft({ amount: ' 0.0001 ', reason: '  spaced  ' }))).toMatchObject({ ok: true, credits: 0.0001, reason: 'spaced' });
  });

  it('captures the actual legacy unit rather than relabelling it', () => {
    expect(creditRequest(draft({ unitVersion: 'credit-ten-paise-v1' }))).toMatchObject({ ok: true, unitVersion: 'credit-ten-paise-v1' });
    expect(creditRequest(draft({ unitVersion: 'credit-ten-paise-v1', amount: '1000001' }))).toMatchObject({ ok: false });
    expect(creditRequest(draft({ unitVersion: undefined }))).toMatchObject({ ok: false, reason: expect.stringMatching(/reload/i) });
  });

  it('allows the same economic administrator ceiling in one-paisa credits', () => {
    expect(creditRequest(draft({ amount: '10000000' }))).toMatchObject({ ok: true, credits: 10000000 });
  });

  it.each([
    ['no amount', { amount: '' }, /amount/i],
    ['zero', { amount: '0' }, /above zero/i],
    ['words', { amount: 'ten' }, /amount/i],
    ['a thousands separator', { amount: '2,000' }, /amount/i],
    ['a minus sign', { amount: '-5' }, /minus/i],
    ['five decimals', { amount: '1.00001' }, /four decimals/i],
    ['too many credits', { amount: '10000001' }, /10,000,000/],
    ['no reason', { reason: '' }, /reason/i],
    ['a blank reason', { reason: '   ' }, /reason/i],
    ['a reason over 500 characters', { reason: 'x'.repeat(501) }, /500/],
    ['an unknown action', { kind: 'gift' }, /action/i],
  ])('refuses %s with a plain message', (_label, over, message) => {
    const result = creditRequest(draft(over));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(message);
  });
});

describe('formatBalance', () => {
  it('shows the exact amount, up to four decimals, and a dash when unknown', () => {
    expect(formatBalance(1250.5)).toBe('1,250.5');
    expect(formatBalance(0)).toBe('0');
    expect(formatBalance(100000.1234)).toBe('1,00,000.1234');
    expect(formatBalance(null)).toBe('—');
    expect(formatBalance(undefined)).toBe('—');
  });
});

it('newRequestId makes a fresh uuid each time', () => {
  const a = newRequestId();
  expect(a).toMatch(UUID);
  expect(newRequestId()).not.toBe(a);
});

describe('adjustUserCredits', () => {
  const request = { credits: -25, kind: 'adjustment', reason: 'Refund', unitVersion: 'credit-paise-v2' };
  const respond = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

  beforeEach(() => {
    vi.clearAllMocks();
    store.verifiedLocalIdentity.mockResolvedValue({ id: 'admin', token: 'admin-token' });
    store.hydrateUsersFromServer.mockResolvedValue([]);
  });

  it('posts the adjustment with the admin token and the request id, then refreshes the directory', async () => {
    const fetch = respond(200, { ok: true, repeated: false, balance: 975.5 });
    vi.stubGlobal('fetch', fetch);
    const result = await adjustUserCredits('u-1 x', request, 'req-1');
    expect(result).toEqual({ ok: true, repeated: false, balance: 975.5 });
    expect(store.verifiedLocalIdentity).toHaveBeenCalledWith({ admin: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/users/u-1%20x/credits');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ credits: -25, kind: 'adjustment', reason: 'Refund', requestId: 'req-1', unitVersion: 'credit-paise-v2' });
    expect(store.hydrateUsersFromServer).toHaveBeenCalledOnce();
  });

  it('does not stamp a legacy retry with a new denomination', async () => {
    const fetch = respond(200, { ok: true, repeated: true, balance: 975.5 });
    vi.stubGlobal('fetch', fetch);
    const legacy = { credits: request.credits, kind: request.kind, reason: request.reason };
    await adjustUserCredits('u-1', legacy, 'old-request');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('unitVersion');
  });

  it('reports a repeated request as repeated', async () => {
    vi.stubGlobal('fetch', respond(200, { ok: true, repeated: true, balance: 3 }));
    expect(await adjustUserCredits('u-1', request, 'req-1')).toMatchObject({ ok: true, repeated: true, balance: 3 });
  });

  it('returns the server message when it refuses, and does not refresh', async () => {
    vi.stubGlobal('fetch', respond(400, { ok: false, error: 'A reason is required' }));
    expect(await adjustUserCredits('u-1', request, 'req-1')).toEqual({ ok: false, reason: 'A reason is required' });
    expect(store.hydrateUsersFromServer).not.toHaveBeenCalled();
  });

  it('gives a plain message when the answer has no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => { throw new Error('html'); } })));
    const result = await adjustUserCredits('u-1', request, 'req-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not applied|could not/i);
  });

  it('says a retry is safe when the request could not be sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const result = await adjustUserCredits('u-1', request, 'req-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/try again/i);
  });

  it('sends nothing when the admin cannot be verified', async () => {
    store.verifiedLocalIdentity.mockResolvedValue(null);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await adjustUserCredits('u-1', request, 'req-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sign in/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('still succeeds when the directory refresh fails, since the credits are already applied', async () => {
    vi.stubGlobal('fetch', respond(200, { ok: true, repeated: false, balance: 1 }));
    store.hydrateUsersFromServer.mockRejectedValue(new Error('down'));
    expect(await adjustUserCredits('u-1', request, 'req-1')).toMatchObject({ ok: true, balance: 1 });
  });
});
