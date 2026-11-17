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
import {
  RECHECK_ALREADY, RECHECK_FAILED, VERDICTS, priceChangedText, recheckAnswerLost, recheckErrorText, recheckPriceChangedText,
} from './factCheckText.js';
import {
  coveringPart, partModel, reportErrorText, unlockErrorText, viewErrorText,
} from './factCheckShare.js';

const OFF = { available: false, creditsPerMinute: null, recheckCredits: null, sharing: null, userId: null };
const IDLE = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, final: null, endReason: null, error: null,
};
const ACTIVE = new Set(['sharing', 'starting', 'running', 'ending']);
const FINISHED = new Set(['ended', 'error']);

export const INITIAL_VIEW = Object.freeze({
  flag: OFF, supported: false, ready: false, session: IDLE, announcement: '', priceNotice: '', orphanNotice: '', orphanFailed: false, rechecks: {}, recheckNotices: [], shared: null, balance: null,
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
  getPosition = null,
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
  // Panel-level messages that must outlive a reset: a re-check that finished after the user left, or
  // the feature being switched off. Cleared by the user or when a new session starts.
  let recheckNotices = [];
  let clientRef = client;
  const getClient = () => (clientRef ??= createFactCheckClient());
  // Shared results of a recorded video ("Checked parts"): null unless sharing is on and a recorded
  // video is playing. unlocks and reports are keyed by stretch id and claim id.
  let video = { videoId: null, videoKind: null };
  let shared = null;
  let loadEpoch = 0;   // the newest load; an older answer is ignored
  let viewEpoch = 0;   // bumped when the video or target changes; late answers are dropped
  let announced = new Map();
  let unsubscribe = null;
  let loadId = 0;

  const balance = () => {
    try { return credits.available(flag.userId); } catch { return null; }
  };
  const view = () => ({
    flag, supported: isSupportedHere, ready: Boolean(target), session: sessionState, announcement, priceNotice, orphanNotice, orphanFailed, rechecks: recheckView(), recheckNotices: [...recheckNotices], recheckActions, shared: sharedView(), shareActions, balance: balance(),
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

  const finished = (state, prev) => FINISHED.has(state.status) && !FINISHED.has(prev.status);

  function handle(state) {
    const prev = sessionState;
    noteVerdicts(state);
    sessionState = state;
    if (state.status === 'idle' || (state.status === 'sharing' && !ACTIVE.has(prev.status))) clearRechecks();
    if (state.status === 'sharing' && !ACTIVE.has(prev.status)) recheckNotices = [];
    if (finished(state, prev) && state.sessionId) void loadShared(); // the new part is shared now
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
    if (!session) {
      session = createSession({
        onChange: handle,
        // Where the player is, for recorded videos only.
        getPosition: () => (video.videoKind === 'recorded' ? getPosition?.() ?? null : null),
      });
    }
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
    if (changed) { clearRechecks(); resetShared(); }
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
    void loadShared();
    const id = ++chooseId;
    let fresh;
    try { fresh = await readFlag({ fresh: true }); } catch { return; }
    if (id !== chooseId || sessionState.status !== 'choosing') return;
    flag = fresh?.available === true ? fresh : { ...OFF, userId: fresh?.userId ?? flag.userId };
    if (!flag.available) session.cancelChoice();
    else if (flag.sharing && !shared) void loadShared();
    else if (!flag.sharing && shared) { resetShared(); }
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
  // Only a claim of the session on screen can be checked again. A claim in a part (even the user's own)
  // is the original row with the newest result, which the server would refuse to check again.
  const findClaim = (id) => sessionState.claims.find((c) => c.id === id);
  const settle = (id, patch) => { const r = rechecks.get(id); if (r) Object.assign(r, patch); };

  function recheckAsk(id) {
    const claim = findClaim(id);
    if (!rechecksEnabled() || !claim || (claim.status !== 'checked' && claim.status !== 'error')) return;
    const r = rechecks.get(id) || { phase: 'idle', results: [], error: null, notice: '' };
    if (r.phase === 'running' || r.locked) return;
    rechecks.set(id, { ...r, phase: 'confirming', error: null, notice: '' });
    emit();
  }
  function recheckCancel(id) {
    const r = rechecks.get(id);
    if (!r || r.phase !== 'confirming') return;
    if (r.results.length === 0 && !r.locked) rechecks.delete(id); else Object.assign(r, { phase: 'idle', error: null });
    emit();
  }
  const CANCELLED = Symbol('panel reset');
  // One retry after a rate limit, at the wait the server gave (capped). Never after a reset of the
  // panel, and never after too_many_failures.
  async function recheckCall(claimId, price, epoch) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await getClient().recheck({ claimId, expectedRecheckCredits: price });
      } catch (e) {
        if (e?.status === 429 && e.reason !== 'too_many_failures' && attempt === 0) {
          await sleep(Math.min(e.retryAfterMs ?? 5000, 30000));
          if (epoch !== recheckEpoch) throw CANCELLED;
          continue;
        }
        throw e;
      }
    }
  }
  const refreshCredits_ = () => Promise.resolve(credits.refresh()).catch(() => {});
  const chargeText = (out, price) => (typeof out.creditsCharged === 'number' && !out.chargePending
    ? `Charged ${creditsText(out.creditsCharged)}` : `${creditsText(price)} will be charged.`);
  const addNotice = (text) => { recheckNotices = [...recheckNotices, text].slice(-5); };
  // price: the amount the user saw in the confirmation; exactly that is sent for the server to check.
  async function recheckConfirm(id, shownPrice) {
    const r = rechecks.get(id);
    const claim = findClaim(id);
    if (!r || r.phase !== 'confirming' || r.locked || !rechecksEnabled() || !claim) return;
    const epoch = recheckEpoch;
    const price = typeof shownPrice === 'number' ? shownPrice : flag.recheckCredits;
    const latest = r.results[0]?.id ?? id;
    Object.assign(r, { phase: 'running', error: null, notice: '' });
    announcement = `Checking again: ${claim.claim_en}`;
    emit();
    const say = (text) => { announcement = text; };
    let out;
    try {
      out = await recheckCall(latest, price, epoch);
    } catch (e) {
      if (e === CANCELLED) return;
      const lost = recheckAnswerLost(e?.status ?? 0);
      if (lost) void refreshCredits_(); // the server finishes a started check; it may have charged
      if (epoch !== recheckEpoch) {
        if (lost) { addNotice('A re-check may have finished after you left and been charged. Check your balance.'); emit(); }
        return;
      }
      const newer = e?.reason === 'not_recheckable' ? e.claim : null;
      if (newer && newer.status === 'checked' && Object.hasOwn(VERDICTS, newer.verdict)) {
        // Already checked again (another tab, or an answer that was lost): that result is paid for.
        const results = r.results.some((x) => x.id === newer.id) ? r.results : [newer, ...r.results];
        settle(id, { phase: 'idle', results, error: null, notice: RECHECK_ALREADY });
        say(`${VERDICTS[newer.verdict].label}: ${claim.claim_en} (checked again)`);
      } else if (e?.reason === 'price_changed' && typeof e.recheckCredits === 'number' && e.recheckCredits > 0 && e.recheckCredits <= 1000) {
        flag = { ...flag, recheckCredits: e.recheckCredits };
        settle(id, { phase: 'confirming', error: recheckPriceChangedText(e.recheckCredits) });
        say(recheckPriceChangedText(e.recheckCredits));
      } else if (e?.status === 403 && (e.reason === 'off' || e.reason === 'not_allowed')) {
        // Not available any more: no price, no buttons anywhere, one message for the panel.
        flag = { ...flag, recheckCredits: null };
        rechecks.delete(id);
        addNotice(recheckErrorText(e));
        say(recheckErrorText(e));
      } else {
        const text = recheckErrorText(e);
        settle(id, { phase: 'idle', error: text, ...(e?.reason === 'too_many_failures' ? { locked: true } : {}) });
        say(text);
      }
      emit();
      return;
    }
    const c = out.claim;
    const good = c.status === 'checked' && Object.hasOwn(VERDICTS, c.verdict);
    if (good) void refreshCredits_(); // charged now, or about to be
    if (epoch !== recheckEpoch) {
      // The panel was reset while this ran. It was charged on the server, so say so.
      if (good) {
        const charge = chargeText(out, price);
        addNotice(`A re-check finished after you left: ${VERDICTS[c.verdict].label}. ${charge}${charge.endsWith('.') ? '' : '.'}`);
        emit();
      }
      return;
    }
    if (good) {
      settle(id, { phase: 'idle', results: [c, ...r.results], error: null, notice: chargeText(out, price) });
      say(`${VERDICTS[c.verdict].label}: ${claim.claim_en} (checked again)`);
    } else {
      settle(id, { phase: 'idle', error: RECHECK_FAILED });
      say(RECHECK_FAILED);
    }
    emit();
  }


  // ---- shared results: "Checked parts of this video" ----
  const validStretch = (s) => s && typeof s === 'object' && typeof s.stretch_id === 'string' && Number.isFinite(s.from_s) && Number.isFinite(s.to_s);
  const sharingNow = () => flag.available && flag.sharing && video.videoKind === 'recorded' && Boolean(video.videoId);
  function sharedView() {
    if (!shared) return null;
    return {
      ...shared,
      stretches: [...shared.stretches],
      unlocks: Object.fromEntries(Object.entries(shared.unlocks).map(([k, v]) => [k, { ...v }])),
      reports: Object.fromEntries(Object.entries(shared.reports).map(([k, v]) => [k, { ...v }])),
    };
  }
  function resetShared() { viewEpoch++; loadEpoch++; shared = null; }
  function switchSharingOff(text) {
    flag = { ...flag, sharing: null };
    resetShared();
    if (text) recheckNotices = [...recheckNotices, text].slice(-5);
  }
  function setVideo(next) {
    const videoId = next?.videoId ?? null;
    const videoKind = next?.videoKind ?? null;
    if (videoId === video.videoId && videoKind === video.videoKind) return;
    video = { videoId, videoKind };
    resetShared();
    emit();
  }
  async function loadShared() {
    if (!sharingNow()) { if (shared) { resetShared(); emit(); } return; }
    const epoch = ++loadEpoch;
    const view = viewEpoch;
    const keep = shared;
    shared = {
      phase: 'loading', error: null, unlockCreditsPerMinute: flag.sharing.unlockCreditsPerMinute,
      stretches: keep?.stretches ?? [], unlocks: keep?.unlocks ?? {}, reports: keep?.reports ?? {}, covering: null,
    };
    emit();
    let res;
    try {
      res = await getClient().videoView({ videoId: video.videoId });
    } catch (e) {
      if (epoch !== loadEpoch || view !== viewEpoch) return;
      if (e?.status === 403 && (e.reason === 'off' || e.reason === 'not_allowed')) switchSharingOff();
      else shared = { ...shared, phase: 'error', error: viewErrorText(e), stretches: [] };
      emit();
      return;
    }
    if (epoch !== loadEpoch || view !== viewEpoch) return;
    const stretches = Array.isArray(res?.stretches) ? res.stretches.filter(validStretch) : [];
    const here = getPosition?.()?.positionS;
    shared = {
      ...shared, phase: 'ready', error: null, stretches,
      unlockCreditsPerMinute: typeof res?.unlock_credits_per_minute === 'number' ? res.unlock_credits_per_minute : shared.unlockCreditsPerMinute,
      covering: coveringPart(stretches, typeof here === 'number' ? here : null)?.stretch_id ?? null,
    };
    emit();
  }

  const stretchById = (id) => shared?.stretches.find((s) => s.stretch_id === id);
  function unlockAsk(id) {
    const st = stretchById(id);
    if (!st || partModel(st).readable) return;
    const u = shared.unlocks[id];
    if (u?.phase === 'running') return;
    shared.unlocks[id] = { phase: 'confirming', error: null, notice: '' };
    emit();
  }
  function unlockCancel(id) {
    const u = shared?.unlocks[id];
    if (!u || u.phase !== 'confirming') return;
    delete shared.unlocks[id];
    emit();
  }
  // shownPrice: the price in the confirmation; exactly that is sent for the server to check.
  async function unlockConfirm(id, shownPrice) {
    const st = stretchById(id);
    const u = shared?.unlocks[id];
    if (!st || !u || u.phase !== 'confirming') return;
    const view = viewEpoch;
    const price = typeof shownPrice === 'number' ? shownPrice : st.price;
    Object.assign(u, { phase: 'running', error: null, notice: '' });
    emit();
    const refresh = () => Promise.resolve(credits.refresh()).catch(() => {});
    try {
      await getClient().unlock({ stretchId: id, expectedCredits: price });
    } catch (e) {
      if ((e?.status ?? 0) === 0 || e?.status >= 500) void refresh(); // a charge may have happened
      if (view !== viewEpoch) return;
      if (e?.status === 403 && (e.reason === 'off' || e.reason === 'not_allowed')) { switchSharingOff(unlockErrorText(e)); emit(); return; }
      if (e?.reason === 'price_changed' || e?.reason === 'own' || e?.reason === 'not_found' || e?.reason === 'claim_not_found') {
        await loadShared();
        if (view !== viewEpoch || !shared) return;
        const now = stretchById(id);
        if (e.reason === 'price_changed' && now && !partModel(now).readable) {
          shared.unlocks[id] = {
            phase: 'confirming', notice: '',
            error: typeof (e.price ?? now.price) === 'number'
              ? `The price changed to ${creditsText(e.price ?? now.price)}. Review it and unlock again.` : unlockErrorText(e),
          };
        } else if (e.reason === 'own' && now && partModel(now).readable) delete shared.unlocks[id];
        else shared.unlocks[id] = { phase: 'idle', notice: '', error: unlockErrorText(e) };
        emit();
        return;
      }
      shared.unlocks[id] = { phase: 'idle', notice: '', error: unlockErrorText(e) };
      emit();
      return;
    }
    void refresh();
    if (view !== viewEpoch) return;
    await loadShared();
    if (view !== viewEpoch || !shared) return;
    shared.unlocks[id] = { phase: 'idle', error: null, notice: 'Unlocked.' };
    emit();
  }

  const reportableClaim = (claimId) => {
    for (const st of shared?.stretches ?? []) {
      if (!partModel(st).reportable) continue;
      const c = (st.claims || []).find((x) => x.id === claimId);
      if (c) return c.reported === true ? null : c;
    }
    return null;
  };
  function reportAsk(claimId) {
    if (!reportableClaim(claimId) || shared.reports[claimId]?.phase === 'running' || shared.reports[claimId]?.phase === 'done') return;
    shared.reports[claimId] = { phase: 'asking', error: null };
    emit();
  }
  function reportCancel(claimId) {
    if (shared?.reports[claimId]?.phase !== 'asking') return;
    delete shared.reports[claimId];
    emit();
  }
  async function reportSend(claimId, reason) {
    const r = shared?.reports[claimId];
    if (!r || r.phase !== 'asking') return;
    const view = viewEpoch;
    const text = String(reason ?? '').trim().slice(0, 300);
    Object.assign(r, { phase: 'running', error: null });
    emit();
    try {
      await getClient().report({ claimId, reason: text });
      r.phase = 'done';
    } catch (e) {
      if (view !== viewEpoch) return;
      if (e?.reason === 'already') r.phase = 'done';
      else if (e?.status === 403 && (e.reason === 'off' || e.reason === 'not_allowed')) { switchSharingOff(reportErrorText(e)); emit(); return; }
      else Object.assign(r, { phase: 'asking', error: reportErrorText(e) });
    }
    emit();
  }
  const shareActions = { reload: () => { void loadShared(); }, unlockAsk, unlockCancel, unlockConfirm, reportAsk, reportCancel, reportSend };

  // Carried in the published view so the panel needs no extra props from the modal.
  const recheckActions = {
    ask: recheckAsk, confirm: recheckConfirm, cancel: recheckCancel,
    dismissNotices: () => { recheckNotices = []; emit(); },
  };

  function retry() { session?.reset(); void choose(); }

  return { load, close, setTarget, setVideo, choose, cancel, start, stop, dismiss, retry, endOrphan, recheckAsk, recheckCancel, recheckConfirm,
    unlockAsk, unlockCancel, unlockConfirm, reportAsk, reportCancel, reportSend,
  };
}
