import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { pqAnswerKey, prepareSuppliedText } from './suppliedText.ts';
import { sha256Hex } from './textNormalise.ts';
import { chunkTextWithContext } from './textContext.ts';

import { input, nationalBill, nationalQuestion } from './suppliedText_fixture.ts';
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
Deno.test('pqAnswerKey names the answer file of a Lok Sabha question URL, and nothing else', () => {
  assertEquals(pqAnswerKey('https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals'), 'pq:ls:187:AU6302_KIQmzb');
  assertEquals(pqAnswerKey('https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf'), 'pq:ls:187:AU6302_KIQmzb');
  for (const url of ['http://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf', 'https://example.org/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf',
    'https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=other', 'https://sansad.in/x/AU6302.pdf', undefined, 7]) {
    assertEquals(pqAnswerKey(url), null);
  }
});
Deno.test('Lok Sabha answers are admitted only for their own module, official answer URL and matching key', async () => {
  const q = await nationalQuestion();
  const p = await prepareSuppliedText(q);
  assertEquals(p.input.desk_tier, 'national');
  assertEquals(p.input.desk_feature, 'Parliamentary Question Database');
  assertEquals(p.input.file_url, q.file_url);
  assertEquals(p.input.document_key_suggested, 'pq:ls:187:AU6302_KIQmzb');
  assertEquals(p.chunks, await chunkTextWithContext(q.text));
  await prepareSuppliedText({ ...q, document_key_suggested: undefined });
  await assertRejects(() => prepareSuppliedText({ ...q, desk_feature: 'Bill Passage Probability Index' }), Error, 'sansad.in');
  await assertRejects(() => prepareSuppliedText({ ...q, desk_tier: 'law' }), Error, 'feature');
  await assertRejects(() => prepareSuppliedText({ ...q, file_url: 'https://example.org/AU6302_KIQmzb.pdf' }), Error, 'sansad.in');
  await assertRejects(() => prepareSuppliedText({ ...q, file_url: 'http://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf' }), Error, 'sansad.in');
  await assertRejects(() => prepareSuppliedText({ ...q, file_url: undefined }), Error, 'sansad.in');
  await assertRejects(() => prepareSuppliedText({ ...q, document_key_suggested: 'pq:ls:187:AU9999_other' }), Error, 'does not match');
  await assertRejects(() => prepareSuppliedText({ ...q, source_key: 'national:x', review: { ...q.review, source_key: 'national:x' } }), Error, 'source_key');
  await assertRejects(() => prepareSuppliedText({ ...q, source_key: 'A'.repeat(40), review: { ...q.review, source_key: 'A'.repeat(40) } }), Error, 'source_key');
});
Deno.test('Law keeps its own module rule: a Law source cannot claim the question module, nor a question a Law one', async () => {
  const r = await input();
  await assertRejects(() => prepareSuppliedText({ ...r, desk_tier: 'national', desk_feature: 'Parliamentary Question Database' }), Error, 'feature');
  const q = await nationalQuestion();
  await assertRejects(() => prepareSuppliedText({ ...q, desk_tier: 'law', desk_feature: 'Order Archive by Topic (Cross-Court)' }), Error, 'feature');
});

Deno.test('servable: the single-document path drops it as it always did, whatever its value', async () => {
  const r = await input();
  const plain = await prepareSuppliedText(r);
  for (const servable of [false, true, null, 'false', 0]) {
    assertEquals((await prepareSuppliedText({ ...r, servable })).payload, plain.payload, `servable ${JSON.stringify(servable)}`);
  }
});

Deno.test('servable: the batch path carries false for the database to refuse, refuses a non-boolean, and leaves others unchanged', async () => {
  const r = await input();
  const plain = await prepareSuppliedText(r, { batch: true });
  assertEquals(plain.payload, (await prepareSuppliedText(r)).payload, 'without servable both paths agree');
  assertEquals((await prepareSuppliedText({ ...r, servable: true }, { batch: true })).payload, plain.payload);
  assertEquals((await prepareSuppliedText({ ...r, servable: null }, { batch: true })).payload, plain.payload);
  const held = await prepareSuppliedText({ ...r, servable: false }, { batch: true });
  assertEquals(JSON.parse(held.payload).servable, false);
  await assertRejects(() => prepareSuppliedText({ ...r, servable: 'false' }, { batch: true }), Error, 'servable');
});
Deno.test('a National bill carries its key and role, and a check only when it was made', async () => {
  const r = await nationalBill();
  const p = await prepareSuppliedText(r);
  assertEquals(p.input.document_key, 'bill:2025:12');
  assertEquals(p.input.document_role, 'as_introduced');
  assertEquals((p.input.review as { checks: Record<string, boolean> }).checks.bill_identity, undefined);
  const checked = { ...r, review: { ...r.review, checks: { ...r.review.checks, bill_identity: true } } };
  const q = await prepareSuppliedText(checked);
  assertEquals((q.input.review as { checks: Record<string, boolean> }).checks.bill_identity, true);
});
Deno.test('a National bill must say what it is', async () => {
  const r = await nationalBill();
  await assertRejects(() => prepareSuppliedText({ ...r, file_url: 'https://example.com/bill.pdf' }), Error, 'sansad.in');
  await assertRejects(
    () => prepareSuppliedText({ ...r, file_url: 'https://sansad.in/getFile/BillsTexts/../secret.pdf' }),
    Error,
    'sansad.in',
  );
  await assertRejects(() => prepareSuppliedText({ ...r, document_role: 'memo' }), Error, 'document_role');
  await assertRejects(() => prepareSuppliedText({ ...r, document_key: 'bill:2024:12' }), Error, 'document_key');
});
Deno.test('a National bill may carry the citation key or the listing key, and no other', async () => {
  const r = await nationalBill();
  const cite = (over: Record<string, unknown>) => ({ ...r.citation, ...over });
  const key = async (rec: Record<string, unknown>, document_key: string) =>
    (await prepareSuppliedText({ ...rec, document_key })).input.document_key;
  // The name closes with 2025; the citation says 2024. Both keys are the bill's own.
  const split = { ...r, citation: cite({ bill_year: '2024' }) };
  assertEquals(await key(split, 'bill:2025:12'), 'bill:2025:12');
  assertEquals(await key(split, 'bill:2024:12'), 'bill:2024:12');
  await assertRejects(() => key(split, 'bill:2023:12'), Error, 'document_key');
  await assertRejects(() => key(split, 'bill:2025:13'), Error, 'document_key');
  // No year in the name: the year of introduced_on is the listing's.
  const named = { bill_name: 'The River Navigation Bill', bill_year: '2025' };
  const bare = { ...r, citation: cite({ ...named, introduced_on: '2024-12-30' }) };
  assertEquals(await key(bare, 'bill:2024:12'), 'bill:2024:12');
  // A date that is not a date gives no listing key.
  for (const introduced_on of ['2024-02-31', '2024-13-01', '24-12-30', undefined]) {
    const bad = { ...r, citation: cite({ ...named, introduced_on }) };
    await assertRejects(() => key(bad, 'bill:2024:12'), Error, 'document_key');
  }
  // The name's year wins over the date's.
  const both = { ...r, citation: cite({ bill_year: '2024', introduced_on: '2023-01-01' }) };
  await assertRejects(() => key(both, 'bill:2023:12'), Error, 'document_key');
});
Deno.test('a National bill file_url: dots in a file name pass; parent and current segments and backslashes do not', async () => {
  const r = await nationalBill();
  const base = 'https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/';
  const allowed = [
    `${base}591LS%20As%20Int....pdf`,
    `${base}12.pdf?next=/../a`,
    `${base}12.pdf#/../a`,
    `${base}...pdf`,
    `${base}x/591LS As Int....pdf`,
  ];
  for (const u of allowed) {
    assertEquals((await prepareSuppliedText({ ...r, file_url: u })).input.file_url, u, u);
  }
  const refused = [
    'https://sansad.in/getFile/BillsTexts/../a.pdf',
    'https://sansad.in/getFile/BillsTexts/./a.pdf',
    'https://sansad.in/getFile/BillsTexts/%2e%2e/a.pdf',
    'https://sansad.in/getFile/BillsTexts/%2E./a.pdf',
    'https://sansad.in/getFile/BillsTexts/.%2e/a.pdf',
    'https://sansad.in/getFile/BillsTexts/x/..',
    'https://sansad.in/getFile/BillsTexts/x/..?a=1',
    'https://sansad.in/getFile/BillsTexts/x\\a.pdf',
    'https://sansad.in/getFile/BillsTexts/x/..\r/a.pdf',
    'https://sansad.in/getFile/BillsTexts/x/..\n/a.pdf',
    'https://sansad.in/getFile/BillsTexts/x/.\t./a.pdf',
    'https://sansad.in/getFile/BillsTexts/x/..;/a.pdf',
    'https://sansad.in/getFile/BillsTexts/x/%2e%2e%3b/a.pdf',
    'https://sansad.in/getFile/BillsTexts/x/..%2fa.pdf',
    'https://sansad.in/getFile/BillsTexts/x/..%2F..%2Fa.pdf',
    'https://sansad.in/getFile/BillsTexts/x/%2e%2e%5ca.pdf',
  ];
  for (const u of refused) await assertRejects(() => prepareSuppliedText({ ...r, file_url: u }), Error, 'sansad.in');
});
Deno.test('a question record is unchanged by the Bills adapter', async () => {
  const r = await nationalQuestion();
  const checks = { ...r.review.checks, bill_identity: true };
  const p = await prepareSuppliedText({
    ...r,
    document_key: 'bill:2025:12',
    document_role: 'as_introduced',
    review: { ...r.review, checks },
  });
  assertEquals(p.input.document_key, undefined);
  assertEquals(p.input.document_role, undefined);
  assertEquals(p.payload_sha256, (await prepareSuppliedText(r)).payload_sha256);
});
Deno.test('a bill carries the hash of the pack text it was stripped from; a question or Law payload does not, byte for byte', async () => {
  const orig = 'a'.repeat(64);
  const b = await nationalBill();
  const p = await prepareSuppliedText({ ...b, original_text_sha256: orig }, { batch: true });
  assertEquals(p.input.original_text_sha256, orig);
  assertEquals(JSON.parse(p.payload).original_text_sha256, orig);
  // The worker re-plans the stored payload and must get the same bytes back.
  const again = await prepareSuppliedText(JSON.parse(p.payload), { batch: true });
  assertEquals(again.payload_sha256, p.payload_sha256);
  assertEquals((await prepareSuppliedText(b, { batch: true })).input.original_text_sha256, undefined);
  await assertRejects(
    () => prepareSuppliedText({ ...b, original_text_sha256: 'nope' }, { batch: true }),
    Error,
    'original text hash',
  );
  for (const r of [await nationalQuestion(), await input()]) {
    const withHash = await prepareSuppliedText({ ...r, original_text_sha256: orig }, { batch: true });
    assertEquals(withHash.payload, (await prepareSuppliedText(r, { batch: true })).payload);
    assertEquals(withHash.payload_sha256, (await prepareSuppliedText(r, { batch: true })).payload_sha256);
  }
});
