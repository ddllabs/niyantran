// F344 T5: the session state machine with fake client, capture, transcriber and
// clock. No React, no DOM, no real timers.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseClient.js', () => ({ accessToken: async () => 't', functionsUrl: n => `https://x.test/${n}` }));

import { FactCheckError } from './client.js';
import { CaptureError } from './capture.js';
import { createFactCheckSession } from './session.js';
import { createFactCheckClient } from './client.js';
import { createTranscriber } from './transcriber.js';
import { createPieceCutter } from './pieces.js';

const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

const PARAMS = { videoId: 'vid1', channelId: 'ch1', videoKind: 'live', startPositionS: null, minutes: 5, seed: { channel: 'WION', title: 'News' } };
let pieceNo = 0;
const piece = (seq, over = {}) => ({
  seq, startMs: seq * 10000, endMs: seq * 10000 + 10000, overlapMs: seq ? 1000 : 0, endPauseMs: 0,
  silent: false, wav: new Blob([new Uint8Array(4)]), ...over,
});

function world(opts = {}) {
  const w = { now: 1_700_000_000_000, sleeps: [], timers: [], statuses: [], capHandlers: null, capStops: [], pieceNo };
  let timerId = 0;
  const timers = {
    setTimeout: (fn, ms) => { const id = ++timerId; w.timers.push({ id, fn, ms }); return id; },
    clearTimeout: id => { w.timers = w.timers.filter(t => t.id !== id); },
  };
  w.tick = () => { const due = w.timers.filter(t => t.ms === 1000); w.timers = w.timers.filter(t => t.ms !== 1000); due.forEach(t => t.fn()); };
  w.fire = ms => { const due = w.timers.filter(t => t.ms === ms); w.timers = w.timers.filter(t => t.ms !== ms); due.forEach(t => t.fn()); return due.length; };

  w.client = {
    start: vi.fn(async () => ({ session_id: 's1', credits_per_minute: 500, credits_held: 2500, ends_at: new Date(w.now + 300000).toISOString() })),
    extract: vi.fn(async () => ({ claims: [], ledger: { n: 1 } })),
    check: vi.fn(async ({ claim_id }) => ({ id: claim_id, status: 'checked', verdict: 'supported', reason: 'because', sources: [{ url: 'https://a.test', title: 'A' }], checked_at: '2026-11-15T10:00:00Z' })),
    stop: vi.fn(async () => ({ minutes_used: 1, credits_charged: 500, balance: 9500 })),
    ...opts.client,
  };
  w.transcribe = vi.fn(async (p) => ({ seq: p.seq, text: `text ${p.seq}`, secondsLeft: 250 }));
  if (opts.transcribe) w.transcribe = vi.fn(opts.transcribe);
  w.transcriber = { transcribe: (...args) => w.transcribe(...args) };
  w.capture = vi.fn(async handlers => {
    if (opts.captureError) throw opts.captureError;
    if (opts.captureGate) await opts.captureGate.promise;
    w.capHandlers = handlers;
    return { stop: vi.fn(async (o) => { w.capStops.push(o); handlers.onEnded('stopped'); }) };
  });
  w.session = createFactCheckSession({
    client: w.client, capture: w.capture, transcriber: w.transcriber,
    now: () => w.now, timers, sleep: async ms => { w.sleeps.push(ms); }, extractGapMs: 0,
    onChange: s => { if (w.statuses.at(-1) !== s.status) w.statuses.push(s.status); },
    ...opts.session,
  });
  w.start = async (params = PARAMS) => { await w.session.start(params); await settle(); };
  w.emit = async (...ps) => { for (const p of ps) w.capHandlers.onPiece(p); await settle(); };
  return w;
}

describe('happy path', () => {
  it('moves idle -> sharing -> running -> ending -> ended and stops the server once', async () => {
    const w = world();
    expect(w.session.getState().status).toBe('idle');
    await w.start();
    const s = w.session.getState();
    expect(s).toMatchObject({ status: 'running', minutesBought: 5, secondsLeft: 300 });
    expect(w.client.start).toHaveBeenCalledWith(expect.objectContaining({
      video_id: 'vid1', channel_id: 'ch1', video_kind: 'live', start_position_s: null, minutes: 5,
    }));
    await w.emit(piece(0), piece(1));
    expect(w.session.getState().transcript.map(l => l.text)).toEqual(['text 0', 'text 1']);
    await w.session.stop('user');
    expect(w.session.getState()).toMatchObject({
      status: 'ended', final: { minutes_used: 1, credits_charged: 500, balance: 9500 }, error: null,
    });
    expect(w.statuses).toEqual(['sharing', 'starting', 'running', 'ending', 'ended']);
    expect(w.client.stop).toHaveBeenCalledTimes(1);
    expect(w.client.stop).toHaveBeenCalledWith(expect.objectContaining({ session_id: 's1' }));
  });

  it('supports the choosing step before start', () => {
    const w = world();
    w.session.choose();
    expect(w.session.getState().status).toBe('choosing');
    w.session.cancelChoice();
    expect(w.session.getState().status).toBe('idle');
  });

  it('sends each piece to the transcriber with the session id, in capture order', async () => {
    const w = world();
    await w.start();
    await w.emit(piece(0));
    expect(w.transcribe.mock.calls[0][0].seq).toBe(0);
    expect(w.transcribe.mock.calls[0][1]).toBe('s1');
    await w.session.stop();
  });
});

describe('transcript', () => {
  it('applies results by seq even when responses arrive out of order', async () => {
    const gates = [defer(), defer()];
    const w = world({ transcribe: async p => { await gates[p.seq].promise; return { seq: p.seq, text: `t${p.seq}`, secondsLeft: 200 }; } });
    await w.start();
    await w.emit(piece(0), piece(1));
    gates[1].resolve();
    await settle();
    expect(w.session.getState().transcript).toEqual([]);
    gates[0].resolve();
    await settle();
    expect(w.session.getState().transcript.map(l => l.text)).toEqual(['t0', 't1']);
    await w.session.stop();
  });

  it('limits concurrent transcriptions to two', async () => {
    const gates = [defer(), defer(), defer()];
    const w = world({ transcribe: async p => { await gates[p.seq].promise; return { seq: p.seq, text: 'x', secondsLeft: 200 }; } });
    await w.start();
    await w.emit(piece(0), piece(1), piece(2));
    expect(w.transcribe).toHaveBeenCalledTimes(2);
    gates[0].resolve();
    await settle();
    expect(w.transcribe).toHaveBeenCalledTimes(3);
    gates.forEach(g => g.resolve());
    await w.session.stop();
  });

  it('strips sound tags, drops tag-only pieces, and removes the overlap repeat', async () => {
    const texts = ['The council voted [संगीत] while supporting the adoption', '[background music]', 'x'];
    const w = world({ transcribe: async p => ({ seq: p.seq, text: texts[p.seq], secondsLeft: 100 }) });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.session.getState().transcript.map(l => l.text)).toEqual(['The council voted while supporting the adoption']);
    await w.session.stop();
  });

  it('joins a piece to the previous one without the doubled word, startMs after the overlap', async () => {
    const texts = ['We are supporting the adoption', 'the adoption of the resolution passed'];
    const w = world({ transcribe: async p => ({ seq: p.seq, text: texts[p.seq], secondsLeft: 100 }) });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.session.getState().transcript).toEqual([
      { seq: 0, text: 'We are supporting the adoption', startMs: 0 },
      { seq: 1, text: 'of the resolution passed', startMs: 11000 },
    ]);
    await w.session.stop();
  });

  it('repairs a half word at the end of the previous line', async () => {
    const texts = ['We are supporting the adop', 'the adoption of the resolution passed'];
    const w = world({ transcribe: async p => ({ seq: p.seq, text: texts[p.seq], secondsLeft: 100 }) });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.session.getState().transcript.map(l => l.text)).toEqual(['We are supporting', 'the adoption of the resolution passed']);
    await w.session.stop();
  });

  it('does not de-duplicate across a piece that failed to transcribe', async () => {
    const w = world({ transcribe: async p => {
      if (p.seq === 1) throw new FactCheckError(500, 'server_error');
      return { seq: p.seq, text: 'adoption adoption', secondsLeft: 100 };
    } });
    await w.start();
    await w.emit(piece(0), piece(1), piece(2));
    expect(w.session.getState().transcript.map(l => l.text)).toEqual(['adoption adoption', 'adoption adoption']);
    await w.session.stop();
  });

  it('reports silentFor: time since the last audible piece, from the audio level', async () => {
    const w = world();
    await w.start();
    await w.emit(piece(0));
    expect(w.session.getState().silentFor).toBe(0);
    await w.emit(piece(1, { silent: true }), piece(2, { silent: true }));
    expect(w.session.getState().silentFor).toBe(20000);
    await w.emit(piece(3));
    expect(w.session.getState().silentFor).toBe(0);
    await w.session.stop();
  });

  it('still sends silent pieces to the transcriber', async () => {
    const w = world();
    await w.start();
    await w.emit(piece(0, { silent: true }));
    expect(w.transcribe).toHaveBeenCalledTimes(1);
    await w.session.stop();
  });
});

describe('extraction and checks', () => {
  const claim = (id, over = {}) => ({ id, quote: `q${id}`, claim_en: `claim ${id}`, claimant: 'A', reported_by: null, kind: 'claim', status: 'pending', ...over });

  it('sends a turn of two pieces to extract with the last 3 turns, the ledger, the seed and timing', async () => {
    const w = world();
    w.client.extract.mockResolvedValueOnce({ claims: [], ledger: { who: 'A' } });
    await w.start({ ...PARAMS, videoKind: 'recorded', startPositionS: 60 });
    const started = w.now;
    await w.emit(piece(0), piece(1));
    expect(w.client.extract).toHaveBeenCalledTimes(1);
    const first = w.client.extract.mock.calls[0][0];
    expect(first).toMatchObject({
      session_id: 's1', recent: [], ledger: null, seed: { channel: 'WION', title: 'News' },
      turn: { text: 'text 0 text 1', position_s: 60 },
    });
    expect(first.turn.spoken_at).toBe(new Date(started).toISOString());
    await w.emit(piece(2), piece(3));
    const second = w.client.extract.mock.calls[1][0];
    expect(second.recent).toEqual(['text 0 text 1']);
    expect(second.ledger).toEqual({ who: 'A' });
    // position counts from where the new audio starts, after the 1 s overlap
    expect(second.turn.position_s).toBe(60 + 21);
    await w.emit(piece(4), piece(5), piece(6), piece(7), piece(8), piece(9));
    const last = w.client.extract.mock.calls.at(-1)[0];
    expect(last.recent).toHaveLength(3);
    await w.session.stop();
  });

  it('position_s is null for a live stream', async () => {
    const w = world();
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.client.extract.mock.calls[0][0].turn.position_s).toBeNull();
    await w.session.stop();
  });

  it('stores returned claims and checks each pending claim, updating it with the verdict', async () => {
    const w = world();
    w.client.extract.mockResolvedValueOnce({ claims: [claim('c1'), claim('c2')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.client.check).toHaveBeenCalledTimes(2);
    expect(w.client.check).toHaveBeenCalledWith(expect.objectContaining({ session_id: 's1', claim_id: 'c1' }));
    const c1 = w.session.getState().claims.find(c => c.id === 'c1');
    expect(c1).toMatchObject({
      id: 'c1', quote: 'qc1', claim_en: 'claim c1', claimant: 'A', reported_by: null, kind: 'claim',
      status: 'checked', verdict: 'supported', reason: 'because', checked_at: '2026-11-15T10:00:00Z',
      sources: [{ url: 'https://a.test', title: 'A' }],
    });
    await w.session.stop();
  });

  it('never checks a needs_context or not_checkable claim, and keeps it in the list', async () => {
    const w = world();
    w.client.extract.mockResolvedValueOnce({
      claims: [claim('n1', { status: 'needs_context' }), claim('o1', { kind: 'opinion', status: 'not_checkable' }), claim('c1')],
      ledger: {},
    });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.client.check.mock.calls.map(c => c[0].claim_id)).toEqual(['c1']);
    const byId = Object.fromEntries(w.session.getState().claims.map(c => [c.id, c]));
    expect(byId.n1.status).toBe('needs_context');
    expect(byId.o1.status).toBe('not_checkable');
    await w.session.stop();
  });

  it('does not check or duplicate a claim it already has', async () => {
    const w = world();
    w.client.extract
      .mockResolvedValueOnce({ claims: [claim('c1')], ledger: {} })
      .mockResolvedValueOnce({ claims: [claim('c1')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1), piece(2), piece(3));
    expect(w.client.check).toHaveBeenCalledTimes(1);
    expect(w.session.getState().claims).toHaveLength(1);
    await w.session.stop();
  });

  it('a later extraction can resolve a held needs_context claim by returning it pending', async () => {
    const w = world();
    w.client.extract
      .mockResolvedValueOnce({ claims: [claim('n1', { status: 'needs_context' })], ledger: {} })
      .mockResolvedValueOnce({ claims: [claim('n1', { status: 'pending', claim_en: 'resolved claim' })], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1), piece(2), piece(3));
    expect(w.client.check.mock.calls.map(c => c[0].claim_id)).toEqual(['n1']);
    expect(w.session.getState().claims[0]).toMatchObject({ claim_en: 'resolved claim', status: 'checked' });
    await w.session.stop();
  });

  it('limits parallel checks to three', async () => {
    const gates = Array.from({ length: 5 }, defer);
    let n = 0;
    const w = world({ client: { check: async ({ claim_id }) => { await gates[n++].promise; return { id: claim_id, status: 'checked', verdict: 'supported', reason: 'r', sources: [], checked_at: 'now' }; } } });
    w.client.extract.mockResolvedValueOnce({ claims: ['a', 'b', 'c', 'd', 'e'].map(claim), ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(n).toBe(3);
    gates[0].resolve();
    await settle();
    expect(n).toBe(4);
    gates.forEach(g => g.resolve());
    await w.session.stop();
    expect(n).toBe(5);
  });

  it('shows a check that fails as status error with no verdict, and carries on', async () => {
    const w = world({ client: { check: async () => { throw new FactCheckError(500, 'server_error'); } } });
    w.client.extract.mockResolvedValueOnce({ claims: [claim('c1')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    await vi.waitFor(() => expect(w.session.getState().claims[0].status).toBe('error'));
    expect(w.session.getState().claims[0].verdict).toBeNull();
    expect(w.session.getState().status).toBe('running');
    await w.session.stop();
  });

  it('closes the last open turn when the session ends and extracts it', async () => {
    const w = world();
    await w.start();
    await w.emit(piece(0));
    expect(w.client.extract).not.toHaveBeenCalled();
    await w.session.stop();
    expect(w.client.extract).toHaveBeenCalledTimes(1);
    expect(w.client.extract.mock.calls[0][0].turn.text).toBe('text 0');
  });
});

describe('ending', () => {
  const claim = id => ({ id, quote: 'q', claim_en: 'c', claimant: null, reported_by: null, kind: 'claim', status: 'pending' });

  it('the browser ending the share moves to ended, and in-flight checks finish before it', async () => {
    const gate = defer();
    const w = world({ client: { check: async ({ claim_id }) => { await gate.promise; return { id: claim_id, status: 'checked', verdict: 'contradicted', reason: 'r', sources: [], checked_at: 'now' }; } } });
    w.client.extract.mockResolvedValueOnce({ claims: [claim('c1')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    w.capHandlers.onEnded('ended');
    await settle();
    expect(w.session.getState().status).toBe('ending');
    expect(w.client.stop).not.toHaveBeenCalled();
    gate.resolve();
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(w.client.stop).toHaveBeenCalledTimes(1);
    expect(w.session.getState().claims[0].verdict).toBe('contradicted');
    expect(w.session.getState()).toMatchObject({ endReason: 'browser', error: null });
  });

  it('in-flight transcriptions finish and their text is kept before ended', async () => {
    const gate = defer();
    const w = world({ transcribe: async p => { await gate.promise; return { seq: p.seq, text: 'late words', secondsLeft: 100 }; } });
    await w.start();
    await w.emit(piece(0));
    const done = w.session.stop('user');
    await settle();
    expect(w.session.getState().status).toBe('ending');
    gate.resolve();
    await done;
    expect(w.session.getState().transcript.map(l => l.text)).toEqual(['late words']);
    expect(w.client.extract).toHaveBeenCalledTimes(1);
  });

  it('stop called twice (and concurrently) calls the server once', async () => {
    const w = world();
    await w.start();
    const a = w.session.stop('user');
    const b = w.session.stop('ui');
    await Promise.all([a, b]);
    await w.session.stop();
    expect(w.client.stop).toHaveBeenCalledTimes(1);
    expect(w.capStops).toHaveLength(1);
  });

  it('stop flushes the capture tail for a user stop', async () => {
    const w = world();
    await w.start();
    await w.session.stop('user');
    expect(w.capStops[0]).toEqual({ flush: true });
  });

  it('a stop after the session is over does nothing', async () => {
    const w = world();
    await w.start();
    await w.session.stop();
    await w.session.stop('ui');
    expect(w.client.stop).toHaveBeenCalledTimes(1);
    expect(w.session.getState().status).toBe('ended');
  });

  it('ends when the block time runs out (ends_at passes)', async () => {
    const w = world();
    await w.start();
    expect(w.session.getState().secondsLeft).toBe(300);
    w.now += 100000;
    w.tick();
    await settle();
    expect(w.session.getState()).toMatchObject({ status: 'running', secondsLeft: 200 });
    w.now += 200000;
    w.tick();
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(w.session.getState().endReason).toBe('time');
    expect(w.client.stop).toHaveBeenCalledTimes(1);
  });

  it('ends when a transcribe response says no seconds are left, and re-anchors secondsLeft otherwise', async () => {
    const w = world({ transcribe: async p => ({ seq: p.seq, text: 'x', secondsLeft: p.seq === 0 ? 120 : 0 }) });
    await w.start();
    await w.emit(piece(0));
    expect(w.session.getState().secondsLeft).toBe(120);
    await w.emit(piece(1));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(w.session.getState().endReason).toBe('time');
    expect(w.client.stop).toHaveBeenCalledTimes(1);
  });

  it('a UI stop with a reason (channel change, modal close) records that reason', async () => {
    const w = world();
    await w.start();
    await w.session.stop('channel_change');
    expect(w.session.getState().endReason).toBe('channel_change');
  });

  it('a 409 from transcribe ends gracefully: no capture flush, but the open turn is extracted and the server stopped once', async () => {
    const w = world({ transcribe: async p => {
      if (p.seq === 1) throw new FactCheckError(409, 'ended');
      return { seq: p.seq, text: 'open turn words', secondsLeft: 100 };
    } });
    await w.start();
    await w.emit(piece(0), piece(1));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(w.session.getState()).toMatchObject({ endReason: 'server', error: null });
    expect(w.capStops[0]).toEqual({ flush: false });
    expect(w.client.extract).toHaveBeenCalledTimes(1);
    expect(w.client.extract.mock.calls[0][0].turn.text).toBe('open turn words');
    expect(w.client.stop).toHaveBeenCalledTimes(1);
  });

  it('a 409 lets checks that are in flight finish', async () => {
    const gate = defer();
    const w = world({
      transcribe: async p => { if (p.seq === 2) throw new FactCheckError(409, 'settled'); return { seq: p.seq, text: `t${p.seq}`, secondsLeft: 100 }; },
      client: { check: async ({ claim_id }) => { await gate.promise; return { id: claim_id, status: 'checked', verdict: 'supported', reason: 'r', sources: [], checked_at: 'now' }; } },
    });
    w.client.extract.mockResolvedValueOnce({ claims: [{ id: 'c1', quote: 'q', claim_en: 'c', claimant: null, reported_by: null, kind: 'claim', status: 'pending' }], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1), piece(2));
    await settle();
    expect(w.session.getState().status).toBe('ending');
    gate.resolve();
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(w.session.getState().claims[0].verdict).toBe('supported');
  });

  it.each([[401, 'unauthorized'], [403, 'not_allowed'], [404, 'not_found']])('a %s from transcribe aborts without draining and moves to error', async (status, reason) => {
    const w = world({ transcribe: async p => { if (p.seq === 1) throw new FactCheckError(status, reason); return { seq: p.seq, text: 'words', secondsLeft: 100 }; } });
    await w.start();
    await w.emit(piece(0), piece(1));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('error'));
    expect(w.session.getState().error).toMatchObject({ source: 'transcribe', status });
    expect(w.client.extract).not.toHaveBeenCalled();
    expect(w.capStops[0]).toEqual({ flush: false });
    expect(w.client.stop).toHaveBeenCalledTimes(1);
  });

  it('a 404 that is not about the session (another reason) is an ordinary failure', async () => {
    const w = world({ transcribe: async p => { if (p.seq === 0) throw new FactCheckError(404, 'no_such_thing'); return { seq: p.seq, text: 'ok', secondsLeft: 100 }; } });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.session.getState().status).toBe('running');
    await w.session.stop();
  });

  it('a 409 from stop (already settled) is a normal end with no final figures', async () => {
    const w = world({ client: { stop: async () => { throw new FactCheckError(409, 'settled'); } } });
    await w.start();
    await w.session.stop();
    expect(w.session.getState()).toMatchObject({ status: 'ended', final: null });
  });

  it('releases capture and ends when capture reports an error while running', async () => {
    const w = world();
    await w.start();
    w.capHandlers.onError(new Error('handler failed'));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('error'));
    expect(w.session.getState().error.source).toBe('capture');
    expect(w.client.stop).toHaveBeenCalledTimes(1);
  });

  it('retries stop on a network failure, then reports an error but not a second charge', async () => {
    const w = world({ client: { stop: vi.fn(async () => { throw new FactCheckError(0, 'network'); }) } });
    await w.start();
    await w.session.stop();
    expect(w.client.stop.mock.calls.length).toBeGreaterThan(1);
    expect(w.client.stop.mock.calls.length).toBeLessThanOrEqual(3);
    expect(w.session.getState()).toMatchObject({ status: 'error', final: null });
  });
});

describe('retries and failures', () => {
  it('backs off and retries a 429, honouring Retry-After', async () => {
    let n = 0;
    const w = world({ transcribe: async p => {
      if (n++ < 2) throw new FactCheckError(429, 'rate_limited', { retryAfterMs: 3000 });
      return { seq: p.seq, text: 'ok', secondsLeft: 100 };
    } });
    await w.start();
    await w.emit(piece(0));
    expect(w.transcribe).toHaveBeenCalledTimes(3);
    expect(w.sleeps).toEqual([3000, 3000]);
    expect(w.session.getState().transcript.map(l => l.text)).toEqual(['ok']);
    expect(w.session.getState().status).toBe('running');
    await w.session.stop();
  });

  it('gives up on a 429 after a bounded number of retries, skipping that piece only', async () => {
    const w = world({ transcribe: async p => {
      if (p.seq === 0) throw new FactCheckError(429, 'rate_limited');
      return { seq: p.seq, text: 'second', secondsLeft: 100 };
    } });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.transcribe.mock.calls.filter(c => c[0].seq === 0)).toHaveLength(4);
    expect(w.session.getState().transcript.map(l => l.text)).toEqual(['second']);
    expect(w.session.getState()).toMatchObject({ status: 'running', skippedPieces: 1 });
    await w.session.stop();
  });

  it('survives a transient network failure on one piece', async () => {
    let n = 0;
    const w = world({ transcribe: async p => {
      if (p.seq === 0 && n++ < 1) throw new FactCheckError(0, 'network');
      return { seq: p.seq, text: `t${p.seq}`, secondsLeft: 100 };
    } });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.session.getState().status).toBe('running');
    expect(w.session.getState().transcript.map(l => l.text)).toEqual(['t0', 't1']);
    await w.session.stop();
  });

  it('moves to error after repeated failures, still stops the server session once', async () => {
    const w = world({ transcribe: async () => { throw new FactCheckError(0, 'network'); } });
    await w.start();
    await w.emit(piece(0), piece(1), piece(2), piece(3));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('error'));
    expect(w.session.getState().error).toMatchObject({ reason: 'network', status: 0 });
    expect(w.client.stop).toHaveBeenCalledTimes(1);
    expect(w.capStops[0]).toEqual({ flush: false });
  });

  it('a success resets the failure count', async () => {
    const fail = new Set([0, 1, 3, 4]);
    const w = world({ transcribe: async p => {
      if (fail.has(p.seq)) throw new FactCheckError(500, 'server_error');
      return { seq: p.seq, text: `t${p.seq}`, secondsLeft: 100 };
    } });
    await w.start();
    await w.emit(piece(0), piece(1), piece(2), piece(3), piece(4), piece(5));
    expect(w.session.getState().status).toBe('running');
    expect(w.session.getState().transcript.map(l => l.text)).toEqual(['t2', 't5']);
    await w.session.stop();
  });

  it('a failed extraction does not stop the session and keeps the old ledger', async () => {
    const w = world();
    w.client.extract
      .mockResolvedValueOnce({ claims: [], ledger: { keep: 1 } })
      .mockRejectedValueOnce(new FactCheckError(500, 'server_error'))
      .mockRejectedValueOnce(new FactCheckError(500, 'server_error'))
      .mockRejectedValueOnce(new FactCheckError(500, 'server_error'))
      .mockResolvedValue({ claims: [], ledger: { keep: 2 } });
    await w.start();
    await w.emit(piece(0), piece(1), piece(2), piece(3), piece(4), piece(5));
    expect(w.session.getState().status).toBe('running');
    expect(w.client.extract).toHaveBeenCalledTimes(5);
    expect(w.client.extract.mock.calls[4][0].ledger).toEqual({ keep: 1 });
    await w.session.stop();
  });
});

describe('starting', () => {
  it('shares the tab first, so a cancelled prompt costs nothing: start is not called until audio flows', async () => {
    const gate = defer();
    const w = world({ captureGate: gate });
    const started = w.session.start(PARAMS);
    await settle();
    expect(w.session.getState().status).toBe('sharing');
    expect(w.client.start).not.toHaveBeenCalled();
    gate.resolve();
    await started;
    await settle();
    expect(w.client.start).toHaveBeenCalledTimes(1);
    expect(w.session.getState().status).toBe('running');
    await w.session.stop();
  });

  it('a refused prompt or a share without audio is an error with no server session', async () => {
    const w = world({ captureError: new CaptureError('no_audio') });
    await w.start();
    expect(w.session.getState()).toMatchObject({ status: 'error', error: { source: 'capture', reason: 'no_audio' } });
    expect(w.client.start).not.toHaveBeenCalled();
    expect(w.client.stop).not.toHaveBeenCalled();
  });

  it('a refused start (402) stops the capture, reports the shortfall and never calls stop', async () => {
    const w = world({ client: { start: async () => { throw new FactCheckError(402, 'insufficient', { needed: 2500, available: 100 }); } } });
    await w.start();
    expect(w.session.getState()).toMatchObject({ status: 'error', error: { source: 'start', reason: 'insufficient', status: 402, needed: 2500, available: 100 } });
    expect(w.capStops).toEqual([{ flush: false }]);
    expect(w.client.stop).not.toHaveBeenCalled();
  });

  it('sends the price the user saw as expected_credits_per_minute, and omits it when none was given', async () => {
    const w = world();
    await w.start({ ...PARAMS, expectedCreditsPerMinute: 500 });
    expect(w.client.start).toHaveBeenCalledWith(expect.objectContaining({ expected_credits_per_minute: 500 }));
    await w.session.stop();
    const w2 = world();
    await w2.start();
    expect(w2.client.start.mock.calls[0][0].expected_credits_per_minute).toBeUndefined();
    await w2.session.stop();
  });

  it('a start refused with price_changed reports the fresh price, releases the tab and never calls stop', async () => {
    const w = world({ client: { start: async () => { throw new FactCheckError(409, 'price_changed', { creditsPerMinute: 700 }); } } });
    await w.start({ ...PARAMS, expectedCreditsPerMinute: 500 });
    expect(w.session.getState()).toMatchObject({ status: 'error', error: { source: 'start', reason: 'price_changed', status: 409, creditsPerMinute: 700 }, sessionId: null });
    expect(w.capStops).toEqual([{ flush: false }]);
    expect(w.client.stop).not.toHaveBeenCalled();
  });

  it('a start answered at a different price than the user saw is stopped at once and reported', async () => {
    const w = world({ client: { start: async () => ({ session_id: 's1', credits_per_minute: 700, credits_held: 3500 }) } });
    await w.start({ ...PARAMS, expectedCreditsPerMinute: 500 });
    expect(w.client.stop).toHaveBeenCalledTimes(1);
    expect(w.session.getState()).toMatchObject({
      status: 'error', endReason: 'price_changed', creditsPerMinute: 700,
      error: { source: 'start', reason: 'price_changed', creditsPerMinute: 700 },
      final: { credits_charged: 500 },
    });
    expect(w.capStops).toHaveLength(1);
  });

  it('the same price as expected runs normally', async () => {
    const w = world();
    await w.start({ ...PARAMS, expectedCreditsPerMinute: 500 });
    expect(w.session.getState().status).toBe('running');
    await w.session.stop();
  });

  it('cancelling while the share prompt is open returns to idle and releases the tab when it arrives', async () => {
    const gate = defer();
    const w = world({ captureGate: gate });
    const started = w.session.start(PARAMS);
    await settle();
    await w.session.stop('ui');
    expect(w.session.getState().status).toBe('idle');
    gate.resolve();
    await started;
    await settle();
    expect(w.capStops).toEqual([{ flush: false }]);
    expect(w.client.start).not.toHaveBeenCalled();
    expect(w.session.getState().status).toBe('idle');
  });

  it('pieces that arrive while the server start is in flight are processed after it', async () => {
    const gate = defer();
    const w = world({ client: { start: async () => { await gate.promise; return { session_id: 's1', credits_per_minute: 500, credits_held: 2500, ends_at: new Date(1_700_000_000_000 + 300000).toISOString() }; } } });
    const started = w.session.start(PARAMS);
    await settle();
    w.capHandlers.onPiece(piece(0));
    await settle();
    expect(w.transcribe).not.toHaveBeenCalled();
    gate.resolve();
    await started;
    await settle();
    expect(w.transcribe).toHaveBeenCalledTimes(1);
    await w.session.stop();
  });

  it('the browser ending the share while the server start is in flight ends the session once it is running', async () => {
    const gate = defer();
    const w = world({ client: { start: async () => { await gate.promise; return { session_id: 's1', credits_per_minute: 500, credits_held: 2500, ends_at: new Date(1_700_000_000_000 + 300000).toISOString() }; } } });
    const started = w.session.start(PARAMS);
    await settle();
    w.capHandlers.onEnded('ended');
    gate.resolve();
    await started;
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(w.session.getState().endReason).toBe('browser');
    expect(w.client.stop).toHaveBeenCalledTimes(1);
  });

  it('audio captured before the browser ended the share is transcribed before the server is stopped', async () => {
    const gate = defer();
    const w = world({ client: { start: async () => { await gate.promise; return { session_id: 's1', credits_per_minute: 500, credits_held: 2500, ends_at: new Date(1_700_000_000_000 + 300000).toISOString() }; } } });
    const started = w.session.start(PARAMS);
    await settle();
    w.capHandlers.onPiece(piece(0));
    w.capHandlers.onEnded('ended');
    gate.resolve();
    await started;
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(w.transcribe).toHaveBeenCalledTimes(1);
    expect(w.session.getState().transcript.map(l => l.text)).toEqual(['text 0']);
    expect(w.transcribe.mock.invocationCallOrder[0]).toBeLessThan(w.client.stop.mock.invocationCallOrder[0]);
    expect(w.client.extract).toHaveBeenCalledTimes(1);
  });

  it('a second start while running is ignored; a new start after ended begins fresh', async () => {
    const w = world();
    await w.start();
    await w.session.start(PARAMS);
    expect(w.capture).toHaveBeenCalledTimes(1);
    await w.emit(piece(0));
    await w.session.stop();
    expect(w.session.getState().transcript).toHaveLength(1);
    w.client.start.mockResolvedValueOnce({ session_id: 's2', credits_per_minute: 500, credits_held: 5000, ends_at: new Date(w.now + 600000).toISOString() });
    await w.start({ ...PARAMS, minutes: 10 });
    expect(w.session.getState()).toMatchObject({ status: 'running', minutesBought: 10, transcript: [], claims: [], final: null, error: null });
    await w.session.stop();
    expect(w.client.stop).toHaveBeenCalledTimes(2);
  });

  it('getState returns a snapshot that later changes do not mutate', async () => {
    const w = world();
    await w.start();
    const before = w.session.getState();
    await w.emit(piece(0));
    expect(before.transcript).toEqual([]);
    expect(w.session.getState().transcript).toHaveLength(1);
    await w.session.stop();
  });
});

const claimOf = (id, over = {}) => ({ id, quote: `q${id}`, claim_en: `claim ${id}`, claimant: 'A', reported_by: null, kind: 'claim', status: 'pending', ...over });
const verdict = (id, v = 'supported') => ({ id, status: 'checked', verdict: v, reason: 'r', sources: [], checked_at: 'now' });

describe('claims returned again', () => {
  it('keeps the verdict when extract returns the claim while its check is running (reviewer case)', async () => {
    const gate = defer();
    const w = world({ client: { check: vi.fn(async ({ claim_id }) => { await gate.promise; return verdict(claim_id); }) } });
    w.client.extract.mockResolvedValue({ claims: [claimOf('c1')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    await w.emit(piece(2), piece(3));
    expect(w.client.extract).toHaveBeenCalledTimes(2);
    gate.resolve();
    await settle();
    expect(w.session.getState().claims).toHaveLength(1);
    expect(w.session.getState().claims[0]).toMatchObject({ status: 'checked', verdict: 'supported' });
    expect(w.client.check).toHaveBeenCalledTimes(1);
    await w.session.stop();
  });

  it('a claim already checked keeps its verdict when returned again', async () => {
    const w = world();
    w.client.extract
      .mockResolvedValueOnce({ claims: [claimOf('c1')], ledger: {} })
      .mockResolvedValue({ claims: [claimOf('c1', { claim_en: 'reworded' })], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    await w.emit(piece(2), piece(3));
    expect(w.session.getState().claims[0]).toMatchObject({ status: 'checked', verdict: 'supported', claim_en: 'claim c1' });
    expect(w.client.check).toHaveBeenCalledTimes(1);
    await w.session.stop();
  });

  it('a held needs_context claim returned with the SAME id as pending is updated in place and then checked', async () => {
    const w = world();
    w.client.extract
      .mockResolvedValueOnce({ claims: [claimOf('h1', { status: 'needs_context', claim_en: 'He studied there' })], ledger: {} })
      .mockResolvedValueOnce({ claims: [claimOf('h1', { claim_en: 'XYZ studied at S' })], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.session.getState().claims[0].status).toBe('needs_context');
    expect(w.client.check).not.toHaveBeenCalled();
    await w.emit(piece(2), piece(3));
    expect(w.client.check).toHaveBeenCalledWith(expect.objectContaining({ claim_id: 'h1' }));
    const claims = w.session.getState().claims;
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ id: 'h1', claim_en: 'XYZ studied at S', status: 'checked', verdict: 'supported' });
    await w.session.stop();
  });

  it('a 404 from check marks that claim error and does not end the session', async () => {
    const w = world({ client: { check: async () => { throw new FactCheckError(404, 'not_found'); } } });
    w.client.extract.mockResolvedValueOnce({ claims: [claimOf('c1')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.session.getState().claims[0].status).toBe('error');
    expect(w.session.getState().status).toBe('running');
    await w.session.stop();
  });
});

describe('unchecked claims', () => {
  it('claims whose check never returned become unchecked when the drain expires', async () => {
    const w = world({ client: { check: () => new Promise(() => {}) } });
    w.client.extract.mockResolvedValueOnce({ claims: [claimOf('c1'), claimOf('c2')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    const ending = w.session.stop();
    await settle();
    expect(w.fire(100000)).toBe(1);
    await ending;
    expect(w.session.getState().status).toBe('ended');
    expect(w.session.getState().claims.map(c => c.status)).toEqual(['unchecked', 'unchecked']);
  });

  it('claims never started (aborted session) are unchecked, never left pending', async () => {
    const w = world({ client: { check: () => new Promise(() => {}) }, transcribe: async p => {
      if (p.seq === 2) throw new FactCheckError(403, 'not_allowed');
      return { seq: p.seq, text: `t${p.seq}`, secondsLeft: 100 };
    } });
    w.client.extract.mockResolvedValueOnce({ claims: ['a', 'b', 'c', 'd', 'e'].map(i => claimOf(i)), ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1), piece(2));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('error'));
    expect(w.session.getState().claims.every(c => c.status === 'unchecked')).toBe(true);
  });
});

describe('the starting state', () => {

  it('is "starting" while the server start is in flight, and "sharing" only while the prompt is open', async () => {
    const capGate = defer();
    const startGate = defer();
    const w = world({ captureGate: capGate, client: { start: async () => { await startGate.promise; return { session_id: 's1', credits_per_minute: 500, credits_held: 2500, ends_at: 'x' }; } } });
    const started = w.session.start(PARAMS);
    await settle();
    expect(w.session.getState().status).toBe('sharing');
    capGate.resolve();
    await settle();
    expect(w.session.getState().status).toBe('starting');
    startGate.resolve();
    await started;
    await settle();
    expect(w.session.getState().status).toBe('running');
    await w.session.stop();
  });

  it('a stop while starting keeps the run: it goes through the normal end path and final shows the charge', async () => {
    const startGate = defer();
    const w = world({ client: { start: async () => { await startGate.promise; return { session_id: 's1', credits_per_minute: 500, credits_held: 2500, ends_at: new Date(1_700_000_000_000 + 300000).toISOString() }; } } });
    const started = w.session.start(PARAMS);
    await settle();
    w.capHandlers.onPiece(piece(0));
    const stopped = w.session.stop('ui');
    await settle();
    expect(w.session.getState().status).toBe('starting');
    expect(w.client.stop).not.toHaveBeenCalled();
    startGate.resolve();
    await started;
    await stopped;
    expect(w.session.getState()).toMatchObject({ status: 'ended', endReason: 'ui', final: { credits_charged: 500 } });
    expect(w.client.stop).toHaveBeenCalledTimes(1);
    expect(w.transcribe).toHaveBeenCalledTimes(1);
  });

  it('a stop while starting whose start then fails ends in error with no server stop', async () => {
    const startGate = defer();
    const w = world({ client: { start: async () => { await startGate.promise; } } });
    w.client.start = vi.fn(async () => { await startGate.promise; throw new FactCheckError(402, 'insufficient', { needed: 1, available: 0 }); });
    const started = w.session.start(PARAMS);
    await settle();
    const stopped = w.session.stop('ui');
    startGate.resolve();
    await started; await stopped;
    expect(w.session.getState().status).toBe('error');
    expect(w.client.stop).not.toHaveBeenCalled();
  });

  it('a new start waits for the previous run server stop to finish', async () => {
    const stopGate = defer();
    const w = world({ client: { stop: async () => { await stopGate.promise; return { minutes_used: 1, credits_charged: 500, balance: 1 }; } } });
    await w.start();
    const first = w.session.stop('ui');
    await settle();
    expect(w.session.getState().status).toBe('ending');
    const second = w.session.start(PARAMS);
    await settle();
    expect(w.capture).toHaveBeenCalledTimes(1);
    stopGate.resolve();
    await first;
    await second;
    await settle();
    expect(w.capture).toHaveBeenCalledTimes(2);
    expect(w.client.start).toHaveBeenCalledTimes(2);
    expect(w.session.getState().status).toBe('running');
    await w.session.stop();
  });

  it('gives up on a server start that has not answered in 20 s: error, capture released', async () => {
    const w = world({ client: { start: () => new Promise(() => {}) } });
    const started = w.session.start(PARAMS);
    await settle();
    w.capHandlers.onPiece(piece(0));
    expect(w.fire(20000)).toBe(1);
    await started;
    await settle();
    expect(w.session.getState()).toMatchObject({ status: 'error', error: { source: 'start', reason: 'timeout' } });
    expect(w.capStops).toEqual([{ flush: false }]);
    expect(w.client.stop).not.toHaveBeenCalled();
  });

  it('uses the local clock for the end until a server seconds_left arrives', async () => {
    const w = world({ client: { start: async () => ({ session_id: 's1', credits_per_minute: 500, credits_held: 2500, ends_at: new Date(1_700_000_000_000 - 5000).toISOString() }) } });
    await w.start();
    expect(w.session.getState()).toMatchObject({ status: 'running', secondsLeft: 300 });
    await w.session.stop();
  });
});

describe('timeouts', () => {
  it('aborts a hung call before the retry is made', async () => {
    const signals = [];
    const w = world({ client: { check: ({ signal }) => new Promise((res, rej) => {
      signals.push(signal);
      if (signals.length === 2) { res(verdict('c1')); return; }
      signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }) } });
    w.client.extract.mockResolvedValueOnce({ claims: [claimOf('c1')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(signals).toHaveLength(1);
    expect(w.fire(45000)).toBeGreaterThan(0);
    await settle();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(w.session.getState().claims[0].verdict).toBe('supported');
    await w.session.stop();
  });

  it('gives the transcriber an abort signal too', async () => {
    const w = world();
    await w.start();
    await w.emit(piece(0));
    expect(w.transcribe.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
    await w.session.stop();
  });

  it('does not retry once the run is dead (reviewer case E)', async () => {
    const gate = defer();
    const w = world({ transcribe: async p => { if (p.seq === 0) throw new FactCheckError(503, 'server_error'); return { seq: p.seq, text: 'x', secondsLeft: 100 }; } });
    w.session = createFactCheckSession({
      client: w.client, transcriber: w.transcriber, capture: w.capture, now: () => w.now,
      timers: { setTimeout: () => 1, clearTimeout() {} }, sleep: () => gate.promise, extractGapMs: 0,
    });
    await w.session.start(PARAMS);
    await settle();
    w.capHandlers.onPiece(piece(0));
    await settle();
    expect(w.transcribe).toHaveBeenCalledTimes(1);
    w.capHandlers.onError(new Error('boom'));
    await settle();
    gate.resolve();
    await settle(20);
    expect(w.transcribe).toHaveBeenCalledTimes(1);
  });
});

describe('pacing', () => {
  it('sends extract calls at least 10 s apart, merging the turns that queued up meanwhile', async () => {
    const w = world({ session: { extractGapMs: 10000 } });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.client.extract).toHaveBeenCalledTimes(1);
    await w.emit(piece(2), piece(3), piece(4), piece(5));
    expect(w.client.extract).toHaveBeenCalledTimes(1);
    w.now += 10000;
    expect(w.fire(10000)).toBe(1);
    await settle();
    expect(w.client.extract).toHaveBeenCalledTimes(2);
    expect(w.client.extract.mock.calls[1][0].turn.text).toBe('text 2 text 3 text 4 text 5');
    await w.session.stop();
  });

  it('the final extract at the end does not wait for the gap', async () => {
    const w = world({ session: { extractGapMs: 10000 } });
    await w.start();
    await w.emit(piece(0), piece(1));
    await w.emit(piece(2));
    await w.session.stop();
    expect(w.client.extract).toHaveBeenCalledTimes(2);
    expect(w.session.getState().status).toBe('ended');
  });

  it('counts turns dropped after retries as droppedTurns, and pieces as skippedPieces', async () => {
    const w = world();
    w.client.extract.mockRejectedValue(new FactCheckError(500, 'server_error'));
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.session.getState()).toMatchObject({ droppedTurns: 1, skippedPieces: 0 });
    await w.session.stop();
  });
});

describe('silence', () => {
  it('ends with reason "silent" after 90 s without an audible piece, via the normal end path', async () => {
    const w = world();
    await w.start();
    await w.emit(piece(0));
    for (let i = 1; i <= 8; i++) await w.emit(piece(i, { silent: true }));
    expect(w.session.getState().status).toBe('running');
    await w.emit(piece(9, { silent: true }));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(w.session.getState().endReason).toBe('silent');
    expect(w.client.stop).toHaveBeenCalledTimes(1);
    expect(w.capStops[0]).toEqual({ flush: true });
  });

  it('an audible piece resets the silence clock', async () => {
    const w = world();
    await w.start();
    for (let i = 0; i < 8; i++) await w.emit(piece(i, { silent: true }));
    await w.emit(piece(8));
    for (let i = 9; i < 16; i++) await w.emit(piece(i, { silent: true }));
    expect(w.session.getState().status).toBe('running');
    await w.session.stop();
  });
});

describe('API defaults', () => {
  it('builds its own client and transcriber when none are given', () => {
    const s = createFactCheckSession({ capture: async () => ({ stop() {} }) });
    expect(s.getState().status).toBe('idle');
  });
});

describe('budget, switched off, orphan sessions', () => {
  const budget = () => new FactCheckError(429, 'budget');

  it('a 429 budget on check is not retried: that claim is unchecked, no further checks, transcript continues', async () => {
    const w = world({ client: { check: vi.fn(async () => { throw budget(); }) } });
    w.client.extract.mockResolvedValueOnce({ claims: ['a', 'b', 'c', 'd', 'e'].map(i => claimOf(i)), ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.sleeps).toEqual([]);
    const calls = w.client.check.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(3);
    const s = w.session.getState();
    expect(s.budgetReached).toBe(true);
    expect(s.status).toBe('running');
    expect(s.claims.filter(c => c.status === 'unchecked').length).toBeGreaterThanOrEqual(1);
    w.client.extract.mockResolvedValueOnce({ claims: [claimOf('z')], ledger: {} });
    await w.emit(piece(2), piece(3));
    expect(w.client.check.mock.calls.length).toBe(calls);
    expect(w.session.getState().transcript).toHaveLength(4);
    await w.session.stop();
    expect(w.session.getState().claims.every(c => c.status === 'unchecked')).toBe(true);
  });

  it('a 429 budget on extract is not retried, further extracts stop, turns are counted as dropped, transcription goes on', async () => {
    const w = world();
    w.client.extract.mockRejectedValue(budget());
    await w.start();
    await w.emit(piece(0), piece(1));
    await w.emit(piece(2), piece(3));
    await w.emit(piece(4));
    expect(w.client.extract).toHaveBeenCalledTimes(1);
    expect(w.sleeps).toEqual([]);
    const s = w.session.getState();
    expect(s).toMatchObject({ budgetReached: true, status: 'running' });
    expect(s.droppedTurns).toBe(2);
    expect(s.transcript).toHaveLength(5);
    await w.session.stop();
    expect(w.client.extract).toHaveBeenCalledTimes(1);
    expect(w.session.getState().droppedTurns).toBe(3);
  });

  it('budgetReached is false until a budget answer arrives', async () => {
    const w = world();
    await w.start();
    expect(w.session.getState().budgetReached).toBe(false);
    await w.session.stop();
  });

  it('a rate_limited 429 is still retried as before', async () => {
    let n = 0;
    const w = world({ client: { check: async ({ claim_id }) => { if (n++ === 0) throw new FactCheckError(429, 'rate_limited', { retryAfterMs: 2000 }); return verdict(claim_id); } } });
    w.client.extract.mockResolvedValueOnce({ claims: [claimOf('c1')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.sleeps).toEqual([2000]);
    expect(w.session.getState().claims[0].verdict).toBe('supported');
    expect(w.session.getState().budgetReached).toBe(false);
    await w.session.stop();
  });

  it.each(['transcribe', 'extract', 'check'])('a 403 off from %s ends through the normal path with reason off, stops the server once, no retries', async source => {
    const off = () => new FactCheckError(403, 'off');
    const w = world({
      transcribe: source === 'transcribe' ? async () => { throw off(); } : undefined,
      client: source === 'check' ? { check: vi.fn(async () => { throw off(); }) } : {},
    });
    if (source === 'extract') w.client.extract.mockRejectedValue(off());
    if (source === 'check') w.client.extract.mockResolvedValueOnce({ claims: [claimOf('c1')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(w.session.getState()).toMatchObject({ endReason: 'off', error: null });
    expect(w.client.stop).toHaveBeenCalledTimes(1);
    expect(w.sleeps).toEqual([]);
    const fn = source === 'transcribe' ? w.transcribe : w.client[source];
    expect(fn.mock.calls.length).toBeLessThanOrEqual(2); // two pieces may be in flight; none is retried
  });

  it('a 403 that is not "off" is still a fatal error', async () => {
    const w = world({ transcribe: async () => { throw new FactCheckError(403, 'not_allowed'); } });
    await w.start();
    await w.emit(piece(0));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('error'));
  });

  it('a 409 already_active from start surfaces the id of the active session in the error', async () => {
    const w = world({ client: { start: async () => { throw new FactCheckError(409, 'already_active', { sessionId: 'old-1' }); } } });
    await w.start();
    expect(w.session.getState()).toMatchObject({ status: 'error', error: { source: 'start', reason: 'already_active', status: 409, sessionId: 'old-1' } });
    expect(w.client.stop).not.toHaveBeenCalled();
  });

  it('stopOrphan(sessionId) stops that server session and returns the settlement', async () => {
    const w = world();
    const out = await w.session.stopOrphan('old-1');
    expect(out).toEqual({ minutes_used: 1, credits_charged: 500, balance: 9500 });
    expect(w.client.stop).toHaveBeenCalledWith({ session_id: 'old-1', end_reason: 'user_stop' });
  });

  it('check on a claim that is no longer pending applies the returned status in place, not as a failure', async () => {
    const w = world({ client: { check: async ({ claim_id }) => ({ id: claim_id, status: 'not_checkable', verdict: null, reason: null, sources: [], checked_at: null }) } });
    w.client.extract.mockResolvedValueOnce({ claims: [claimOf('c1')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    expect(w.session.getState().claims[0].status).toBe('not_checkable');
    expect(w.session.getState().status).toBe('running');
    await w.session.stop();
  });
});

describe('shared results: piece numbers, positions and piece ranges', () => {
  // Pieces as the cutter makes them: from piece 1 on, 1 s of overlap before the previous cut.
  const rp = seq => ({ seq, startMs: seq ? seq * 10000 - 1000 : 0, endMs: (seq + 1) * 10000, overlapMs: seq ? 1000 : 0, endPauseMs: 0, silent: false, wav: new Blob([new Uint8Array(4)]) });
  const reply = (shareable = true) => ({ session_id: 's1', credits_per_minute: 500, credits_held: 2500, shareable, ends_at: new Date(1_700_000_000_000 + 300000).toISOString() });
  function sharing({ shareable = true, withPosition = true, storedFor = () => true, position } = {}) {
    const pos = { current: position === undefined ? { positionS: 100, playerState: 1 } : position };
    const w = world({
      client: { start: vi.fn(async () => reply(shareable)) },
      transcribe: async p => ({ seq: p.seq, text: `text ${p.seq}`, secondsLeft: 250, stored: storedFor(p.seq) }),
      session: withPosition ? { getPosition: () => (pos.current ? { ...pos.current } : null) } : {},
    });
    w.pos = pos;
    // The player moves with the audio: the sample at the end of piece n is 100 + endMs / 1000.
    w.play = async (seq, over = {}) => { pos.current = pos.current && { positionS: 100 + (seq + 1) * 10, playerState: 1, ...over }; await w.emit(rp(seq)); };
    return w;
  }
  const sent = w => w.transcribe.mock.calls.map(c => c[0]);

  it('sends pieceNo 1, 2, 3 ... and the position at the first and last audio sample', async () => {
    const w = sharing();
    await w.start();
    await w.play(0); await w.play(1); await w.play(2);
    expect(sent(w).map(p => [p.pieceNo, p.posStartS, p.posEndS])).toEqual([
      [1, 100, 110], [2, 109, 120], [3, 119, 130],
    ]);
    expect(w.session.getState().shareable).toBe(true);
    await w.session.stop();
  });

  it('a piece cut while the player was paused carries none of the three piece fields', async () => {
    const w = sharing();
    await w.start();
    await w.play(0, { playerState: 2, positionS: 100 });
    await w.play(1);
    await w.play(2);
    const [a, b, c] = sent(w);
    expect(a).not.toHaveProperty('pieceNo'); expect(a.posStartS).toBeUndefined(); expect(a.posEndS).toBeUndefined();
    // the next piece started from a paused sample: also without position
    expect(b).not.toHaveProperty('pieceNo'); expect(b).not.toHaveProperty('posStartS');
    expect(c).toMatchObject({ pieceNo: 3, posStartS: 119, posEndS: 130 });
    await w.session.stop();
  });

  it('a piece cut while the player was buffering (not playing) loses its position even if the position advanced', async () => {
    const w = sharing();
    await w.start();
    await w.play(0, { playerState: 3 });
    expect(sent(w)[0]).not.toHaveProperty('pieceNo');
    await w.session.stop();
  });

  it('a seek (position not advancing with the audio) removes the position of that piece', async () => {
    const w = sharing();
    await w.start();
    await w.play(0);
    await w.play(1, { positionS: 900 });
    await w.play(2, { positionS: 910 });
    const [, b, c] = sent(w);
    expect(b).not.toHaveProperty('pieceNo');
    expect(c).toMatchObject({ pieceNo: 3, posStartS: 899, posEndS: 910 });
    await w.session.stop();
  });

  it('a length off by more than 1.5 s is not valid, by less is', async () => {
    const w = sharing();
    await w.start();
    await w.play(0, { positionS: 112 });   // 12 s of position for 10 s of audio
    await w.play(1, { positionS: 123 });   // 123 - (112 - 1) = 12 s for 11 s of audio
    expect(sent(w)[0]).not.toHaveProperty('pieceNo');
    expect(sent(w)[1]).toMatchObject({ posStartS: 112, posEndS: 123 });
    await w.session.stop();
  });

  it('getPosition returning null gives plain slice-1 pieces', async () => {
    const w = sharing({ position: null });
    await w.start();
    await w.emit(rp(0));
    expect(sent(w)[0]).not.toHaveProperty('pieceNo');
    await w.session.stop();
  });

  it('a turn made only of stored pieces is sent as a piece range, without text', async () => {
    const w = sharing();
    await w.start();
    await w.play(0); await w.play(1);
    const turn = w.client.extract.mock.calls[0][0].turn;
    expect(turn.piece_from).toBe(1);
    expect(turn.piece_to).toBe(2);
    expect(turn).not.toHaveProperty('text');
    expect(turn.spoken_at).toEqual(expect.any(String));
    await w.session.stop();
  });

  it('a turn with one unstored piece is sent as text, exactly as before', async () => {
    const w = sharing({ storedFor: seq => seq !== 1 });
    await w.start();
    await w.play(0); await w.play(1);
    const turn = w.client.extract.mock.calls[0][0].turn;
    expect(turn.text).toBe('text 0 text 1');
    expect(turn).not.toHaveProperty('piece_from');
    expect(Object.keys(turn)).toEqual(['text', 'spoken_at', 'position_s']);
    await w.session.stop();
  });

  it('a turn is text when the server never said stored (not shareable)', async () => {
    const w = sharing({ shareable: false });
    await w.start();
    await w.play(0); await w.play(1);
    expect(w.client.extract.mock.calls[0][0].turn.text).toBe('text 0 text 1');
    expect(w.session.getState().shareable).toBe(false);
    for (const p of sent(w)) expect(p).not.toHaveProperty('pieceNo');
    await w.session.stop();
  });

  it('without getPosition the pieces are not decorated and shareable stays as the server said', async () => {
    const w = sharing({ withPosition: false });
    await w.start();
    await w.play(0);
    expect(sent(w)[0]).not.toHaveProperty('pieceNo');
    expect(w.session.getState().shareable).toBe(true);
    await w.session.stop();
  });

  it('an absent shareable in the start answer and an absent stored in the transcribe answer count as false', async () => {
    const w = world({ client: { start: vi.fn(async () => ({ session_id: 's1', credits_per_minute: 500, credits_held: 2500, ends_at: 'x' })) }, session: { getPosition: () => ({ positionS: 1, playerState: 1 }) } });
    await w.start();
    expect(w.session.getState().shareable).toBe(false);
    await w.emit({ seq: 0, startMs: 0, endMs: 10000, overlapMs: 0, endPauseMs: 0, silent: false, wav: new Blob([]) }, { seq: 1, startMs: 9000, endMs: 20000, overlapMs: 1000, endPauseMs: 0, silent: false, wav: new Blob([]) });
    expect(w.client.extract.mock.calls[0][0].turn).toHaveProperty('text');
    await w.session.stop();
  });

  it('shareable is false before and without a start answer', () => {
    expect(world().session.getState().shareable).toBe(false);
  });

  // The requests on the wire are the same with and without a position getter when the server says not shareable.
  async function wire(getPosition) {
    const log = [];
    const fetchImpl = async (url, init) => {
      const body = init.body instanceof FormData
        ? [...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `file:${v.size}`])
        : init.body;
      log.push({ method: init.method, headers: init.headers, body });
      const action = init.body instanceof FormData ? init.body.get('action') : JSON.parse(init.body).action;
      const out = {
        start: { session_id: 's1', credits_per_minute: 500, credits_held: 2500, shareable: false },
        transcribe: { seq: 0, text: 'hello there', seconds_left: 250 },
        extract: { claims: [], ledger: null },
        stop: { minutes_used: 1, credits_charged: 500, balance: 1 },
      }[action];
      return new Response(JSON.stringify(out), { status: 200 });
    };
    const client = createFactCheckClient({ fetchImpl, getToken: async () => 't', url: 'https://x.test/f' });
    let handlers;
    const session = createFactCheckSession({
      client, transcriber: createTranscriber(client), now: () => 1_700_000_000_000, extractGapMs: 0, getPosition,
      capture: async h => { handlers = h; return { stop: async () => h.onEnded('stopped') }; },
    });
    await session.start({ videoId: 'v', channelId: 'c', videoKind: 'recorded', startPositionS: 30, minutes: 5, seed: { channel: 'c', title: 't' } });
    await settle();
    handlers.onPiece(rp(0)); handlers.onPiece(rp(1));
    await settle();
    await session.stop();
    return log;
  }

  it('requests are identical with and without a position getter when the session is not shareable', async () => {
    const without = await wire(undefined);
    const withGetter = await wire(() => ({ positionS: 130, playerState: 1 }));
    expect(withGetter).toEqual(without);
    expect(JSON.stringify(withGetter)).not.toMatch(/piece_no|pos_start_s|piece_from/);
    expect(without.length).toBeGreaterThanOrEqual(4);
  });
});

describe('positions with the real cutter (R2, R5)', () => {
  const RATE = 16000;
  const noise = (ms, amp = 0.3) => Float32Array.from({ length: Math.round(ms * RATE / 1000) }, (_, i) => amp * Math.sin(i / 5) * Math.cos(i / 131));
  const gap = ms => new Float32Array(Math.round(ms * RATE / 1000));
  const cat = parts => { const o = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let a = 0; for (const p of parts) { o.set(p, a); a += p.length; } return o; };

  // A fake capture around the REAL cutter; the player advances with the audio fed.
  async function drive(audio, { startAt = 100, playerState = () => 1 } = {}) {
    const state = { fed: 0 };
    const getPosition = () => ({ positionS: startAt + state.fed / RATE, playerState: playerState(state.fed / RATE) });
    const cutter = createPieceCutter();
    const kinds = [];
    const w = world({
      client: { start: vi.fn(async () => ({ session_id: 's1', credits_per_minute: 500, credits_held: 2500, shareable: true, ends_at: 'x' })) },
      transcribe: async p => ({ seq: p.seq, text: `t${p.seq}`, secondsLeft: 250, stored: true }),
      session: { getPosition },
    });
    await w.start();
    for (let i = 0; i < audio.length; i += 2048) {
      const chunk = audio.subarray(i, i + 2048);
      state.fed += chunk.length;
      for (const p of cutter.push(chunk)) { kinds.push(p.cutKind); w.capHandlers.onPiece({ ...p, samples: undefined, silent: false, wav: new Blob([]) }); }
    }
    await settle();
    return { w, kinds, sent: w.transcribe.mock.calls.map(c => c[0]) };
  }

  it('every piece position is within 0.25 s of the truth and none is dropped, for pause, quiet and hard cuts', async () => {
    const audio = cat([
      noise(9000), gap(700), noise(8000),            // a pause cut
      noise(3000), noise(300, 0.04), noise(9000),    // a quiet-window cut (music bed dip)
      noise(15000),                                  // a hard cut
      noise(6000),
    ]);
    const { kinds, sent } = await drive(audio);
    expect(new Set(kinds)).toEqual(new Set(['pause', 'quiet', 'hard']));
    expect(sent.length).toBeGreaterThanOrEqual(4);
    for (const p of sent) {
      expect(p.pieceNo).toBe(p.seq + 1);
      expect(Math.abs(p.posEndS - (100 + p.endMs / 1000))).toBeLessThan(0.25);
      expect(Math.abs(p.posStartS - (100 + p.startMs / 1000))).toBeLessThan(0.25);
    }
  });

  it('a start slightly below 0 (within 1.5 s) is clamped to 0; one further below is sent without positions', async () => {
    const lone = async endPos => {
      const samples = [0, endPos];
      const w = world({
        client: { start: vi.fn(async () => ({ session_id: 's1', credits_per_minute: 500, credits_held: 2500, shareable: true, ends_at: 'x' })) },
        session: { getPosition: () => ({ positionS: samples.length > 1 ? samples.shift() : samples[0], playerState: 1 }) },
      });
      await w.start();
      w.capHandlers.onPiece({ seq: 0, startMs: 0, endMs: 10000, overlapMs: 0, heldMs: 0, endPauseMs: 0, silent: false, wav: new Blob([]) });
      await settle();
      return w.transcribe.mock.calls[0][0];
    };
    expect(await lone(9)).toMatchObject({ pieceNo: 1, posStartS: 0, posEndS: 9 });
    expect(await lone(8)).not.toHaveProperty('pieceNo');
  });
});

describe('F349: end reasons sent with stop', () => {
  const sent = w => w.client.stop.mock.calls.map(c => c[0].end_reason);

  it.each([
    ['user', 'user_stop'], ['modal_close', 'modal_close'], ['channel_change', 'channel_change'], ['ui', 'other'],
  ])('a stop(%s) sends end_reason %s', async (reason, wire) => {
    const w = world();
    await w.start();
    await w.session.stop(reason);
    expect(sent(w)).toEqual([wire]);
  });

  it('the default stop (the Stop button) is user_stop', async () => {
    const w = world();
    await w.start();
    await w.session.stop();
    expect(sent(w)).toEqual(['user_stop']);
  });

  it('the browser ending the share (Stop sharing, track ended) sends sharing_stopped', async () => {
    const w = world();
    await w.start();
    await w.emit(piece(0));
    w.capHandlers.onEnded('ended');
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(sent(w)).toEqual(['sharing_stopped']);
  });

  it('the block running out sends time_up', async () => {
    const w = world();
    await w.start();
    w.now += 301000;
    w.tick();
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(sent(w)).toEqual(['time_up']);
  });

  it('the silence limit sends silence', async () => {
    const w = world();
    await w.start();
    await w.emit(piece(0));
    for (let i = 1; i <= 9; i++) await w.emit(piece(i, { silent: true }));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(sent(w)).toEqual(['silence']);
  });

  it('being ended by a 409 sends server', async () => {
    const w = world({ transcribe: async p => { if (p.seq === 1) throw new FactCheckError(409, 'settled'); return { seq: p.seq, text: 'x', secondsLeft: 100 }; } });
    await w.start();
    await w.emit(piece(0), piece(1));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(sent(w)).toEqual(['server']);
  });

  it('ending on repeated failures sends error', async () => {
    const w = world({ transcribe: async () => { throw new FactCheckError(400, 'bad_request'); } });
    await w.start();
    await w.emit(piece(0), piece(1), piece(2));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('error'));
    expect(sent(w)).toEqual(['error']);
  });

  it('a stop asked for while the server start is in flight carries its own reason', async () => {
    const gate = defer();
    const w = world({ client: { start: async () => { await gate.promise; return { session_id: 's1', credits_per_minute: 500, credits_held: 2500 }; } } });
    const started = w.session.start(PARAMS);
    await settle();
    const stopping = w.session.stop('modal_close');
    gate.resolve();
    await started; await stopping;
    expect(sent(w)).toEqual(['modal_close']);
  });
});

describe('F349: a 409 ending the session keeps the server reason', () => {
  it.each(['settled', 'ended'])('records endDetail %s', async (reason) => {
    const w = world({ transcribe: async p => { if (p.seq === 1) throw new FactCheckError(409, reason); return { seq: p.seq, text: 'x', secondsLeft: 100 }; } });
    await w.start();
    await w.emit(piece(0), piece(1));
    await vi.waitFor(() => expect(w.session.getState().status).toBe('ended'));
    expect(w.session.getState()).toMatchObject({ endReason: 'server', endDetail: reason });
  });
  it('other endings have no endDetail', async () => {
    const w = world();
    await w.start();
    await w.session.stop();
    expect(w.session.getState().endDetail).toBeNull();
  });
});

describe('F349: fail_reason stays on the claim', () => {
  const claimFrom = id => ({ id, quote: 'q', claim_en: 'c', kind: 'claim', status: 'pending' });
  it.each([['no_sources'], ['no_label'], ['bad_label'], ['label_conflict']])('a check answering error/%s keeps it', async (fail_reason) => {
    const w = world({ client: { check: async ({ claim_id }) => ({ id: claim_id, status: 'error', verdict: null, reason: null, sources: [], checked_at: null, fail_reason }) } });
    w.client.extract.mockResolvedValueOnce({ claims: [claimFrom('c1')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    await vi.waitFor(() => expect(w.session.getState().claims[0].status).toBe('error'));
    expect(w.session.getState().claims[0].fail_reason).toBe(fail_reason);
    await w.session.stop();
  });
  it('an older response without the field reads as null, and a thrown check has none', async () => {
    const w = world();
    w.client.extract.mockResolvedValueOnce({ claims: [claimFrom('c1')], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    await vi.waitFor(() => expect(w.session.getState().claims[0].status).toBe('checked'));
    expect(w.session.getState().claims[0].fail_reason).toBeNull();
    await w.session.stop();
    const v = world({ client: { check: async () => { throw new FactCheckError(500, 'server_error'); } } });
    v.client.extract.mockResolvedValueOnce({ claims: [claimFrom('c1')], ledger: {} });
    await v.start();
    await v.emit(piece(0), piece(1));
    await vi.waitFor(() => expect(v.session.getState().claims[0].status).toBe('error'));
    expect(v.session.getState().claims[0].fail_reason).toBeNull();
    await v.session.stop();
  });
});

describe('F349 review: a later extract never overwrites a real fail_reason', () => {
  it('extract returning the same id with fail_reason null leaves an error/no_sources claim alone', async () => {
    const pending = { id: 'c1', quote: 'q', claim_en: 'c', kind: 'claim', status: 'pending', fail_reason: null };
    const w = world({ client: { check: async ({ claim_id }) => ({ id: claim_id, status: 'error', verdict: null, sources: [], fail_reason: 'no_sources' }) } });
    w.client.extract.mockResolvedValueOnce({ claims: [pending], ledger: {} }).mockResolvedValue({ claims: [{ ...pending, status: 'error', fail_reason: null }], ledger: {} });
    await w.start();
    await w.emit(piece(0), piece(1));
    await vi.waitFor(() => expect(w.session.getState().claims[0].fail_reason).toBe('no_sources'));
    await w.emit(piece(2), piece(3), piece(4));
    await settle(10);
    expect(w.session.getState().claims[0]).toMatchObject({ status: 'error', fail_reason: 'no_sources' });
    await w.session.stop();
  });
});
