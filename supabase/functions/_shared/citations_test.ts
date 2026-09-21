import { assertEquals } from 'jsr:@std/assert@1';
import type { CitationSource } from './citation.types.ts';
import type { Chunk } from './retrieval.ts';
import { buildSources, citedIds, expandGroupedCitations, parseCitationIds, recoverHandleCitations, renumberCitations } from './citations.ts';

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
