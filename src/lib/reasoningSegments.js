/**
 * Reasoning segmentation — one algorithm, two copies (streaming spec §F).
 * The server (supabase/functions/_shared/reasoningSegments.ts) persists the
 * segments into a message's activity; the browser segments the live stream
 * with this copy, so the ticker during the turn and after a reload agree.
 * src/lib/__fixtures__/reasoningSegments.json is asserted by both runners.
 *
 * Paragraph breaks first; then sentence ends (. ! ?) followed by whitespace,
 * except after a digit (list numbering, "3.") or a lone capital (initials,
 * "R. Kumar"); pieces under MIN_SEGMENT_CHARS merge backwards (the first one
 * forwards); each segment is cut at MAX_SEGMENT_CHARS; at most
 * MAX_REASONING_SEGMENTS, the rest folded into the last.
 */
export const MIN_SEGMENT_CHARS = 25;
export const MAX_SEGMENT_CHARS = 160;
export const MAX_REASONING_SEGMENTS = 12;

function splitSentences(paragraph) {
  const out = [];
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

function clip(s) {
  return s.length > MAX_SEGMENT_CHARS ? s.slice(0, MAX_SEGMENT_CHARS).trimEnd() : s;
}

export function segmentReasoning(text) {
  const paragraphs = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const pieces = [];
  for (const p of paragraphs) pieces.push(...splitSentences(p));

  const merged = [];
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
