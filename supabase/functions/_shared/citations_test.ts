import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import type { CitationSource, TextCitation } from './citation.types.ts';
import type { Chunk } from './retrieval.ts';
import {
  buildSources,
  citedIds,
  citedPageRefs,
  expandGroupedCitations,
  MAX_CITATION_BOXES,
  pageEvidenceMaps,
  parseCitationIds,
  recoverHandleCitations,
  renumberCitations,
  stripInventedMarkers,
} from './citations.ts';

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

// ---- The page contract's citation payload (chunk-contract spec, "Citation payload").

/** The exact shape buildSources produced before the page contract, for an old chunk. */
function oldShape(id: number, c: Chunk) {
  return {
    id,
    kind: 'text',
    chunk_id: c.id,
    document_id: c.document_id,
    title: c.title,
    file_name: c.file_name,
    file_url: c.file_url,
    desk_tier: c.desk_tier,
    desk_feature: c.desk_feature,
    char_from: c.char_from,
    char_to: c.char_to,
    text_hash: c.text_hash,
    source_kind: c.source_kind,
    page_number: c.page_number,
  };
}

function pageChunk(id: string, over: Partial<Chunk> = {}): Chunk {
  return chunk(id, {
    document_id: 'd-bill',
    source_kind: 'pdf_page',
    page_number: 4,
    block_ids: [`${id}-b1`, `${id}-b2`],
    image_ids: [`${id}-i1`],
    section: { heading: 'CHAPTER II', note: 'Presumption of prejudicial purpose.' },
    ...over,
  });
}

function block(id: string, over: Record<string, unknown> = {}) {
  return { id, document_id: 'd-bill', extract_hash: 'xh-1', page_number: 4, x0: 0.19, y0: 0.2, x1: 0.81, y1: 0.3, ...over };
}

Deno.test('buildSources: an old chunk, with or without page evidence, gives exactly the old citation', () => {
  const old = chunk('x', { file_url: 'https://e.org/x.pdf', page_number: 3, source_kind: 'pdf_page' });
  const evidence = pageEvidenceMaps([old], { blocks: [block('stray')], images: [] });
  for (const out of [buildSources({ 1: old }, [1]), buildSources({ 1: old }, [1], evidence)]) {
    assertEquals(out[0], oldShape(1, old) as TextCitation);
    assertEquals(Object.keys(out[0]).sort(), Object.keys(oldShape(1, old)).sort());
    assertEquals(JSON.stringify(out[0]), JSON.stringify(oldShape(1, old)));
  }
});

Deno.test('buildSources maps section, boxes, images and extract_hash for a page chunk', () => {
  const c = pageChunk('p');
  const evidence = pageEvidenceMaps([c], {
    blocks: [block('p-b2', { x0: 0.5 }), block('p-b1')],
    images: [{ id: 'p-i1', document_id: 'd-bill', extract_hash: 'xh-1', page_number: 4, sha256: 'ab'.repeat(32), mime: 'image/jpeg' }],
  });
  const [s] = buildSources({ 2: c }, [2], evidence);
  assertEquals(s.section, { heading: 'CHAPTER II', note: 'Presumption of prejudicial purpose.' });
  assertEquals(s.page_number, 4);
  assertEquals(s.extract_hash, 'xh-1');
  // In block_ids order, not row order.
  assertEquals(s.boxes, [
    { page: 4, x0: 0.19, y0: 0.2, x1: 0.81, y1: 0.3 },
    { page: 4, x0: 0.5, y0: 0.2, x1: 0.81, y1: 0.3 },
  ]);
  assertEquals(s.images, [{ page: 4, sha256: 'ab'.repeat(32), mime: 'image/jpeg' }]);
  // Without evidence the section still maps; boxes, images and the hash do not.
  const [bare] = buildSources({ 2: c }, [2]);
  assertEquals(bare.section, c.section);
  assertEquals('boxes' in bare || 'images' in bare || 'extract_hash' in bare, false);
});

Deno.test('pageEvidenceMaps caps boxes at 20, skips null or out-of-range boxes and foreign rows', () => {
  const many = Array.from({ length: 30 }, (_, i) => `m-b${i}`);
  const c = pageChunk('m', { block_ids: ['m-null', 'm-bad', 'm-foreign', ...many], image_ids: undefined });
  const rows = [
    block('m-null', { x0: null, y0: null, x1: null, y1: null }),
    block('m-bad', { x1: 1.4 }),
    block('m-foreign', { document_id: 'd-other' }),
    ...many.map((id, i) => block(id, { y0: i / 100, y1: i / 100 + 0.01 })),
  ];
  const e = pageEvidenceMaps([c], { blocks: rows, images: [] });
  const boxes = e.boxesByChunk.get('m')!;
  assertEquals(MAX_CITATION_BOXES, 20);
  assertEquals(boxes.length, 20);
  assertEquals(boxes[0].y0, 0, 'the first valid block, after the skipped ones');
  assertEquals(e.imagesByChunk.has('m'), false);
  // A chunk whose every block is boxless gets no boxes and no extract_hash.
  const boxless = pageEvidenceMaps([pageChunk('n', { block_ids: ['m-null'], image_ids: undefined })], { blocks: rows, images: [] });
  assertEquals(boxless.boxesByChunk.has('n'), false);
  assertEquals(boxless.extractHashByChunk.has('n'), false);
});

Deno.test('citedPageRefs: distinct ids of the given chunks only, none for old chunks', () => {
  const a = pageChunk('a', { block_ids: ['b1', 'b2'], image_ids: ['i1'] });
  const b = pageChunk('b', { block_ids: ['b2', 'b3'], image_ids: ['i1', 'i2'] });
  assertEquals(citedPageRefs([a, b, chunk('old')]), { blockIds: ['b1', 'b2', 'b3'], imageIds: ['i1', 'i2'] });
  assertEquals(citedPageRefs([chunk('old')]), { blockIds: [], imageIds: [] });
  // Bounded per chunk: all of a chunk's blocks share one page, so a box is null
  // for all of them or none; twice the cap leaves room for missing rows.
  const wide = pageChunk('w', { block_ids: Array.from({ length: 100 }, (_, i) => `w${i}`), image_ids: undefined });
  assertEquals(citedPageRefs([wide]).blockIds.length, MAX_CITATION_BOXES * 2);
});
