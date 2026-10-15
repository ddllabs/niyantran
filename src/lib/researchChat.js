/**
 * The browser half of the research turn (streaming spec §G).
 *
 * `sendTurn` opens the SSE stream, reads its frames and keeps one streaming
 * state per conversation that the panel subscribes to. Answer text is
 * coalesced to one commit per animation frame — a long answer otherwise
 * spends more time re-rendering than reading the socket — and a silent stream
 * is given up on after the safety timeout rather than hanging the composer.
 *
 * Cancellation is an explicit act: Stop writes a chat_cancellations row, which
 * the server polls. Closing the tab does not cancel anything; the turn
 * finishes and persists on the server either way.
 */
import { supabase } from './supabaseClient.js';
import { sendResearchTurn } from './aiClient.js';
import { verifiedLocalIdentity, localIdentityIsCurrent, reverifiedAccount, subscribeLocalIdentity } from './userStore.js';

export const SAFETY_TIMEOUT_MS = 120_000;
// F111 §3: after `done` the server settles the turn and sends one `{credits}` frame, which on a
// stopped turn can come a few seconds later. The answer is finished at `done`; this only bounds how
// long the reader stays on the stream for that frame.
export const CREDITS_WAIT_MS = 6000;
const EVENT = 'niy-research-stream';

/**
 * Parsed frames from an SSE response body; ends when [DONE] arrives, or when
 * `signal` aborts. The reader holds a lock on the body, so an abort has to
 * cancel the reader — cancelling the body itself would throw.
 */
export async function* readSseFrames(response, signal) {
  const body = response?.body;
  if (!body) return;
  const reader = body.getReader();
  const stop = () => {
    reader.cancel().catch(() => {});
  };
  if (signal?.aborted) stop();
  signal?.addEventListener?.('abort', stop, { once: true });
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (signal?.aborted) return;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        if (signal?.aborted) return;
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const payload = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n');
        if (payload === '[DONE]') return;
        if (payload) {
          try {
            yield JSON.parse(payload);
          } catch {
            /* a malformed frame is skipped, never fatal */
          }
        }
        split = buffer.indexOf('\n\n');
      }
      if (done) return;
    }
  } finally {
    signal?.removeEventListener?.('abort', stop);
    // A transport's cancellation callback may never resolve. Releasing our
    // reader must not wait for external cleanup.
    void reader.cancel().catch(() => {});
    try {
      reader.releaseLock?.();
    } catch {
      /* already released by cancel */
    }
  }
}

/** One commit per animation frame, in order, with patch support for a rewrite. */
export function createTextCoalescer(commit, schedule) {
  const raf = schedule || ((fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16)));
  let text = '';
  let queued = false;
  let revision = 0;
  let disposed = false;
  function flushSoon() {
    if (queued || disposed) return;
    queued = true;
    const scheduled = ++revision;
    raf(() => {
      if (disposed || scheduled !== revision) return;
      queued = false;
      commit(text);
    });
  }
  return {
    push(delta) {
      text += String(delta ?? '');
      flushSoon();
    },
    patch(from, replacement) {
      text = text.slice(0, Math.max(0, from)) + String(replacement ?? '');
      flushSoon();
    },
    flush() {
      if (disposed) return;
      queued = false;
      revision++;
      return commit(text);
    },
    dispose() { disposed = true; revision++; },
    get text() {
      return text;
    },
  };
}

/** The live pages with the new ones appended, each URL once; an entry without a string URL is dropped. */
function mergeWebPages(current, pages) {
  if (!Array.isArray(pages)) return current;
  const seen = new Set(current.map(p => p.url));
  const added = pages.filter(p => p && typeof p === 'object' && typeof p.url === 'string' && p.url && !seen.has(p.url) && seen.add(p.url));
  return added.length ? [...current, ...added] : current;
}

function blankState() {
  return { isStreaming: false, isPending: false, status: 'idle', streamingText: '', activity: [], sources: [],
    followUps: [], web: null, webSources: [], webLive: [], model: null, timing: null, usage: null, truncated: null, notice: null, error: '', errorCode: '', held: false,
    conversationId: '', messageId: '', executionExpiresAt: null, retryable: false, retryCount: 0,
    cancelRequested: false, cancelPending: false, cancelError: '', stopQueued: false };
}

// Aliases share one operation. In particular, the draft remains readable after
// the first conversation frame until D10 adopts that ID in the conversation store.
const operations = new Map();
let generation = 0;
let watching = false;
const copy = value => JSON.parse(JSON.stringify(value));
function notify() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT)); }
function remove(entry, reason = 'identity_changed') {
  entry.abort?.(reason);
  entry.coalescer?.dispose();
  entry.request = null;
  for (const [key, value] of operations) if (value === entry) operations.delete(key);
}
function watchIdentity() {
  if (watching) return;
  watching = true;
  subscribeLocalIdentity((id, event) => {
    generation++;
    for (const entry of new Set(operations.values())) {
      // F43: supabase-js re-announces the same account as SIGNED_IN on every tab
      // refocus, and a token refresh is the same account too. Its turn keeps
      // streaming; the next check verifies that account again before it publishes.
      if (id && entry.identity?.id === id) {
        entry.generation = generation;
        entry.reverify = true;
        continue;
      }
      // F198: a send not yet verified, for the account its caller named, is kept across that
      // account's re-announcement too; its preflight verifies the account and requires that one.
      if (id && !entry.identity && entry.account === id) continue;
      // The first successful B4 verification may announce its identity before
      // the unbound preflight has received it. Actual Auth/logout events cancel it.
      if (entry.identity || event || !id) remove(entry);
    }
    notify();
  });
}
function bound(entry, attempt = entry?.attempt) {
  return Boolean(entry?.identity && entry.generation === generation && entry.attempt === attempt
    && entry.identity.expiresAt > Date.now() && [...operations.values()].includes(entry));
}
async function current(entry, attempt = entry.attempt) {
  if (!bound(entry, attempt) || entry.signal?.aborted) return false;
  try {
    // Bounded: a run of same-account events cannot keep a check spinning.
    for (let tries = 0; tries < 3; tries++) {
      if ((entry.reverify || entry.reverifying) && !await reverify(entry)) return false;
      if (!bound(entry, attempt)) return false;
      const verified = await raceAbort(localIdentityIsCurrent(entry.identity), entry.signal);
      if (verified) return !entry.signal.aborted && bound(entry, attempt);
      // Superseded meanwhile by another same-account event: verify again.
      if (!entry.reverify) return false;
    }
    return false;
  } catch { return false; }
}
/** One shared re-verification per entry after a same-account Auth event (F43).
 * Any other account, or a failed check, leaves the entry unverified. */
function reverify(entry) {
  if (!entry.reverifying) {
    const check = (async () => {
      await null;
      while (entry.reverify && bound(entry)) {
        entry.reverify = false;
        const held = entry.identity;
        const live = await raceAbort(reverifiedAccount(held), entry.signal);
        if (live && entry.identity === held) entry.identity = live;
        else if (!entry.reverify) return false;
      }
      return bound(entry);
    })().catch(() => false);
    entry.reverifying = check;
    void check.finally(() => { if (entry.reverifying === check) entry.reverifying = null; });
  }
  return entry.reverifying;
}
async function publish(entry, patch, attempt = entry.attempt, stillCurrent = () => true) {
  if (!await current(entry, attempt) || !bound(entry, attempt) || !stillCurrent()) return false;
  Object.assign(entry.state, patch);
  notify();
  return true;
}
function result(entry) {
  // An authoritative saved answer retired this operation. That is not an identity
  // change and must not be reported to the user as one.
  if (!bound(entry)) return entry.endReason === 'reconciled'
    ? { ...blankState(), status: 'reconciled', aborted: true, endReason: 'reconciled' }
    : { ...blankState(), error: 'Your research session changed.', errorCode: 'identity_changed', aborted: true, endReason: 'identity_changed' };
  const s = visibleState(entry);
  return { conversationId: s.conversationId, messageId: s.messageId, error: s.error, errorCode: s.errorCode, held: s.held === true,
    status: s.status, isPending: s.isPending, retryable: s.retryable, aborted: Boolean(entry.endReason), endReason: entry.endReason || '' };
}
/**
 * F66 (F171 B3): what a reader sees when the connection drops mid-answer. The browser's own words
 * ("Failed to fetch", "Load failed", "NetworkError…") are replaced; a message the app wrote is kept.
 */
export function connectionMessage(error) {
  const text = String(error?.message || '');
  if (/failed to fetch|load failed|networkerror|network error|network connection was lost/i.test(text)) {
    return 'The connection dropped. The answer may still be finishing; it will appear here once it is saved.';
  }
  return text || 'The connection failed.';
}
// Transport bookkeeping is separate from protected frame publication. If an
// identity check stalls, abort cannot authorize publishing its pending payload.
// The last verified owner may still recover the frozen request by manual replay.
function visibleState(entry) {
  if (entry.transportActive !== false || !entry.state.isStreaming) return entry.state;
  return { ...entry.state, isStreaming: false, status: entry.dispatched ? 'unknown' : 'error',
    isPending: entry.dispatched, retryable: entry.dispatched,
    error: entry.state.error || (entry.endReason === 'timeout'
      ? 'The answer stopped arriving. Its server outcome is unknown; reload or replay this turn.'
      : 'The connection ended before a saved result was confirmed. Reload or replay this turn.'),
    errorCode: entry.state.errorCode || (entry.dispatched ? 'connection_lost' : 'identity_changed') };
}
function refreshExpiry(entry) {
  const expires = Date.parse(entry.state.executionExpiresAt);
  if (entry.state.isPending && !visibleState(entry).isStreaming && Number.isFinite(expires) && expires <= Date.now()) {
    Object.assign(entry.state, { status: 'interrupted', isStreaming: false, isPending: false, errorCode: 'interrupted',
      error: 'The execution deadline passed. Reload the saved result.', retryable: true });
  }
}
export function streamState(conversationId) {
  watchIdentity();
  const entry = operations.get(conversationId || 'new');
  if (!bound(entry)) {
    if (entry?.identity && entry.identity.expiresAt <= Date.now()) remove(entry);
    return blankState();
  }
  refreshExpiry(entry);
  return visibleState(entry);
}
export function subscribeStream(fn) {
  watchIdentity();
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
export function clearStream(conversationId) {
  const entry = operations.get(conversationId || 'new');
  if (!entry) return;
  // Detaching a transport cannot erase the pending execution lock.
  refreshExpiry(entry);
  if (entry.state.isPending) entry.abort?.('detached');
  else remove(entry);
  notify();
}

/** An owner-checked copy; callers cannot mutate the retained replay intent. */
export function retryRequest(conversationId) {
  const entry = operations.get(conversationId || 'new');
  return bound(entry) && entry.request ? copy(entry.request) : null;
}

const TERMINAL_MESSAGE_STATUS = ['complete', 'error', 'cancelled', 'truncated', 'interrupted'];

/** Only an authoritative owner-scoped terminal row can release a retained
 * execution after Reload. Cache contents and transport failure are not proof.
 * A true result retires any open send/retry operation too, reporting the
 * neutral `reconciled` end reason so the caller renders the saved row. */
export async function reconcileSavedTurn(conversationId) {
  const entry = operations.get(conversationId);
  if (!conversationId || !bound(entry) || !entry.request
      || entry.state.conversationId !== conversationId) return false;
  if ((entry.reverify || entry.reverifying) && !await reverify(entry)) return false;
  const attempt = entry.attempt, identity = entry.identity, turnKey = entry.request.turn_key;
  const messageId = entry.state.messageId;
  const stillCurrent = () => bound(entry, attempt) && operations.get(conversationId) === entry;
  const controller = new AbortController();
  // Bound Auth as well as every RLS query; ignored aborts cannot publish late.
  const timer = setTimeout(() => controller.abort(), 4000);
  const wait = promise => raceAbort(promise, controller.signal);
  const owned = () => supabase.from('chat_messages').select('id,user_id,conversation_id,turn_key,role,status,created_at')
    .eq('user_id', identity.id).eq('conversation_id', conversationId);
  const read = query => wait(query.abortSignal(controller.signal).maybeSingle());
  try {
    const verified = await wait(verifiedLocalIdentity());
    if (!stillCurrent() || !verified || verified.id !== identity.id || verified.epoch !== identity.epoch
        || verified.token !== identity.token || !await wait(localIdentityIsCurrent(identity)) || !stillCurrent()) return false;
    // An assistant row never carries the user turn's key: the claim writes it on
    // the user row, and unique(conversation_id, turn_key) forbids a second
    // holder. A reserved message ID therefore identifies the answer directly;
    // otherwise the retained key resolves through its own user row.
    let asked = null;
    if (!messageId) {
      const { data: question, error: askedError } = await read(owned().eq('turn_key', turnKey).eq('role', 'user'));
      if (!stillCurrent()) return false;
      if (askedError) throw new Error('Saved turn read failed');
      if (!question || typeof question.id !== 'string' || !question.id || question.user_id !== identity.id
          || question.conversation_id !== conversationId || question.turn_key !== turnKey
          || question.role !== 'user' || !Number.isFinite(Date.parse(question.created_at))) return false;
      asked = question;
    }
    // The claim inserts the reserved answer one microsecond after its question,
    // so the very next message is it. Deliberately unfiltered by role: a turn
    // whose answer was deleted then matches a later question and is rejected,
    // rather than adopting a different turn's answer.
    const { data: row, error } = await read(messageId
      ? owned().eq('id', messageId).eq('role', 'assistant')
      : owned().gt('created_at', asked.created_at).order('created_at', { ascending: true }).limit(1));
    if (!stillCurrent()) return false;
    if (error) throw new Error('Saved result read failed');
    if (!row || typeof row.id !== 'string' || !row.id || row.user_id !== identity.id
        || row.conversation_id !== conversationId || row.role !== 'assistant'
        || !TERMINAL_MESSAGE_STATUS.includes(row.status)
        // Microsecond ordering is enforced by the server filter. This is the
        // coarser client backstop against an answer predating its own question.
        || (messageId ? row.id !== messageId
          : row.id === asked.id || !(Date.parse(row.created_at) >= Date.parse(asked.created_at)))) return false;
    if (!await wait(localIdentityIsCurrent(identity)) || !stillCurrent() || controller.signal.aborted) return false;
    remove(entry, 'reconciled');
    notify();
    return true;
  } catch (err) {
    if (!stillCurrent()) return false;
    // The reader sees one generic message; the real failure (a read error, or a
    // programming error) stays attached as the cause instead of being masked.
    throw new Error('The saved result could not be verified. Try Reload.', { cause: err });
  } finally { clearTimeout(timer); }
}
function raceAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Research transport detached', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Cancellation uses the same B4 verification as reads and fetches. A successful
 * write requests Stop; only a saved terminal frame can confirm cancellation. */
export async function recordChatCancellation(conversationId, client = supabase, expectedIdentity = null, stillPending = () => true) {
  if (!conversationId || !client) throw new Error('No conversation is available to stop.');
  let changed = 0;
  const unsubscribe = subscribeLocalIdentity(() => changed++);
  try {
    const identity = await verifiedLocalIdentity();
    const version = changed;
    if (!identity || (expectedIdentity && (identity.id !== expectedIdentity.id || identity.epoch !== expectedIdentity.epoch
        || identity.token !== expectedIdentity.token)) || !await localIdentityIsCurrent(identity) || changed !== version) {
      throw new Error('Your research session changed.');
    }
    if (!stillPending()) throw new Error('The turn no longer needs a Stop request.');
    const response = await client.from('chat_cancellations').upsert({ conversation_id: conversationId,
      user_id: identity.id, cancel_requested_at: new Date().toISOString() }, { onConflict: 'conversation_id' });
    if (!await localIdentityIsCurrent(identity) || changed !== version) throw new Error('Your research session changed.');
    if (response.error) throw new Error('Stop could not be requested. Try Stop again.');
    return { cancelRequested: true, cancelError: '' };
  } finally { unsubscribe(); }
}
async function cancel(entry) {
  if (!bound(entry) || entry.state.cancelRequested || entry.cancelPromise) return entry.cancelPromise;
  const attempt = entry.attempt;
  entry.cancelPromise = (async () => {
    if (!await publish(entry, { cancelPending: true, stopQueued: false, cancelError: '' }, attempt)) return;
    try {
      await recordChatCancellation(entry.state.conversationId, supabase, entry.identity,
        () => bound(entry, attempt) && entry.state.isPending && entry.acknowledged);
      if (entry.state.isPending) await publish(entry, { cancelPending: false, cancelRequested: true }, attempt);
    } catch (error) {
      if (entry.state.isPending) await publish(entry, { cancelPending: false, cancelRequested: false,
        cancelError: error?.message || 'Stop could not be requested. Try Stop again.' }, attempt);
    }
  })().finally(() => { entry.cancelPromise = null; });
  return entry.cancelPromise;
}
export async function stopTurn(conversationId) {
  const entry = operations.get(conversationId || 'new');
  if (!entry) {
    try { return await recordChatCancellation(conversationId); }
    catch (error) { return { cancelRequested: false, cancelError: error?.message || 'Stop could not be requested.' }; }
  }
  // Stop may arrive before the initial identity verification resolves. Queue
  // intent only; the verified, acknowledged operation performs the eventual write.
  if (!entry.identity && entry.state.isPending) {
    entry.state.stopQueued = true;
    return { queued: true, cancelRequested: false };
  }
  if (!bound(entry)) return { cancelRequested: false, cancelError: 'Your research session changed.' };
  if (!entry.state.isPending) return { cancelRequested: false, cancelError: 'The turn has already ended.' };
  if (!entry.acknowledged || !entry.state.conversationId) {
    await publish(entry, { stopQueued: true });
    return { queued: true, cancelRequested: false };
  }
  await cancel(entry);
  return bound(entry) ? { cancelRequested: entry.state.cancelRequested, cancelError: entry.state.cancelError }
    : { cancelRequested: false, cancelError: 'Your research session changed.' };
}

/** The one frame allowed after `done`: `{credits: number | null}` and nothing beside it. */
function creditsFrame(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  const keys = Object.keys(frame);
  if (keys.length !== 1 || keys[0] !== 'credits') return null;
  const value = frame.credits;
  if (value === null) return { credits: null };
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { credits: value } : null;
}

/**
 * Keep reading a finished turn's stream for its credits (F111 §3). The answer is already shown as
 * finished; nothing here can change it. Exactly one `{credits}` frame is accepted. Any other data,
 * a second credits frame, a broken stream or the wait running out ends the read, and the caller
 * hears `credits: null` (not settled, or not known) rather than a guess. `onCredits` is called once.
 */
async function readCreditsTail(frames, reading, waitMs, onCredits) {
  let reported = false;
  const report = (credits) => {
    if (reported) return;
    reported = true;
    try { void Promise.resolve(onCredits?.(credits)).catch(() => {}); } catch { /* a caller's failure is its own */ }
  };
  const timer = setTimeout(() => reading.abort(), waitMs);
  timer?.unref?.();
  try {
    for (;;) {
      const next = await raceAbort(frames.next(), reading.signal);
      if (next.done) break;
      const accepted = reported ? null : creditsFrame(next.value);
      if (!accepted) break;
      report(accepted.credits);
    }
  } catch { /* the saved answer stands whatever happens to the stream */ }
  finally {
    clearTimeout(timer);
    report(null);
    // The reader is released without waiting for the transport's own cancellation.
    reading.abort();
    void Promise.resolve(frames.return?.()).catch(() => {});
  }
}

/**
 * Exactly one active/unknown execution per conversation; replay is explicit. `opts.account` is the
 * verified account the caller composed the turn for (F198): the send is made for that account only,
 * and survives its re-announcement (a tab refocus, a token refresh) before the send is verified.
 */
export async function sendTurn(body, opts = {}) {
  watchIdentity();
  const key = body?.conversation_id || 'new';
  const previous = operations.get(key);
  if (previous) refreshExpiry(previous);
  if (previous && (previous.state.isPending || previous.state.isStreaming)) {
    return { error: 'A turn is still pending. Reload or replay its saved result.', errorCode: 'turn_pending', isPending: true };
  }
  if (previous) remove(previous);
  let request;
  try {
    request = copy(body);
    if (typeof request.turn_key !== 'string' || !request.turn_key.trim() || request.turn_key.length > 64) throw Error();
  } catch { return { error: 'A valid original turn key is required.', errorCode: 'invalid_request', isPending: false }; }
  const entry = { request, state: { ...blankState(), isStreaming: true, isPending: true, status: 'connecting',
    conversationId: request.conversation_id || '' }, identity: null, account: typeof opts.account === 'string' ? opts.account : '',
    generation, attempt: 0, retryCount: 0, acknowledged: false };
  operations.set(key, entry);
  return await run(entry, opts);
}
// Every replay is explicit and single-flight. There is no lifetime cap: an
// unknown server outcome must remain recoverable with the original intent/key.
export async function retryTurn(conversationId, opts = {}) {
  const entry = operations.get(conversationId || 'new');
  if (!bound(entry) || !entry.request || visibleState(entry).isStreaming || !visibleState(entry).retryable) {
    return { error: 'Replay is unavailable. Reload the durable conversation state.', errorCode: 'replay_unavailable' };
  }
  entry.retryCount++;
  entry.state.isStreaming = true;
  entry.state.retryable = false;
  return await run(entry, opts);
}

async function run(entry, opts) {
  const attempt = ++entry.attempt;
  const controller = new AbortController();
  entry.signal = controller.signal;
  entry.transportActive = true;
  entry.endReason = '';
  entry.acknowledged = false;
  entry.dispatched = false;
  let idle;
  entry.abort = reason => { entry.endReason = reason; controller.abort(); };
  const bump = () => { clearTimeout(idle); idle = setTimeout(() => entry.abort('timeout'), opts.timeoutMs ?? SAFETY_TIMEOUT_MS); };
  let terminal = false;
  let sawSources = false;
  let terminalError = '';
  let saveFailed = false;
  let doneSeen = false;
  let textRevision = 0;
  const coalescer = createTextCoalescer(text => {
    const revision = ++textRevision;
    return publish(entry, { streamingText: text }, attempt, () => revision === textRevision);
  }, opts.schedule);
  entry.coalescer = coalescer;
  const conversation = async value => {
    if (!value || typeof value.id !== 'string' || !value.id) throw new Error('Invalid conversation frame.');
    if (!await current(entry, attempt) || !bound(entry, attempt)) return;
    if (entry.state.conversationId && entry.state.conversationId !== value.id) throw new Error('Conversation changed during a turn.');
    const other = operations.get(value.id);
    if (other && other !== entry && other.state.isPending) throw new Error('Another turn is pending for this conversation.');
    operations.set(value.id, entry);
    entry.acknowledged = true;
    if (!await publish(entry, { conversationId: value.id, conversation: value }, attempt)) return;
    if (opts.onConversation && await current(entry, attempt) && bound(entry, attempt)) await raceAbort(Promise.resolve(opts.onConversation(value)), controller.signal);
    if (entry.state.stopQueued) void cancel(entry);
  };
  try {
    bump();
    // A replay after a same-account Auth event first adopts that account's
    // current identity, so the check below compares like with like (F43).
    if (entry.identity && (entry.reverify || entry.reverifying) && !await raceAbort(reverify(entry), controller.signal)) {
      throw new Error('Your research session changed.');
    }
    let identity = null;
    for (let tries = 0; tries < 3 && !identity; tries++) {
      const heard = generation;
      identity = await raceAbort(verifiedLocalIdentity(), controller.signal);
      // F198: an Auth event during the check supersedes the identity it issued. When the send
      // is still wanted (a named account's re-announcement keeps it), verify again, bounded.
      if (identity || heard === generation || ![...operations.values()].includes(entry)) break;
    }
    const version = generation;
    if (!identity || (entry.account && identity.id !== entry.account)
        || (entry.identity && (identity.id !== entry.identity.id || identity.epoch !== entry.identity.epoch || identity.token !== entry.identity.token))
        || !await raceAbort(localIdentityIsCurrent(identity), controller.signal) || version !== generation
        || ![...operations.values()].includes(entry) || controller.signal.aborted) throw new Error('Your research session changed.');
    entry.identity = identity;
    entry.generation = version;
    await publish(entry, { isStreaming: true, isPending: true, status: 'connecting', error: '', errorCode: '', held: false,
      retryable: false, retryCount: entry.retryCount, streamingText: '', sources: [], followUps: [], web: null, webSources: [], webLive: [], truncated: null,
      activity: [], timing: null, usage: null, messageId: '', cancelPending: false }, attempt);
    if (!bound(entry, attempt) || controller.signal.aborted) throw new Error('Your research session changed.');
    entry.dispatched = true;
    const responsePromise = Promise.resolve((opts.send ?? sendResearchTurn)({ body: copy(entry.request), signal: controller.signal, identity }))
      .then(response => {
        if (controller.signal.aborted || !bound(entry, attempt)) void response.body?.cancel().catch(() => {});
        return response;
      });
    const response = await raceAbort(responsePromise, controller.signal);
    if (!await current(entry, attempt) || !bound(entry, attempt)) { void response.body?.cancel().catch(() => {}); throw new Error('Your research session changed.'); }
    if (response.status === 202) {
      const data = await raceAbort(response.json(), controller.signal);
      if (data.status !== 'running' || typeof data.message_id !== 'string' || !data.message_id || !Number.isFinite(Date.parse(data.execution_expires_at))) throw new Error('Invalid running-turn response.');
      await conversation({ id: data.conversation_id });
      await publish(entry, { status: 'running', isStreaming: false, isPending: true, messageId: data.message_id,
        executionExpiresAt: data.execution_expires_at, retryable: true }, attempt);
      return result(entry);
    }
    if (!response.ok) {
      const detail = await raceAbort(response.json().catch(() => null), controller.signal);
      const rejected = response.status >= 400 && response.status < 500;
      // F111 §3: a credit check that could not run is refused before the claim, so nothing
      // started and nothing is unknown. It is not "rejected" (the same turn may be sent
      // again as it was), but it is not pending either.
      const unchecked = response.status === 503 && detail?.code === 'credits_unavailable';
      await publish(entry, { isStreaming: false, status: rejected || unchecked ? 'error' : 'unknown', isPending: !rejected && !unchecked,
        error: detail?.error || `research-chat HTTP ${response.status}`, errorCode: detail?.code || `http_${response.status}`,
        // F111: credits exist but are held by answers still running (the 402 says so).
        held: response.status === 402 && detail?.held === true,
        retryable: !rejected }, attempt);
      return result(entry);
    }
    // At `done` the frames stay open for the credits that follow (F111 §3): a loop that ends there would
    // cancel the reader. The wrapper lets that one `break` hand the stream on instead.
    // `reading` follows the turn's own abort, and is the only thing the credits wait ever aborts, so
    // ending that wait cannot make the finished turn look cancelled.
    const reading = new AbortController();
    controller.signal.addEventListener('abort', () => reading.abort(), { once: true });
    if (controller.signal.aborted) reading.abort();
    const frames = readSseFrames(response, reading.signal);
    let handedOn = false;
    const source = { [Symbol.asyncIterator]: () => ({
      next: () => frames.next(),
      return: async value => (handedOn ? { done: true, value } : frames.return(value)),
    }) };
    for await (const frame of source) {
      if (!await current(entry, attempt) || !bound(entry, attempt) || controller.signal.aborted) break;
      bump();
      if (doneSeen) throw new Error('Unexpected data after the terminal result.');
      if (frame.conversation) await conversation(frame.conversation);
      else if (frame.duplicate) await publish(entry, { duplicate: true }, attempt);
      else if (typeof frame.reasoning === 'string') await publish(entry, { activity: [...entry.state.activity, { type: 'activity', text: frame.reasoning }] }, attempt);
      // The server's web-search decision for this turn, sent once and early (web-search spec §4).
      else if (frame.web && typeof frame.web === 'object') await publish(entry, { web: frame.web }, attempt);
      // F131 §2: pages found while the research call searches, for display only. Each frame carries
      // only new pages; they are merged by URL, and the terminal `webSources` is the authoritative list.
      else if (frame.webProgress) await publish(entry, { webLive: mergeWebPages(entry.state.webLive, frame.webProgress.pages) }, attempt);
      // A web_search frame is listed as it is: its start (F131) is hidden by the ticker once its end
      // arrives, an older turn sent the end alone, and a document or desk search that ends later never
      // merges into it, whatever step number the two share.
      else if (frame.tool) await publish(entry, { activity: frame.tool.phase === 'start' || frame.tool.name === 'web_search'
        ? [...entry.state.activity, { type: 'tool', ...frame.tool }]
        : entry.state.activity.map(a => a.type === 'tool' && a.name !== 'web_search' && a.step === frame.tool.step ? { ...a, ...frame.tool } : a) }, attempt);
      else if (typeof frame.chunk === 'string') coalescer.push(frame.chunk);
      else if (frame.patch) {
        if (!Number.isInteger(frame.patch.from) || frame.patch.from < 0 || frame.patch.from > coalescer.text.length || typeof frame.patch.text !== 'string') throw new Error('Invalid answer patch.');
        coalescer.patch(frame.patch.from, frame.patch.text);
      } else if (frame.model) await publish(entry, { model: frame.model }, attempt);
      else if (Array.isArray(frame.sources)) { sawSources = true; await publish(entry, { sources: frame.sources }, attempt); }
      // The pages the turn searched, kept apart from `sources`: a web page is never a citation.
      else if (Array.isArray(frame.webSources)) await publish(entry, { webSources: frame.webSources }, attempt);
      else if (Array.isArray(frame.followUpQuestions)) await publish(entry, { followUps: frame.followUpQuestions }, attempt);
      else if (frame.truncated?.reason === 'length') await publish(entry, { truncated: frame.truncated }, attempt);
      else if (frame.notice) await publish(entry, { notice: frame.notice }, attempt);
      // The reasoning count rides with the timing, so the live summary's word matches the saved row's.
      else if (frame.timing) await publish(entry, { timing: frame.timing, usage: frame.usage ?? null }, attempt);
      else if (frame.saveFailed) { saveFailed = true; await publish(entry, { error: 'The answer could not be saved. Reload the conversation.', errorCode: 'save_failed' }, attempt); }
      else if (typeof frame.error === 'string') {
        terminalError = ['error', 'cancelled', 'interrupted'].includes(frame.code) ? frame.code : '';
        await publish(entry, { error: frame.error, errorCode: frame.code || 'stream_error' }, attempt);
      } else if (frame.done) {
        doneSeen = true;
        if (typeof frame.done.message_id !== 'string' || !frame.done.message_id || !entry.state.conversationId || saveFailed
            || (!terminalError && (!sawSources || !coalescer.text.trim() || entry.state.error))) throw new Error('Incomplete terminal result.');
        await coalescer.flush();
        terminal = await publish(entry, { messageId: frame.done.message_id, status: terminalError || (entry.state.truncated ? 'truncated' : 'complete'),
          errorCode: terminalError || (entry.state.truncated ? 'truncated' : ''),
          isStreaming: false, isPending: false, retryable: false, cancelPending: false, stopQueued: false }, attempt);
        // Saved terminal evidence ends this operation, independently of how the
        // server or network subsequently closes its transport.
        if (terminal) { handedOn = true; break; }
      }
    }
    await coalescer.flush();
    if (!terminal) throw new Error('The connection ended before a saved result was confirmed. Reload or replay this turn.');
    await publish(entry, { isStreaming: false }, attempt);
    const finished = result(entry);
    if (handedOn) {
      const done = { conversationId: entry.state.conversationId, messageId: entry.state.messageId };
      void readCreditsTail(frames, reading, opts.creditsWaitMs ?? CREDITS_WAIT_MS,
        credits => opts.onCredits?.({ ...done, credits }));
    }
    return finished;
  } catch (error) {
    await coalescer.flush();
    const message = entry.endReason === 'timeout' ? 'The answer stopped arriving. Its server outcome is unknown; reload or replay this turn.'
      : entry.endReason === 'detached' ? 'The connection was closed. Its server outcome is unknown; reload the conversation.' : connectionMessage(error);
    await publish(entry, { isStreaming: false, status: entry.dispatched ? 'unknown' : 'error', isPending: entry.dispatched,
      error: entry.state.error || message, errorCode: entry.state.errorCode || (entry.dispatched ? 'connection_lost' : 'identity_changed'),
      retryable: entry.dispatched }, attempt);
    if (entry.attempt === attempt) entry.transportActive = false;
    return result(entry);
  } finally {
    clearTimeout(idle);
    coalescer.dispose();
    if (entry.attempt === attempt) {
      entry.abort = null;
      entry.transportActive = false;
      if (bound(entry, attempt)) notify();
    }
    if (!entry.identity) remove(entry);
  }
}
