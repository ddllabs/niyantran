// F344 T5: the live fact-check session state machine. No React, no DOM.
//
// Session status:
//   idle        nothing running
//   choosing    the user is picking a block (set by choose(), before start)
//   sharing     waiting for the browser's share prompt
//   starting    tab audio granted; the server session is being started
//   running     transcribing, extracting, checking
//   ending      capture released, in-flight work finishing, server stop pending
//   ended       finished normally (see endReason)
//   error       finished with an error (see error)
// Claim status: pending, checked, needs_context, not_checkable, error, and
//   unchecked (client-side: the session ended and no check came back; no check
//   happened). A claim is never left `pending` once the run has ended.
// endDetail (state): the server's reason when a 409 ended the session (settled: ended elsewhere), else null.
// Claim fail_reason: null | no_label | bad_label | label_conflict | no_sources (status error only).
// endReason: user | browser | time | silent | server | off | error | price_changed | <caller's reason>
//   (off: the server switched the feature off; the session is stopped and charged as used)
// budgetReached (state): the server's extract/check budget for this session was used up (429
//   reason budget, never retried). Later checks/extracts are not sent; their claims end as
//   unchecked and their turns count in droppedTurns. Transcription goes on.
// error.sessionId (start refused with 409 already_active): the session still active on the
//   server; stopOrphan(sessionId) stops it.
//
// Shared results (recorded videos): when `start` answers shareable: true and a getPosition()
// option exists ({ positionS, playerState } from the player; playerState 1 = playing), each piece
// whose position moved with the audio goes to the server with pieceNo (seq + 1), posStartS and
// posEndS (all three or none; any other piece is sent as in slice 1); a turn whose pieces the server all stored is sent as a piece range instead of text.
// Without that, requests are exactly as before. State: shareable.
//
// Order of events on start: the tab is shared first, then the server session
// is started. A user who dismisses the browser's share prompt therefore costs
// nothing (a started session is charged at least one minute). Pieces that arrive
// while the server start is in flight wait and are sent afterwards.
//
// While running: captured pieces are transcribed (two at a time), applied to the
// transcript in capture order, tag-stripped and overlap-joined; closed turns go
// to `extract` one call at a time and at least 10 s apart (turns that queue up
// are merged into one call; the ledger passes from one call to the next); each
// pending claim is sent to `check`, three at a time. The session ends once,
// calls `stop` on the server once, and releases capture on every path.
import { startCapture } from './capture.js';
import { createFactCheckClient } from './client.js';
import { createTranscriber } from './transcriber.js';
import { createTurnBuilder, mergeOverlap, stripSoundTags } from './pieces.js';

export const LIMITS = Object.freeze({
  transcribeConcurrency: 2,
  checkConcurrency: 3,
  extractGapMs: 10000,    // at least this long between extract calls
  retries429: 3,          // waits 1 s, 2 s, 4 s unless Retry-After says otherwise
  retriesTransient: 2,    // network failure, timeout or 5xx: waits 0.5 s, 1 s
  maxRetryAfterMs: 30000,
  failureLimit: 3,        // consecutive failed calls before the session gives up
  callTimeoutMs: 45000,
  startTimeoutMs: 20000,  // the server start must answer within this
  drainMs: 100000,        // the server allows extract/check for 120 s after the end
  silentMs: 90000,        // no audible piece for this long ends the session
  tickMs: 1000,
  recentTurns: 3,
});

// What the server is told about why a session ended (the `stop` request's end_reason). The names
// inside the browser (endReason) are older and shown to the user; this maps them to the wire set.
const WIRE_END_REASONS = {
  user: 'user_stop', modal_close: 'modal_close', channel_change: 'channel_change', browser: 'sharing_stopped',
  time: 'time_up', silent: 'silence', server: 'server', error: 'error',
};
export const wireEndReason = reason => (Object.hasOwn(WIRE_END_REASONS, reason) ? WIRE_END_REASONS[reason] : 'other');

export function createFactCheckSession({
  client = createFactCheckClient(),
  transcriber = createTranscriber(client),
  capture = startCapture, now = Date.now, onChange = () => {},
  timers = { setTimeout: (...a) => globalThis.setTimeout(...a), clearTimeout: (...a) => globalThis.clearTimeout(...a) },
  sleep = ms => new Promise(resolve => timers.setTimeout(resolve, ms)),
  initialLedger = null,
  extractGapMs = LIMITS.extractGapMs,
  getPosition = null,
} = {}) {
  let run = null;
  let phase = 'idle';

  const publish = () => onChange(getState());

  function idleState(status) {
    return {
      status, sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
      transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false, shareable: false,
      final: null, endReason: null, endDetail: null, error: null,
    };
  }
  function getState() { return run ? run.snapshot() : idleState(phase); }

  function choose() { if (!run || run.finished()) { run = null; phase = 'choosing'; publish(); } }
  function cancelChoice() { if (!run && phase === 'choosing') { phase = 'idle'; publish(); } }
  function reset() { if (!run || run.finished()) { run = null; phase = 'idle'; publish(); } }

  async function start(params) {
    // A run that is being stopped finishes (server stop included) before a new one begins.
    if (run && !run.finished() && run.stopping()) await run.done;
    if (run && !run.finished()) return;
    run = createRun(params);
    publish();
    await run.begin();
  }
  function stop(reason = 'user') { return run ? run.stop(reason) : Promise.resolve(); }
  /** Stops a session left active on the server (for example after 409 already_active). */
  function stopOrphan(sessionId) { return client.stop({ session_id: sessionId, end_reason: wireEndReason('user') }); }

  function createRun(params) {
    const { videoId, channelId, videoKind, startPositionS = null, minutes, seed = {}, expectedCreditsPerMinute } = params;
    let status = 'sharing';
    let sessionId = null;
    let creditsPerMinute = null;
    let creditsHeld = null;
    let endsAt = null;
    let frozenLeft = null;
    let final = null;
    let endReason = null;
    let endDetail = null;        // the server's reason when a 409 ended the session (settled, ended)
    let error = null;
    let skipped = 0;
    let dropped = 0;
    let shareable = false;       // the server confirmed this recorded video can be shared
    const posByPiece = new Map(); // seq -> { posStartS, posEndS } for pieces with a sane position
    const storedSeqs = new Set(); // seqs the server stored (answered stored: true)
    let lastSample = null;        // player position when the previous piece was cut
    let noMoreChecks = false;
    let noMoreExtracts = false;
    let failures = 0;
    let dead = false;            // stop sending work; ignore late results
    let cancelled = false;
    let stopRequested = null;    // a stop that arrived while the server start was in flight
    let capHandle = null;
    let captureEnded = false;
    let browserEndedEarly = false;
    let startedAt = now();
    let tickTimer = null;
    let endPromise = null;
    let ledger = initialLedger;
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });

    const lines = [];
    const claims = new Map();
    const checkQueued = new Set();
    const history = [];
    const builder = createTurnBuilder();
    const early = [];
    const pending = [];          // pieces waiting for a transcription slot
    const results = new Map();   // seq -> { piece, text | null }
    let nextSeq = 0;
    let running = 0;
    let checksRunning = 0;
    const checkQueue = [];
    const extractQueue = [];
    let extracting = false;
    let lastExtractAt = -Infinity;
    let paceTimer = null;
    let draining = false;
    let busy = 0;
    const waiters = [];
    let drainExpired = false;
    let lastAudibleEnd = 0;
    let latestEnd = 0;

    const left = () => (endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now()) / 1000)));
    const setStatus = next => {
      status = next;
      if (next === 'ended' || next === 'error') resolveDone();
      publish();
    };
    const snapshot = () => ({
      status, sessionId, minutesBought: minutes, creditsPerMinute, creditsHeld,
      secondsLeft: frozenLeft ?? (status === 'running' ? left() : status === 'sharing' || status === 'starting' ? minutes * 60 : 0),
      transcript: lines.map(l => ({ ...l })),
      claims: [...claims.values()].map(c => ({ ...c, sources: [...c.sources] })),
      silentFor: Math.max(0, latestEnd - lastAudibleEnd),
      skippedPieces: skipped, droppedTurns: dropped, budgetReached: noMoreChecks || noMoreExtracts, shareable, final, endReason, endDetail, error: error && { ...error },
    });

    // ---- bookkeeping for "is everything finished" ----
    const jobStart = () => { busy++; };
    const jobDone = (n = 1) => { busy -= n; wake(); };
    function wake() { for (const w of waiters.splice(0)) w(); }
    function whenIdle() {
      return new Promise(resolve => {
        const check = () => (busy === 0 || drainExpired ? resolve() : waiters.push(check));
        check();
      });
    }

    // ---- calls with timeouts and retries ----
    const timeoutError = () => Object.assign(new Error('timeout'), { status: 0, reason: 'timeout' });
    // One attempt: its own AbortController, aborted when the timeout fires.
    async function attempt(fn, timeoutMs) {
      const controller = new AbortController();
      let id;
      const timeout = new Promise((_, reject) => {
        id = timers.setTimeout(() => { controller.abort(); reject(timeoutError()); }, timeoutMs);
      });
      try {
        return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), timeout]);
      } catch (e) {
        throw e?.name === 'AbortError' ? timeoutError() : e;
      } finally { timers.clearTimeout(id); }
    }
    async function retrying(fn, { critical = false, timeoutMs = LIMITS.callTimeoutMs } = {}) {
      let rate = 0;
      let transient = 0;
      for (;;) {
        try {
          return await attempt(fn, timeoutMs);
        } catch (e) {
          if (dead && !critical) throw e;
          const st = e?.status;
          let wait = null;
          if (st === 429 && e.reason !== 'budget' && rate < LIMITS.retries429) wait = Math.min(e.retryAfterMs ?? 1000 * 2 ** rate++, LIMITS.maxRetryAfterMs);
          else if ((st === 0 || st >= 500) && transient < LIMITS.retriesTransient) wait = 500 * 2 ** transient++;
          if (wait === null) throw e;
          await sleep(wait);
          if (dead && !critical) throw e;
        }
      }
    }
    const describe = (source, e) => {
      const info = { source, reason: e?.reason || (e?.status === 0 ? 'network' : 'unknown'), status: e?.status ?? 0 };
      if (e?.needed !== undefined) info.needed = e.needed;
      if (e?.available !== undefined) info.available = e.available;
      if (e?.creditsPerMinute !== undefined) info.creditsPerMinute = e.creditsPerMinute;
      if (e?.sessionId !== undefined) info.sessionId = e.sessionId;
      return info;
    };
    // A call failed for good. May end the session.
    function failed(source, e) {
      if (dead || endPromise) return;
      const st = e?.status;
      if (st === 403 && e?.reason === 'off') { void end('off', { flush: false, drain: false }); return; }
      if (st === 409) { void end('server', { flush: false, detail: typeof e?.reason === 'string' ? e.reason : null }); return; }
      const fatal = st === 401 || st === 403 || (st === 404 && source !== 'check' && e?.reason === 'not_found');
      if (fatal || ++failures >= LIMITS.failureLimit) void end('error', { errorInfo: describe(source, e), flush: false, drain: false });
    }
    const succeeded = () => { failures = 0; };

    // ---- positions (shared results) ----
    // The player is read when a piece arrives, which is `heldMs` of audio after the piece's last
    // sample (the cutter holds audio past a cut): the end position is the reading minus heldMs, the
    // start is the end minus the piece's own audio length. Valid only if the player was playing at
    // this reading and the previous one, and the position moved by the audio received between the two
    // readings within 1.5 s (a pause, buffering or a seek fails). A start a little below 0 is 0.
    function samplePosition() {
      if (!getPosition) return null;
      try {
        const p = getPosition();
        return p && Number.isFinite(p.positionS) ? { positionS: p.positionS, playing: p.playerState === 1, atMs: 0 } : null;
      } catch { return null; }
    }
    function notePosition(piece) {
      if (!getPosition) return;
      const cur = samplePosition();
      const prev = lastSample;
      if (cur) cur.atMs = piece.endMs + (piece.heldMs || 0);
      lastSample = cur;
      if (!prev || !cur || !prev.playing || !cur.playing) return;
      if (Math.abs((cur.positionS - prev.positionS) - (cur.atMs - prev.atMs) / 1000) > 1.5) return;
      const endS = cur.positionS - (piece.heldMs || 0) / 1000;
      let startS = endS - (piece.endMs - piece.startMs) / 1000;
      if (startS < 0) { if (startS < -1.5) return; startS = 0; }
      if (endS < startS) return;
      posByPiece.set(piece.seq, { posStartS: Math.round(startS * 1000) / 1000, posEndS: Math.round(endS * 1000) / 1000 });
    }
    // With sharing off or no position getter the piece is passed on untouched.
    // The three piece fields go together or not at all: the server refuses a piece with only some.
    const forServer = piece => {
      const pos = shareable && getPosition ? posByPiece.get(piece.seq) : null;
      return pos ? { ...piece, pieceNo: piece.seq + 1, ...pos } : piece;
    };

    // ---- transcription ----
    function onPiece(piece) {
      if (dead || cancelled) return;
      notePosition(piece);
      latestEnd = Math.max(latestEnd, piece.endMs);
      if (!piece.silent) lastAudibleEnd = piece.endMs;
      if (!sessionId) { early.push(piece); return; }
      enqueuePiece(piece);
      if (status === 'running' && !endPromise && latestEnd - lastAudibleEnd >= LIMITS.silentMs) void end('silent');
      publish();
    }
    function enqueuePiece(piece) { jobStart(); pending.push(piece); pump(); }
    function pump() {
      while (!dead && running < LIMITS.transcribeConcurrency && pending.length) {
        running++;
        void transcribeJob(pending.shift());
      }
    }
    async function transcribeJob(piece) {
      let text = null;
      let secondsLeft;
      let failure = null;
      try {
        const r = await retrying(signal => transcriber.transcribe(forServer(piece), sessionId, { signal }));
        if (r?.stored === true) storedSeqs.add(piece.seq);
        text = typeof r?.text === 'string' ? r.text : '';
        secondsLeft = r?.secondsLeft;
        succeeded();
      } catch (e) { failure = e; }
      running--;
      if (dead) { jobDone(); return; }
      if (failure) skipped++;
      results.set(piece.seq, { piece, text });
      applyReady();
      if (typeof secondsLeft === 'number') {
        // seconds_left counts to the end of the block (not the grace after it)
        endsAt = now() + secondsLeft * 1000;
        if (secondsLeft <= 0 && !endPromise) void end('time');
      }
      if (failure) failed('transcribe', failure);
      jobDone();
      pump();
      publish();
    }
    function applyReady() {
      while (results.has(nextSeq)) {
        const { piece, text } = results.get(nextSeq);
        results.delete(nextSeq);
        nextSeq++;
        if (text === null) continue;
        let clean = stripSoundTags(text);
        const prev = lines.at(-1);
        if (clean && prev && prev.seq === piece.seq - 1 && piece.overlapMs > 0) {
          const merged = mergeOverlap(prev.text, clean);
          if (merged.prev !== prev.text) {
            builder.amend(prev.seq, merged.prev);
            if (merged.prev) prev.text = merged.prev; else lines.pop();
          }
          clean = merged.next;
        }
        const startMs = piece.startMs + (piece.overlapMs || 0);
        if (clean) lines.push({ seq: piece.seq, text: clean, startMs });
        for (const turn of builder.add({ seq: piece.seq, text: clean, startMs, endMs: piece.endMs, endPauseMs: piece.endPauseMs })) {
          enqueueExtract(turn);
        }
      }
    }

    // ---- extraction (one call at a time, paced, queued turns merged) ----
    function enqueueExtract(turn) {
      if (noMoreExtracts) { dropped++; return; }
      const recent = history.slice(-LIMITS.recentTurns);
      history.push(turn.text);
      jobStart();
      extractQueue.push({ turn, recent });
      pumpExtract();
    }
    function pumpExtract() {
      if (dead || extracting || !extractQueue.length) return;
      const wait = draining ? 0 : lastExtractAt + extractGapMs - now();
      if (wait > 0) {
        if (paceTimer === null) paceTimer = timers.setTimeout(() => { paceTimer = null; pumpExtract(); }, wait);
        return;
      }
      extracting = true;
      void extractJob(extractQueue.splice(0));
    }
    async function extractJob(batch) {
      lastExtractAt = now();
      const first = batch[0].turn;
      const turn = batch.length === 1 ? first : { ...first, text: batch.map(b => b.turn.text).join(' ') };
      const when = {
        spoken_at: new Date(startedAt + turn.startMs).toISOString(),
        position_s: videoKind === 'recorded' && startPositionS !== null ? startPositionS + turn.startMs / 1000 : null,
      };
      // A turn whose pieces the server all stored is sent as a range: the server builds the text.
      const seqs = batch.flatMap(b => b.turn.seqs || []).sort((a, b) => a - b);
      const ranged = shareable && seqs.length > 0 && seqs.length <= 12
        && seqs.every((q, i) => storedSeqs.has(q) && (i === 0 || q === seqs[i - 1] + 1));
      const payload = {
        session_id: sessionId,
        turn: ranged ? { piece_from: seqs[0] + 1, piece_to: seqs.at(-1) + 1, ...when } : { text: turn.text, ...when },
        recent: batch[0].recent, ledger, seed,
      };
      try {
        const r = await retrying(signal => client.extract({ ...payload, signal }));
        if (!dead) {
          succeeded();
          if (r && r.ledger !== undefined) ledger = r.ledger;
          for (const c of r?.claims || []) takeClaim(c);
        }
      } catch (e) {
        if (!dead) {
          dropped += batch.length;
          if (e?.status === 429 && e.reason === 'budget') {
            noMoreExtracts = true;
            const queued = extractQueue.splice(0).length;
            dropped += queued;
            jobDone(queued);
          } else failed('extract', e);
        }
      }
      extracting = false;
      jobDone(batch.length);
      pumpExtract();
      publish();
    }
    // Updates the claim in place. A claim that is queued, running or finished
    // keeps its state; one returned again as pending (a held claim resolved) is
    // queued for a check under the same id.
    function takeClaim(c) {
      if (!c || !c.id) return;
      const old = claims.get(c.id);
      if (old && (checkQueued.has(c.id) || old.status === 'checked' || old.status === 'error')) return;
      if (old) {
        Object.assign(old, {
          quote: c.quote ?? old.quote, claim_en: c.claim_en ?? old.claim_en,
          claimant: c.claimant ?? null, reported_by: c.reported_by ?? null, kind: c.kind ?? old.kind, status: c.status,
        });
      } else {
        claims.set(c.id, {
          id: c.id, quote: c.quote ?? '', claim_en: c.claim_en ?? '', claimant: c.claimant ?? null,
          reported_by: c.reported_by ?? null, kind: c.kind ?? 'claim', status: c.status,
          verdict: null, reason: null, sources: [], checked_at: null, fail_reason: null,
        });
      }
      if (c.status === 'pending' && !noMoreChecks) {
        checkQueued.add(c.id);
        jobStart();
        checkQueue.push(c.id);
        pumpChecks();
      }
    }

    // ---- checks ----
    function pumpChecks() {
      if (noMoreChecks) jobDone(checkQueue.splice(0).length); // stay pending; unchecked at the end
      while (!dead && checksRunning < LIMITS.checkConcurrency && checkQueue.length) {
        checksRunning++;
        void checkJob(checkQueue.shift());
      }
    }
    async function checkJob(id) {
      const claim = claims.get(id);
      try {
        const r = await retrying(signal => client.check({ session_id: sessionId, claim_id: id, signal }));
        if (!dead) {
          succeeded();
          Object.assign(claim, {
            status: r.status ?? 'checked', verdict: r.verdict ?? null, reason: r.reason ?? null,
            sources: Array.isArray(r.sources) ? r.sources : [], checked_at: r.checked_at ?? null,
            fail_reason: typeof r.fail_reason === 'string' ? r.fail_reason : null,
          });
        }
      } catch (e) {
        if (!dead) {
          if (e?.status === 429 && e.reason === 'budget') { claim.status = 'unchecked'; noMoreChecks = true; }
          else { claim.status = 'error'; failed('check', e); }
        }
      }
      checksRunning--;
      jobDone();
      pumpChecks();
      publish();
    }

    // ---- clock ----
    function tick() {
      tickTimer = null;
      if (status !== 'running') return;
      if (now() >= endsAt) { void end('time'); return; }
      publish();
      tickTimer = timers.setTimeout(tick, LIMITS.tickMs);
    }
    function stopTicker() {
      if (tickTimer !== null) timers.clearTimeout(tickTimer);
      if (paceTimer !== null) timers.clearTimeout(paceTimer);
      tickTimer = null; paceTimer = null;
    }

    // ---- ending ----
    // flush: send the capture's last partial piece. drain: let in-flight work
    // finish and extract the open turn (the server allows it for 120 s).
    function end(reason, { errorInfo = null, flush = true, drain = true, detail = null } = {}) {
      if (endPromise) return endPromise;
      endPromise = (async () => {
        frozenLeft = left();
        stopTicker();
        if (!drain) dead = true;
        if (reason === 'server') jobDone(pending.splice(0).length); // the server refuses more audio
        setStatus('ending');
        if (errorInfo) error = errorInfo;
        if (!captureEnded) {
          captureEnded = true;
          try { await capHandle?.stop({ flush }); } catch { /* released by capture itself */ }
        }
        if (drain) await drainWork();
        let stopFailure = null;
        try {
          final = await retrying(signal => client.stop({ session_id: sessionId, end_reason: wireEndReason(reason), signal }), { critical: true });
        } catch (e) {
          if (e?.status !== 409) stopFailure = describe('stop', e);
        }
        endReason = reason;
        endDetail = detail;
        if (stopFailure && !error) error = stopFailure;
        dead = true;
        for (const c of claims.values()) if (c.status === 'pending') c.status = 'unchecked';
        setStatus(error ? 'error' : 'ended');
      })();
      return endPromise;
    }
    async function drainWork() {
      const id = timers.setTimeout(() => { drainExpired = true; wake(); }, LIMITS.drainMs);
      await whenIdle();
      if (!drainExpired) {
        draining = true;
        if (paceTimer !== null) { timers.clearTimeout(paceTimer); paceTimer = null; }
        for (const turn of builder.flush()) enqueueExtract(turn);
        pumpExtract();
        await whenIdle();
      }
      timers.clearTimeout(id);
      if (drainExpired) dead = true;
    }

    // ---- begin / stop ----
    async function begin() {
      let cap;
      try {
        cap = await capture({
          onPiece,
          onEnded: reason => {
            if (reason !== 'ended' || captureEnded) return;
            captureEnded = true;
            if (status === 'running') void end('browser'); else browserEndedEarly = true;
          },
          onError: () => {
            if (status === 'running' && !endPromise) void end('error', { errorInfo: { source: 'capture', reason: 'handler', status: 0 }, flush: false, drain: false });
          },
        });
      } catch (e) {
        if (cancelled) return;
        error = { source: 'capture', reason: e?.reason || 'failed', status: 0 };
        setStatus('error');
        return;
      }
      capHandle = cap;
      lastSample = samplePosition(); // player position at the first audio sample
      if (cancelled) { await cap.stop({ flush: false }); return; }
      startedAt = now();
      setStatus('starting');
      let res;
      try {
        // Never retried: a second start could create a second session.
        res = await attempt(signal => client.start({
          video_id: videoId, channel_id: channelId, video_kind: videoKind, start_position_s: startPositionS, minutes,
          expected_credits_per_minute: expectedCreditsPerMinute, signal,
        }), LIMITS.startTimeoutMs);
      } catch (e) {
        captureEnded = true;
        dead = true;
        early.length = 0;
        await cap.stop({ flush: false });
        error = describe('start', e);
        setStatus('error');
        return;
      }
      sessionId = res.session_id;
      shareable = res.shareable === true;
      creditsPerMinute = res.credits_per_minute ?? null;
      creditsHeld = res.credits_held ?? null;
      // The local clock rules until the first seconds_left arrives.
      endsAt = now() + minutes * 60000;
      // The user agreed to one price; a session started at another is ended at once (the server
      // normally refuses a mismatch before this point).
      if (typeof expectedCreditsPerMinute === 'number' && creditsPerMinute !== expectedCreditsPerMinute) {
        early.length = 0;
        void end('price_changed', {
          errorInfo: { source: 'start', reason: 'price_changed', status: 0, creditsPerMinute }, flush: false, drain: false,
        });
        return;
      }
      setStatus('running');
      tickTimer = timers.setTimeout(tick, LIMITS.tickMs);
      for (const piece of early.splice(0)) enqueuePiece(piece);
      publish();
      if (browserEndedEarly) void end('browser');
      else if (stopRequested) void end(stopRequested);
    }

    function stopRun(reason) {
      if (status === 'sharing') {
        cancelled = true;
        dead = true;
        run = null; phase = 'idle'; resolveDone(); publish();
        return Promise.resolve();
      }
      if (status === 'starting') { stopRequested ??= reason; return done; }
      if (status === 'running' || status === 'ending') return end(reason);
      return endPromise || Promise.resolve();
    }

    return {
      begin, snapshot, stop: stopRun, done,
      stopping: () => status === 'ending' || stopRequested !== null,
      finished: () => status === 'ended' || status === 'error',
    };
  }

  return { start, stop, stopOrphan, choose, cancelChoice, reset, getState };
}
