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
import { verifiedLocalIdentity, localIdentityIsCurrent, subscribeLocalIdentity } from './userStore.js';

export const SAFETY_TIMEOUT_MS = 120_000;
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

function blankState() {
  return { isStreaming: false, isPending: false, status: 'idle', streamingText: '', activity: [], sources: [],
    followUps: [], model: null, timing: null, truncated: null, notice: null, error: '', errorCode: '',
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
    const verified = await raceAbort(localIdentityIsCurrent(entry.identity), entry.signal);
    return verified && !entry.signal.aborted && bound(entry, attempt);
  } catch { return false; }
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
  return { conversationId: s.conversationId, messageId: s.messageId, error: s.error, errorCode: s.errorCode,
    status: s.status, isPending: s.isPending, retryable: s.retryable, aborted: Boolean(entry.endReason), endReason: entry.endReason || '' };
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
  } catch {
    if (!stillCurrent()) return false;
    throw new Error('The saved result could not be verified. Try Reload.');
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

/** Exactly one active/unknown execution per conversation; replay is explicit. */
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
    conversationId: request.conversation_id || '' }, identity: null, generation, attempt: 0, retryCount: 0, acknowledged: false };
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
    const identity = await raceAbort(verifiedLocalIdentity(), controller.signal);
    const version = generation;
    if (!identity || (entry.identity && (identity.id !== entry.identity.id || identity.epoch !== entry.identity.epoch || identity.token !== entry.identity.token))
        || !await raceAbort(localIdentityIsCurrent(identity), controller.signal) || version !== generation
        || ![...operations.values()].includes(entry) || controller.signal.aborted) throw new Error('Your research session changed.');
    entry.identity = identity;
    entry.generation = version;
    await publish(entry, { isStreaming: true, isPending: true, status: 'connecting', error: '', errorCode: '',
      retryable: false, retryCount: entry.retryCount, streamingText: '', sources: [], followUps: [], truncated: null,
      activity: [], timing: null, messageId: '', cancelPending: false }, attempt);
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
      await publish(entry, { isStreaming: false, status: rejected ? 'error' : 'unknown', isPending: !rejected,
        error: detail?.error || `research-chat HTTP ${response.status}`, errorCode: detail?.code || `http_${response.status}`,
        retryable: !rejected }, attempt);
      return result(entry);
    }
    for await (const frame of readSseFrames(response, controller.signal)) {
      if (!await current(entry, attempt) || !bound(entry, attempt) || controller.signal.aborted) break;
      bump();
      if (doneSeen) throw new Error('Unexpected data after the terminal result.');
      if (frame.conversation) await conversation(frame.conversation);
      else if (frame.duplicate) await publish(entry, { duplicate: true }, attempt);
      else if (typeof frame.reasoning === 'string') await publish(entry, { activity: [...entry.state.activity, { type: 'activity', text: frame.reasoning }] }, attempt);
      else if (frame.tool) await publish(entry, { activity: frame.tool.phase === 'start'
        ? [...entry.state.activity, { type: 'tool', ...frame.tool }]
        : entry.state.activity.map(a => a.type === 'tool' && a.step === frame.tool.step ? { ...a, ...frame.tool } : a) }, attempt);
      else if (typeof frame.chunk === 'string') coalescer.push(frame.chunk);
      else if (frame.patch) {
        if (!Number.isInteger(frame.patch.from) || frame.patch.from < 0 || frame.patch.from > coalescer.text.length || typeof frame.patch.text !== 'string') throw new Error('Invalid answer patch.');
        coalescer.patch(frame.patch.from, frame.patch.text);
      } else if (frame.model) await publish(entry, { model: frame.model }, attempt);
      else if (Array.isArray(frame.sources)) { sawSources = true; await publish(entry, { sources: frame.sources }, attempt); }
      else if (Array.isArray(frame.followUpQuestions)) await publish(entry, { followUps: frame.followUpQuestions }, attempt);
      else if (frame.truncated?.reason === 'length') await publish(entry, { truncated: frame.truncated }, attempt);
      else if (frame.notice) await publish(entry, { notice: frame.notice }, attempt);
      else if (frame.timing) await publish(entry, { timing: frame.timing }, attempt);
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
        if (terminal) break;
      }
    }
    await coalescer.flush();
    if (!terminal) throw new Error('The connection ended before a saved result was confirmed. Reload or replay this turn.');
    await publish(entry, { isStreaming: false }, attempt);
    return result(entry);
  } catch (error) {
    await coalescer.flush();
    const message = entry.endReason === 'timeout' ? 'The answer stopped arriving. Its server outcome is unknown; reload or replay this turn.'
      : entry.endReason === 'detached' ? 'The connection was closed. Its server outcome is unknown; reload the conversation.' : error?.message || 'The connection failed.';
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
