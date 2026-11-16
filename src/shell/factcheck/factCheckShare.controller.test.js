// F344 S3: shared results in the controller: loading "Checked parts", unlock, report, the part that
// covers the current position, and the position getter that reaches the session.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
import { FactCheckError } from '../../lib/factcheck/client.js';
import { createFactCheckController } from './factCheckController.js';

const ON = { available: true, creditsPerMinute: 500, recheckCredits: 100, sharing: { unlockCreditsPerMinute: 100 }, userId: 'u1' };
const base = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false,
  final: null, endReason: null, error: null,
};
const claim = (id, over = {}) => ({
  id, position_s: 140, quote: 'q', claim_en: `claim ${id}`, claimant: null, reported_by: null, kind: 'claim', status: 'checked',
  verdict: 'supported', reason: 'r', sources: [], checked_at: '2026-11-16T10:00:00Z', reported: false, ...over,
});
const stretch = (id, over = {}) => ({
  stretch_id: id, from_s: 100, to_s: 400, minutes: 5, checked_on: '2026-11-16', claims_count: 1, access: 'locked', price: 500, ...over,
});
const VIEW = (stretches) => ({ ok: true, unlock_credits_per_minute: 100, stretches });
const RECORDED = { videoId: 'vid1', videoKind: 'recorded' };

function setup({ flag = ON, stretches = [stretch('s1')], videoView, unlock, report, position = { positionS: 150, playerState: 1 }, balance = 1000 } = {}) {
  const changes = [];
  let state = { ...base };
  const handlers = {};
  const session = {
    stop: vi.fn(async () => {}), reset: vi.fn(() => { state = { ...base }; handlers.onChange(state); }),
    choose: vi.fn(() => session.emit({ status: 'choosing' })), cancelChoice: vi.fn(), start: vi.fn(),
    getState: () => state,
    emit(next) { state = { ...state, ...next }; handlers.onChange(state); },
  };
  const credits = { available: vi.fn(() => balance), refresh: vi.fn(async () => {}), subscribe: () => () => {} };
  const client = {
    videoView: vi.fn(videoView || (async () => VIEW(stretches))),
    unlock: vi.fn(unlock || (async () => ({ ok: true }))),
    report: vi.fn(report || (async () => ({ ok: true }))),
    recheck: vi.fn(async () => ({ claim: { id: 'n1', status: 'checked', verdict: 'contradicted', sources: [] }, creditsCharged: 100, balance: 1, chargePending: false })),
  };
  const getPosition = vi.fn(() => position);
  const createSession = vi.fn((h) => { Object.assign(handlers, h); return session; });
  const controller = createFactCheckController({
    createSession, readFlag: async () => flag, supported: () => true, credits, client, getPosition, sleep: async () => {},
    onChange: (v) => changes.push(v),
  });
  return { controller, session, credits, client, createSession, getPosition, last: () => changes.at(-1), sh: () => changes.at(-1).shared };
}

async function open(t, video = RECORDED) {
  await t.controller.load();
  t.controller.setVideo(video);
  t.controller.setTarget('ch|video|vid1');
  t.controller.choose();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('loading the checked parts', () => {
  it('loads when the panel opens on a recorded video, with sharing on', async () => {
    const t = setup();
    await open(t);
    expect(t.client.videoView).toHaveBeenCalledWith({ videoId: 'vid1' });
    expect(t.sh()).toMatchObject({ phase: 'ready', unlockCreditsPerMinute: 100 });
    expect(t.sh().stretches.map((s) => s.stretch_id)).toEqual(['s1']);
  });
  it('shows nothing for a live stream', async () => {
    const t = setup();
    await open(t, { videoId: 'v', videoKind: 'live' });
    expect(t.client.videoView).not.toHaveBeenCalled();
    expect(t.last().shared ?? null).toBeNull();
  });
  it('shows nothing when sharing is off', async () => {
    const t = setup({ flag: { ...ON, sharing: null } });
    await open(t);
    expect(t.client.videoView).not.toHaveBeenCalled();
    expect(t.last().shared ?? null).toBeNull();
  });
  it('shows nothing without a video id', async () => {
    const t = setup();
    await open(t, { videoId: null, videoKind: 'recorded' });
    expect(t.client.videoView).not.toHaveBeenCalled();
    expect(t.last().shared ?? null).toBeNull();
  });
  it('shows a loading state, then a plain error if it cannot load', async () => {
    let fail;
    const t = setup({ videoView: () => new Promise((_, reject) => { fail = () => reject(new FactCheckError(500, 'server_error')); }) });
    await t.controller.load();
    t.controller.setVideo(RECORDED);
    t.controller.setTarget('a');
    t.controller.choose();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.sh().phase).toBe('loading');
    fail();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.sh()).toMatchObject({ phase: 'error', stretches: [] });
    expect(t.sh().error).toMatch(/could not be loaded/i);
  });
  it('a rate-limited view shows plain words, can be retried by hand, and never loops', async () => {
    const t = setup({ videoView: async () => { throw new FactCheckError(429, 'rate_limited'); } });
    await open(t);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.sh()).toMatchObject({ phase: 'error', stretches: [], error: 'Too many lookups just now. Wait a minute and try again.' });
    expect(t.client.videoView).toHaveBeenCalledTimes(1);
    t.client.videoView.mockResolvedValue(VIEW([stretch('s1')]));
    t.last().shareActions.reload();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.client.videoView).toHaveBeenCalledTimes(2);
    expect(t.sh().phase).toBe('ready');
  });
  it('reloads after a session ends', async () => {
    const t = setup();
    await open(t);
    t.client.videoView.mockClear();
    t.session.emit({ status: 'running', sessionId: 's' });
    t.session.emit({ status: 'ended', sessionId: 's', endReason: 'user' });
    await new Promise((r) => setTimeout(r, 0));
    expect(t.client.videoView).toHaveBeenCalledTimes(1);
  });
  it('clears on a new target and ignores a load that finishes after', async () => {
    let release;
    const t = setup({ videoView: () => new Promise((resolve) => { release = () => resolve(VIEW([stretch('late')])); }) });
    await t.controller.load();
    t.controller.setVideo(RECORDED);
    t.controller.setTarget('a');
    t.controller.choose();
    await new Promise((r) => setTimeout(r, 0));
    t.controller.setTarget('b');
    t.controller.setVideo({ videoId: 'vid2', videoKind: 'recorded' });
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.last().shared ?? null).toBeNull();
  });
  it('a stretch with no usable fields is dropped; the list is kept as the server gave it', async () => {
    const t = setup({ stretches: [stretch('a'), { nope: true }, stretch('b')] });
    await open(t);
    expect(t.sh().stretches.map((s) => s.stretch_id)).toEqual(['a', 'b']);
  });
  it('a not_allowed or off answer switches sharing off', async () => {
    const t = setup({ videoView: async () => { throw new FactCheckError(403, 'off'); } });
    await open(t);
    expect(t.last().flag.sharing).toBeNull();
    expect(t.last().shared ?? null).toBeNull();
  });
});

describe('the part that covers the current position', () => {
  it('is named when the player position is inside a part', async () => {
    const t = setup({ stretches: [stretch('a', { from_s: 100, to_s: 200 }), stretch('b', { from_s: 300, to_s: 400 })], position: { positionS: 350, playerState: 1 } });
    await open(t);
    expect(t.sh().covering).toBe('b');
  });
  it('is none when the position is unknown or outside', async () => {
    const a = setup({ position: null });
    await open(a);
    expect(a.sh().covering).toBeNull();
    const b = setup({ position: { positionS: 900, playerState: 1 } });
    await open(b);
    expect(b.sh().covering).toBeNull();
  });
});

describe('unlock', () => {
  async function ready(over) {
    const t = setup(over);
    await open(t);
    return t;
  }
  const u = (t, id = 's1') => t.sh().unlocks[id];
  it('ask opens the confirmation; cancel closes it', async () => {
    const t = await ready();
    t.controller.unlockAsk('s1');
    expect(u(t).phase).toBe('confirming');
    t.controller.unlockCancel('s1');
    expect(u(t)?.phase ?? 'idle').toBe('idle');
    expect(t.client.unlock).not.toHaveBeenCalled();
  });
  it('only a locked part can be unlocked', async () => {
    const t = await ready({ stretches: [stretch('s1', { access: 'own' }), stretch('s2', { access: 'unlocked' })] });
    t.controller.unlockAsk('s1');
    t.controller.unlockAsk('s2');
    expect(t.sh().unlocks).toEqual({});
  });
  it('confirm sends the stretch id and the price shown, then reloads, refreshes credits and says it is unlocked', async () => {
    let released;
    const t = await ready({ unlock: () => new Promise((resolve) => { released = () => resolve({ ok: true }); }) });
    t.controller.unlockAsk('s1');
    const p = t.controller.unlockConfirm('s1', 500);
    expect(u(t).phase).toBe('running');
    expect(t.client.unlock).toHaveBeenCalledWith({ stretchId: 's1', expectedCredits: 500 });
    t.client.videoView.mockResolvedValue(VIEW([stretch('s1', { access: 'unlocked', claims: [claim('k1')], lines: [{ pos_start_s: 100, text: 'hello' }] })]));
    released();
    await p;
    expect(t.credits.refresh).toHaveBeenCalled();
    expect(t.sh().stretches[0].access).toBe('unlocked');
    expect(u(t)).toMatchObject({ phase: 'idle', notice: 'Unlocked.' });
  });
  it('a repeated unlock (already unlocked) is not an error', async () => {
    const t = await ready({ unlock: async () => ({ ok: true, repeated: true }) });
    t.controller.unlockAsk('s1');
    await t.controller.unlockConfirm('s1', 500);
    expect(u(t)?.error ?? null).toBeNull();
  });
  it('a second press while it runs makes no second call', async () => {
    let released;
    const t = await ready({ unlock: () => new Promise((resolve) => { released = () => resolve({ ok: true }); }) });
    t.controller.unlockAsk('s1');
    const p = t.controller.unlockConfirm('s1', 500);
    t.controller.unlockAsk('s1');
    void t.controller.unlockConfirm('s1', 500);
    released();
    await p;
    expect(t.client.unlock).toHaveBeenCalledTimes(1);
  });
  it.each([
    [new FactCheckError(402, 'insufficient', { needed: 500, available: 100 }), 'Not enough credits: this needs 500 credits and you have 100 credits.'],
    [new FactCheckError(409, 'own'), 'You ran this part yourself, so it is already yours.'],
    [new FactCheckError(429, 'rate_limited'), 'Too many tries just now. Wait a minute and try again.'],
    [new FactCheckError(404, 'not_found'), 'This part could no longer be found.'],
    [new FactCheckError(0, 'network'), 'The server did not answer. If you were charged, your balance will show it.'],
  ])('error %#: plain words, no charge claimed, the part stays', async (err, text) => {
    const t = await ready({ unlock: async () => { throw err; } });
    t.controller.unlockAsk('s1');
    await t.controller.unlockConfirm('s1', 500);
    expect(u(t)).toMatchObject({ phase: 'idle', error: text });
    expect(t.sh().stretches[0].access).toBe('locked');
  });
  it('a lost answer also refreshes credits', async () => {
    const t = await ready({ unlock: async () => { throw new FactCheckError(0, 'network'); } });
    t.controller.unlockAsk('s1');
    t.credits.refresh.mockClear();
    await t.controller.unlockConfirm('s1', 500);
    expect(t.credits.refresh).toHaveBeenCalled();
  });
  it('price_changed shows the price the error carried', async () => {
    const t = await ready({ unlock: async () => { throw Object.assign(new FactCheckError(409, 'price_changed'), { price: 900 }); } });
    t.client.videoView.mockResolvedValue(VIEW([stretch('s1', { price: 700 })]));
    t.controller.unlockAsk('s1');
    await t.controller.unlockConfirm('s1', 500);
    expect(u(t).error).toBe('The price changed to 900 credits. Review it and unlock again.');
  });
  it('a claim_not_found answer is treated like not_found', async () => {
    const t = await ready({ unlock: async () => { throw new FactCheckError(404, 'claim_not_found'); } });
    t.controller.unlockAsk('s1');
    await t.controller.unlockConfirm('s1', 500);
    expect(u(t).error).toBe('This part could no longer be found.');
  });
  it('price_changed reloads, shows the new price and asks again', async () => {
    const t = await ready({ unlock: async () => { throw new FactCheckError(409, 'price_changed'); } });
    t.client.videoView.mockResolvedValue(VIEW([stretch('s1', { price: 700 })]));
    t.controller.unlockAsk('s1');
    await t.controller.unlockConfirm('s1', 500);
    expect(u(t)).toMatchObject({ phase: 'confirming', error: 'The price changed to 700 credits. Review it and unlock again.' });
    expect(t.sh().stretches[0].price).toBe(700);
  });
  it('own after the fact reloads so the part opens', async () => {
    const t = await ready({ unlock: async () => { throw new FactCheckError(409, 'own'); } });
    t.client.videoView.mockResolvedValue(VIEW([stretch('s1', { access: 'own' })]));
    t.controller.unlockAsk('s1');
    await t.controller.unlockConfirm('s1', 500);
    expect(t.sh().stretches[0].access).toBe('own');
  });
  it('off or not allowed switches sharing off', async () => {
    const t = await ready({ unlock: async () => { throw new FactCheckError(403, 'not_allowed'); } });
    t.controller.unlockAsk('s1');
    await t.controller.unlockConfirm('s1', 500);
    expect(t.last().flag.sharing).toBeNull();
    expect(t.last().shared ?? null).toBeNull();
  });
});

describe('report', () => {
  const stretches = [stretch('s1', { access: 'unlocked', claims: [claim('k1'), claim('k2', { reported: true })], lines: [] }), stretch('s2', { access: 'own', claims: [claim('k3')], lines: [] })];
  const r = (t, id = 'k1') => t.sh().reports[id];
  it('ask opens a form; cancel closes it', async () => {
    const t = setup({ stretches });
    await open(t);
    t.controller.reportAsk('k1');
    expect(r(t).phase).toBe('asking');
    t.controller.reportCancel('k1');
    expect(r(t)?.phase ?? 'idle').toBe('idle');
  });
  it('send posts the claim and a trimmed reason of at most 300 characters; the card then reads Reported', async () => {
    const t = setup({ stretches });
    await open(t);
    t.controller.reportAsk('k1');
    await t.controller.reportSend('k1', `  ${'x'.repeat(400)}  `);
    expect(t.client.report).toHaveBeenCalledWith({ claimId: 'k1', reason: 'x'.repeat(300) });
    expect(r(t)).toMatchObject({ phase: 'done' });
  });
  it('an empty reason is allowed', async () => {
    const t = setup({ stretches });
    await open(t);
    t.controller.reportAsk('k1');
    await t.controller.reportSend('k1', '   ');
    expect(t.client.report).toHaveBeenCalledWith({ claimId: 'k1', reason: '' });
  });
  it('already reported is shown as reported', async () => {
    const t = setup({ stretches, report: async () => { throw new FactCheckError(409, 'already'); } });
    await open(t);
    t.controller.reportAsk('k1');
    await t.controller.reportSend('k1', '');
    expect(r(t).phase).toBe('done');
  });
  it('a card already reported, an own card and a card of a locked part cannot be reported', async () => {
    const t = setup({ stretches: [...stretches, stretch('s3', { access: 'locked' })] });
    await open(t);
    t.controller.reportAsk('k2');
    t.controller.reportAsk('k3');
    t.controller.reportAsk('nope');
    expect(t.sh().reports).toEqual({});
  });
  it.each([
    [new FactCheckError(429, 'rate_limited'), 'You have sent many reports today. Try again tomorrow.'],
    [new FactCheckError(404, 'claim_not_found'), 'This verdict could no longer be found.'],
    [new FactCheckError(0, 'network'), 'The report could not be sent. Check your connection and try again.'],
  ])('error %#', async (err, text) => {
    const t = setup({ stretches, report: async () => { throw err; } });
    await open(t);
    t.controller.reportAsk('k1');
    await t.controller.reportSend('k1', 'wrong');
    expect(r(t)).toMatchObject({ phase: 'asking', error: text });
  });
});

describe('own parts and the position getter', () => {
  it('an own part card cannot be checked again (the server shows the original claim id)', async () => {
    const t = setup({ stretches: [stretch('s1', { access: 'own', claims: [claim('k1')], lines: [] })] });
    await open(t);
    t.controller.recheckAsk('k1');
    expect(t.last().rechecks.k1).toBeUndefined();
  });
  it('an unlocked part card cannot be checked again', async () => {
    const t = setup({ stretches: [stretch('s1', { access: 'unlocked', claims: [claim('k1')], lines: [] })] });
    await open(t);
    t.controller.recheckAsk('k1');
    expect(t.last().rechecks.k1).toBeUndefined();
  });
  it('the session gets a position getter that answers only for a recorded video', async () => {
    const t = setup();
    await open(t);
    const { getPosition } = t.createSession.mock.calls[0][0];
    expect(getPosition()).toEqual({ positionS: 150, playerState: 1 });
    t.controller.setVideo({ videoId: 'live1', videoKind: 'live' });
    expect(getPosition()).toBeNull();
  });
});
