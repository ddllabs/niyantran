// The SSE frame vocabulary for research-chat (streaming spec §A, "Frames").
// TYPES ONLY in the foundation cut. The sender, the disconnect-tolerant
// writer and the [DONE] terminator are added by streaming-research-agent,
// which may add frames but must not rename these.

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
 * reports itself closed.
 */
export function createChatSender(controller: ReadableStreamDefaultController<Uint8Array>): ChatSender {
  const encoder = new TextEncoder();
  let closed = false;
  let sent = 0;

  function write(payload: string): void {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(payload));
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
