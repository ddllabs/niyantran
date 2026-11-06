import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
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
const longText = (n: number) =>
  Array.from({ length: n }, (_, i) => `Paragraph ${i}. The Ministry reports progress on scheme ${i} in the year.`).join(
    '\n\n',
  );

Deno.test('a valid question becomes one request whose plan is the worker plan', async () => {
  const r = await nationalQuestion();
  const out = await prepareRecord(r, {});
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
  const out = await prepareRecord({ ...(await nationalQuestion()), servable: false }, {});
  assertEquals(out.kind, 'request');
  if (out.kind === 'request') assertEquals(JSON.parse(out.request.payload).servable, false);
});

Deno.test('control codes are stripped except tab, LF and CR; hashes, counts and spans follow; the count is reported', async () => {
  const base = await nationalQuestion();
  const dirty = 'Alpha\u0001 beta\u0007\tgam\u0000ma\r\ndelta\u007f\nend\u000b.';
  const r = await withText(base, dirty);
  const out = await prepareRecord(r, {});
  assertEquals(out.kind, 'request');
  if (out.kind !== 'request') return;
  const clean = 'Alpha beta\tgamma\r\ndelta\nend.';
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
});

Deno.test('control codes inside a multi-page record keep every span on its words', async () => {
  const base = await nationalQuestion();
  const text = 'One\u0001 two. Three four.\u0002 Five six.';
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
  const out = await prepareRecord(r, {});
  assertEquals(out.kind, 'request');
  if (out.kind !== 'request') return;
  const p = JSON.parse(out.request.payload);
  assertEquals(p.text, 'One two. Three four. Five six.');
  assertEquals(p.n_chars, 30);
  assertEquals(p.pages.map((x: Rec) => x.text), ['One two. Three', ' four. Five six.']);
});

Deno.test('no text is a hold, including text that is only control codes', async () => {
  const base = await nationalQuestion();
  for (const bad of [undefined, '', '   ', '\u0001\u0002', 5]) {
    const out = await prepareRecord({ ...base, text: bad }, {});
    assertEquals(out.kind, 'hold');
    if (out.kind === 'hold') assertEquals(out.hold.reason, 'no_text');
  }
});

Deno.test('a record prepareSuppliedText refuses is held with its message', async () => {
  const base = await nationalQuestion();
  const out = await prepareRecord({ ...base, text_sha256: 'f'.repeat(64) }, {});
  assertEquals(out.kind, 'hold');
  if (out.kind !== 'hold') return;
  assertEquals(out.hold.reason, 'prepare_failed');
  assertEquals(out.hold.source_key, base.source_key);
  assert(out.hold.detail?.includes('text hash mismatch'), out.hold.detail);
  const notRecord = await prepareRecord(null, {});
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
  const huge = await prepareRecord(await withText(await nationalQuestion(), longText(9000)), {});
  assertEquals(huge.kind === 'hold' && huge.hold.reason, 'over_chunk_limit');
});

async function bill(text: string, role = 'as_introduced'): Promise<Rec> {
  const b = await withText(await nationalBill(), text);
  return { ...b, document_role: role };
}

Deno.test('text identity: required and failing is held, required and passing carries the check, not required is not asked', async () => {
  const wrong = await bill('A text about something else entirely, with no number in it.');
  const held = await prepareRecord(wrong, { requireTextIdentity: true });
  assertEquals(held.kind, 'hold');
  if (held.kind === 'hold') {
    assertEquals(held.hold.reason, 'text_identity_failed');
    assertEquals(held.hold.source_key, wrong.source_key);
  }
  const notAsked = await prepareRecord(wrong, {});
  assertEquals(notAsked.kind, 'request');
  if (notAsked.kind === 'request') {
    assertEquals(JSON.parse(notAsked.request.payload).review.checks.bill_identity, undefined);
  }

  const right = await bill('THE BILL NO. 12 OF 2025\n\nA Bill to amend the law on river navigation.');
  const ok = await prepareRecord(right, { requireTextIdentity: true });
  assertEquals(ok.kind, 'request');
  if (ok.kind === 'request') assertEquals(JSON.parse(ok.request.payload).review.checks.bill_identity, true);
});

Deno.test('text identity: a role that cannot establish identity passes, and is marked as checked', async () => {
  const syn = await bill('A synopsis that names nothing.', 'synopsis');
  const out = await prepareRecord(syn, { requireTextIdentity: true });
  assertEquals(out.kind, 'request');
  if (out.kind === 'request') assertEquals(JSON.parse(out.request.payload).review.checks.bill_identity, true);
});

Deno.test('text identity is not asked of a question', async () => {
  const out = await prepareRecord(await nationalQuestion(), { requireTextIdentity: true });
  assertEquals(out.kind, 'request');
  if (out.kind === 'request') assertEquals(JSON.parse(out.request.payload).review.checks.bill_identity, undefined);
});

Deno.test('a corrigendum without a bill mapping is held; with one it takes that bill identity', async () => {
  const c: Rec = {
    ...(await bill('Corrigendum to the Bill.', 'errata')),
    document_key: 'bill:2025:999',
    citation: { kind: 'bill', bill_number: '999', bill_year: '2025', house: 'Lok Sabha' },
  };
  const held = await prepareRecord(c, {});
  assertEquals(held.kind === 'hold' && held.hold.reason, 'corrigendum_unmapped');
  const other = await prepareRecord(c, {
    corrigenda: {
      ['z'.repeat(40)]: { bill_number: '1', bill_year: '2024', bill_name: 'The X Bill, 2024', house: 'Rajya Sabha' },
    },
  });
  assertEquals(other.kind === 'hold' && other.hold.reason, 'corrigendum_unmapped');

  const mapped = await prepareRecord(c, {
    corrigenda: {
      [c.source_key]: {
        bill_number: '12',
        bill_year: '2025',
        bill_name: 'The River Navigation (Amendment) Bill, 2025',
        house: 'Lok Sabha',
      },
    },
  });
  assertEquals(mapped.kind, 'request');
  if (mapped.kind !== 'request') return;
  const p = JSON.parse(mapped.request.payload);
  assertEquals(p.document_key, 'bill:2025:12');
  assertEquals(p.document_role, 'errata');
  assertEquals(p.citation.bill_number, '12');
  assertEquals(p.citation.bill_name, 'The River Navigation (Amendment) Bill, 2025');
});

Deno.test('a bill that is not a corrigendum needs no mapping', async () => {
  const out = await prepareRecord(await nationalBill(), { corrigenda: {} });
  assertEquals(out.kind, 'request');
});

Deno.test('a patched record is held as superseded, and its patch loads in its place', async () => {
  const orig = await nationalQuestion();
  const fixed = await withText({ ...orig, title: 'Expanding Khadi Production (corrected)' }, orig.text + ' Corrected.');
  const patches = { [orig.source_key]: fixed };
  const direct = await prepareRecord(orig, { patches });
  assertEquals(direct.kind === 'hold' && direct.hold.reason, 'superseded_by_patch');

  const all = await prepareAll([orig], { patches });
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
  }, 'Text\u0001 with a code.');
  const bad = { ...q, source_key: 'c'.repeat(40), text: '' };
  const all = await prepareAll([q, dirty, bad], {});
  assertEquals(all.requests.length + all.holds.length, 3);
  assertEquals(all.holds.map((h) => h.source_key), ['c'.repeat(40)]);
  assertEquals(all.controlCodesRemoved, 1);
});
