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
