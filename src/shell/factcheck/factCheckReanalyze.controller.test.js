// F363: "Re-analyze this block" in the controller: the length it preselects, the seek and its 3 second
// check, what it refuses, and that nothing is started or charged until the user confirms.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { PREPARE_WAIT_MS, SEEK_TOLERANCE_S, SEEK_WAIT_MS, createFactCheckController } from './factCheckController.js';

const ON = { available: true, creditsPerMinute: 500, recheckCredits: 100, sharing: { unlockCreditsPerMinute: 100 }, userId: 'u1' };
const base = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false,
  final: null, endReason: null, error: null,
};
const stretch = (id, over = {}) => ({
  stretch_id: id, from_s: 130, to_s: 460, minutes: 6, checked_on: '2026-11-16', claims_count: 1, access: 'own', price: 500, lines: [], claims: [], ...over,
});
const RECORDED = { videoId: 'vid1', videoKind: 'recorded' };
const flush = () => vi.advanceTimersByTimeAsync(0);

function setup({ flag = ON, stretches = [stretch('s1')], moves = true, withSeek = true, readingDelay = 0 } = {}) {
  const changes = [];
  let state = { ...base };
  const handlers = {};
  const position = { current: { positionS: 10, playerState: 1 } };
  const session = {
    stop: vi.fn(async () => {}), reset: vi.fn(() => { session.emit({ ...base }); }),
    choose: vi.fn(() => session.emit({ status: 'choosing' })), cancelChoice: vi.fn(() => session.emit({ status: 'idle' })), start: vi.fn(),
    emit(next) { state = { ...state, ...next }; handlers.onChange(state); },
  };
  const credits = { available: vi.fn(() => 100000), refresh: vi.fn(async () => {}), subscribe: () => () => {} };
  const client = {
    videoView: vi.fn(async () => ({ ok: true, unlock_credits_per_minute: 100, stretches })),
    unlock: vi.fn(), report: vi.fn(), recheck: vi.fn(),
  };
  const seek = vi.fn((s) => {
    position.current = null; // the bridge forgets the old reading when it sends a seek
    if (moves) setTimeout(() => { position.current = { positionS: s, playerState: 1 }; }, readingDelay);
    return true;
  });
  const controller = createFactCheckController({
    createSession: (h) => { Object.assign(handlers, h); return session; },
    readFlag: async () => flag, supported: () => true, credits, client,
    getPosition: () => position.current, ...(withSeek ? { seek } : {}), sleep: async () => {},
    onChange: (v) => changes.push(v),
  });
  return { controller, session, client, seek, position, last: () => changes.at(-1), sh: () => changes.at(-1).shared, changes };
}
async function open(t) {
  await t.controller.load();
  t.controller.setVideo(RECORDED);
  t.controller.setTarget('ch|video|vid1');
  t.controller.choose();
  await flush();
  await flush();
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the length it preselects', () => {
  it.each([[3, 5], [6, 10], [12, 15], [30, 30], [45, 30], [1, 1]])('a stretch of %s minutes opens at %s', async (minutes, out) => {
    const t = setup({ stretches: [stretch('s1', { minutes })] });
    await open(t);
    expect(t.controller.reanalyze('s1')).toBe(true);
    expect(t.sh().reanalysis).toMatchObject({ stretchId: 's1', minutes: out, fromS: 130 });
  });
});

describe('what it accepts', () => {
  it('works for an unlocked stretch too, but not a locked one or an unknown id', async () => {
    const t = setup({ stretches: [stretch('u', { access: 'unlocked' }), stretch('l', { access: 'locked', lines: undefined, claims: undefined })] });
    await open(t);
    expect(t.controller.reanalyze('l')).toBe(false);
    expect(t.controller.reanalyze('nope')).toBe(false);
    expect(t.seek).not.toHaveBeenCalled();
    expect(t.sh().reanalysis).toBeUndefined();
    expect(t.controller.reanalyze('u')).toBe(true);
  });

  it.each(['sharing', 'starting', 'running', 'ending'])('refuses while a session is %s', async (status) => {
    const t = setup();
    await open(t);
    t.session.emit({ status });
    expect(t.controller.reanalyze('s1')).toBe(false);
    expect(t.seek).not.toHaveBeenCalled();
    expect(t.last().shared.reanalysis).toBeUndefined();
  });

  it('opens the start screen from the choose step without resetting the session', async () => {
    const t = setup();
    await open(t);
    t.session.reset.mockClear();
    t.controller.reanalyze('s1');
    expect(t.session.reset).not.toHaveBeenCalled();
    expect(t.last().session.status).toBe('choosing');
  });

  it.each(['ended', 'error'])('opens the start screen from a session that %s', async (status) => {
    const t = setup();
    await open(t);
    t.session.emit({ status });
    expect(t.controller.reanalyze('s1')).toBe(true);
    expect(t.session.reset).toHaveBeenCalledTimes(1);
    await flush();
    expect(t.last().session.status).toBe('choosing');
    expect(t.sh().reanalysis).toMatchObject({ stretchId: 's1' });
  });

  it('does nothing with the feature off or sharing off', async () => {
    for (const flag of [{ ...ON, available: false }, { ...ON, sharing: null }]) {
      const t = setup({ flag });
      await t.controller.load();
      t.controller.setVideo(RECORDED);
      t.controller.setTarget('ch|video|vid1');
      expect(t.controller.reanalyze('s1')).toBe(false);
      expect(t.seek).not.toHaveBeenCalled();
      expect(t.last().shared ?? null).toBeNull();
    }
  });
});

describe('nothing is charged or started before the user confirms', () => {
  it('pressing the button seeks and opens the start screen, but starts no session and calls no paid endpoint', async () => {
    const t = setup();
    await open(t);
    t.controller.reanalyze('s1');
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.session.start).not.toHaveBeenCalled();
    expect(t.client.unlock).not.toHaveBeenCalled();
    expect(t.client.recheck).not.toHaveBeenCalled();
    expect(t.client.report).not.toHaveBeenCalled();
    expect(t.seek).toHaveBeenCalledWith(130);
  });

  it('the start is the ordinary start, called once, by the confirm control only', async () => {
    const t = setup();
    await open(t);
    t.controller.reanalyze('s1');
    await t.controller.start({ videoId: 'vid1', startPositionS: 131 }, 10, 500);
    expect(t.session.start).toHaveBeenCalledTimes(1);
    expect(t.session.start).toHaveBeenCalledWith({ videoId: 'vid1', startPositionS: 131, minutes: 10, expectedCreditsPerMinute: 500 });
  });
});

describe('the seek and its 3 second check', () => {
  it('asks the player to move to the stretch start', async () => {
    const t = setup();
    await open(t);
    t.controller.reanalyze('s1');
    expect(t.seek).toHaveBeenCalledTimes(1);
    expect(t.seek).toHaveBeenCalledWith(130);
  });

  it('is fine when the player reports a position near the target', async () => {
    const t = setup();
    await open(t);
    t.controller.reanalyze('s1');
    await vi.advanceTimersByTimeAsync(SEEK_WAIT_MS + 1000);
    expect(t.sh().reanalysis.seek).toBe('ok');
    expect(vi.getTimerCount()).toBe(1); // the check goes on while the start screen is open
  });

  it('is pending until 3 seconds have passed, then late, if the player does not move', async () => {
    const t = setup({ moves: false });
    await open(t);
    t.controller.reanalyze('s1');
    expect(SEEK_WAIT_MS).toBe(3000);
    await vi.advanceTimersByTimeAsync(2999);
    expect(t.sh().reanalysis.seek).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(t.sh().reanalysis.seek).toBe('late');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('is ok if the position arrives just before the 3 seconds are up', async () => {
    const t = setup({ moves: false });
    await open(t);
    t.controller.reanalyze('s1');
    await vi.advanceTimersByTimeAsync(2500);
    t.position.current = { positionS: 131, playerState: 1 };
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sh().reanalysis.seek).toBe('ok');
  });

  it('does not count a reading taken before the seek was sent: pending until a fresh one arrives', async () => {
    const t = setup({ readingDelay: 2000 });
    await open(t);
    t.controller.reanalyze('s1');
    await vi.advanceTimersByTimeAsync(1500);
    expect(t.sh().reanalysis.seek).toBe('pending');
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sh().reanalysis.seek).toBe('ok');
  });

  it('near means within the tolerance of the stretch start', async () => {
    for (const [p, out] of [[130 + SEEK_TOLERANCE_S, 'ok'], [130 - SEEK_TOLERANCE_S, 'ok'], [130 - SEEK_TOLERANCE_S - 1, 'late'], [400, 'late'], [null, 'late']]) {
      const t = setup({ moves: false });
      await open(t);
      t.controller.reanalyze('s1');
      t.position.current = p === null ? null : { positionS: p, playerState: 1 };
      await vi.advanceTimersByTimeAsync(SEEK_WAIT_MS);
      expect(t.sh().reanalysis.seek).toBe(out);
      t.controller.cancel();
    }
  });

  it('is late when there is no way to seek at all, and still lets the user start', async () => {
    const t = setup({ withSeek: false, moves: false });
    await open(t);
    t.controller.reanalyze('s1');
    await vi.advanceTimersByTimeAsync(SEEK_WAIT_MS);
    expect(t.sh().reanalysis.seek).toBe('late');
    await t.controller.start({ videoId: 'vid1', startPositionS: 10 }, 5, 500);
    expect(t.session.start).toHaveBeenCalledTimes(1);
  });
});

describe('the check goes on while the start screen is open', () => {
  it('late becomes ok when the player reaches the target, and ok becomes late when the user moves away', async () => {
    const t = setup({ moves: false });
    await open(t);
    t.controller.reanalyze('s1');
    await vi.advanceTimersByTimeAsync(SEEK_WAIT_MS);
    expect(t.sh().reanalysis.seek).toBe('late');
    t.position.current = { positionS: 132, playerState: 1 };
    await vi.advanceTimersByTimeAsync(500);
    expect(t.sh().reanalysis.seek).toBe('ok');
    t.position.current = { positionS: 400, playerState: 1 };
    await vi.advanceTimersByTimeAsync(500);
    expect(t.sh().reanalysis.seek).toBe('late');
    t.position.current = { positionS: 20, playerState: 1 };
    await vi.advanceTimersByTimeAsync(500);
    expect(t.sh().reanalysis.seek).toBe('late');
  });

  it('a video that plays on after the seek stays ok for as long as playing explains the distance', async () => {
    const t = setup();
    await open(t);
    t.controller.reanalyze('s1');
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 1; i <= 40; i += 1) {
      await vi.advanceTimersByTimeAsync(1000);
      t.position.current = { positionS: 130 + 1 + i, playerState: 1 };
    }
    await vi.advanceTimersByTimeAsync(250);
    expect(t.sh().reanalysis.seek).toBe('ok');
  });
});

describe('the seek again when the user presses Start', () => {
  it('prepareStart is null when there is no re-analysis, and does not seek', async () => {
    const t = setup();
    await open(t);
    expect(t.controller.prepareStart()).toBeNull();
    expect(t.seek).not.toHaveBeenCalled();
  });

  it('seeks to the block start again and resolves once a reading taken after that seek is there', async () => {
    const t = setup({ readingDelay: 600 });
    await open(t);
    t.controller.reanalyze('s1');
    await vi.advanceTimersByTimeAsync(1000);
    t.seek.mockClear();
    t.position.current = { positionS: 150, playerState: 1 }; // the video played on
    let done = false;
    const p = t.controller.prepareStart().then(() => { done = true; });
    expect(t.seek).toHaveBeenCalledWith(130);
    expect(t.position.current).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    await p;
    expect(done).toBe(true);
    expect(t.position.current).toEqual({ positionS: 130, playerState: 1 });
  });

  it('gives up waiting after a short wait and lets the start go on', async () => {
    const t = setup({ moves: false });
    await open(t);
    t.controller.reanalyze('s1');
    let done = false;
    const p = t.controller.prepareStart().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(PREPARE_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });
});

describe('what a re-analysis may start from', () => {
  const run = async (error, extra = {}) => {
    const t = setup(extra.setup);
    await open(t);
    for (const e of extra.before || []) t.session.emit({ status: 'error', error: e }), t.session.emit({ status: 'choosing' });
    t.session.emit({ status: 'error', error });
    t.session.reset.mockClear();
    t.seek.mockClear();
    return { t, ok: t.controller.reanalyze('s1') };
  };
  it.each([
    ['a stop that could not be confirmed', { source: 'stop', status: 500 }],
    ['a start that got no answer', { source: 'start', status: 0 }],
    ['an other session still active, with its id', { reason: 'already_active', status: 409, sessionId: 'x1' }],
  ])('refuses after %s and leaves the state, the warning and Start alone', async (_n, error) => {
    const { t, ok } = await run(error);
    expect(ok).toBe(false);
    expect(t.session.reset).not.toHaveBeenCalled();
    expect(t.seek).not.toHaveBeenCalled();
    expect(t.last().session.status).toBe('error');
    expect(t.last().shared.reanalysis).toBeUndefined();
  });
  it('refuses after capture failed twice in a row', async () => {
    const f = { source: 'capture', reason: 'failed' };
    const { t, ok } = await run(f, { before: [f] });
    expect(ok).toBe(false);
    expect(t.session.reset).not.toHaveBeenCalled();
  });
  it.each([
    ['sharing declined', { source: 'capture', reason: 'denied' }],
    ['a service problem', { status: 500 }],
    ['not enough credits', { status: 402, reason: 'insufficient' }],
    ['an other session active with no id', { reason: 'already_active', status: 409 }],
  ])('accepts after %s, as Try again would', async (_n, error) => {
    const { t, ok } = await run(error);
    expect(ok).toBe(true);
    expect(t.session.reset).toHaveBeenCalledTimes(1);
  });
});

describe('a price change while the start screen is open', () => {
  it('goes back to the start screen with the re-analysis kept, preselect included', async () => {
    const t = setup({ stretches: [stretch('s1', { minutes: 12 })] });
    await open(t);
    t.controller.reanalyze('s1');
    await t.controller.start({ videoId: 'vid1' }, 15, 500);
    t.session.emit({ status: 'error', sessionId: null, error: { source: 'start', reason: 'price_changed', creditsPerMinute: 600 } });
    expect(t.last().session.status).toBe('choosing');
    expect(t.sh().reanalysis).toMatchObject({ stretchId: 's1', minutes: 15, fromS: 130 });
    expect(t.last().priceNotice).not.toBe('');
  });
  it('a plain start that meets a price change stays a plain start screen', async () => {
    const t = setup();
    await open(t);
    await t.controller.start({ videoId: 'vid1' }, 5, 500);
    t.session.emit({ status: 'error', sessionId: null, error: { source: 'start', reason: 'price_changed', creditsPerMinute: 600 } });
    expect(t.last().session.status).toBe('choosing');
    expect(t.sh().reanalysis).toBeUndefined();
  });
});

describe('it ends with the start screen', () => {
  it('closing the page clears the seek timers', async () => {
    const t = setup({ moves: false });
    await open(t);
    t.controller.reanalyze('s1');
    expect(vi.getTimerCount()).toBe(2);
    await t.controller.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancelling clears it and its timers', async () => {
    const t = setup({ moves: false });
    await open(t);
    t.controller.reanalyze('s1');
    t.controller.cancel();
    expect(t.last().shared?.reanalysis).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starting a session clears it', async () => {
    const t = setup({ moves: false });
    await open(t);
    t.controller.reanalyze('s1');
    t.session.emit({ status: 'sharing' });
    expect(t.last().shared.reanalysis).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a new video clears it', async () => {
    const t = setup({ moves: false });
    await open(t);
    t.controller.reanalyze('s1');
    t.controller.setVideo({ videoId: 'other', videoKind: 'recorded' });
    expect(t.last().shared ?? null).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pressing it again for another stretch replaces the first with a fresh token', async () => {
    const t = setup({ stretches: [stretch('s1'), stretch('s2', { from_s: 900, to_s: 1000, minutes: 2 })], moves: false });
    await open(t);
    t.controller.reanalyze('s1');
    const first = t.sh().reanalysis.token;
    t.controller.reanalyze('s2');
    expect(t.sh().reanalysis).toMatchObject({ stretchId: 's2', minutes: 2, fromS: 900, seek: 'pending' });
    expect(t.sh().reanalysis.token).not.toBe(first);
    expect(vi.getTimerCount()).toBe(2); // one poll, one deadline: the first's are gone
  });
});
