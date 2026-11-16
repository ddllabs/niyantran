// F344 T6: the modal's side of the fact-check session. No React: the hook is a thin shell around
// this, so what ends a session (a new channel, a new video, closing the modal) is tested here.
//
// The session itself (src/lib/factcheck/session.js) is created only when the user first presses
// the button, so an account without the feature does no work beyond one flag read.
import { createFactCheckClient } from '../../lib/factcheck/client.js';
import { createFactCheckSession } from '../../lib/factcheck/session.js';
import { isSupported } from '../../lib/factcheck/capture.js';
import { creditsText, refreshCredits, serverCredits, subscribeCredits } from '../../lib/creditsStore.js';
import { readFactCheckFlag } from './factCheckFlag.js';
import { RECHECK_FAILED, VERDICTS, priceChangedText, recheckErrorText, recheckPriceChangedText } from './factCheckText.js';

const OFF = { available: false, creditsPerMinute: null, recheckCredits: null, userId: null };
const IDLE = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, final: null, endReason: null, error: null,
};
const ACTIVE = new Set(['sharing', 'starting', 'running', 'ending']);
const FINISHED = new Set(['ended', 'error']);

export const INITIAL_VIEW = Object.freeze({
  flag: OFF, supported: false, ready: false, session: IDLE, announcement: '', priceNotice: '', orphanNotice: '', orphanFailed: false, rechecks: {}, balance: null,
});

const defaultCredits = {
  available: (userId) => serverCredits(userId)?.available ?? null,
  refresh: () => refreshCredits(),
  subscribe: (fn) => subscribeCredits(fn),
};

export function createFactCheckController({
  createSession = createFactCheckSession,
  readFlag = readFactCheckFlag,
  supported = isSupported,
  credits = defaultCredits,
  client = null,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onChange = () => {},
} = {}) {
  let flag = OFF;
  let isSupportedHere = false;
  let session = null;
  let sessionState = IDLE;
  let target;            // undefined until the first setTarget; null = nothing playing
  let announcement = '';
  let priceNotice = '';
  let orphanNotice = '';
  let orphanFailed = false;
  let chooseId = 0;
  // Re-check state by claim id: { phase: 'idle'|'confirming'|'running', results (newest first), error, notice }.
  // Independent of the session; cleared with the panel.
  const rechecks = new Map();
  let recheckEpoch = 0;
  let clientRef = client;
  let announced = new Map();
  let unsubscribe = null;
  let loadId = 0;

  const balance = () => {
    try { return credits.available(flag.userId); } catch { return null; }
  };
  const view = () => ({
    flag, supported: isSupportedHere, ready: Boolean(target), session: sessionState, announcement, priceNotice, orphanNotice, orphanFailed, rechecks: recheckView(), recheckActions, balance: balance(),
  });
  const recheckView = () => Object.fromEntries([...rechecks].map(([id, r]) => [id, { ...r, results: [...r.results] }]));
  const emit = () => onChange(view());
  function clearRechecks() { recheckEpoch++; rechecks.clear(); }

  function noteVerdicts(state) {
    if (state.status === 'sharing' && !ACTIVE.has(sessionState.status)) { announced = new Map(); announcement = ''; }
    const fresh = [];
    for (const c of state.claims) {
      if (c.status === 'checked' && Object.hasOwn(VERDICTS, c.verdict) && announced.get(c.id) !== c.verdict) {
        announced.set(c.id, c.verdict);
        fresh.push(`${VERDICTS[c.verdict].label}: ${c.claim_en}`);
      }
    }
    if (fresh.length) announcement = fresh.join('. ');
  }

  function handle(state) {
    const prev = sessionState;
    noteVerdicts(state);
    sessionState = state;
    if (state.status === 'idle' || (state.status === 'sharing' && !ACTIVE.has(prev.status))) clearRechecks();
    if (state.status === 'sharing' || state.status === 'idle') { priceNotice = ''; orphanNotice = ''; orphanFailed = false; }
    // The charge is settled on the server; the header balance catches up once. A start that got no
    // answer may have created a session, so it asks too.
    const finishedNow = FINISHED.has(state.status) && !FINISHED.has(prev.status);
    if (finishedNow && (state.sessionId || (state.error?.source === 'start' && state.error.status === 0))) {
      Promise.resolve(credits.refresh()).catch(() => {});
    }
    emit();
    // The server refused the start because the price moved: no session exists. Back to choosing, at
    // the fresh price, so the user decides again knowing it.
    const e = state.error;
    if (state.status === 'error' && !state.sessionId && e?.source === 'start' && e.reason === 'price_changed'
      && typeof e.creditsPerMinute === 'number' && e.creditsPerMinute > 0 && e.creditsPerMinute <= 5000) {
      flag = { ...flag, creditsPerMinute: e.creditsPerMinute };
      session.reset();
      session.choose();
      priceNotice = priceChangedText(e.creditsPerMinute);
      emit();
    }
  }

  function ensureSession() {
    if (!session) session = createSession({ onChange: handle });
    return session;
  }

  async function load() {
    const id = ++loadId;
    let result;
    try { result = await readFlag(); } catch { result = OFF; }
    if (id !== loadId) return;
    flag = result?.available === true ? result : { ...OFF, userId: result?.userId ?? null };
    isSupportedHere = Boolean(supported());
    if (flag.available && !unsubscribe) unsubscribe = credits.subscribe(emit);
    emit();
  }

    // Closing the modal ends what is running but keeps the ended or error view, so a charge or a stop
  // warning is still there when Live TV is opened again.
  async function close() {
    loadId++; // a flag read still in flight is dropped
    chooseId++;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (!session) return;
    const status = sessionState.status;
    if (status === 'choosing') session.cancelChoice();
    else if (ACTIVE.has(status)) {
      try { await session.stop('modal_close'); } catch { /* the session reports its own failure */ }
    }
  }

  function setTarget(next) {
    const changed = target !== undefined && next !== target;
    target = next;
    if (changed) clearRechecks();
    if (changed && session) {
      const status = sessionState.status;
      if (status === 'choosing') session.cancelChoice();
      else if (ACTIVE.has(status)) void session.stop('channel_change');
      else if (FINISHED.has(status)) session.reset();
    }
    emit();
  }

  // The price on screen is the price charged: re-read the flag past the cache on entering the step.
  async function choose() {
    if (!flag.available) return;
    ensureSession().choose();
    Promise.resolve(credits.refresh()).catch(() => {});
    const id = ++chooseId;
    let fresh;
    try { fresh = await readFlag({ fresh: true }); } catch { return; }
    if (id !== chooseId || sessionState.status !== 'choosing') return;
    flag = fresh?.available === true ? fresh : { ...OFF, userId: fresh?.userId ?? flag.userId };
    if (!flag.available) session.cancelChoice();
    emit();
  }
  function cancel() { chooseId++; session?.cancelChoice(); }
  // expected: the per-minute price the user saw; the server refuses the start if it has moved.
  async function start(params, minutes, expected) {
    if (!flag.available) return;
    chooseId++;
    const expectedCreditsPerMinute = typeof expected === 'number' ? expected : flag.creditsPerMinute;
    try { await ensureSession().start({ ...params, minutes, expectedCreditsPerMinute }); } catch { /* shown through the session's state */ }
  }
  function stop() { return session ? session.stop('user') : Promise.resolve(); }
  function dismiss() { session?.reset(); }
  // Another session of this account is still active on the server (409 already_active): end it, show
  // what it cost, and let the user choose again.
  async function endOrphan() {
    const id = sessionState.error?.sessionId;
    if (!session || !id) return;
    try {
      const done = await session.stopOrphan(id);
      Promise.resolve(credits.refresh()).catch(() => {});
      session.reset();
      session.choose();
      const used = typeof done?.minutes_used === 'number' ? done.minutes_used : null;
      const charged = typeof done?.credits_charged === 'number' ? done.credits_charged : null;
      orphanNotice = used !== null && charged !== null
        ? `The other session was ended. Used ${used} ${used === 1 ? 'minute' : 'minutes'}, charged ${creditsText(charged)}.`
        : 'The other session was ended.';
      orphanFailed = false;
    } catch {
      orphanFailed = true;
    }
    emit();
  }
  const rechecksEnabled = () => flag.available && typeof flag.recheckCredits === 'number';
  const findClaim = (id) => sessionState.claims.find((c) => c.id === id);
  const settle = (id, patch) => { const r = rechecks.get(id); if (r) Object.assign(r, patch); };

  function recheckAsk(id) {
    const claim = findClaim(id);
    if (!rechecksEnabled() || !claim || (claim.status !== 'checked' && claim.status !== 'error')) return;
    const r = rechecks.get(id) || { phase: 'idle', results: [], error: null, notice: '' };
    if (r.phase === 'running') return;
    rechecks.set(id, { ...r, phase: 'confirming', error: null, notice: '' });
    emit();
  }
  function recheckCancel(id) {
    const r = rechecks.get(id);
    if (!r || r.phase !== 'confirming') return;
    if (r.results.length === 0) rechecks.delete(id); else Object.assign(r, { phase: 'idle', error: null });
    emit();
  }
  // One retry after a rate limit, at the wait the server gave (capped).
  async function recheckCall(claimId, price) {
    for (let attempt = 0; ; attempt++) {
      try {
        clientRef ??= createFactCheckClient();
        return await clientRef.recheck({ claimId, expectedRecheckCredits: price });
      } catch (e) {
        if (e?.status === 429 && attempt === 0) { await sleep(Math.min(e.retryAfterMs ?? 5000, 30000)); continue; }
        throw e;
      }
    }
  }
  async function recheckConfirm(id) {
    const r = rechecks.get(id);
    const claim = findClaim(id);
    if (!r || r.phase !== 'confirming' || !rechecksEnabled() || !claim) return;
    const epoch = recheckEpoch;
    const price = flag.recheckCredits;
    const latest = r.results[0]?.id ?? id;
    Object.assign(r, { phase: 'running', error: null, notice: '' });
    emit();
    const refresh = () => Promise.resolve(credits.refresh()).catch(() => {});
    let out;
    try {
      out = await recheckCall(latest, price);
    } catch (e) {
      if (epoch !== recheckEpoch) return;
      if (e?.reason === 'price_changed' && typeof e.recheckCredits === 'number' && e.recheckCredits > 0 && e.recheckCredits <= 1000) {
        flag = { ...flag, recheckCredits: e.recheckCredits };
        settle(id, { phase: 'confirming', error: recheckPriceChangedText(e.recheckCredits) });
      } else {
        if (e?.status === 0) void refresh(); // the answer was lost; a charge may have happened
        settle(id, { phase: 'idle', error: recheckErrorText(e) });
      }
      emit();
      return;
    }
    if (typeof out.creditsCharged === 'number' && out.creditsCharged > 0) void refresh();
    if (epoch !== recheckEpoch) return;
    const c = out.claim;
    if (c.status === 'checked' && Object.hasOwn(VERDICTS, c.verdict)) {
      settle(id, {
        phase: 'idle', results: [c, ...r.results], error: null,
        notice: typeof out.creditsCharged === 'number' ? `Charged ${creditsText(out.creditsCharged)}` : '',
      });
      announcement = `${VERDICTS[c.verdict].label}: ${claim.claim_en} (checked again)`;
    } else {
      settle(id, { phase: 'idle', error: RECHECK_FAILED });
    }
    emit();
  }

  // Carried in the published view so the panel needs no extra props from the modal.
  const recheckActions = { ask: recheckAsk, confirm: recheckConfirm, cancel: recheckCancel };

  function retry() { session?.reset(); void choose(); }

  return { load, close, setTarget, choose, cancel, start, stop, dismiss, retry, endOrphan, recheckAsk, recheckCancel, recheckConfirm };
}
