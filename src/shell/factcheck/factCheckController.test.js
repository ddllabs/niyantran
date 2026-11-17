// F344 T6: the controller owns the session for the modal. Stopping on a channel, video or modal
// change is logic here, tested without React or a browser.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { createFactCheckController } from './factCheckController.js';

const ON = { available: true, creditsPerMinute: 500, userId: 'u1' };
const OFF = { available: false, creditsPerMinute: null, userId: 'u1' };
const idle = (status = 'idle', extra = {}) => ({
  status, sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, final: null, endReason: null, error: null, ...extra,
});

function fakeSession(handlers) {
  let state = idle();
  const s = {
    calls: [],
    emit(next) { state = { ...state, ...next }; handlers.onChange(state); },
    getState: () => state,
    choose: vi.fn(() => s.emit({ status: 'choosing' })),
    cancelChoice: vi.fn(() => s.emit({ status: 'idle' })),
    start: vi.fn(async (p) => { s.started = p; s.emit({ status: 'sharing' }); }),
    stop: vi.fn(async (reason) => { s.emit({ status: 'ended', endReason: reason, sessionId: 'S' }); }),
    reset: vi.fn(() => s.emit({ ...idle() })),
    stopOrphan: vi.fn(async () => ({ minutes_used: 2, credits_charged: 1000, balance: 9000 })),
  };
  return s;
}

function setup({ flag = ON, supported = true, balance = 10000 } = {}) {
  const changes = [];
  const credits = {
    available: vi.fn(() => balance),
    refresh: vi.fn(async () => {}),
    subscribe: vi.fn(() => { credits.unsub = vi.fn(); return credits.unsub; }),
  };
  let session;
  const createSession = vi.fn((handlers) => (session = fakeSession(handlers)));
  const controller = createFactCheckController({
    createSession, readFlag: vi.fn(async () => flag), supported: () => supported, credits,
    onChange: (v) => changes.push(v),
  });
  return { controller, credits, createSession, session: () => session, changes, last: () => changes.at(-1) };
}

describe('loading', () => {
  it('reads the flag and browser support, then publishes', async () => {
    const t = setup();
    await t.controller.load();
    expect(t.last()).toMatchObject({ flag: ON, supported: true, balance: 10000 });
    expect(t.createSession).not.toHaveBeenCalled();
  });
  it('a flag that is off creates no session and takes no credit subscription', async () => {
    const t = setup({ flag: OFF });
    await t.controller.load();
    expect(t.last().flag.available).toBe(false);
    expect(t.credits.subscribe).not.toHaveBeenCalled();
    t.controller.choose();
    expect(t.createSession).not.toHaveBeenCalled();
  });
  it('an unexpected read failure is off', async () => {
    const changes = [];
    const c = createFactCheckController({ readFlag: async () => { throw new Error('x'); }, supported: () => true, onChange: (v) => changes.push(v) });
    await c.load();
    expect(changes.at(-1).flag.available).toBe(false);
  });
  it('a read that finishes after close is dropped', async () => {
    let release;
    const changes = [];
    const c = createFactCheckController({
      readFlag: () => new Promise((r) => { release = r; }), supported: () => true, onChange: (v) => changes.push(v),
      credits: { available: () => null, refresh: async () => {}, subscribe: () => () => {} },
    });
    const p = c.load();
    c.close();
    release(ON);
    await p;
    expect(changes.some((v) => v.flag.available)).toBe(false);
  });
});

describe('ending another session', () => {
  const orphanError = { source: 'start', reason: 'already_active', status: 409, sessionId: 'other-1' };
  it('stops it, shows what it cost, refreshes credits and returns to choosing', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.session().emit({ status: 'error', sessionId: null, error: orphanError });
    t.credits.refresh.mockClear();
    await t.controller.endOrphan();
    expect(t.session().stopOrphan).toHaveBeenCalledWith('other-1');
    expect(t.credits.refresh).toHaveBeenCalled();
    expect(t.last().session.status).toBe('choosing');
    expect(t.last().orphanNotice).toBe('The other session was ended. Used 2 minutes, charged 1,000 credits.');
    expect(t.last().orphanFailed).toBe(false);
  });
  it('a failure is reported and leaves the error and its button in place', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.session().emit({ status: 'error', sessionId: null, error: orphanError });
    t.session().stopOrphan.mockRejectedValueOnce(new Error('x'));
    await t.controller.endOrphan();
    expect(t.last().orphanFailed).toBe(true);
    expect(t.last().session.status).toBe('error');
  });
  it('does nothing without a session id', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.session().emit({ status: 'error', sessionId: null, error: { ...orphanError, sessionId: undefined } });
    await t.controller.endOrphan();
    expect(t.session().stopOrphan).not.toHaveBeenCalled();
  });
});

describe('readiness', () => {
  it('is ready only while a target (something playing) is set', async () => {
    const t = setup();
    await t.controller.load();
    expect(t.last().ready).toBe(false);
    t.controller.setTarget('dd-news|live|abc');
    expect(t.last().ready).toBe(true);
    t.controller.setTarget(null);
    expect(t.last().ready).toBe(false);
  });
  it('losing the target stops a running session', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.setTarget('a|live|b');
    t.controller.choose();
    t.session().emit({ status: 'running' });
    t.controller.setTarget(null);
    expect(t.session().stop).toHaveBeenCalledWith('channel_change');
  });
});

describe('the price the user agrees to', () => {
  it('choose re-reads the flag bypassing the cache, and shows the fresh price', async () => {
    const t = setup();
    await t.controller.load();
    const read = vi.fn(async () => ({ ...ON, creditsPerMinute: 600 }));
    const c = createFactCheckController({
      createSession: t.createSession, readFlag: read, supported: () => true, credits: { available: () => 1e6, refresh: async () => {}, subscribe: () => () => {} },
      onChange: (v) => t.changes.push(v),
    });
    await c.load();
    read.mockClear();
    c.choose();
    await new Promise((r) => setTimeout(r, 0));
    expect(read).toHaveBeenCalledWith({ fresh: true });
    expect(t.last().flag.creditsPerMinute).toBe(600);
  });
  it('a fresh read that turns the feature off cancels the choice', async () => {
    const t = setup();
    await t.controller.load();
    let n = 0;
    const read = async () => (++n === 1 ? ON : OFF);
    const c = createFactCheckController({
      createSession: t.createSession, readFlag: read, supported: () => true, credits: { available: () => 1, refresh: async () => {}, subscribe: () => () => {} },
      onChange: (v) => t.changes.push(v),
    });
    await c.load();
    c.choose();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.session().cancelChoice).toHaveBeenCalled();
    expect(t.last().flag.available).toBe(false);
  });
  it('a start refused with price_changed returns to choosing at the fresh price, with a notice', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.session().emit({ status: 'error', sessionId: null, error: { source: 'start', reason: 'price_changed', status: 409, creditsPerMinute: 700 } });
    expect(t.last().session.status).toBe('choosing');
    expect(t.last().flag.creditsPerMinute).toBe(700);
    expect(t.last().priceNotice).toBe('The price changed to 700 credits a minute. Review and start again.');
    t.session().emit({ status: 'sharing' });
    expect(t.last().priceNotice).toBe('');
  });
  it('a price_changed without a usable price is shown as an error', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.session().emit({ status: 'error', sessionId: null, error: { source: 'start', reason: 'price_changed', status: 409 } });
    expect(t.last().session.status).toBe('error');
  });
});

describe('choosing and starting', () => {
  it('choose refreshes the balance and starts the session with the video, channel, kind and seed', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    expect(t.credits.refresh).toHaveBeenCalled();
    expect(t.last().session.status).toBe('choosing');
    const params = { videoId: 'abc', channelId: 'dd-news', videoKind: 'live', startPositionS: null, seed: { channel: 'DD News', title: '' } };
    await t.controller.start(params, 10, 500);
    expect(t.session().start).toHaveBeenCalledWith({ ...params, minutes: 10, expectedCreditsPerMinute: 500 });
  });
  it('cancel returns to idle', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.controller.cancel();
    expect(t.last().session.status).toBe('idle');
  });
  it('retry goes back to choosing', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.session().emit({ status: 'error', error: { source: 'start', reason: 'network', status: 0 } });
    t.controller.retry();
    expect(t.session().reset).toHaveBeenCalled();
    expect(t.last().session.status).toBe('choosing');
  });
  it('stop asks the session to stop for the user; dismiss resets', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.session().emit({ status: 'running' });
    await t.controller.stop();
    expect(t.session().stop).toHaveBeenCalledWith('user');
    t.controller.dismiss();
    expect(t.session().reset).toHaveBeenCalled();
  });
  it('a start that rejects is swallowed (the session reports its own error)', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.session().start.mockRejectedValueOnce(new Error('boom'));
    await expect(t.controller.start({ videoId: 'a', channelId: 'c', videoKind: 'live', seed: {} }, 5)).resolves.toBeUndefined();
  });
});

describe('stopping on change', () => {
  async function running() {
    const t = setup();
    await t.controller.load();
    t.controller.setTarget('dd-news|live|abc');
    t.controller.choose();
    t.session().emit({ status: 'running' });
    return t;
  }
  it('the first target is a baseline and stops nothing', async () => {
    const t = await running();
    expect(t.session().stop).not.toHaveBeenCalled();
  });
  it('the same target again stops nothing', async () => {
    const t = await running();
    t.controller.setTarget('dd-news|live|abc');
    expect(t.session().stop).not.toHaveBeenCalled();
  });
  it.each([
    ['channel', 'sansad-tv|live|abc'],
    ['video', 'dd-news|video|zzz'],
    ['playback mode', 'dd-news|archive|abc'],
  ])('a changed %s stops a running session with channel_change', async (_n, key) => {
    const t = await running();
    t.controller.setTarget(key);
    expect(t.session().stop).toHaveBeenCalledWith('channel_change');
  });
  it('a change while waiting for sharing or starting stops it too', async () => {
    for (const status of ['sharing', 'starting', 'ending']) {
      const t = await running();
      t.session().emit({ status });
      t.controller.setTarget('other|live|x');
      expect(t.session().stop).toHaveBeenCalledWith('channel_change');
    }
  });
  it('a change while choosing cancels the choice; after the end it clears the old results', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.setTarget('a');
    t.controller.choose();
    t.controller.setTarget('b');
    expect(t.session().cancelChoice).toHaveBeenCalled();
    expect(t.session().stop).not.toHaveBeenCalled();
    t.session().emit({ status: 'ended' });
    t.controller.setTarget('c');
    expect(t.session().reset).toHaveBeenCalled();
  });
  it('closing the modal stops a running session with modal_close and keeps the summary', async () => {
    const t = await running();
    await t.controller.close();
    expect(t.session().stop).toHaveBeenCalledWith('modal_close');
    expect(t.session().reset).not.toHaveBeenCalled();
    expect(t.last().session).toMatchObject({ status: 'ended', endReason: 'modal_close' });
    expect(t.credits.unsub).toHaveBeenCalled();
  });
  it('closing with nothing running is quiet', async () => {
    const t = setup();
    await t.controller.load();
    await t.controller.close();
    expect(t.createSession).not.toHaveBeenCalled();
  });
  it('closing while choosing cancels the choice', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    await t.controller.close();
    expect(t.session().cancelChoice).toHaveBeenCalled();
  });
});

describe('credits and announcements', () => {
  it('refreshes the credits once when a run ends, and once when it errors after starting', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.credits.refresh.mockClear();
    t.session().emit({ status: 'running', sessionId: 'S' });
    expect(t.credits.refresh).not.toHaveBeenCalled();
    t.session().emit({ status: 'ended', sessionId: 'S', final: { minutes_used: 1, credits_charged: 500, balance: 9500 } });
    t.session().emit({ status: 'ended', sessionId: 'S' });
    expect(t.credits.refresh).toHaveBeenCalledTimes(1);
  });
  it('refreshes the credits when a start gets no answer, since it may have been charged', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.credits.refresh.mockClear();
    t.session().emit({ status: 'error', sessionId: null, error: { source: 'start', reason: 'timeout', status: 0 } });
    expect(t.credits.refresh).toHaveBeenCalledTimes(1);
  });
  it('does not refresh for an error that happened before any server session', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.credits.refresh.mockClear();
    t.session().emit({ status: 'error', sessionId: null, error: { source: 'capture', reason: 'denied', status: 0 } });
    expect(t.credits.refresh).not.toHaveBeenCalled();
  });
  it('announces each newly checked verdict once', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    const checked = { id: 'c1', status: 'checked', verdict: 'contradicted', claim_en: 'X is 5', sources: [] };
    t.session().emit({ status: 'running', claims: [{ id: 'c1', status: 'pending', verdict: null, claim_en: 'X is 5', sources: [] }] });
    expect(t.last().announcement).toBe('');
    t.session().emit({ claims: [checked] });
    expect(t.last().announcement).toBe('Contradicted: X is 5');
    t.session().emit({ claims: [checked, { id: 'c2', status: 'checked', verdict: 'supported', claim_en: 'Y', sources: [] }] });
    expect(t.last().announcement).toBe('Supported: Y');
    t.session().emit({ secondsLeft: 3 });
    expect(t.last().announcement).toBe('Supported: Y');
  });
  it('does not announce an unknown verdict', async () => {
    const t = setup();
    await t.controller.load();
    t.controller.choose();
    t.session().emit({ status: 'running', claims: [{ id: 'c1', status: 'checked', verdict: 'weird', claim_en: 'Z', sources: [] }] });
    expect(t.last().announcement).toBe('');
  });
  it('republishes when the balance changes', async () => {
    const t = setup({ balance: 100 });
    await t.controller.load();
    const sub = t.credits.subscribe.mock.calls[0][0];
    t.credits.available.mockReturnValue(900);
    sub();
    expect(t.last().balance).toBe(900);
  });
});

describe('F349: capture failures in a row', () => {
  const capErr = { source: 'capture', reason: 'failed', status: 0 };
  async function ready(t) { await t.controller.load(); t.controller.setTarget('a|live|b'); t.controller.choose(); }
  it('counts failed captures in a row and publishes the count', async () => {
    const t = setup();
    await ready(t);
    expect(t.last().captureFailures).toBe(0);
    t.session().emit({ status: 'error', error: capErr });
    expect(t.last().captureFailures).toBe(1);
    t.session().emit({ status: 'choosing', error: null });
    t.session().emit({ status: 'sharing' });
    t.session().emit({ status: 'error', error: capErr });
    expect(t.last().captureFailures).toBe(2);
  });
  it('decline, decline, then one real failure still offers Try again (declines and no-audio leave the count alone)', async () => {
    const t = setup();
    await ready(t);
    for (const reason of ['denied', 'denied', 'no_audio']) {
      t.session().emit({ status: 'sharing', error: null });
      t.session().emit({ status: 'error', error: { source: 'capture', reason, status: 0 } });
      expect(t.last().captureFailures).toBe(0);
    }
    t.session().emit({ status: 'sharing', error: null });
    t.session().emit({ status: 'error', error: capErr });
    expect(t.last().captureFailures).toBe(1);
  });
  it('a decline between two real failures neither adds nor resets', async () => {
    const t = setup();
    await ready(t);
    const go = (reason) => { t.session().emit({ status: 'sharing', error: null }); t.session().emit({ status: 'error', error: { source: 'capture', reason, status: 0 } }); };
    go('blocked'); go('denied');
    expect(t.last().captureFailures).toBe(1);
    go('failed');
    expect(t.last().captureFailures).toBe(2);
  });
  it('a session that really starts clears the count', async () => {
    const t = setup();
    await ready(t);
    t.session().emit({ status: 'error', error: capErr });
    t.session().emit({ status: 'sharing', error: null });
    t.session().emit({ status: 'running', error: null, sessionId: 'S' });
    expect(t.last().captureFailures).toBe(0);
  });
  it('another kind of error clears it, and so does dismissing the panel', async () => {
    const t = setup();
    await ready(t);
    t.session().emit({ status: 'error', error: capErr });
    t.session().emit({ status: 'sharing', error: null });
    t.session().emit({ status: 'error', error: { source: 'start', reason: 'insufficient', status: 402 } });
    expect(t.last().captureFailures).toBe(0);
    t.session().emit({ status: 'sharing', error: null });
    t.session().emit({ status: 'error', error: capErr });
    expect(t.last().captureFailures).toBe(1);
    t.controller.dismiss();
    expect(t.last().captureFailures).toBe(0);
  });
  it('Try again (reset, then choose) keeps the count, so the second failure is seen as the second', async () => {
    const t = setup();
    await ready(t);
    t.session().emit({ status: 'error', error: capErr });
    t.controller.retry();
    t.session().emit({ status: 'sharing' });
    t.session().emit({ status: 'error', error: capErr });
    expect(t.last().captureFailures).toBe(2);
  });
  it('re-emitting the same error does not count it twice', async () => {
    const t = setup();
    await ready(t);
    t.session().emit({ status: 'error', error: capErr });
    t.session().emit({ status: 'error', error: capErr, announcement: 'x' });
    expect(t.last().captureFailures).toBe(1);
  });
});
