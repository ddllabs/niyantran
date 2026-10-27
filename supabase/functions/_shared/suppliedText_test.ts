import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { prepareSuppliedText } from './suppliedText.ts';
import { sha256Hex } from './textNormalise.ts';
import { chunkTextWithContext } from './textContext.ts';

import { input, nationalQuestion } from './suppliedText_fixture.ts';
Deno.test('supplied text uses existing chunker and converts code points without changing text', async () => {
  const r = await input();
  const p = await prepareSuppliedText(r);
  assertEquals(p.text, r.text);
  assertEquals(p.pages[0].char_to, r.text.length);
  assertEquals(p.pages[0].source_char_to, [...r.text].length);
  assertEquals(p.chunks, await chunkTextWithContext(r.text));
  assertEquals((await prepareSuppliedText(r)).payload_sha256, p.payload_sha256);
});
Deno.test('supplied text rejects altered text, review identity, unchecked rules and incomplete source', async () => {
  const r = await input();
  await assertRejects(() => prepareSuppliedText({ ...r, text: r.text + 'x' }), Error, 'hash');
  await assertRejects(
    () => prepareSuppliedText({ ...r, review: { ...r.review, source_key: 'other' } }),
    Error,
    'review',
  );
  await assertRejects(
    () => prepareSuppliedText({ ...r, review: { ...r.review, checks: { ...r.review.checks, dedupe: false } } }),
    Error,
    'review',
  );
  await assertRejects(() => prepareSuppliedText({ ...r, text_quality: 'cut_at_250' }), Error, 'incomplete');
  await assertRejects(() => prepareSuppliedText({ ...r, desk_feature: 'invented' }), Error, 'feature');
});
Deno.test('supplied text rejects bad spans, overlap, empty text and retained unknown fields', async () => {
  const r = await input();
  await assertRejects(() => prepareSuppliedText({ ...r, pages: [{ ...r.pages[0], char_to: 10000 }] }), Error, 'span');
  await assertRejects(() => prepareSuppliedText({ ...r, pages: [r.pages[0], r.pages[0]] }), Error, 'page');
  await assertRejects(() => prepareSuppliedText({ ...r, pages: [{ ...r.pages[0], text: 'wrong' }] }), Error, 'page');
  await assertRejects(async () => prepareSuppliedText({ ...r, text: '', text_sha256: await sha256Hex('') }), Error);
  const p = await prepareSuppliedText({ ...r, actor: 'forged', metadata: { document_key: 'wrong' } });
  assertEquals('actor' in p, false);
  assertEquals('metadata' in p, false);
});
Deno.test('known truncated page declarations cannot be overridden by an eligible review', async () => {
  const r = await input();
  await assertRejects(() => prepareSuppliedText({ ...r, page_split: 'cut_at_250' }), Error, 'incomplete');
  await assertRejects(() => prepareSuppliedText({ ...r, page_split: 'partial' }), Error, 'incomplete');
  await assertRejects(() => prepareSuppliedText({ ...r, page_count: 2 }), Error, 'page count');
});
Deno.test('repeated text chunk identities use the same deduplication as legacy ingestion', async () => {
 const r=await input(); const text='# Repeated\n\nA court order.\n\n# Repeated\n\nA court order.\n';const h=await sha256Hex(text);
 const p=await prepareSuppliedText({...r,text,text_sha256:h,pages:[],review:{...r.review,text_sha256:h}});
 assertEquals(p.chunks.length,1);assertEquals(text.slice(p.chunks[0].charFrom,p.chunks[0].charTo),p.chunks[0].content);
});
Deno.test('National question answers are admitted only for their own module and official sansad.in PDF', async () => {
  const q = await nationalQuestion();
  const p = await prepareSuppliedText(q);
  assertEquals(p.input.desk_tier, 'national');
  assertEquals(p.input.desk_feature, 'Parliamentary Question Database');
  assertEquals(p.input.file_url, q.file_url);
  assertEquals(p.chunks, await chunkTextWithContext(q.text));
  await assertRejects(() => prepareSuppliedText({ ...q, desk_feature: 'Bill Passage Probability Index' }), Error, 'feature');
  await assertRejects(() => prepareSuppliedText({ ...q, desk_tier: 'law' }), Error, 'feature');
  await assertRejects(() => prepareSuppliedText({ ...q, file_url: 'https://example.org/AU1.pdf' }), Error, 'sansad.in');
  await assertRejects(() => prepareSuppliedText({ ...q, file_url: 'http://sansad.in/x/AU1.pdf' }), Error, 'sansad.in');
  await assertRejects(() => prepareSuppliedText({ ...q, file_url: undefined }), Error, 'sansad.in');
  await assertRejects(() => prepareSuppliedText({ ...q, source_key: 'national:x', review: { ...q.review, source_key: 'national:x' } }), Error, 'source_key');
  await assertRejects(() => prepareSuppliedText({ ...q, source_key: 'A'.repeat(40), review: { ...q.review, source_key: 'A'.repeat(40) } }), Error, 'source_key');
});
Deno.test('Law keeps its own module rule: a Law source cannot claim the National question module', async () => {
  const r = await input();
  await assertRejects(() => prepareSuppliedText({ ...r, desk_tier: 'national', desk_feature: 'Parliamentary Question Database' }), Error, 'feature');
  const q = await nationalQuestion();
  await assertRejects(() => prepareSuppliedText({ ...q, desk_tier: 'law', desk_feature: 'Order Archive by Topic (Cross-Court)' }), Error, 'feature');
});
