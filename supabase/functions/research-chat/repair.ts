// The citation repair pass (streaming spec §E.6). When the ladder reports that
// a substantial answer cited nothing resolvable, one cheap model is asked to
// put the markers back into the existing prose without rewriting it. The pass
// is never streamed to the reader, it is charged to the platform, and its
// result is rejected unless the text stayed recognisably the same answer — a
// "repair" that rewrites the answer is a second opinion, not a repair.

import type { Message, ModelEvent, StreamRequest, Usage } from '../_shared/openrouterStream.ts';
import type { Evidence, EvidenceMap } from './sources.ts';

export const REPAIR_MIN_ANSWER_CHARS = 200;
export const REPAIR_RATIO_MIN = 0.7;
export const REPAIR_RATIO_MAX = 1.4;
export const REPAIR_MAX_EVIDENCE_CHARS = 40_000;

const SYSTEM = `You insert citation markers into an answer that already exists. You never rewrite it.

Rules:
- Return the same answer text, character for character, with [n] markers added where a sentence is supported by one of the numbered passages below.
- Never add, remove or reword a sentence, a figure or a heading. Never add a preamble or a closing line.
- Use only the numbers listed below. One number per bracket. Leave a sentence unmarked when no passage supports it.
- Reply with the answer text only. No JSON, no explanation, no code fence.`;

function evidenceLine(n: number, e: Evidence): string {
  if (e.kind === 'row') return `[${n}] ${e.row.feature} — ${e.row.record_text}`;
  return `[${n}] ${e.chunk.title}\n${e.chunk.content}`;
}

/**
 * Numbered passages for the repair prompt, and the map from those numbers back
 * to the evidence. Numbers are positional and unrelated to the model's own
 * earlier ids; the handler re-runs the ladder over the result.
 */
export function numberEvidence(evidence: EvidenceMap): { block: string; byNumber: Map<number, Evidence> } {
  const byNumber = new Map<number, Evidence>();
  const lines: string[] = [];
  let used = 0;
  let n = 0;
  for (const e of evidence.values()) {
    n++;
    const line = evidenceLine(n, e);
    if (used + line.length > REPAIR_MAX_EVIDENCE_CHARS) break;
    used += line.length;
    byNumber.set(n, e);
    lines.push(line);
  }
  return { block: lines.join('\n\n'), byNumber };
}

export function buildRepairMessages(answer: string, evidence: EvidenceMap): { messages: Message[]; byNumber: Map<number, Evidence> } {
  const { block, byNumber } = numberEvidence(evidence);
  return {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Passages:\n\n${block}\n\nAnswer to mark up:\n\n${answer}` },
    ],
    byNumber,
  };
}

export interface RepairDeps {
  model(req: StreamRequest): AsyncGenerator<ModelEvent>;
}

export interface RepairResult {
  /** The marked-up answer, or null when the pass was rejected or failed. */
  text: string | null;
  byNumber: Map<number, Evidence>;
  usage: Usage | null;
  served: string | null;
  generationId: string | null;
  /** Why the text was not used, when it was not. */
  rejected: 'ratio' | 'empty' | null;
}

/** True when a repair is worth paying for at all. */
export function repairWorthwhile(answer: string, evidence: EvidenceMap): boolean {
  return answer.trim().length >= REPAIR_MIN_ANSWER_CHARS && evidence.size > 0;
}

export async function repairCitations(
  deps: RepairDeps,
  a: { answer: string; evidence: EvidenceMap; model: string; signal?: AbortSignal },
): Promise<RepairResult> {
  const { messages, byNumber } = buildRepairMessages(a.answer, a.evidence);
  let text = '';
  let usage: Usage | null = null;
  let served: string | null = null;
  let generationId: string | null = null;
  for await (const event of deps.model({ model: a.model, messages, signal: a.signal })) {
    if (event.type === 'text') text += event.text;
    else if (event.type === 'finish') {
      usage = event.usage;
      served = event.served;
      generationId = event.generationId;
    }
  }
  const cleaned = text.replace(/^\s*```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  if (!cleaned) return { text: null, byNumber, usage, served, generationId, rejected: 'empty' };
  const ratio = cleaned.length / Math.max(1, a.answer.trim().length);
  if (ratio < REPAIR_RATIO_MIN || ratio > REPAIR_RATIO_MAX) {
    return { text: null, byNumber, usage, served, generationId, rejected: 'ratio' };
  }
  return { text: cleaned, byNumber, usage, served, generationId, rejected: null };
}

/** The repaired text's numbered markers, as the ladder's "model sources" shape. */
export function repairSources(byNumber: Map<number, Evidence>, handleOf: (e: Evidence) => string | undefined): { id: number; source: string }[] {
  const out: { id: number; source: string }[] = [];
  for (const [id, e] of byNumber) {
    const handle = handleOf(e);
    if (handle) out.push({ id, source: handle });
  }
  return out;
}
