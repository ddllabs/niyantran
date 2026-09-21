// The SSE frame vocabulary for research-chat (streaming spec §A, "Frames").
// Frame names are shared with the browser parser and must remain stable.

import type { CitationSource } from './citation.types.ts';

export type ToolPhase = 'start' | 'end';

export type ChatFrame =
  | { conversation: { id: string; title: string } }
  | { reasoning: string }
  | { tool: { name: string; phase: ToolPhase; input?: unknown; step: number; resultCount?: number } }
  | { chunk: string }
  | { patch: { from: number; text: string } }
  | { model: { requested: string; served: string; reason: string } }
  | { sources: CitationSource[] }
  | { followUpQuestions: string[] }
  | { truncated: { reason: 'length'; continuations: number } }
  | { notice: { kind: 'window'; dropped: number } }
  | { timing: { search_ms: number; reasoning_ms: number; writing_ms: number; total_ms: number } }
  | { duplicate: true }
  | { saveFailed: { stage: string; detail: string } }
  | { error: string; status?: number; code?: string; retryable?: boolean }
  | { done: { message_id: string } };

/** The frame names, for exhaustiveness checks and the client-side parser. */
export const CHAT_FRAME_KEYS = [
  'conversation',
  'reasoning',
  'tool',
  'chunk',
  'patch',
  'model',
  'sources',
  'followUpQuestions',
  'truncated',
  'notice',
  'timing',
  'duplicate',
  'saveFailed',
  'error',
  'done',
] as const;

export type ChatFrameKey = (typeof CHAT_FRAME_KEYS)[number];

export function frameKey(frame: ChatFrame): ChatFrameKey {
  const key = Object.keys(frame)[0] as ChatFrameKey;
  if (!CHAT_FRAME_KEYS.includes(key)) throw new Error(`unknown frame ${key}`);
  return key;
}

/** Bound unread transport bytes, not the persisted answer size. Both live and
 * replay streams use this strategy; a detached reader can reload saved state. */
export const CHAT_STREAM_BUFFER_BYTES = 8 * 1024 * 1024;
export const CHAT_STREAM_QUEUE: QueuingStrategy<Uint8Array> = {
  highWaterMark: CHAT_STREAM_BUFFER_BYTES,
  size: (chunk) => chunk.byteLength,
};

export interface ChatSender {
  /** Write one frame. A closed reader is not an error: the turn must still finish and persist. */
  send(frame: ChatFrame): void;
  /** Write the terminator and close. Safe to call twice. */
  done(): void;
  readonly closed: boolean;
  readonly sent: number;
}

/**
 * The server half of the wire. A client that reloaded or navigated away has
 * closed the response stream, and enqueuing onto it throws; that must never
 * kill the turn, so every write failure is swallowed and the sender simply
 * reports itself closed. The controller must use CHAT_STREAM_QUEUE.
 */
export function createChatSender(controller: ReadableStreamDefaultController<Uint8Array>): ChatSender {
  const encoder = new TextEncoder();
  let closed = false;
  let sent = 0;

  function write(payload: string): void {
    if (closed) return;
    try {
      const bytes = encoder.encode(payload);
      // A stopped reader must not retain an unbounded queue during a live turn.
      // No prefix is enqueued: overflow disconnects transport, never truncates
      // the answer that the turn will finalize in storage.
      if (controller.desiredSize === null || bytes.byteLength > controller.desiredSize) {
        closed = true;
        controller.error(new Error('Research stream reader buffer limit exceeded'));
        return;
      }
      controller.enqueue(bytes);
      sent++;
    } catch {
      closed = true;
    }
  }

  return {
    send(frame) {
      frameKey(frame);
      write(`data: ${JSON.stringify(frame)}\n\n`);
    },
    done() {
      if (closed) return;
      write('data: [DONE]\n\n');
      closed = true;
      try {
        controller.close();
      } catch {
        /* already closed by the runtime */
      }
    },
    get closed() {
      return closed;
    },
    get sent() {
      return sent;
    },
  };
}

/** Replay produces on demand, so even a saved frame larger than the queue
 * budget is transported intact. SSE parsers already accept byte fragmentation. */
export function createChatReplay(frames: Iterable<ChatFrame>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  function* chunks(): Generator<Uint8Array> {
    for (const frame of frames) {
      frameKey(frame);
      const payload = `data: ${JSON.stringify(frame)}\n\n`;
      for (let offset = 0; offset < payload.length;) {
        let end = Math.min(offset + 16_384, payload.length);
        // Do not independently encode the two halves of a surrogate pair.
        const last = payload.charCodeAt(end - 1);
        if (end < payload.length && last >= 0xd800 && last <= 0xdbff) end--;
        yield encoder.encode(payload.slice(offset, end));
        offset = end;
      }
    }
    yield encoder.encode('data: [DONE]\n\n');
  }
  const iterator = chunks();
  let pending: Uint8Array | undefined;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!pending) {
        const next = iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        pending = next.value;
      }
      const count = Math.min(pending.byteLength, controller.desiredSize ?? 0);
      if (count <= 0) return;
      controller.enqueue(pending.subarray(0, count));
      pending = count < pending.byteLength ? pending.subarray(count) : undefined;
    },
    cancel() {
      pending = undefined;
      iterator.return(undefined);
    },
  }, CHAT_STREAM_QUEUE);
}
