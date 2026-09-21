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
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
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
  function flushSoon() {
    if (queued) return;
    queued = true;
    raf(() => {
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
      queued = false;
      commit(text);
    },
    get text() {
      return text;
    },
  };
}

function blankState() {
  return {
    isStreaming: false,
    streamingText: '',
    activity: [],
    sources: [],
    followUps: [],
    model: null,
    truncated: null,
    notice: null,
    error: '',
    conversationId: '',
    messageId: '',
  };
}

const states = new Map();
const controllers = new Map();

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export function streamState(conversationId) {
  return states.get(conversationId || 'new') || blankState();
}

export function subscribeStream(fn) {
  if (typeof window === 'undefined') return () => {};
  const on = () => fn();
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}

export function clearStream(conversationId) {
  states.delete(conversationId || 'new');
  notify();
}

/** Stop the turn: tell the server, then let the stream end on its own. */
export async function recordChatCancellation(conversationId, client = supabase) {
  if (!conversationId || !client) return;
  const { data } = await client.auth.getUser();
  const userId = data?.user?.id;
  await client
    .from('chat_cancellations')
    .upsert({ conversation_id: conversationId, ...(userId ? { user_id: userId } : {}), cancel_requested_at: new Date().toISOString() }, { onConflict: 'conversation_id' });
}

/** Why the stream ended, as a message the reader should see (a Stop is not an error). */
function timeoutMessage(reason) {
  return reason === 'timeout' ? 'The answer stopped arriving. Send it again.' : '';
}

export function stopTurn(conversationId) {
  const key = conversationId || 'new';
  recordChatCancellation(conversationId).catch(() => {});
  controllers.get(key)?.('stopped');
}

/**
 * Send one turn. Resolves with the ids when the stream ends; the panel reads
 * progress through streamState/subscribeStream while it runs.
 */
export async function sendTurn(body, opts = {}) {
  const key = body.conversation_id || 'new';
  const state = { ...blankState(), isStreaming: true, conversationId: body.conversation_id || '' };
  states.set(key, state);
  notify();

  const controller = new AbortController();
  let idle = null;
  // The signal both aborts the request and, through readSseFrames, cancels the
  // reader — a stream that simply stops sending would otherwise leave the
  // reader waiting for ever and the composer stuck. Cancelling the reader ends
  // the loop cleanly, so why the turn ended is recorded here rather than
  // inferred from whether something was thrown.
  let endReason = '';
  const giveUp = (reason) => {
    endReason = reason;
    controller.abort();
  };
  const bump = () => {
    clearTimeout(idle);
    idle = setTimeout(() => giveUp('timeout'), opts.timeoutMs ?? SAFETY_TIMEOUT_MS);
  };
  controllers.set(key, giveUp);

  const coalescer = createTextCoalescer((text) => {
    state.streamingText = text;
    notify();
  }, opts.schedule);

  const settle = (patch) => {
    Object.assign(state, patch);
    notify();
  };

  try {
    bump();
    const response = await (opts.send ?? sendResearchTurn)({ body, signal: controller.signal });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.error || `research-chat HTTP ${response.status}`);
    }
    for await (const frame of readSseFrames(response, controller.signal)) {
      bump();
      if (frame.conversation) {
        // The first frame names the conversation; move the state under its id.
        states.delete(key);
        state.conversationId = frame.conversation.id;
        states.set(frame.conversation.id, state);
        controllers.set(frame.conversation.id, giveUp);
        settle({ conversation: frame.conversation });
      } else if (frame.duplicate) settle({ isStreaming: false });
      else if (frame.reasoning) {
        state.activity = [...state.activity, { type: 'reasoning', text: frame.reasoning }];
        notify();
      } else if (frame.tool) {
        state.activity = frame.tool.phase === 'start'
          ? [...state.activity, { type: 'tool', ...frame.tool }]
          : state.activity.map((a) => (a.type === 'tool' && a.step === frame.tool.step ? { ...a, ...frame.tool } : a));
        notify();
      } else if (typeof frame.chunk === 'string') coalescer.push(frame.chunk);
      else if (frame.patch) coalescer.patch(frame.patch.from, frame.patch.text);
      else if (frame.model) settle({ model: frame.model });
      else if (frame.sources) settle({ sources: frame.sources });
      else if (frame.followUpQuestions) settle({ followUps: frame.followUpQuestions });
      else if (frame.truncated) settle({ truncated: frame.truncated });
      else if (frame.notice) settle({ notice: frame.notice });
      else if (frame.timing) settle({ timing: frame.timing });
      else if (frame.saveFailed) settle({ error: `The answer could not be saved: ${frame.saveFailed.detail}` });
      else if (frame.error) settle({ error: frame.error });
      else if (frame.done) settle({ messageId: frame.done.message_id });
    }
    coalescer.flush();
    settle({ isStreaming: false, error: state.error || timeoutMessage(endReason) });
    return { conversationId: state.conversationId, messageId: state.messageId, error: state.error, aborted: Boolean(endReason), endReason };
  } catch (e) {
    coalescer.flush();
    const aborted = Boolean(endReason) || controller.signal.aborted;
    settle({ isStreaming: false, error: state.error || timeoutMessage(endReason) || (aborted ? '' : e?.message || String(e)) });
    return { conversationId: state.conversationId, messageId: state.messageId, error: state.error, aborted, endReason };
  } finally {
    clearTimeout(idle);
    controllers.delete(key);
    controllers.delete(state.conversationId);
  }
}
