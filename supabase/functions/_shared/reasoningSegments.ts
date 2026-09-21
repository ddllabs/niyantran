// Reasoning segmentation — the Deno copy of src/lib/reasoningSegments.js,
// which carries the rationale. The two MUST stay behaviourally identical;
// src/lib/__fixtures__/reasoningSegments.json is asserted by both runners.

export const MIN_SEGMENT_CHARS = 25;
export const MAX_SEGMENT_CHARS = 160;
export const MAX_REASONING_SEGMENTS = 12;

function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < paragraph.length; i += 1) {
    const ch = paragraph[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    const next = paragraph[i + 1];
    if (next === undefined || !/\s/.test(next)) continue;
    const prev = paragraph[i - 1] || '';
    if (/\d/.test(prev)) continue;
    if (/[A-Z]/.test(prev) && (i - 2 < 0 || /\s/.test(paragraph[i - 2]))) continue;
    const piece = paragraph.slice(start, i + 1).trim();
    if (piece) out.push(piece);
    start = i + 1;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

function clip(s: string): string {
  return s.length > MAX_SEGMENT_CHARS ? s.slice(0, MAX_SEGMENT_CHARS).trimEnd() : s;
}

export function segmentReasoning(text: unknown): string[] {
  const paragraphs = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) pieces.push(...splitSentences(p));

  const merged: string[] = [];
  for (const piece of pieces) {
    if (piece.length < MIN_SEGMENT_CHARS && merged.length) merged[merged.length - 1] = `${merged[merged.length - 1]} ${piece}`;
    else merged.push(piece);
  }
  if (merged.length > 1 && merged[0].length < MIN_SEGMENT_CHARS) {
    merged[1] = `${merged[0]} ${merged[1]}`;
    merged.shift();
  }

  if (merged.length > MAX_REASONING_SEGMENTS) {
    const head = merged.slice(0, MAX_REASONING_SEGMENTS - 1);
    head.push(merged.slice(MAX_REASONING_SEGMENTS - 1).join(' '));
    return head.map(clip);
  }
  return merged.map(clip);
}
