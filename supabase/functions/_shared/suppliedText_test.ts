import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { COMPLETENESS_BASES, NATIONAL_SEARCH_ONLY, pqAnswerKey, prepareSuppliedText, SEARCH_ONLY_HOSTS, searchOnlyUrlOk } from './suppliedText.ts';
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
Deno.test('F372: only a pack corrigendum (doc_type bill_corrigendum, role errata) may have no file_url', async () => {
  const r = await nationalBill();
  const erratum = { ...r, doc_type: 'bill_corrigendum', document_role: 'errata', file_url: null };
  const p = await prepareSuppliedText(erratum, { batch: true });
  assertEquals([p.input.document_role, p.input.doc_type, p.input.file_url], ['errata', 'bill_corrigendum', undefined]);
  assertEquals((await prepareSuppliedText({ ...erratum, file_url: undefined }, { batch: true })).input.file_url, undefined);
  // Any other bill needs its official file.
  await assertRejects(() => prepareSuppliedText({ ...r, file_url: null }, { batch: true }), Error, 'sansad.in');
  await assertRejects(() => prepareSuppliedText({ ...erratum, doc_type: 'bill' }, { batch: true }), Error, 'sansad.in');
  await assertRejects(() => prepareSuppliedText({ ...erratum, doc_type: undefined }, { batch: true }), Error, 'sansad.in');
  await assertRejects(() => prepareSuppliedText({ ...erratum, document_role: 'synopsis' }, { batch: true }), Error, 'sansad.in');
  // A link that is given is still held to the official rule; an empty one is a link, not an absent one.
  await assertRejects(() => prepareSuppliedText({ ...erratum, file_url: 'https://example.com/c.pdf' }, { batch: true }), Error, 'sansad.in');
  await assertRejects(() => prepareSuppliedText({ ...erratum, file_url: '' }, { batch: true }), Error, 'sansad.in');
  const linked = { ...erratum, file_url: 'https://sansad.in/getFile/BillsTexts/LSBillTexts/Errata/12_c.pdf' };
  assertEquals((await prepareSuppliedText(linked, { batch: true })).input.file_url, linked.file_url);
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

// ═══ National search-only desks (F307, docs/specs/2026-11-12-regulatory-screen.md, Admission) ═══

// payload_sha256 of each record as the adapter prepared it before search-only desks existed (computed at 0e628f30).
// The worker compares a stored payload with a fresh one (ingest-worker/supplied-step.ts), so these must never move.
const BEFORE_SEARCH_ONLY: [string, () => Promise<unknown>, boolean, string][] = [
  ['law', input, false, 'a0288fcad3eb0ac982340bef5bc33d56e18a490dc51ccf9c23bc3ee4e4999522'],
  ['law, batch', input, true, 'a0288fcad3eb0ac982340bef5bc33d56e18a490dc51ccf9c23bc3ee4e4999522'],
  ['question', nationalQuestion, false, 'f70f4cdadde3ea69e625dce3c7ad3012973d361571d34bb21e5dbc6d2ca25711'],
  ['question, batch, not servable', async () => ({ ...(await nationalQuestion()), servable: false }), true,
    'c9424ef4853652a7b9f768a5c41a72222c5bafc7487ba7fcf096583b1ed0640a'],
  ['bill', nationalBill, false, '87203adff04a2ca03acdef306b2846ac56397022a0b9175d8a25633b1c825b72'],
  ['bill, batch, original hash', async () => ({ ...(await nationalBill()), original_text_sha256: 'a'.repeat(64) }), true,
    'c62609fddd0dfe11ad1a69bb508d33ca928055e928db3401d097a22d5560f364'],
  ['bill, batch, identity checked', async () => {
    const b = await nationalBill();
    return { ...b, review: { ...b.review, checks: { ...b.review.checks, bill_identity: true } } };
  }, true, 'a1f3cfba6952175460f8f57dc20ad9fe3655f883061227d44ea70c4581b0bbc4'],
];
Deno.test('Law, question and bill payloads are byte-identical to the adapter before search-only desks', async () => {
  for (const [name, make, batch, sha] of BEFORE_SEARCH_ONLY) {
    const r = await make() as Record<string, unknown>;
    assertEquals((await prepareSuppliedText(r, { batch })).payload_sha256, sha, name);
    // A basis on another desk is not theirs to carry: dropped, as the question desk drops a bill's key.
    for (const completeness_basis of ['page_check', 'density_only', 'invented']) {
      assertEquals((await prepareSuppliedText({ ...r, completeness_basis }, { batch })).payload_sha256, sha, `${name} + ${completeness_basis}`);
    }
  }
});

const REGULATORY = 'Regulatory Body Watch (RBI SEBI TRAI CCI)';
/** A Regulatory pack record (synthetic): the corpus (space) spelling, a pack suggested key, an official RBI file. */
async function regulatory(): Promise<Record<string, unknown>> {
  const q = await nationalQuestion();
  return {
    ...q,
    title: 'Master Direction on Fixture Accounts',
    desk_feature: REGULATORY,
    file_name: 'MD01FIXTURE.PDF',
    file_url: 'https://rbidocs.rbi.org.in/rdocs/notification/PDFs/MD01FIXTURE.PDF',
    document_key_suggested: 'reg:rbi:md01fixture',
    doc_type: 'regulatory',
    source_host: 'rbi.org.in',
    licence_class: 'govt_material_confirm_counsel',
    extraction: 'pdf_text',
    citation: { kind: 'regulatory', regulator: 'RBI', regulator_name: 'Reserve Bank of India', title: 'Master Direction', date: '2025-04-01', source: 'rbi.org.in' },
    completeness_basis: 'page_check',
  };
}
/** The six search-only desks and each one's hosts, as public.ingest_search_only_desks() holds them (20261123090000). */
const DESK_HOSTS: Record<string, string[]> = {
  [REGULATORY]: ['rbidocs.rbi.org.in', 'www.rbi.org.in', 'www.sebi.gov.in'],
  'Budget Utilisation & Schemes': ['www.indiabudget.gov.in'],
  'Cabinet Decisions': ['www.pib.gov.in'],
  'Bureaucratic Transfers — AGMUT Cadre': ['mha.gov.in'],
  'Industry Updates (Ministry Data)': ['www.dpiit.gov.in', 'eaindustry.nic.in', 'www.mospi.gov.in', 'mospi.gov.in'],
  'MP Profiles & Performance (MPLAD attendance debates)': ['sansad.in'],
};
Deno.test('NATIONAL_SEARCH_ONLY holds the six desks under the spellings their documents use, each with its own hosts', () => {
  assertEquals(NATIONAL_SEARCH_ONLY.map((d) => `${d.tier}|${d.feature}`), Object.keys(DESK_HOSTS).map((f) => `national|${f}`));
  assertEquals(Object.fromEntries(Object.entries(SEARCH_ONLY_HOSTS).map(([k, v]) => [k, [...v]])), DESK_HOSTS);
  assertEquals(Object.keys(SEARCH_ONLY_HOSTS)[3].codePointAt(23), 0x2014);
  assertEquals([...COMPLETENESS_BASES], ['page_check', 'density_only']);
});
const r0 = await regulatory();
/** A record of search-only desk `feature` (synthetic), its file on the desk's first host. */
async function deskRecord(feature: string, over: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return { ...(await regulatory()), desk_feature: feature, file_name: 'F1.pdf', file_url: `https://${DESK_HOSTS[feature][0]}/fixture/F1.pdf`,
    document_key_suggested: 'fx:1', ...over };
}
Deno.test('each search-only desk is prepared with each of its own hosts, and with no file_url', async () => {
  for (const [feature, hosts] of Object.entries(DESK_HOSTS)) {
    for (const host of hosts) {
      const p = await prepareSuppliedText(await deskRecord(feature, { file_url: `https://${host}/fixture/F1.pdf?x=1` }), { batch: true });
      assertEquals([p.input.desk_tier, p.input.desk_feature, p.input.file_url], ['national', feature, `https://${host}/fixture/F1.pdf?x=1`]);
      assertEquals((await prepareSuppliedText(JSON.parse(p.payload))).payload_sha256, p.payload_sha256);
      assertEquals(searchOnlyUrlOk(`https://${host}/a.pdf`, feature), true, `${feature} ${host}`);
    }
    assertEquals((await prepareSuppliedText(await deskRecord(feature, { file_url: null, completeness_basis: 'density_only' }), { batch: true }))
      .input.desk_feature, feature);
  }
});
Deno.test('a search-only record carrying another desk\'s host is refused, for every desk and every host not its own', async () => {
  const all = [...new Set(Object.values(DESK_HOSTS).flat())];
  let pairs = 0;
  for (const [feature, hosts] of Object.entries(DESK_HOSTS)) {
    for (const host of all.filter((h) => !hosts.includes(h))) {
      pairs++;
      assertEquals(searchOnlyUrlOk(`https://${host}/a.pdf`, feature), false, `${feature} ${host}`);
      await assertRejects(() => prepareSuppliedText({ ...r0, desk_feature: feature, file_url: `https://${host}/a.pdf` }, { batch: true }),
        Error, 'file_url', `${feature} ${host}`);
    }
  }
  assertEquals(pairs, 55);
  // A desk outside the list has no host.
  assertEquals(searchOnlyUrlOk('https://www.pib.gov.in/a.pdf', 'Ministry Press Releases'), false);
  assertEquals(searchOnlyUrlOk('https://www.pib.gov.in/a.pdf', '__proto__'), false);
});
Deno.test('a search-only record may not carry a question-answer file or a bill file, whatever its host allows', async () => {
  const mp = 'MP Profiles & Performance (MPLAD attendance debates)';
  for (
    const file_url of [
      'https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals',
      'https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf',
      'https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/9_2025.pdf?source=legislation',
      'https://sansad.in/getFile/BillsPDFFiles/synopsis/9-2025.pdf',
    ]
  ) {
    assertEquals(searchOnlyUrlOk(file_url, mp), false, file_url);
    await assertRejects(() => prepareSuppliedText({ ...r0, desk_feature: mp, file_url }, { batch: true }), Error, 'file_url', file_url);
  }
  for (
    const file_url of [
      'https://sansad.in/ls/members/biography/4567?from=members',
      'https://sansad.in/rs/members/mplads/4567',
      'https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=other',
      'https://sansad.in/getFile/debates/members/4567.pdf',
    ]
  ) {
    assertEquals(searchOnlyUrlOk(file_url, mp), true, file_url);
    assertEquals((await prepareSuppliedText({ ...r0, desk_feature: mp, file_url }, { batch: true })).input.file_url, file_url);
  }
});
Deno.test('a web page (Cabinet, MP Profiles, or Regulatory alike) is prepared with no page spans, no page count, page_split none', async () => {
  for (const feature of ['Cabinet Decisions', 'MP Profiles & Performance (MPLAD attendance debates)', REGULATORY]) {
    const rec = await deskRecord(feature, { pages: [], page_split: 'none', page_count: null, completeness_basis: 'density_only' });
    const p = await prepareSuppliedText(rec, { batch: true });
    assertEquals([p.pages.length, p.input.page_split, 'page_count' in p.input, p.input.completeness_basis], [0, 'none', false, 'density_only']);
    assertEquals((await prepareSuppliedText(JSON.parse(p.payload))).payload_sha256, p.payload_sha256);
  }
});
Deno.test('the Transfers desk is only the dash spelling; the hyphen and en-dash spellings are not search-only desks', async () => {
  for (const feature of ['Bureaucratic Transfers - AGMUT Cadre', 'Bureaucratic Transfers – AGMUT Cadre', 'Budget Utilisation and Schemes']) {
    await assertRejects(() => prepareSuppliedText({ ...r0, desk_feature: feature, file_url: null }, { batch: true }), Error, 'feature', feature);
  }
});
Deno.test('a search-only record is prepared with its basis, with or without a file_url, and re-plans to the same bytes', async () => {
  const r = await regulatory();
  for (const rec of [r, { ...r, completeness_basis: 'density_only' }, { ...r, file_url: undefined, file_name: undefined },
    { ...r, file_url: null }, { ...r, file_url: 'https://www.sebi.gov.in/legal/circulars/apr-2025/fixture_1.html' },
    { ...r, file_url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=1&Mode=0' },
    { ...r, file_url: 'https://rbidocs.rbi.org.in/rdocs/x/MD01 FIX....PDF' }]) {
    const p = await prepareSuppliedText(rec, { batch: true });
    assertEquals(p.input.desk_tier, 'national');
    assertEquals(p.input.desk_feature, REGULATORY);
    assertEquals(p.input.completeness_basis, rec.completeness_basis);
    assertEquals(JSON.parse(p.payload).completeness_basis, rec.completeness_basis);
    assertEquals(p.input.file_url, rec.file_url ?? undefined);
    assertEquals(p.input.document_key_suggested, 'reg:rbi:md01fixture');
    // The worker re-prepares the stored payload without the batch option and must get the same bytes.
    assertEquals((await prepareSuppliedText(JSON.parse(p.payload))).payload_sha256, p.payload_sha256);
  }
});
Deno.test('a search-only record without a valid completeness basis is refused', async () => {
  const r = await regulatory();
  for (const completeness_basis of [undefined, null, '', 'Page_check', 'density only', 'page_check ', true, 1, ['page_check'], { v: 'page_check' }]) {
    await assertRejects(() => prepareSuppliedText({ ...r, completeness_basis }, { batch: true }), Error, 'completeness_basis', String(completeness_basis));
  }
});
Deno.test('a search-only file_url must be https on a configured host with no dot or encoded-separator segment', async () => {
  const r = await regulatory();
  for (
    const file_url of [
      '',
      'http://rbidocs.rbi.org.in/rdocs/a.pdf',
      'HTTPS://rbidocs.rbi.org.in/rdocs/a.pdf',
      'https://RBIDOCS.rbi.org.in/rdocs/a.pdf',
      'https://rbi.org.in/rdocs/a.pdf',
      'https://sebi.gov.in/legal/a.html',
      'https://rbidocs.rbi.org.in.example.com/a.pdf',
      'https://example.com/https://rbidocs.rbi.org.in/a.pdf',
      'https://user@rbidocs.rbi.org.in/a.pdf',
      'https://rbidocs.rbi.org.in:443/a.pdf',
      'https://rbidocs.rbi.org.in',
      'https://rbidocs.rbi.org.in/rdocs/../a.pdf',
      'https://rbidocs.rbi.org.in/rdocs/./a.pdf',
      'https://rbidocs.rbi.org.in/rdocs/%2e%2e/a.pdf',
      'https://rbidocs.rbi.org.in/rdocs/..%2fa.pdf',
      'https://rbidocs.rbi.org.in/rdocs/x%5ca.pdf',
      'https://rbidocs.rbi.org.in/rdocs/x\\a.pdf',
      'https://rbidocs.rbi.org.in/rdocs/..;/a.pdf',
      'https://rbidocs.rbi.org.in/rdocs/x/..\r/a.pdf',
      'https://rbidocs.rbi.org.in/rdocs/x/.\t./a.pdf',
      'https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals',
    ]
  ) {
    await assertRejects(() => prepareSuppliedText({ ...r, file_url }, { batch: true }), Error, 'file_url', JSON.stringify(file_url));
  }
});
Deno.test('only the corpus spelling of a search-only desk, on the National tier, with a National key', async () => {
  const r = await regulatory();
  // The listing (slash) spelling is in the catalogue but is not a search-only desk.
  await assertRejects(() => prepareSuppliedText({ ...r, desk_feature: 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)' }), Error, 'feature');
  await assertRejects(() => prepareSuppliedText({ ...r, desk_feature: 'regulatory body watch (rbi sebi trai cci)' }), Error, 'feature');
  await assertRejects(() => prepareSuppliedText({ ...r, desk_tier: 'law' }), Error, 'feature');
  await assertRejects(() => prepareSuppliedText({ ...r, desk_tier: 'state' }), Error, 'feature');
  const law = await input();
  await assertRejects(() => prepareSuppliedText({ ...law, desk_tier: 'national', desk_feature: REGULATORY }), Error, 'feature');
  await assertRejects(() => prepareSuppliedText({ ...r, source_key: 'B'.repeat(40), review: { ...r.review as object, source_key: 'B'.repeat(40) } }), Error, 'source_key');
  // The question desk keeps its answer-URL rule, and a question cannot borrow the search-only path.
  const q = await nationalQuestion();
  await assertRejects(() => prepareSuppliedText({ ...q, file_url: r.file_url, completeness_basis: 'page_check' }), Error, 'sansad.in');
});
Deno.test('a search-only file_url is at most 2,000 UTF-8 bytes, as admission measures it', async () => {
  const r = await regulatory();
  const base = 'https://rbidocs.rbi.org.in/rdocs/';
  const url = (bytes: number, tail = '') => base + 'a'.repeat(bytes - base.length - tail.length - 4) + tail + '.PDF';
  assertEquals(new TextEncoder().encode(url(2000)).length, 2000);
  assertEquals((await prepareSuppliedText({ ...r, file_url: url(2000) }, { batch: true })).input.file_url, url(2000));
  await assertRejects(() => prepareSuppliedText({ ...r, file_url: url(2001) }, { batch: true }), Error, 'file_url');
  await assertRejects(() => prepareSuppliedText({ ...r, file_url: url(2900) }, { batch: true }), Error, 'file_url');
  // 1,000 two-byte characters: under 2,000 characters, over 2,000 bytes.
  const wide = base + 'é'.repeat(1000) + '.PDF';
  assertEquals(wide.length < 2000 && new TextEncoder().encode(wide).length > 2000, true);
  await assertRejects(() => prepareSuppliedText({ ...r, file_url: wide }, { batch: true }), Error, 'file_url');
});
Deno.test('a search-only document_key_suggested is a non-blank string of at most 500 UTF-8 bytes', async () => {
  const r = await regulatory();
  const key = (bytes: number) => 'reg:' + 'k'.repeat(bytes - 4);
  assertEquals((await prepareSuppliedText({ ...r, document_key_suggested: key(500) }, { batch: true })).input.document_key_suggested, key(500));
  await assertRejects(() => prepareSuppliedText({ ...r, document_key_suggested: key(501) }, { batch: true }), Error, 'document_key_suggested');
  await assertRejects(() => prepareSuppliedText({ ...r, document_key_suggested: key(2900) }, { batch: true }), Error, 'document_key_suggested');
  const wide = 'reg:' + 'é'.repeat(249); // 253 characters, 502 bytes
  assertEquals(wide.length < 500 && new TextEncoder().encode(wide).length === 502, true);
  await assertRejects(() => prepareSuppliedText({ ...r, document_key_suggested: wide }, { batch: true }), Error, 'document_key_suggested');
  // Shape: a string, non-blank after trimming (JavaScript's whitespace); absent or null means no key.
  for (const document_key_suggested of [5, true, ['reg:x'], { k: 'reg:x' }, '', '   ', '\t\n', '　', '﻿ ']) {
    await assertRejects(() => prepareSuppliedText({ ...r, document_key_suggested }, { batch: true }), Error, 'document_key_suggested',
      JSON.stringify(document_key_suggested));
  }
  assertEquals((await prepareSuppliedText({ ...r, document_key_suggested: '5' }, { batch: true })).input.document_key_suggested, '5');
  for (const document_key_suggested of [undefined, null]) {
    assertEquals('document_key_suggested' in (await prepareSuppliedText({ ...r, document_key_suggested }, { batch: true })).input, false);
  }
});
