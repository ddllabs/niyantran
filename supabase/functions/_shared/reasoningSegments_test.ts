import { assert, assertEquals } from 'jsr:@std/assert@1';
import { MAX_REASONING_SEGMENTS, MAX_SEGMENT_CHARS, segmentReasoning } from './reasoningSegments.ts';

const fixture = JSON.parse(await Deno.readTextFile(new URL('../../../src/lib/__fixtures__/reasoningSegments.json', import.meta.url))) as {
  name: string;
  input: string;
  segments: string[];
}[];

Deno.test('reproduces every fixture case exactly as the client copy', () => {
  assert(fixture.length >= 8);
  for (const c of fixture) assertEquals(segmentReasoning(c.input), c.segments, c.name);
});

Deno.test('numbering and initials are not sentence ends; count and length are capped', () => {
  assertEquals(segmentReasoning('1. Check the bill number. 2. Read the report by R. Kumar. Then decide what to search for next.'), [
    '1. Check the bill number.',
    '2. Read the report by R. Kumar.',
    'Then decide what to search for next.',
  ]);
  const many = Array.from({ length: 30 }, (_, i) => `Sentence number ${i + 1} is about twenty-nine chars.`).join(' ');
  const s = segmentReasoning(many);
  assertEquals(s.length, MAX_REASONING_SEGMENTS);
  for (const seg of s) assert(seg.length <= MAX_SEGMENT_CHARS);
  assertEquals(segmentReasoning(''), []);
});
