import { assert, assertEquals } from 'jsr:@std/assert@1';
import type { RowCitation, TextCitation } from '../_shared/citation.types.ts';
import type { Chunk } from '../_shared/retrieval.ts';
import type { DeskRow } from '../_shared/tools/searchDeskRows.ts';
import { applyCitationLadder, type EvidenceMap, ladderFired, rowTitle } from './sources.ts';

function chunk(id: string, title = 'The Delimitation Bill, 2026'): Chunk {
  return {
    id,
    document_id: `doc-${id}`,
    content: 'The Bill was referred to the Standing Committee on 12 March.',
    similarity: 0.8,
    chunk_index: 0,
    source_kind: 'document',
    char_from: 0,
    char_to: 59,
    title,
    file_url: 'https://sansad.in/x.pdf',
    desk_tier: 'national',
    desk_feature: 'Bill Passage Probability Index',
    text_hash: 'hash-' + id,
  };
}

function deskRow(key: string): DeskRow {
  return {
    tier: 'national',
    feature: 'Bill Passage Probability Index',
    row_key: key,
    row: { bill_name: 'THE DELIMITATION BILL, 2026.', house: 'Lok Sabha' },
    record_text: 'Record: THE DELIMITATION BILL, 2026.',
    document_key: 'bill:2026:108',
    snapshot_at: '2026-09-07T18:02:04.432Z',
  };
}

function evidence(): EvidenceMap {
  return new Map([
    ['ref:ab12cd-1', { kind: 'text', chunk: chunk('c1') }],
    ['ref:ab12cd-2', { kind: 'text', chunk: chunk('c2', 'The Aircraft (Amendment) Bill, 2006') }],
    ['ref:ab12cd-3', { kind: 'row', row: deskRow('108-lok sabha') }],
  ]);
}

Deno.test('handles the model cited become numbered sources; a text and a row source carry their own shape', () => {
  const r = applyCitationLadder({
    answer: 'The Bill went to committee [7] and the desk row agrees [9].',
    modelSources: [{ id: 7, source: 'ref:ab12cd-1' }, { id: 9, source: 'ref:ab12cd-3' }],
    evidence: evidence(),
  });
  assertEquals(r.answer, 'The Bill went to committee [1] and the desk row agrees [2].');
  assertEquals(r.sources.map((s) => [s.id, s.kind]), [[1, 'text'], [2, 'row']]);
  const text = r.sources[0] as TextCitation;
  assertEquals(text.chunk_id, 'c1');
  assertEquals(text.text_hash, 'hash-c1');
  assertEquals(text.char_to, 59);
  const row = r.sources[1] as RowCitation;
  assertEquals(row.row_key, '108-lok sabha');
  assertEquals(row.title, 'THE DELIMITATION BILL, 2026.');
  assertEquals(row.snapshot_at, '2026-09-07T18:02:04.432Z');
  assertEquals(ladderFired(r.flags), false);
});

Deno.test('a handle the model never received cannot become a citation; its marker is stripped', () => {
  const r = applyCitationLadder({
    answer: 'Real [1]. Invented [2]. Also invented [3].',
    modelSources: [
      { id: 1, source: 'ref:ab12cd-1' },
      { id: 2, source: 'ref:zzzzzz-9' },
      { id: 3, source: 'chunk-uuid-the-model-guessed' },
    ],
    evidence: evidence(),
  });
  assertEquals(r.answer, 'Real [1]. Invented. Also invented.');
  assertEquals(r.sources.length, 1);
  assertEquals(r.flags.marker_source_mismatch, true);
  assertEquals(ladderFired(r.flags), true);
});

Deno.test('grouped and ranged markers expand before resolution', () => {
  const r = applyCitationLadder({
    answer: 'Three sources agree [1, 2] and [2-3].',
    modelSources: [
      { id: 1, source: 'ref:ab12cd-1' },
      { id: 2, source: 'ref:ab12cd-2' },
      { id: 3, source: 'ref:ab12cd-3' },
    ],
    evidence: evidence(),
  });
  assertEquals(r.answer, 'Three sources agree [1][2] and [2][3].');
  assertEquals(r.sources.map((s) => s.id), [1, 2, 3]);
});

Deno.test('a handle written into the prose is rescued as a citation and reported as prose_fallback', () => {
  const r = applyCitationLadder({
    answer: 'The committee stage is recorded in ref:ab12cd-1 and nowhere else.',
    modelSources: [],
    evidence: evidence(),
  });
  assertEquals(r.answer, 'The committee stage is recorded in [1] and nowhere else.');
  assertEquals(r.sources.length, 1);
  assertEquals((r.sources[0] as TextCitation).chunk_id, 'c1');
  assertEquals(r.recovered, 1);
  assertEquals(r.flags.prose_fallback, true);
  assertEquals(r.flags.uncited_claims, false);
});

Deno.test('a bracketed handle in prose is rescued too, and one the model also listed keeps its id', () => {
  const r = applyCitationLadder({
    answer: 'First [ref:ab12cd-2] then [4].',
    modelSources: [{ id: 4, source: 'ref:ab12cd-2' }],
    evidence: evidence(),
  });
  assertEquals(r.answer, 'First [1] then [1].');
  assertEquals(r.sources.length, 1);
  assertEquals((r.sources[0] as TextCitation).chunk_id, 'c2');
});

Deno.test('a long answer that cites nothing while evidence existed is uncited_claims', () => {
  const long = 'The record describes the committee stage at length. '.repeat(6);
  const r = applyCitationLadder({ answer: long, modelSources: [], evidence: evidence() });
  assertEquals(r.sources, []);
  assertEquals(r.flags.uncited_claims, true);
  assertEquals(r.flags.prose_fallback, false, 'nothing was recovered, so this is not a rescue');
  assert(ladderFired(r.flags));
});

Deno.test('a greeting with no evidence fires nothing', () => {
  const r = applyCitationLadder({ answer: 'Hello — what would you like to check?', modelSources: [], evidence: new Map() });
  assertEquals(r.sources, []);
  assertEquals(ladderFired(r.flags), false);
});

Deno.test('malformed model sources are ignored without throwing; duplicate ids and handles keep the first', () => {
  const r = applyCitationLadder({
    answer: 'A [1] B [2].',
    modelSources: [
      null,
      'nonsense',
      { id: '1', source: 'ref:ab12cd-1' },
      { id: 0, source: 'ref:ab12cd-1' },
      { id: 1, source: 'ref:ab12cd-1' },
      { id: 1, source: 'ref:ab12cd-2' },
      { id: 2, source: 'ref:ab12cd-1' },
    ],
    evidence: evidence(),
  });
  assertEquals(r.sources.length, 1);
  assertEquals((r.sources[0] as TextCitation).chunk_id, 'c1');
  assertEquals(r.answer, 'A [1] B.');
  assertEquals(applyCitationLadder({ answer: 'x', modelSources: { not: 'an array' }, evidence: new Map() }).sources, []);
});

Deno.test('rowTitle prefers the desk naming columns and falls back to the row key', () => {
  assertEquals(rowTitle(deskRow('k')), 'THE DELIMITATION BILL, 2026.');
  const bare = { ...deskRow('only-key'), row: { house: 'Rajya Sabha' } };
  assertEquals(rowTitle(bare), 'only-key');
});

// The production failure this rung exists for. Message f85ae628, 2026-09-21:
// two searches, 98k prompt tokens, gemini-3.5-flash-lite. The model dropped the
// `ref:` prefix, bracketed the handles and grouped them with a comma, and every
// rung below missed it: zero sources, and the raw tokens rendered to the reader.
Deno.test('a prefix-stripped, bracketed, grouped handle is restored, resolved and numbered', () => {
  const r = applyCitationLadder({
    answer: 'The Bill was brought to continue the existing rates [ab12cd-1, ab12cd-2].',
    modelSources: [],
    evidence: evidence(),
  });
  assertEquals(r.answer, 'The Bill was brought to continue the existing rates [1][2].');
  assertEquals(r.sources.map((s) => s.id), [1, 2]);
  assertEquals((r.sources[0] as TextCitation).chunk_id, 'c1');
  assertEquals(r.recovered, 2);
  assertEquals(r.flags.uncited_claims, false);
});

Deno.test('a prefix-stripped handle the turn never issued is removed, not left in the prose', () => {
  const r = applyCitationLadder({
    answer: 'A claim [ab12cd-1] and one from nowhere [zzzzzz-4], plus a bare one ab12cd-9 too.',
    modelSources: [],
    evidence: evidence(),
  });
  assertEquals(r.answer, 'A claim [1] and one from nowhere [zzzzzz-4], plus a bare one too.');
  assertEquals(r.sources.length, 1);
});

Deno.test('restoration leaves prose that merely looks like a handle alone', () => {
  const r = applyCitationLadder({
    answer: 'Rates for 2014-15 and clause 2-3 stand [ref:ab12cd-1]. See [Table 4] and [1].',
    modelSources: [{ id: 1, source: 'ref:ab12cd-2' }],
    evidence: evidence(),
  });
  assert(r.answer.includes('2014-15'), r.answer);
  assert(r.answer.includes('clause 2-3'), r.answer);
  assert(r.answer.includes('[Table 4]'), r.answer);
});

// The flag used to require that evidence had been retrieved, which excluded the
// turns that need it most: a long answer built on nothing at all could not be
// flagged, because "nothing at all" is what the condition ruled out.
Deno.test('uncited_claims fires on a substantial answer with no sources, evidence or not', () => {
  const long = 'The Bill reached the Standing Committee on 12 March. '.repeat(6);
  const withNone = applyCitationLadder({ answer: long, modelSources: [], evidence: new Map() });
  assertEquals(withNone.sources.length, 0);
  assertEquals(withNone.flags.uncited_claims, true, 'a turn that retrieved nothing is exactly the case to flag');

  const withSome = applyCitationLadder({ answer: long, modelSources: [], evidence: evidence() });
  assertEquals(withSome.flags.uncited_claims, true);

  // A short answer is not a body of claims, and a greeting is not either.
  assertEquals(applyCitationLadder({ answer: 'Hello.', modelSources: [], evidence: new Map() }).flags.uncited_claims, false);
});
