import { afterEach, describe, expect, it, vi } from 'vitest';
import { creditNotice, publishCreditNotice, refusalMessage, subscribeCreditNotice } from './chatCreditNotice.js';

const wallet = (patch = {}) => ({ userId: 'u1', balance: 0, held: 0, available: 0, plan: 'plus', allowance: 2000, ...patch });

afterEach(() => publishCreditNotice(null));

describe('the chat refusal, told to the header (F193)', () => {
  it('keeps the latest refusal and tells every listener once per change', () => {
    const seen = vi.fn();
    const off = subscribeCreditNotice(seen);
    const retry = () => {};
    publishCreditNotice({ block: 'credits_exhausted', held: false, retry });
    expect(creditNotice()).toEqual({ block: 'credits_exhausted', held: false, retry });
    publishCreditNotice({ block: 'credits_exhausted', held: false, retry });
    expect(seen).toHaveBeenCalledTimes(1);
    publishCreditNotice(null);
    expect(creditNotice()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    publishCreditNotice({ block: 'credits_unavailable' });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('drops anything that is not a credit refusal', () => {
    publishCreditNotice({ block: '' });
    expect(creditNotice()).toBeNull();
    publishCreditNotice({ block: 'something_else' });
    expect(creditNotice()).toBeNull();
  });
});

describe('refusalMessage', () => {
  it('is nothing without a refusal', () => {
    expect(refusalMessage(null, wallet())).toBeNull();
  });

  it('says there are no credits left and offers to buy', () => {
    const m = refusalMessage({ block: 'credits_exhausted' }, wallet());
    expect(m).toMatchObject({ key: 'refused', tone: 'danger', buy: true });
    expect(m.text).toBe('You have no AI credits left to start an answer. Upgrade your plan, or write to niyantranai@gmail.com for more credits.');
  });

  it('says so before the balance is known', () => {
    expect(refusalMessage({ block: 'credits_exhausted' }, null)).toMatchObject({ key: 'refused', buy: true });
  });

  it('says the credits are in use, with no way to buy, when the refusal says held or the balance is positive', () => {
    const held = refusalMessage({ block: 'credits_exhausted', held: true }, null);
    expect(held).toMatchObject({ key: 'refused-held', tone: 'warn' });
    expect(held.buy).toBeUndefined();
    expect(held.text).toBe('Your credits are in use by an answer that is still running. Try again when it finishes.');
    expect(refusalMessage({ block: 'credits_exhausted' }, wallet({ balance: 40, held: 40 }))).toMatchObject({ key: 'refused-held' });
  });

  it('is gone once credits are available again', () => {
    expect(refusalMessage({ block: 'credits_exhausted' }, wallet({ balance: 500, available: 500 }))).toBeNull();
  });

  it('says the check failed and offers to try again when there is a retry', () => {
    const m = refusalMessage({ block: 'credits_unavailable', retry: () => {} }, wallet({ balance: 900, available: 900 }));
    expect(m).toMatchObject({ key: 'refused-unchecked', tone: 'warn', retry: true });
    expect(m.text).toBe('AI credits could not be checked, so your answer did not start. Try again in a moment.');
    expect(refusalMessage({ block: 'credits_unavailable' }, null).retry).toBe(false);
  });
});
