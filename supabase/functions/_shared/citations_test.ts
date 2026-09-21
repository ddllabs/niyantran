import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import type { CitationSource } from './citation.types.ts';
import type { Chunk } from './retrieval.ts';
import { buildSources, citedIds, expandGroupedCitations, parseCitationIds, recoverHandleCitations, renumberCitations, stripInventedMarkers } from './citations.ts';

const fixture = JSON.parse(await Deno.readTextFile(new URL('../../../src/lib/__fixtures__/citations.json', import.meta.url))) as {
  name: string;
  text: string;
  expanded: string;
  markers: (string | { citation: number })[];
}[];

function chunk(id: string, over: Partial<Chunk> = {}): Chunk {
  return { id, document_id: `d-${id}`, content: 'c', similarity: 0.5, chunk_index: 0, source_kind: 'document', char_from: 0, char_to: 1, title: `T ${id}`, text_hash: `h-${id}`, ...over };
}
function text(id: number, chunkId = `c${id}`): CitationSource {
  return { id, kind: 'text', chunk_id: chunkId, document_id: 'd', title: 't', char_from: 0, char_to: 1, text_hash: 'h', source_kind: 'document' };
}

Deno.test('parseCitationIds: singles, groups, ranges, and the two limits', () => {
  assertEquals(parseCitationIds('2'), [2]);
  assertEquals(parseCitationIds('2, 3'), [2, 3]);
  assertEquals(parseCitationIds('2-4'), [2, 3, 4]);
  assertEquals(parseCitationIds('5–6'), [5, 6]);
  assertEquals(parseCitationIds('1-40'), []);
  assertEquals(parseCitationIds('1-6'), [1, 2, 3, 4, 5, 6]);
  assertEquals(parseCitationIds('1-7'), []);
  assertEquals(parseCitationIds('99'), [99]);
  assertEquals(parseCitationIds('100'), []);
  assertEquals(parseCitationIds('0'), []);
  assertEquals(parseCitationIds('2, x'), []);
  assertEquals(parseCitationIds('4-2'), []);
});

Deno.test('expandGroupedCitations matches the shared fixture line for line', () => {
  for (const c of fixture) assertEquals(expandGroupedCitations(c.text), c.expanded, c.name);
});

Deno.test('the server expansion agrees with the fixture marker lists', () => {
  for (const c of fixture) {
    const joined = c.markers.map((m) => (typeof m === 'string' ? m : `[${m.citation}]`)).join('');
    assertEquals(joined, c.expanded, c.name);
  }
});

Deno.test('renumberCitations keeps resolvable sources in first-appearance order and strips the rest', () => {
  const r = renumberCitations('Claim A [3]. Claim B [2, 3]. Claim C [1].', [text(1), text(2)]);
  assertEquals(r.answer, 'Claim A. Claim B [1]. Claim C [2].');
  assertEquals(r.sources.map((s) => [s.id, (s as { chunk_id: string }).chunk_id]), [[1, 'c2'], [2, 'c1']]);

  const only2 = renumberCitations('Only the second [2].', [text(1), text(2)]);
  assertEquals(only2.answer, 'Only the second [1].');
  assertEquals(only2.sources.length, 1);
  assertEquals((only2.sources[0] as { chunk_id: string }).chunk_id, 'c2');

  const none = renumberCitations('No citations here.', [text(1)]);
  assertEquals(none.answer, 'No citations here.');
  assertEquals(none.sources, []);
});

Deno.test('recoverHandleCitations matches the longer handle first', () => {
  const handles = { 'ref:k3f-1': 1, 'ref:k3f-11': 11 };
  assertEquals(recoverHandleCitations('See ref:k3f-11 and ref:k3f-1 and [ref:k3f-1].', handles), 'See [11] and [1] and [1].');
});

Deno.test('buildSources returns text citations for the cited ids that resolve, ids preserved', () => {
  const byId = { 3: chunk('x', { file_url: 'https://e.org/x.pdf', page_number: undefined }), 7: chunk('y') };
  const out = buildSources(byId, [7, 3, 5]);
  assertEquals(out.map((s) => s.id), [7, 3]);
  assertEquals(out[1].kind, 'text');
  assertEquals(out[1].chunk_id, 'x');
  assertEquals(out[1].text_hash, 'h-x');
  assertEquals(out[1].file_url, 'https://e.org/x.pdf');
  assertEquals(buildSources(new Map([[1, chunk('m')]]), [1])[0].document_id, 'd-m');
});

Deno.test('citedIds lists valid ids once, in order', () => {
  assertEquals(citedIds('a [2] b [1, 2] c [3-4] d [2005] e [0]'), [2, 1, 3, 4]);
});

Deno.test('handle recovery never replaces an issued prefix of an unissued full token', () => {
  const handles = { 'ref:abc123-1': 1 };
  const unissued = ['ref:abc123-10', '[ref:abc123-10]', 'ref:abc123-100',
    'ref:abc123-1forged', '[ref:abc123-1forged]', 'ref:abc123-1_forged',
    'ref:abc123-1-forged', 'ref:abc123-1ह', 'ref:abc123-1\u0301',
    'prefixref:abc123-1', 'prefix-ref:abc123-1', 'prefix_ref:abc123-1',
    'prefix:ref:abc123-1', 'हref:abc123-1'];
  for (const token of unissued) {
    assertEquals(recoverHandleCitations(`Valid ref:abc123-1. Unissued ${token}.`, handles), `Valid [1]. Unissued ${token}.`, token);
  }
});

Deno.test('handle recovery preserves punctuation and supports exact legacy map keys', () => {
  const handles = { 'ref:abc123-1': 1, 'ref:abc123-10': 2, 'ref:k3f-11': 3 };
  assertEquals(recoverHandleCitations('ref:abc123-10, (ref:abc123-1); claim[ref:k3f-11]! ref:abc123-1: details — [ref:abc123-10]?', handles),
    '[2], ([1]); claim[3]! [1]: details — [2]?');
  assertEquals(recoverHandleCitations('ref:k3f-110 ref:k3f-11suffix', handles), 'ref:k3f-110 ref:k3f-11suffix');
});

// R5. MARKER_RE matches only digits, so a bracketed token of any other shape was
// never examined by the ladder and reached the reader verbatim. A real turn
// rendered `[open-fronts:south-sudan-instability:0]` throughout an answer that
// resolved no sources at all.
Deno.test('invented identifier markers are stripped from the answer', () => {
  const answer = 'South Sudan is a civil war [open-fronts:south-sudan-instability:0].\n' +
    'Intensity is Medium [open-fronts:south-sudan-instability:0] and rising.';
  const { answer: out, sources } = renumberCitations(answer, []);
  assert(!out.includes('open-fronts'), 'the invented marker must not reach the reader');
  assert(!out.includes('['), 'no bracket should survive');
  assertStringIncludes(out, 'South Sudan is a civil war.');
  assertStringIncludes(out, 'Intensity is Medium and rising.');
  assertEquals(sources, []);
});

Deno.test('resolved numeric markers and their sources are untouched', () => {
  const sources = [
    { id: 1, kind: 'row', title: 'A' } as unknown as Parameters<typeof renumberCitations>[1][number],
    { id: 2, kind: 'row', title: 'B' } as unknown as Parameters<typeof renumberCitations>[1][number],
  ];
  const { answer, sources: kept } = renumberCitations('First [1]. Second [2].', sources);
  assertStringIncludes(answer, '[1]');
  assertStringIncludes(answer, '[2]');
  assertEquals(kept.length, 2);
});

// Stripping too much would damage prose. These must all survive.
Deno.test('ordinary brackets and markdown links survive', () => {
  for (
    const text of [
      'The report said [sic] the figure was wrong.',
      'See [the notice](https://example.com/a:b) for detail.',
      'A range [see below] applies.',
      'Ratio was 3:1 in the record.',
      'Timing [09:30 to 11:00] was recorded.',
    ]
  ) {
    const { answer } = renumberCitations(text, []);
    assertEquals(answer, text, `must be unchanged: ${text}`);
  }
});

Deno.test('a bare ref handle that resolved to nothing is stripped too', () => {
  const { answer } = renumberCitations('The record shows a fragile truce [ref:a7k2m9-3].', []);
  assert(!answer.includes('ref:'), 'an unresolved handle must not reach the reader');
  assertStringIncludes(answer, 'fragile truce.');
});

// The repair pass accepts a repair only when nothing but citation markers was
// inserted, and compares against this output. Tidying an answer it did not
// change made a valid repair look like a rewrite.
Deno.test('text with no invented marker is returned byte for byte', () => {
  for (
    const text of [
      'The Bill remains before the committee pending its report. ', // trailing space
      'Two  spaces  inside  are  preserved.',
      'A line with trailing tab\t',
      '',
    ]
  ) {
    assertEquals(stripInventedMarkers(text), text, `must be identical: ${JSON.stringify(text)}`);
  }
});
