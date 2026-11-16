// F344 R3: re-checking one verdict. The state lives in the controller, keyed by claim id, and is
// independent of the session: it works after the session ended and is cleared with the panel.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckError } from '../../lib/factcheck/client.js';
import { createFactCheckController } from './factCheckController.js';

const ON = { available: true, creditsPerMinute: 500, recheckCredits: 100, userId: 'u1' };
const base = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false,
  final: null, endReason: null, error: null,
};
const orig = { id: 'c1', claim_en: 'X is 5', status: 'checked', verdict: 'supported', reason: 'old', sources: [], checked_at: '2026-11-16T09:00:00Z' };
const fresh = (id, over = {}) => ({ id, supersedes: 'c1', status: 'checked', verdict: 'contradicted', reason: `r-${id}`, sources: [{ url: 'https://a.test', title: 'A' }], checked_at: '2026-11-16T10:00:00Z', ...over });

function setup({ flag = ON, recheck, balance = 1000, sleepImpl } = {}) {
  const changes = [];
  let state = { ...base };
  const handlers = {};
  const session = {
    stop: vi.fn(async () => {}), reset: vi.fn(() => { state = { ...base }; handlers.onChange(state); }),
    choose: vi.fn(), cancelChoice: vi.fn(), start: vi.fn(),
    getState: () => state,
    emit(next) { state = { ...state, ...next }; handlers.onChange(state); },
  };
  const credits = { available: vi.fn(() => balance), refresh: vi.fn(async () => {}), subscribe: () => () => {} };
  const client = { recheck: vi.fn(recheck || (async () => ({ claim: fresh('n1'), creditsCharged: 100, balance: 900 }))) };
  const sleep = vi.fn(sleepImpl || (async () => {}));
  const controller = createFactCheckController({
    createSession: (h) => { Object.assign(handlers, h); return session; },
    readFlag: async () => flag, supported: () => true, credits, client, sleep, onChange: (v) => changes.push(v),
  });
  return { controller, session, credits, client, sleep, last: () => changes.at(-1), rc: (id = 'c1') => changes.at(-1).rechecks[id], changes };
}

async function ready(t, claimOver = {}) {
  await t.controller.load();
  t.controller.setTarget('a|live|b');
  t.controller.choose();
  t.session.emit({ status: 'running', claims: [{ ...orig, ...claimOver }] });
  t.credits.refresh.mockClear();
}

describe('the panel reaches the actions through the view', () => {
  it('the published view carries ask, confirm and cancel bound to the controller', async () => {
    const t = setup();
    await ready(t);
    const { ask, confirm, cancel } = t.last().recheckActions;
    ask('c1');
    expect(t.rc().phase).toBe('confirming');
    cancel('c1');
    ask('c1');
    await confirm('c1');
    expect(t.client.recheck).toHaveBeenCalledTimes(1);
  });
});

describe('asking', () => {
  it('ask opens the confirmation, cancel closes it', async () => {
    const t = setup();
    await ready(t);
    t.controller.recheckAsk('c1');
    expect(t.rc().phase).toBe('confirming');
    t.controller.recheckCancel('c1');
    expect(t.rc()?.phase ?? 'idle').toBe('idle');
    expect(t.client.recheck).not.toHaveBeenCalled();
  });
  it('does nothing when the price is unknown', async () => {
    const t = setup({ flag: { ...ON, recheckCredits: null } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc()?.phase ?? 'idle').toBe('idle');
    expect(t.client.recheck).not.toHaveBeenCalled();
  });
  it('does nothing for a claim that is not checked or failed', async () => {
    const t = setup();
    await ready(t, { status: 'pending' });
    t.controller.recheckAsk('c1');
    expect(t.rc()?.phase ?? 'idle').toBe('idle');
  });
  it('ignores a confirm that was never asked', async () => {
    const t = setup();
    await ready(t);
    await t.controller.recheckConfirm('c1');
    expect(t.client.recheck).not.toHaveBeenCalled();
  });
});

describe('a successful re-check', () => {
  it('sends the claim id and the price, shows progress, then the new result, the charge and a refresh', async () => {
    let release;
    const t = setup({ recheck: () => new Promise((r) => { release = () => r({ claim: fresh('n1'), creditsCharged: 100, balance: 900 }); }) });
    await ready(t);
    t.controller.recheckAsk('c1');
    const p = t.controller.recheckConfirm('c1');
    expect(t.rc().phase).toBe('running');
    expect(t.client.recheck).toHaveBeenCalledWith({ claimId: 'c1', expectedRecheckCredits: 100 });
    release();
    await p;
    expect(t.rc()).toMatchObject({ phase: 'idle', results: [expect.objectContaining({ id: 'n1', verdict: 'contradicted' })], notice: 'Charged 100 credits' });
    expect(t.rc().error).toBeNull();
    expect(t.credits.refresh).toHaveBeenCalled();
  });
  it('announces the new verdict once, through the shared announcement', async () => {
    const t = setup();
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.last().announcement).toBe('Contradicted: X is 5 (checked again)');
  });
  it('a second re-check goes against the newest row and keeps every earlier result, newest first', async () => {
    const t = setup();
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    t.client.recheck.mockResolvedValueOnce({ claim: fresh('n2', { supersedes: 'n1', verdict: 'partly_true' }), creditsCharged: 100, balance: 800 });
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.client.recheck).toHaveBeenLastCalledWith({ claimId: 'n1', expectedRecheckCredits: 100 });
    expect(t.rc().results.map((r) => r.id)).toEqual(['n2', 'n1']);
  });
  it('works after the session ended and is not touched by its budget', async () => {
    const t = setup();
    await ready(t);
    t.session.emit({ status: 'ended', endReason: 'time', budgetReached: true });
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.client.recheck).toHaveBeenCalledTimes(1);
    expect(t.rc().results).toHaveLength(1);
    expect(t.session.stop).not.toHaveBeenCalled();
  });
  it('a second press while one runs makes no second call', async () => {
    let release;
    const t = setup({ recheck: () => new Promise((r) => { release = () => r({ claim: fresh('n1'), creditsCharged: 100, balance: 900 }); }) });
    await ready(t);
    t.controller.recheckAsk('c1');
    const p = t.controller.recheckConfirm('c1');
    t.controller.recheckAsk('c1');
    void t.controller.recheckConfirm('c1');
    release();
    await p;
    expect(t.client.recheck).toHaveBeenCalledTimes(1);
  });
});

describe('a re-check that fails', () => {
  it('a returned error claim keeps the old verdict and says nothing was charged', async () => {
    const t = setup({ recheck: async () => ({ claim: fresh('n1', { status: 'error', verdict: null, reason: null, sources: [] }), creditsCharged: 0, balance: 1000 }) });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().error).toBe('The new check failed. Nothing was charged.');
    expect(t.rc().results).toEqual([]);
    expect(t.rc().phase).toBe('idle');
    expect(t.last().session.claims[0].verdict).toBe('supported');
    expect(t.credits.refresh).not.toHaveBeenCalled();
  });
  it('a 502 says the same', async () => {
    const t = setup({ recheck: async () => { throw new FactCheckError(502, 'server_error'); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().error).toBe('The new check failed. Nothing was charged.');
  });
  it('after a failure the same card can be asked again, against the same row', async () => {
    const t = setup({ recheck: async () => { throw new FactCheckError(502, 'server_error'); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    t.client.recheck.mockResolvedValueOnce({ claim: fresh('n1'), creditsCharged: 100, balance: 900 });
    t.controller.recheckAsk('c1');
    expect(t.rc().error).toBeNull();
    await t.controller.recheckConfirm('c1');
    expect(t.client.recheck).toHaveBeenLastCalledWith({ claimId: 'c1', expectedRecheckCredits: 100 });
  });
  const LOST = 'The answer did not arrive. The check may have finished and been charged. Press Check again to see it.';
  it.each([[0, 'network'], [500, 'server_error'], [504, 'server_error']])('a lost answer (%s) says it may have been charged and refreshes credits', async (status, reason) => {
    const t = setup({ recheck: async () => { throw new FactCheckError(status, reason); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().error).toBe(LOST);
    expect(t.rc().phase).toBe('idle');
    expect(t.credits.refresh).toHaveBeenCalled();
  });
  it('a 503 is the plain failure, like a 502', async () => {
    const t = setup({ recheck: async () => { throw new FactCheckError(503, 'server_error'); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().error).toBe('The new check failed. Nothing was charged.');
    expect(t.credits.refresh).not.toHaveBeenCalled();
  });
  it('pressing Check again after a lost answer surfaces the paid result (409 with the claim)', async () => {
    const t = setup();
    t.client.recheck.mockRejectedValueOnce(new FactCheckError(0, 'network'));
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    t.client.recheck.mockRejectedValueOnce(new FactCheckError(409, 'not_recheckable', { claim: fresh('n1') }));
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().results.map((r) => r.id)).toEqual(['n1']);
    expect(t.rc().notice).toBe('This verdict was already checked again. Showing that result.');
  });
});

describe('refusals, in plain words', () => {
  it('price_changed shows the new price and asks again', async () => {
    const t = setup({ recheck: async () => { throw new FactCheckError(409, 'price_changed', { recheckCredits: 150 }); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.last().flag.recheckCredits).toBe(150);
    expect(t.rc()).toMatchObject({ phase: 'confirming', error: 'The price changed to 150 credits. Check again to confirm.' });
  });
  it('insufficient states needed and available', async () => {
    const t = setup({ recheck: async () => { throw new FactCheckError(402, 'insufficient', { needed: 100, available: 40 }); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().error).toBe('Not enough credits: this needs 100 credits and you have 40 credits.');
    expect(t.rc().phase).toBe('idle');
  });
  it.each([
    [409, 'not_recheckable', undefined, /cannot be checked again/i],
    [404, 'claim_not_found', undefined, /could no longer be found/i],
    [401, 'signed_out', undefined, /sign-in has expired/i],
  ])('%s %s', async (status, reason, extra, pattern) => {
    const t = setup({ recheck: async () => { throw new FactCheckError(status, reason, extra); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().error).toMatch(pattern);
    expect(t.rc().phase).toBe('idle');
  });
});

describe('a verdict that is already checked again (409 with the claim)', () => {
  const stale = (claim) => async () => { throw new FactCheckError(409, 'not_recheckable', { claim }); };
  it('shows the newer paid result as the newest, without a charge message', async () => {
    const t = setup({ recheck: stale(fresh('n9', { verdict: 'partly_true' })) });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc()).toMatchObject({ phase: 'idle', error: null, notice: 'This verdict was already checked again. Showing that result.' });
    expect(t.rc().results.map((r) => r.id)).toEqual(['n9']);
    expect(t.last().announcement).toBe('Partly true: X is 5 (checked again)');
    expect(t.credits.refresh).not.toHaveBeenCalled();
  });
  it('does not add the same result twice', async () => {
    const t = setup({ recheck: stale(fresh('n1')) });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().results).toHaveLength(1);
  });
  it('without a usable claim it is the plain message', async () => {
    for (const claim of [undefined, fresh('n1', { status: 'error', verdict: null })]) {
      const t = setup({ recheck: stale(claim) });
      await ready(t);
      t.controller.recheckAsk('c1');
      await t.controller.recheckConfirm('c1');
      expect(t.rc().error).toBe('This verdict cannot be checked again.');
      expect(t.rc().results).toEqual([]);
    }
  });
});

describe('charge wording', () => {
  it('a delayed charge shows the verdict with the confirmed price as "will be charged", and refreshes credits', async () => {
    const t = setup({ recheck: async () => ({ claim: fresh('n1'), creditsCharged: null, balance: 1000, chargePending: true }) });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().results).toHaveLength(1);
    expect(t.rc().notice).toBe('100 credits will be charged.');
    expect(t.credits.refresh).toHaveBeenCalled();
  });
  it('a checked claim with a non-number charge is treated as pending', async () => {
    const t = setup({ recheck: async () => ({ claim: fresh('n1'), creditsCharged: undefined, balance: 1, chargePending: false }) });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().notice).toBe('100 credits will be charged.');
  });
  it('sends exactly the price shown in the confirmation, even if the flag moved meanwhile', async () => {
    const t = setup();
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1', 80);
    expect(t.client.recheck).toHaveBeenCalledWith({ claimId: 'c1', expectedRecheckCredits: 80 });
    expect(t.rc().notice).toBe('Charged 100 credits');
  });
});

describe('announcements', () => {
  it('announces "Checking again" at the start and a failure once', async () => {
    let release;
    const t = setup({ recheck: () => new Promise((_, reject) => { release = () => reject(new FactCheckError(502, 'server_error')); }) });
    await ready(t);
    t.controller.recheckAsk('c1');
    const p = t.controller.recheckConfirm('c1');
    expect(t.last().announcement).toBe('Checking again: X is 5');
    release();
    await p;
    expect(t.last().announcement).toBe('The new check failed. Nothing was charged.');
  });
});

describe('too many failures', () => {
  it('is not retried, says why, and the card gets no button for the rest of the panel', async () => {
    const t = setup({ recheck: async () => { throw new FactCheckError(429, 'too_many_failures'); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.client.recheck).toHaveBeenCalledTimes(1);
    expect(t.sleep).not.toHaveBeenCalled();
    expect(t.rc()).toMatchObject({ locked: true, phase: 'idle', error: 'Checking again is unavailable for now after repeated failures.' });
    t.controller.recheckAsk('c1');
    expect(t.rc().phase).toBe('idle');
    await t.controller.recheckConfirm('c1');
    expect(t.client.recheck).toHaveBeenCalledTimes(1);
  });
});

describe('switched off or not allowed', () => {
  it.each([[403, 'off', /switched off/i], [403, 'not_allowed', /not available for this account/i]])('%s %s clears the price everywhere and says so at panel level', async (status, reason, pattern) => {
    const t = setup({ recheck: async () => { throw new FactCheckError(status, reason); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.last().flag.recheckCredits).toBeNull();
    expect(t.last().recheckNotices[0]).toMatch(pattern);
    t.controller.recheckAsk('c1');
    expect(t.rc()?.phase ?? 'idle').toBe('idle');
  });
});

describe('after the panel was reset', () => {
  async function leave(recheck) {
    let release;
    const t = setup({ recheck: () => new Promise((resolve, reject) => { release = (v, fail) => (fail ? reject(fail) : resolve(v)); }) });
    await ready(t);
    t.controller.recheckAsk('c1');
    const p = t.controller.recheckConfirm('c1');
    t.controller.setTarget('other|live|x');
    return { t, finish: async (v, fail) => { release(v, fail); await p; } };
  }
  it('a charged late result is announced at panel level with the amount, and credits refresh', async () => {
    const { t, finish } = await leave();
    await finish({ claim: fresh('n1'), creditsCharged: 100, balance: 900, chargePending: false });
    expect(t.last().rechecks).toEqual({});
    expect(t.last().recheckNotices).toEqual(['A re-check finished after you left: Contradicted. Charged 100 credits.']);
    expect(t.credits.refresh).toHaveBeenCalled();
  });
  it('a delayed late charge says it will be charged', async () => {
    const { t, finish } = await leave();
    await finish({ claim: fresh('n1'), creditsCharged: null, balance: 900, chargePending: true });
    expect(t.last().recheckNotices).toEqual(['A re-check finished after you left: Contradicted. 100 credits will be charged.']);
  });
  it('a late failed claim needs no notice and charges nothing', async () => {
    const { t, finish } = await leave();
    await finish({ claim: fresh('n1', { status: 'error', verdict: null }), creditsCharged: 0, balance: 900, chargePending: false });
    expect(t.last().recheckNotices).toEqual([]);
  });
  it('a late lost answer warns that a charge may have happened and refreshes credits', async () => {
    const { t, finish } = await leave();
    await finish(null, new FactCheckError(0, 'network'));
    expect(t.last().recheckNotices[0]).toMatch(/may have finished after you left and been charged/i);
    expect(t.credits.refresh).toHaveBeenCalled();
  });
  it('the notices can be dismissed, and a new session clears them', async () => {
    const { t, finish } = await leave();
    await finish({ claim: fresh('n1'), creditsCharged: 100, balance: 900, chargePending: false });
    t.last().recheckActions.dismissNotices();
    expect(t.last().recheckNotices).toEqual([]);
    const u = (await leave());
    await u.finish({ claim: fresh('n1'), creditsCharged: 100, balance: 900, chargePending: false });
    expect(u.t.last().recheckNotices).toHaveLength(1);
    u.t.session.emit({ status: 'idle' });
    u.t.session.emit({ status: 'sharing' });
    expect(u.t.last().recheckNotices).toEqual([]);
  });
  it('the retry that follows a 429 is not sent once the panel has reset', async () => {
    const t = setup({ sleepImpl: async () => { t.controller.setTarget('other|live|x'); } });
    t.client.recheck.mockRejectedValue(new FactCheckError(429, 'rate_limited', { retryAfterMs: 1000 }));
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.client.recheck).toHaveBeenCalledTimes(1);
    expect(t.last().recheckNotices).toEqual([]);
  });
});

describe('rate limits', () => {
  it('waits the given time and retries once, then succeeds', async () => {
    const t = setup();
    t.client.recheck.mockRejectedValueOnce(new FactCheckError(429, 'rate_limited', { retryAfterMs: 2000 }));
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.sleep).toHaveBeenCalledTimes(1);
    expect(t.sleep).toHaveBeenCalledWith(2000);
    expect(t.client.recheck).toHaveBeenCalledTimes(2);
    expect(t.rc().results).toHaveLength(1);
  });
  it('a second refusal ends in a message, with no third call', async () => {
    const t = setup({ recheck: async () => { throw new FactCheckError(429, 'rate_limited', { retryAfterMs: 1000 }); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.client.recheck).toHaveBeenCalledTimes(2);
    expect(t.rc().error).toBe('Too many checks just now. Wait a minute and try again.');
  });
  it('in_progress has its own message', async () => {
    const t = setup({ recheck: async () => { throw new FactCheckError(429, 'in_progress', { retryAfterMs: 1000 }); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().error).toBe('This claim is already being checked again.');
  });
  it('caps the wait and defaults it when none is given', async () => {
    const t = setup({ recheck: async () => { throw new FactCheckError(429, 'rate_limited', { retryAfterMs: 600000 }); } });
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.sleep.mock.calls[0][0]).toBe(30000);
    const u = setup({ recheck: async () => { throw new FactCheckError(429, 'rate_limited'); } });
    await ready(u);
    u.controller.recheckAsk('c1');
    await u.controller.recheckConfirm('c1');
    expect(u.sleep.mock.calls[0][0]).toBe(5000);
  });
});

describe('clearing', () => {
  async function withResult() {
    const t = setup();
    await ready(t);
    t.controller.recheckAsk('c1');
    await t.controller.recheckConfirm('c1');
    expect(t.rc().results).toHaveLength(1);
    return t;
  }
  it('a new target clears every re-check', async () => {
    const t = await withResult();
    t.controller.setTarget('other|live|x');
    expect(t.last().rechecks).toEqual({});
  });
  it('dismissing the panel clears them', async () => {
    const t = await withResult();
    t.controller.dismiss();
    expect(t.last().rechecks).toEqual({});
  });
  it('a result that arrives after the panel was cleared is dropped', async () => {
    let release;
    const t = setup({ recheck: () => new Promise((r) => { release = () => r({ claim: fresh('n1'), creditsCharged: 100, balance: 900 }); }) });
    await ready(t);
    t.controller.recheckAsk('c1');
    const p = t.controller.recheckConfirm('c1');
    t.controller.setTarget('other|live|x');
    release();
    await p;
    expect(t.last().rechecks).toEqual({});
  });
});
