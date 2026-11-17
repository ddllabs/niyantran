import { assertEquals } from 'jsr:@std/assert@1';
import { joinPieces, mergeOverlap, stripSoundTags } from './pieceText.ts';

// The expected values in this file were produced by running the browser implementation
// (src/lib/factcheck/pieces.js mergeOverlap and stripSoundTags, joined as session.js does); the browser
// test reads the same file.
const cases: { name: string; pieces: string[]; expected: string }[] = JSON.parse(
  await Deno.readTextFile(new URL('./__fixtures__/overlap_cases.json', import.meta.url)),
);

Deno.test('the TypeScript port joins every shared fixture case exactly as the browser does', () => {
  assertEquals(cases.length >= 12, true);
  for (const c of cases) {
    assertEquals(joinPieces(c.pieces.map((text, i) => ({ text, overlaps: i > 0 }))), c.expected, c.name);
  }
});

Deno.test('the fixture covers Devanagari, sound tags, no overlap, a one-word overlap that must not merge and full duplicates', () => {
  const names = cases.map((c) => c.name).join('|');
  for (const word of ['hindi', 'sound tags', 'no overlap', 'one word overlap must not merge', 'full duplicate']) {
    assertEquals(names.includes(word), true, word);
  }
});

Deno.test('pieces that do not overlap in time are joined without the overlap clean-up', () => {
  assertEquals(
    joinPieces([{ text: 'the central bank raised the repo rate by', overlaps: false }, {
      text: 'raised the repo rate by 25 basis points',
      overlaps: false,
    }]),
    'the central bank raised the repo rate by raised the repo rate by 25 basis points',
  );
});

Deno.test('stripSoundTags and mergeOverlap behave as the browser functions on single cases', () => {
  assertEquals(stripSoundTags('[संगीत] नमस्कार ।'), 'नमस्कार।');
  assertEquals(stripSoundTags(7 as unknown as string), '');
  assertEquals(mergeOverlap('a b c d', 'c d e f'), { prev: 'a b c d', next: 'e f' });
  assertEquals(mergeOverlap('only road', 'road safety'), { prev: 'only road', next: 'road safety' });
});
