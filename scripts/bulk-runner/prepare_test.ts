import { assert, assertEquals, assertNotEquals, assertRejects } from 'jsr:@std/assert@1';
import { nationalBill, nationalQuestion } from '../../supabase/functions/_shared/suppliedText_fixture.ts';
import { prepareSuppliedText } from '../../supabase/functions/_shared/suppliedText.ts';
import { suppliedCommitRows } from '../../supabase/functions/ingest-worker/supplied-step.ts';
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import { prepareAll, prepareRecord } from './prepare.ts';

// deno-lint-ignore no-explicit-any
type Rec = Record<string, any>;

/** A record with a new text and every hash that binds it, as a pack would carry it. */
async function withText(r: Rec, text: string): Promise<Rec> {
  const sha = await sha256Hex(text);
  return {
    ...r,
    text,
    text_sha256: sha,
    pages: [{ page_number: 1, char_from: 0, char_to: [...text].length, text }],
    review: { ...r.review, text_sha256: sha },
  };
}
const OPT = { maxChunks: 800 };
const longText = (n: number) =>
  Array.from({ length: n }, (_, i) => `Paragraph ${i}. The Ministry reports progress on scheme ${i} in the year.`).join(
    '\n\n',
  );

Deno.test('a valid question becomes one request whose plan is the worker plan', async () => {
  const r = await nationalQuestion();
  const out = await prepareRecord(r, OPT);
  assertEquals(out.kind, 'request');
  if (out.kind !== 'request') return;
  const again = await prepareSuppliedText(r, { batch: true });
  assertEquals(out.request.payload_sha256, again.payload_sha256);
  assertEquals(out.request.expected, suppliedCommitRows(again.chunks));
  assertEquals(out.item.source_key, r.source_key);
  assertEquals(out.item.payload_sha256, again.payload_sha256);
  assertEquals(out.item.content_sha256, r.text_sha256);
  assertEquals(out.item.chunks, again.chunks.length);
  assertEquals(out.item.est_tokens, again.chunks.reduce((s, c) => s + Math.ceil(c.embedding_input.length / 4), 0));
  assertEquals(out.desk, { tier: 'national', feature: 'Parliamentary Question Database' });
  assertEquals(out.controlCodesRemoved, 0);
});

Deno.test('the batch option is on: servable false travels to the database', async () => {
  const out = await prepareRecord({ ...(await nationalQuestion()), servable: false }, OPT);
  assertEquals(out.kind, 'request');
  if (out.kind === 'request') assertEquals(JSON.parse(out.request.payload).servable, false);
});

const PAD = ' The Ministry reports progress on the scheme in the year.'.repeat(40);

Deno.test('control codes are stripped except tab, LF and CR; hashes, counts and spans follow; the count is reported', async () => {
  const base = await nationalQuestion();
  const dirty = 'Alpha\u0001 beta\u0007\tgam\u0000ma\r\ndelta\u007f\nend\u000b.' + PAD;
  const r = await withText(base, dirty);
  const out = await prepareRecord(r, OPT);
  assertEquals(out.kind, 'request');
  if (out.kind !== 'request') return;
  const clean = 'Alpha beta\tgamma\r\ndelta\nend\n.' + PAD; // a vertical tab is a layout break: it becomes a line break
  const payload = JSON.parse(out.request.payload);
  assertEquals(payload.text, clean);
  assertEquals(payload.text_sha256, await sha256Hex(clean));
  assertEquals(payload.review.text_sha256, await sha256Hex(clean));
  assertEquals(out.item.content_sha256, await sha256Hex(clean));
  assertEquals(out.controlCodesRemoved, 5);
  // The page span was remapped, and its own text with it.
  assertEquals(payload.pages[0].char_to, [...clean].length);
  assertEquals(out.request.pages.length, 1);
  assertEquals(r.text, dirty, 'the input record is not changed');
  assertEquals(payload.original_text_sha256, undefined, 'a question payload stays as it always was');
});

Deno.test('control codes inside a multi-page record keep every span on its words', async () => {
  const base = await nationalQuestion();
  const text = 'One\u0001 two. Three four.\u0002 Five six.' + PAD;
  const sha = await sha256Hex(text);
  const r = {
    ...base,
    text,
    text_sha256: sha,
    n_chars: [...text].length,
    page_split: 'exact',
    pages: [
      { page_number: 1, char_from: 0, char_to: 15, text: text.slice(0, 15) },
      { page_number: 2, char_from: 15, char_to: [...text].length, text: text.slice(15) },
    ],
    review: { ...base.review, text_sha256: sha },
  };
  const out = await prepareRecord(r, OPT);
  assertEquals(out.kind, 'request');
  if (out.kind !== 'request') return;
  const p = JSON.parse(out.request.payload);
  assertEquals(p.text, 'One two. Three four. Five six.' + PAD);
  assertEquals(p.n_chars, 30 + PAD.length);
  assertEquals(p.pages.map((x: Rec) => x.text), ['One two. Three', ' four. Five six.' + PAD]);
});

Deno.test('a bill stripped of control codes carries the pack hash of the original text', async () => {
  const dirtyText = 'BILL NO. 12 OF 2025\u0001 river navigation.' + PAD;
  const r = await bill(dirtyText);
  const out = await prepareRecord(r, OPT);
  assertEquals(out.kind, 'request');
  if (out.kind !== 'request') return;
  const p = JSON.parse(out.request.payload);
  assertEquals(p.original_text_sha256, await sha256Hex(dirtyText));
  assertEquals(p.text_sha256, await sha256Hex(dirtyText.replace('\u0001', '')));
  const clean = await prepareRecord(await bill('BILL NO. 12 OF 2025 river navigation.' + PAD), OPT);
  assertEquals(clean.kind === 'request' && JSON.parse(clean.request.payload).original_text_sha256, undefined);
});

Deno.test('page breaks become line breaks, so the words either side stay apart, and many of them are never a hold', async () => {
  const text = 'Page one ends\u000cPage two\u000b' + 'Short page.\u000c'.repeat(300) + PAD;
  const out = await prepareRecord(await withText(await nationalQuestion(), text), OPT);
  assertEquals(out.kind, 'request');
  if (out.kind !== 'request') return;
  const p = JSON.parse(out.request.payload);
  assertEquals(p.text, 'Page one ends\nPage two\n' + 'Short page.\n'.repeat(300) + PAD);
  assertEquals(p.text_sha256, await sha256Hex(p.text));
  assertEquals(out.controlCodesRemoved, 302, 'replaced codes are counted with removed ones');
});

Deno.test('control codes: more than 10 in any 2,000 characters is a held shifted font, wherever it sits in the text', async () => {
  const codes = (n: number, gap: number) => Array.from({ length: n }, () => '\u0001' + 'x'.repeat(gap)).join('');
  const long = (middle: string) => 'y'.repeat(140_000) + middle + 'y'.repeat(140_000);
  const reason = async (t: string) => {
    const o = await prepareRecord(await withText(await nationalQuestion(), t), { maxChunks: 100_000 });
    return o.kind === 'hold' ? o.hold.reason : 'request';
  };
  // A shifted annexure in a long text: a small share of the whole, but dense where it is.
  assertEquals(await reason(long(codes(1400, 5))), 'control_codes_excess');
  assertEquals(await reason(long(codes(11, 150))), 'control_codes_excess', '11 within 1,661 characters');
  assertEquals(await reason(long(codes(10, 150))), 'request', '10 close together are stray codes');
  // Stray codes spread through a long text are cleaned, however many there are in all.
  assertEquals(await reason(codes(150, 1999)), 'request');
  // A short text with a dense run is held too.
  assertEquals(await reason(codes(260, 6) + PAD), 'control_codes_excess');
});

Deno.test('the original is verified before anything is changed: a record that does not bind its text is never admitted', async () => {
  const base = await withText(await nationalQuestion(), 'Some answer text.\u0001' + PAD);
  const reason = async (r: Rec) => {
    const o = await prepareRecord(r, OPT);
    return o.kind === 'hold' ? [o.hold.reason, o.hold.detail ?? ''] : ['request', ''];
  };
  // Changed text plus one control code: the old rule stripped, rehashed and admitted it.
  assertEquals((await reason({ ...base, text: base.text.replace('Some', 'Other') }))[0], 'prepare_failed');
  assertEquals((await reason({ ...base, text_sha256: 'f'.repeat(64) }))[0], 'prepare_failed');
  assertEquals((await reason({ ...base, content_sha256: 'f'.repeat(64) }))[0], 'prepare_failed');
  assertEquals(
    (await reason({ ...base, review: { ...base.review, text_sha256: 'f'.repeat(64) } }))[0],
    'prepare_failed',
  );
  assertEquals(
    (await reason({ ...base, review: { ...base.review, source_key: 'd'.repeat(40) } }))[0],
    'prepare_failed',
  );
  assertEquals((await reason({ ...base, n_chars: 5 }))[0], 'prepare_failed');
  assertEquals(
    (await reason({ ...base, pages: [{ page_number: 1, char_from: 0, char_to: 99999, text: 'x' }] }))[0],
    'prepare_failed',
  );
  assertEquals(
    (await reason({ ...base, pages: [{ page_number: 1, char_from: 0, char_to: 4, text: 'wrong' }] }))[0],
    'prepare_failed',
  );
  assertEquals(
    (await reason({
      ...base,
      pages: [{ page_number: 1, char_from: 0, char_to: 6 }, { page_number: 1, char_from: 6, char_to: 9 }],
    }))[0],
    'prepare_failed',
  );
  assertEquals((await reason(base))[0], 'request');
});

Deno.test('no text is a hold, including text that is only control codes', async () => {
  const base = await nationalQuestion();
  for (const bad of [undefined, '', '   ', '\u0001\u0002', 5]) {
    const out = await prepareRecord({ ...base, text: bad }, OPT);
    assertEquals(out.kind, 'hold');
    if (out.kind === 'hold') assertEquals(out.hold.reason, 'no_text');
  }
});

Deno.test('a record prepareSuppliedText refuses is held with its message', async () => {
  const base = await nationalQuestion();
  const out = await prepareRecord({ ...base, text_sha256: 'f'.repeat(64) }, OPT);
  assertEquals(out.kind, 'hold');
  if (out.kind !== 'hold') return;
  assertEquals(out.hold.reason, 'prepare_failed');
  assertEquals(out.hold.source_key, base.source_key);
  assert(out.hold.detail?.includes('text_sha256'), out.hold.detail);
  const adapter = await prepareRecord({ ...base, desk_feature: 'No Such Feature' }, OPT);
  assertEquals(adapter.kind === 'hold' && adapter.hold.reason, 'prepare_failed');
  assert(adapter.kind === 'hold' && adapter.hold.detail?.includes('unsupported desk feature'));
  const notRecord = await prepareRecord(null, OPT);
  assertEquals(notRecord.kind === 'hold' && notRecord.hold.reason, 'prepare_failed');
});

Deno.test('over the chunk limit is held, exactly past the limit and not at it', async () => {
  const r = await withText(await nationalQuestion(), longText(60));
  const planned = await prepareSuppliedText(r, { batch: true });
  const n = planned.chunks.length;
  assert(n > 3, `${n} chunks`);
  const atLimit = await prepareRecord(r, { maxChunks: n });
  assertEquals(atLimit.kind, 'request');
  const over = await prepareRecord(r, { maxChunks: n - 1 });
  assertEquals(over.kind, 'hold');
  if (over.kind === 'hold') {
    assertEquals(over.hold.reason, 'over_chunk_limit');
    assertEquals(over.hold.chunks, n);
  }
  // Live Bills run to 3,362 chunks: far past the adapter's 600,000 characters, which is the same over-limit hold.
  const huge = await prepareRecord(await withText(await nationalQuestion(), longText(9000)), OPT);
  assertEquals(huge.kind === 'hold' && huge.hold.reason, 'over_chunk_limit');
});

async function bill(text: string, role = 'as_introduced'): Promise<Rec> {
  const b = await withText(await nationalBill(), text);
  return { ...b, document_role: role };
}

Deno.test('text identity: required and failing is held, required and passing carries the check, not required is not asked', async () => {
  const wrong = await bill('A text about something else entirely, with no number in it.');
  const held = await prepareRecord(wrong, { ...OPT, requireTextIdentity: true });
  assertEquals(held.kind, 'hold');
  if (held.kind === 'hold') {
    assertEquals(held.hold.reason, 'text_identity_failed');
    assertEquals(held.hold.source_key, wrong.source_key);
  }
  const notAsked = await prepareRecord(wrong, OPT);
  assertEquals(notAsked.kind, 'request');
  if (notAsked.kind === 'request') {
    assertEquals(JSON.parse(notAsked.request.payload).review.checks.bill_identity, undefined);
  }

  const right = await bill('THE BILL NO. 12 OF 2025\n\nA Bill to amend the law on river navigation.');
  const ok = await prepareRecord(right, { ...OPT, requireTextIdentity: true });
  assertEquals(ok.kind, 'request');
  if (ok.kind === 'request') assertEquals(JSON.parse(ok.request.payload).review.checks.bill_identity, true);
});

Deno.test('text identity: a role that cannot establish identity passes, and is marked as checked', async () => {
  const syn = await bill('A synopsis that names nothing.', 'synopsis');
  const out = await prepareRecord(syn, { ...OPT, requireTextIdentity: true });
  assertEquals(out.kind, 'request');
  if (out.kind === 'request') assertEquals(JSON.parse(out.request.payload).review.checks.bill_identity, true);
});

Deno.test('text identity is not asked of a question', async () => {
  const out = await prepareRecord(await nationalQuestion(), { ...OPT, requireTextIdentity: true });
  assertEquals(out.kind, 'request');
  if (out.kind === 'request') assertEquals(JSON.parse(out.request.payload).review.checks.bill_identity, undefined);
});

const MAP = {
  bill_number: '12',
  bill_year: '2025',
  bill_name: 'The River Navigation (Amendment) Bill, 2025',
  house: 'Lok Sabha',
};
async function erratum(citation: Rec = { kind: 'bill' }, over: Rec = {}): Promise<Rec> {
  return { ...(await bill('Corrigendum to the Bill.', 'errata')), citation, ...over };
}

Deno.test('a corrigendum without a bill mapping is held; with one it takes that bill identity', async () => {
  const c = await erratum({ kind: 'bill', introduced_on: '2020-01-01' }, { document_key: undefined });
  const held = await prepareRecord(c, OPT);
  assertEquals(held.kind === 'hold' && held.hold.reason, 'corrigendum_unmapped');
  const other = await prepareRecord(c, { ...OPT, corrigenda: { ['z'.repeat(40)]: { ...MAP, bill_number: '1' } } });
  assertEquals(other.kind === 'hold' && other.hold.reason, 'corrigendum_unmapped');

  const mapped = await prepareRecord(c, { ...OPT, corrigenda: { [c.source_key]: MAP } });
  assertEquals(mapped.kind, 'request');
  if (mapped.kind !== 'request') return;
  const p = JSON.parse(mapped.request.payload);
  assertEquals(p.document_key, 'bill:2025:12');
  assertEquals(p.document_role, 'errata');
  assertEquals(p.citation.bill_number, '12');
  assertEquals(p.citation.bill_name, 'The River Navigation (Amendment) Bill, 2025');
  assertEquals(p.citation.introduced_on, undefined, 'the pack date is not the mapped bill date');
});

Deno.test('a corrigendum whose own citation conflicts with its mapping is held, never overwritten', async () => {
  for (
    const [field, value] of [['bill_number', '13'], ['bill_year', '2024'], ['house', 'Rajya Sabha'], [
      'bill_name',
      'The Other Bill, 2025',
    ]]
  ) {
    const c = await erratum({ kind: 'bill', [field]: value });
    const out = await prepareRecord(c, { ...OPT, corrigenda: { [c.source_key]: MAP } });
    assertEquals(out.kind === 'hold' && out.hold.reason, 'corrigendum_conflict', field);
    if (out.kind === 'hold') assert(out.hold.detail?.includes(field), out.hold.detail);
  }
  const key = await erratum({ kind: 'bill' }, { document_key: 'bill:2025:99' });
  const out = await prepareRecord(key, { ...OPT, corrigenda: { [key.source_key]: MAP } });
  assertEquals(out.kind === 'hold' && out.hold.reason, 'corrigendum_conflict');
  // The same values are agreement, not conflict.
  const same = await erratum({ kind: 'bill', ...MAP }, { document_key: 'bill:2025:12' });
  assertEquals((await prepareRecord(same, { ...OPT, corrigenda: { [same.source_key]: MAP } })).kind, 'request');
});

Deno.test('a bill that is not a corrigendum needs no mapping', async () => {
  const out = await prepareRecord(await nationalBill(), { ...OPT, corrigenda: {} });
  assertEquals(out.kind, 'request');
});

Deno.test('a patched record is held as superseded, and its patch loads in its place', async () => {
  const orig = await nationalQuestion();
  const fixed = await withText({ ...orig, title: 'Expanding Khadi Production (corrected)' }, orig.text + ' Corrected.');
  const patches = { [orig.source_key]: fixed };
  const direct = await prepareRecord(orig, { ...OPT, patches });
  assertEquals(direct.kind === 'hold' && direct.hold.reason, 'superseded_by_patch');

  const all = await prepareAll([orig], { ...OPT, patches });
  assertEquals(all.holds.map((h) => h.reason), ['superseded_by_patch']);
  assertEquals(all.requests.length, 1);
  assertEquals(JSON.parse(all.requests[0].request.payload).title, 'Expanding Khadi Production (corrected)');
  assertNotEquals(
    all.requests[0].item.payload_sha256,
    (await prepareSuppliedText(orig, { batch: true })).payload_sha256,
  );
});

Deno.test('prepareAll keeps every record: requests plus holds equal the input, and control codes are totalled', async () => {
  const q = await nationalQuestion();
  const dirty = await withText({
    ...q,
    source_key: 'b'.repeat(40),
    review: { ...q.review, source_key: 'b'.repeat(40) },
  }, 'Text\u0001 with a code.' + PAD);
  const bad = { ...q, source_key: 'c'.repeat(40), text: '' };
  const all = await prepareAll([q, dirty, bad], OPT);
  assertEquals(all.requests.length + all.holds.length, 3);
  assertEquals(all.holds.map((h) => h.source_key), ['c'.repeat(40)]);
  assertEquals(all.controlCodesRemoved, 1);
});

Deno.test('a patch whose key is not in the pack, or whose own key differs, is held by name and loads nothing', async () => {
  const orig = await nationalQuestion();
  const other = { ...orig, source_key: 'e'.repeat(40), review: { ...orig.review, source_key: 'e'.repeat(40) } };
  const stray = await prepareAll([orig], { ...OPT, patches: { ['9'.repeat(40)]: orig } });
  assertEquals(stray.holds.filter((h) => h.reason === 'patch_not_in_pack').map((h) => h.source_key), ['9'.repeat(40)]);
  assertEquals(stray.requests.map((r) => r.source_key), [orig.source_key], 'the pack record still loads');

  const wrong = await prepareAll([orig], { ...OPT, patches: { [orig.source_key]: other } });
  assertEquals(wrong.holds.map((h) => h.reason).sort(), ['patch_key_mismatch', 'superseded_by_patch']);
  assertEquals(wrong.requests.length, 0, 'neither the original nor the mismatched patch loads');
});

Deno.test('a bill_identity value the pack carries is removed; only this runner sets it, and only on a pass', async () => {
  const text = 'A text with no number or title.' + PAD;
  const r = await bill(text);
  const claimed = { ...r, review: { ...r.review, checks: { ...r.review.checks, bill_identity: true } } };
  const notAsked = await prepareRecord(claimed, OPT);
  assertEquals(
    notAsked.kind === 'request' && JSON.parse(notAsked.request.payload).review.checks.bill_identity,
    undefined,
  );
  const failed = await prepareRecord(claimed, { ...OPT, requireTextIdentity: true });
  assertEquals(failed.kind === 'hold' && failed.hold.reason, 'text_identity_failed');
});

Deno.test('maxChunks is required: there is no default', async () => {
  // @ts-expect-error the option is required
  await assertRejects(() => prepareRecord(nationalQuestion(), {}), Error, 'maxChunks');
  // @ts-expect-error the option is required
  await assertRejects(() => prepareAll([], {}), Error, 'maxChunks');
  await assertRejects(() => prepareRecord({}, { maxChunks: 0 }), Error, 'maxChunks');
});

Deno.test('a short text with a few stray codes is cleaned, not held', async () => {
  const text = 'BILL NO. 12 OF 2025\u0001 The River Navigation\u0001 Bill\u0001';
  const r = await withText(await nationalQuestion(), text);
  const p = await prepareRecord(r, { maxChunks: 700 });
  assertEquals(p.kind, 'request');
  assertEquals(p.kind === 'request' && p.controlCodesRemoved, 3);
});

// ---- invalid citation dates (search-only desks; the option is the collection's word) ----

const DATES = { ...OPT, dropInvalidCitationDates: true };
const dated = async (date: unknown): Promise<Rec> => {
  const r: Rec = await nationalQuestion();
  const citation: Rec = { ...r.citation };
  if (date === undefined) delete citation.date;
  else citation.date = date;
  return { ...r, citation };
};

Deno.test('citation dates: an invalid one is dropped from the payload and counted; the text and its hashes do not move', async () => {
  const invalid = [
    '2020-13-45',
    '2020-00-10',
    '2021-02-29',
    '2020-1-1',
    '20200101',
    '2020-02-30',
    'yesterday',
    '0000-00-00',
    5,
    {},
  ];
  for (const date of invalid) {
    const r = await dated(date);
    const out = await prepareRecord(r, DATES);
    assertEquals(out.kind, 'request', String(date));
    if (out.kind !== 'request') continue;
    const payload = JSON.parse(out.request.payload);
    assert(!('date' in payload.citation), `date ${String(date)} was kept`);
    assertEquals(out.citationDatesDropped, 1, String(date));
    // The rest of the citation, the text and every hash are the record's own.
    const { date: _d, ...rest } = r.citation;
    assertEquals(payload.citation, rest);
    assertEquals(payload.text, r.text);
    assertEquals(payload.text_sha256, r.text_sha256);
    assertEquals(out.item.content_sha256, r.text_sha256);
    assertEquals(r.citation.date, date, 'the input record is not changed');
  }
});

Deno.test('citation dates: a calendar date, an empty or missing one is left alone and not counted', async () => {
  for (const date of ['2020-02-29', '1904-01-01', '2062-12-31', '', null, undefined]) {
    const r = await dated(date);
    const out = await prepareRecord(r, DATES);
    assertEquals(out.kind, 'request', String(date));
    if (out.kind !== 'request') continue;
    assertEquals(out.citationDatesDropped, 0, String(date));
    assertEquals(JSON.parse(out.request.payload).citation.date, date === undefined ? undefined : date);
  }
});

Deno.test('citation dates: without the option nothing is dropped or counted, so other collections are as they were', async () => {
  for (const options of [OPT, { ...OPT, dropInvalidCitationDates: false }]) {
    const out = await prepareRecord(await dated('2020-13-45'), options);
    assertEquals(out.kind, 'request');
    if (out.kind !== 'request') continue;
    assertEquals(JSON.parse(out.request.payload).citation.date, '2020-13-45');
    assertEquals(out.citationDatesDropped ?? 0, 0);
  }
});

Deno.test('citation dates: a pack total is carried by prepareAll, and held records are not counted', async () => {
  const good = await dated('2020-13-45');
  const other = { ...(await dated('2021-02-30')), source_key: 'b'.repeat(40), text_sha256: 'x' };
  const clean = await dated('2020-01-01');
  const all = await prepareAll([good, other, { ...clean, source_key: 'c'.repeat(40), review: undefined }], DATES);
  // The second record's text does not bind its hash and the third has no review: both are held, only the first counts.
  assertEquals(all.requests.length, 1);
  assertEquals(all.holds.length, 2);
  assertEquals(all.citationDatesDropped, 1);
  assertEquals((await prepareAll([clean], DATES)).citationDatesDropped, 0);
});
