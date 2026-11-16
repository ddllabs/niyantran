// F344 S3a: the browser's overlap clean-up (pieces.js) and the Edge Function's TypeScript port are
// proven equal on one shared fixture file that both test suites read. Each case is a list of piece
// texts and the text expected after sound tags are stripped and overlaps joined.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeOverlap, stripSoundTags } from './pieces.js';

const FIXTURE = new URL('../../../supabase/functions/factcheck/__fixtures__/overlap_cases.json', import.meta.url);

// Joins piece texts the way the transcript does: strip tags, skip empty pieces, trim the
// previous text for a half word and the next for a repeat, then join with a space.
function join(pieces) {
  const lines = [];
  for (const piece of pieces) {
    let text = stripSoundTags(piece);
    if (!text) continue;
    const prev = lines.at(-1);
    if (prev !== undefined) {
      const merged = mergeOverlap(prev, text);
      lines[lines.length - 1] = merged.prev;
      text = merged.next;
    }
    if (text) lines.push(text);
  }
  return lines.filter(Boolean).join(' ');
}

describe.skipIf(!existsSync(FIXTURE))('shared overlap fixture (supabase/functions/factcheck/__fixtures__/overlap_cases.json)', () => {
  const cases = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : [];
  it('has cases', () => { expect(cases.length).toBeGreaterThan(0); });
  it.each(cases.map(c => [c.name, c]))('%s', (_name, c) => {
    expect(join(c.pieces)).toBe(c.expected);
  });
});
