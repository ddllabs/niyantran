// F344 T6: the modal's side of the fact-check session. No React: the hook is a thin shell around
// this, so what ends a session (a new channel, a new video, closing the modal) is tested here.
//
// The session itself (src/lib/factcheck/session.js) is created only when the user first presses
// the button, so an account without the feature does no work beyond one flag read.
import { createFactCheckSession } from '../../lib/factcheck/session.js';
import { isSupported } from '../../lib/factcheck/capture.js';
import { refreshCredits, serverCredits, subscribeCredits } from '../../lib/creditsStore.js';
import { readFactCheckFlag } from './factCheckFlag.js';
import { VERDICTS, priceChangedText } from './factCheckText.js';

const OFF = { available: false, creditsPerMinute: null, userId: null };
const IDLE = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, final: null, endReason: null, error: null,
};
const ACTIVE = new Set(['sharing', 'starting', 'running', 'ending']);
const FINISHED = new Set(['ended', 'error']);

export const INITIAL_VIEW = Object.freeze({
  flag: OFF, supported: false, ready: false, session: IDLE, announcement: '', priceNotice: '', balance: null,
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
  onChange = () => {},
} = {}) {
  let flag = OFF;
  let isSupportedHere = false;
  let session = null;
  let sessionState = IDLE;
  let target;            // undefined until the first setTarget; null = nothing playing
  let announcement = '';
  let priceNotice = '';
  let chooseId = 0;
  let announced = new Map();
  let unsubscribe = null;
  let loadId = 0;

  const balance = () => {
    try { return credits.available(flag.userId); } catch { return null; }
  };
  const view = () => ({
    flag, supported: isSupportedHere, ready: Boolean(target), session: sessionState, announcement, priceNotice, balance: balance(),
  });
  const emit = () => onChange(view());

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
    if (state.status === 'sharing' || state.status === 'idle') priceNotice = '';
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
  function retry() { session?.reset(); void choose(); }

  return { load, close, setTarget, choose, cancel, start, stop, dismiss, retry };
}
