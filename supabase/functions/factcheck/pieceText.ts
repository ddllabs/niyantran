// A TypeScript port of mergeOverlap and stripSoundTags from src/lib/factcheck/pieces.js, so the server can
// build a turn's text from stored pieces exactly as the browser would. The two are kept equal by one shared
// fixture, __fixtures__/overlap_cases.json, which this directory's Deno test and the browser's Vitest test
// both read. Change them together.

/** Removes bracketed sound tags in any script: [संगीत], [background music]. */
export function stripSoundTags(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\[[^[\]\n]{1,80}\]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([.,;:!?।])/gu, '$1')
    .trim();
}

const MAX_OVERLAP_WORDS = 8;
// Lower-case, NFC, nukta removed (हज़ार = हजार), everything but letters, marks and digits dropped.
const norm = (word: string) =>
  word.normalize('NFD').replace(/़/gu, '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
const cpLength = (s: string) => [...s].length;

interface Word {
  key: string;
  start: number;
}

// Words are split on whitespace and hyphens, so "second-hand" is two words.
function words(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(/[^\s‐-―-]+/gu)) {
    const key = norm(m[0]);
    if (key) out.push({ key, start: m.index! });
  }
  return out;
}

// A repeat needs at least two consecutive matching words. A trailing half word counts as one of the two
// only when a whole word before it also matches. A run of one repeated word ("no no") is never removed.
function findOverlap(prevW: Word[], nextW: Word[]): { kind: 'whole' | 'half'; k: number } | null {
  const maxK = Math.min(MAX_OVERLAP_WORDS, prevW.length, nextW.length);
  const last = prevW.length - 1;
  for (let k = maxK; k >= 2; k--) {
    let lead = true;
    for (let i = 0; i < k - 1; i++) {
      if (prevW[last - k + 1 + i].key !== nextW[i].key) {
        lead = false;
        break;
      }
    }
    if (!lead) continue;
    const a = prevW[last].key;
    const b = nextW[k - 1].key;
    if (a === b) {
      if (nextW.slice(0, k).every((w) => w.key === a)) continue;
      return { kind: 'whole', k };
    }
    if (b.startsWith(a) && cpLength(a) >= 3) return { kind: 'half', k };
  }
  return null;
}

/** Joins two consecutive transcripts that overlap by about a second of audio (see pieces.js). */
export function mergeOverlap(prevText: unknown, nextText: unknown): { prev: string; next: string } {
  const prev = typeof prevText === 'string' ? prevText : '';
  const next = typeof nextText === 'string' ? nextText : '';
  const prevW = words(prev);
  const nextW = words(next);
  if (!prevW.length || !nextW.length) return { prev, next };
  const hit = findOverlap(prevW, nextW);
  if (!hit) return { prev, next };
  if (hit.kind === 'half') return { prev: prev.slice(0, prevW[prevW.length - hit.k].start).trimEnd(), next };
  return { prev, next: hit.k >= nextW.length ? '' : next.slice(nextW[hit.k].start) };
}

/** The words of a text as the overlap code compares them, joined by single spaces. */
export function normaliseWords(text: string): string {
  return words(text).map((w) => w.key).join(' ');
}

/**
 * The lines of consecutive pieces as the browser shows them (session.js applyReady): sound tags removed, and
 * a piece that overlaps the one before it in time has the repeated words removed. Each line remembers the
 * index of the piece it came from.
 */
export function mergeLines(items: { text: string; overlaps: boolean }[]): { text: string; index: number }[] {
  const lines: { text: string; index: number }[] = [];
  items.forEach((item, index) => {
    let clean = stripSoundTags(item.text);
    const prev = lines.at(-1);
    if (clean && prev && item.overlaps) {
      const merged = mergeOverlap(prev.text, clean);
      if (merged.prev !== prev.text) {
        if (merged.prev) prev.text = merged.prev;
        else lines.pop();
      }
      clean = merged.next;
    }
    if (clean) lines.push({ text: clean, index });
  });
  return lines;
}

/** The lines joined by a space. */
export function joinPieces(items: { text: string; overlaps: boolean }[]): string {
  return mergeLines(items).map((l) => l.text).join(' ');
}
