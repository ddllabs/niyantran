// Tests for the Bill corrigenda screen (F372). Records are built by hand in the pack's shape (no file link, a citation of
// kind and source only, the bill named by the links); live reads go through a fake LiveReader. No record text is real.
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { sha256Hex } from '../../../supabase/functions/_shared/textNormalise.ts';
import type { Check, Finding, LiveDeskRow, LiveDocument, LiveReader, ScreenContext } from '../screen_types.ts';
import { REVIEW_CHECKS } from '../screen_types.ts';
import { prepareRecord, type Rec } from '../prepare.ts';
import { runScreen } from '../screen.ts';
import { makeBillCorrigendaScreen } from './bill_corrigenda.ts';

const BILLS = 'Bill Passage Probability Index';
const LICENCE = 'gazette_s52_1_q_i_unconfirmed';
const NAME = 'The River Navigation (Amendment) Bill, 2025';
const key = (n: number) => n.toString(16).padStart(40, '0');

type DocQuery = Parameters<LiveReader['documents']>[0];
class FakeLive implements LiveReader {
  docCalls: DocQuery[] = [];
  constructor(public rows: LiveDeskRow[] = [], public docs: LiveDocument[] = []) {}
  identity() {
    return Promise.resolve({ database: 'fake', server: 'fake', documents: 1, deskRows: 1 });
  }
  deskRows(q: { tier: string; feature: string; documentKeys: string[] }) {
    return Promise.resolve(this.rows.filter((r) => q.documentKeys.includes(r.document_key ?? '')));
  }
  documents(q: DocQuery) {
    this.docCalls.push(q);
    return Promise.resolve(
      this.docs.filter((d) =>
        q.sourceKeys.includes(d.source_key ?? '') || (q.contentHashes ?? []).includes(d.content_sha256 ?? '\0')
      ),
    );
  }
}
const liveRow = (n: number, over: Rec = {}, documentKey = `bill:2025:${n}`): LiveDeskRow => ({
  tier: 'national',
  feature: BILLS,
  row_key: `row-${n}`,
  document_key: documentKey,
  row: { house: 'Lok Sabha', bill_name: NAME, date_introduced: '2025-03-04', ...over },
});
const liveDoc = (o: Partial<LiveDocument>): LiveDocument => ({
  id: 'd1',
  source_key: null,
  file_url: null,
  file_name: null,
  desk_feature: BILLS,
  document_key: null,
  house: null,
  document_role: null,
  content_sha256: null,
  ...o,
});
const ctxOf = (live: LiveReader = new FakeLive([1, 2, 3, 4, 5, 6].map((n) => liveRow(n)))): ScreenContext => ({
  live,
  settings: { licenceClasses: [LICENCE] },
});

const link = (n: number, over: Rec = {}): Rec => ({
  tier: 'national',
  feature: BILLS,
  also_feature: 'Parliamentary Question Database',
  row_key: null,
  role: 'corrigendum',
  status: 'Pending',
  document_key: `bill:2025:${n}`,
  bill_number: String(n),
  bill_year: '2025',
  bill_name: NAME,
  house: 'Lok Sabha',
  ...over,
});

/** A pack corrigendum of bill `n`: a text of at least 200 characters, no pages, no page count, no file link. */
async function erratum(n = 1, over: Rec = {}): Promise<Rec> {
  const text = `Corrigendum ${n}. In the Bill, at page 2, line 12, for the words "tenth", read "eleventh". `.repeat(4);
  return {
    schema: 'nter.citation_pack/1.1',
    source_key: key(n),
    desk_tier: 'national',
    desk_feature: BILLS,
    desk_rows_feature: BILLS,
    doc_type: 'bill_corrigendum',
    title: `Corrigendum ${n}`,
    file_name: `corr${n}.doc`,
    file_url: null,
    source_host: 'sansad.in',
    licence_class: LICENCE,
    content_sha256: await sha256Hex(text),
    n_chars: [...text].length,
    page_count: null,
    page_split: 'none',
    pages: [],
    citation: { kind: 'bill_corrigendum', source: 'pack' },
    links: [link(n)],
    text,
    ...over,
  };
}
const withText = async (r: Rec, text: string): Promise<Rec> => ({
  ...r,
  text,
  content_sha256: await sha256Hex(text),
  n_chars: [...text].length,
});

const screen = () => makeBillCorrigendaScreen();

async function runAll(records: Rec[], ctx = ctxOf(), checks?: Check[]) {
  const out = new Map<string, Finding[]>();
  const put = (k: string, fs: Finding[]) => out.set(k, [...(out.get(k) ?? []), ...fs]);
  for (const c of checks ?? screen().checks) {
    if (c.one) { for (const r of records) put(String(r.source_key), await c.one(r, ctx)); }
    if (c.all) { for (const [k, fs] of await c.all(records, ctx)) put(k, fs); }
  }
  return out;
}
const reasons = (m: Map<string, Finding[]>, k: string) => (m.get(k) ?? []).map((f) => f.reason).sort();
const oneReasons = async (name: string, r: Rec, ctx = ctxOf()) => {
  const c = screen().checks.find((x) => x.name === name);
  assert(c?.one, `no per-record check ${name}`);
  return (await c.one(r, ctx)).map((f) => f.reason);
};

Deno.test('definition: its own collection, every review check covered, one-or-all per check, live checks named', () => {
  const s = screen();
  assertEquals(s.collection, 'national-bill-corrigenda');
  assertEquals(s.mappingVersion, 'bill-corrigenda-screen-v1');
  const covered = new Set(s.checks.flatMap((c) => c.covers));
  for (const c of REVIEW_CHECKS) assert(covered.has(c), `${c} not covered`);
  for (const c of s.checks) assert(!!c.one !== !!c.all, `${c.name} must have exactly one of one/all`);
  assertEquals(s.checks.filter((c) => c.needs === 'live').map((c) => c.name).sort(), [
    'already_live',
    'duplicate_text_live',
    'listing_row',
  ]);
  // No page check: a corrigendum has no official file to compare with, and no check here needs the network.
  assertEquals(s.checks.filter((c) => c.needs === 'pages').length, 0);
  assertEquals(s.rulesFiles[0], 'scripts/bulk-runner/screens/bill_corrigenda.ts');
  assert(s.rulesFiles.includes('scripts/bulk-runner/prepare.ts'), 'prepare.ts reads the same links');
  assert(s.rulesFiles.includes('scripts/bulk-runner/screens/bills.ts'));
});

Deno.test('a clean corrigendum of a listed bill passes every check', async () => {
  const r = await erratum(1);
  assertEquals([...(await runAll([r])).values()].flat(), []);
});

Deno.test('the pack-shaped corrigendum is what the Bills screen cannot take: the same record, held there for its type', async () => {
  const { makeBillsScreen } = await import('./bills.ts');
  const r = await erratum(1);
  const found = await makeBillsScreen().checks.find((c) => c.name === 'record_shape')!.one!(r, ctxOf());
  assertEquals(found.map((f) => f.reason), ['bad_shape']);
});

Deno.test('shape: the pack type, the desk, a hex key, and no file link', async () => {
  for (
    const over of [
      { doc_type: 'bill' },
      { doc_type: 'corrigendum' },
      { desk_tier: 'law' },
      { desk_feature: 'Cabinet Decisions' },
      { desk_rows_feature: 'Cabinet Decisions' },
      { source_key: 'xyz' },
      { schema: 'other' },
      { file_url: 'https://sansad.in/getFile/BillsTexts/LSBillTexts/Errata/1.pdf' },
      { file_url: '' },
    ]
  ) {
    assertEquals(await oneReasons('corrigendum_shape', await erratum(1, over)), ['bad_shape'], JSON.stringify(over));
  }
  assertEquals(await oneReasons('corrigendum_shape', await erratum(1)), []);
  // The detail names fields, never text.
  const f = await screen().checks[0].one!(
    await erratum(1, { doc_type: 'bill', file_url: 'https://x.test/a' }),
    ctxOf(),
  );
  assertEquals(f[0].detail, 'doc_type,file_url');
});

Deno.test('identity: the links name one bill; none, a malformed link, or two bills is held by name', async () => {
  assertEquals(await oneReasons('corrigendum_identity', await erratum(1)), []);
  assertEquals(
    await oneReasons('corrigendum_identity', await erratum(1, { links: [link(1), link(1, { also_feature: 'x' })] })),
    [],
  );
  assertEquals(await oneReasons('corrigendum_identity', await erratum(1, { links: [] })), ['corrigendum_unmapped']);
  assertEquals(await oneReasons('corrigendum_identity', await erratum(1, { links: undefined })), [
    'corrigendum_unmapped',
  ]);
  assertEquals(await oneReasons('corrigendum_identity', await erratum(1, { links: ['x'] })), ['corrigendum_unmapped']);
  assertEquals(
    await oneReasons('corrigendum_identity', await erratum(1, { links: [link(1, { bill_name: undefined })] })),
    [
      'corrigendum_unmapped',
    ],
  );
  assertEquals(
    await oneReasons('corrigendum_identity', await erratum(1, { links: [link(1), link(2)] })),
    ['corrigendum_ambiguous'],
  );
  // Two links of one bill that differ in the house are two bills too.
  assertEquals(
    await oneReasons('corrigendum_identity', await erratum(1, { links: [link(1), link(1, { house: 'Rajya Sabha' })] })),
    ['corrigendum_ambiguous'],
  );
});

Deno.test('the bill read from the links is checked like any bill: number, year, house, name, role, key', async () => {
  const bad: [string, Rec][] = [
    ['number', link(1, { bill_number: 'x1' })],
    ['year', link(1, { bill_year: '25' })],
    ['house', link(1, { house: 'Vidhan Sabha' })],
    ['name', link(1, { bill_name: 'Bill' })],
  ];
  for (const [what, l] of bad) {
    assertEquals(
      await oneReasons('citation_complete', await erratum(1, { links: [l] })),
      ['citation_incomplete'],
      what,
    );
  }
  // A link's role is the pack's `corrigendum`; any other role, tier, feature or key disagrees.
  for (
    const l of [
      link(1, { role: 'as_introduced' }),
      link(1, { role: 'synopsis' }),
      link(1, { tier: 'law' }),
      link(1, { feature: 'Cabinet Decisions' }),
      link(1, { document_key: 'bill:2024:1' }),
    ]
  ) {
    assertEquals(
      await oneReasons('links_agree', await erratum(1, { links: [l] })),
      ['link_disagrees'],
      JSON.stringify(l),
    );
  }
  assertEquals(await oneReasons('links_agree', await erratum(1)), []);
});

Deno.test('the listing must hold the bill: its key, house and whole name, as for any bill', async () => {
  const some = (rows: LiveDeskRow[]) => ctxOf(new FakeLive(rows));
  const check = screen().checks.find((c) => c.name === 'listing_row')!;
  const run = async (r: Rec, rows: LiveDeskRow[]) =>
    reasons(await runAll([r], some(rows), [check]), String(r.source_key));
  assertEquals(await run(await erratum(1), [liveRow(1)]), []);
  assertEquals(await run(await erratum(1), []), ['no_live_row']);
  assertEquals(await run(await erratum(1), [liveRow(1, { house: 'Rajya Sabha' })]), ['no_live_row']);
  assertEquals(await run(await erratum(1), [liveRow(1, { bill_name: 'The Coastal Shipping (Reform) Bill, 2025' })]), [
    'listing_name_mismatch',
  ]);
  // The pack gives no date: the listing's date is not compared.
  assertEquals(await run(await erratum(1), [liveRow(1, { date_introduced: '2019-01-01' })]), []);
});

Deno.test('rows of one key, house and name introduced in different sessions are ambiguous (O1)', async () => {
  const check = screen().checks.find((c) => c.name === 'listing_row')!;
  const run = async (rows: LiveDeskRow[]) => {
    const r = await erratum(1);
    return reasons(await runAll([r], ctxOf(new FakeLive(rows)), [check]), String(r.source_key));
  };
  const at = (date: string, n = 1) => liveRow(n, { date_introduced: date });
  assertEquals(await run([at('2025-03-04'), { ...at('2025-03-07'), row_key: 'row-b' }]), []);
  assertEquals(await run([at('2025-03-04'), { ...at('2025-03-08'), row_key: 'row-b' }]), ['bill_key_ambiguous']);
  assertEquals(await run([at('2019-03-04'), { ...at('2025-03-04'), row_key: 'row-b' }]), ['bill_key_ambiguous']);
  // A row with no valid date is not compared, and a row of another house or name is not a matched row.
  assertEquals(await run([at('2025-03-04'), { ...at('not a date'), row_key: 'row-b' }]), []);
  assertEquals(
    await run([at('2025-03-04'), {
      ...liveRow(1, { date_introduced: '2019-01-01', house: 'Rajya Sabha' }),
      row_key: 'row-b',
    }]),
    [],
  );
});

Deno.test('the key the listing uses may be the year closing the name, and it is the one projected', async () => {
  // The link's key is the citation's (2024); the name closes with 2025, and the listing keys the row bill:2025:1.
  const s = screen();
  const ctx = ctxOf(new FakeLive([liveRow(1, {}, 'bill:2025:1')]));
  const r = await erratum(1, { links: [link(1, { bill_year: '2024', document_key: 'bill:2024:1' })] });
  assertEquals(reasons(await runAll([r], ctx, s.checks), String(r.source_key)), []);
  // The listing key is the one that is matched, so it is the one projected (the map listing_row filled).
  assertEquals(s.project!(r).document_key, 'bill:2025:1');
  // Without a listing read there is no certain key here (two are possible), so nothing is guessed.
  assertThrows(() => screen().project!(r), Error, 'listing gave no document key');
  // Links that carry the listing's own key agree too.
  const both = await erratum(1, { links: [link(1, { bill_year: '2024', document_key: 'bill:2025:1' })] });
  assertEquals(reasons(await runAll([both], ctx, screen().checks), String(both.source_key)), []);
  // Neither key: held by the links, and by the listing.
  const none = await erratum(1, { links: [link(1, { bill_year: '2024', document_key: 'bill:2023:1' })] });
  assert(reasons(await runAll([none], ctx, screen().checks), String(none.source_key)).includes('link_disagrees'));
});

Deno.test('completeness: the hash and count bind the text; at least 200 characters; no page spans are needed', async () => {
  const r = await erratum(1);
  assertEquals(await oneReasons('text_binds', r), []);
  assertEquals(await oneReasons('text_binds', { ...r, content_sha256: 'a'.repeat(64) }), ['text_hash_mismatch']);
  assertEquals(await oneReasons('text_binds', { ...r, n_chars: 5 }), ['n_chars_mismatch']);
  assertEquals(await oneReasons('text_binds', { ...r, page_split: 'exact' }), ['page_spans']);
  assertEquals(await oneReasons('text_binds', { ...r, page_split: 'unsure' }), ['page_split', 'page_spans']);
  // A declared count with no spans is still a disagreement, as for every other record.
  assertEquals(await oneReasons('text_binds', { ...r, page_count: 3 }), ['page_count_unsplittable']);
  const short = await withText(r, 'x'.repeat(199));
  assertEquals(await oneReasons('length', short), ['too_short']);
  assertEquals(await oneReasons('length', await withText(r, 'x'.repeat(200))), []);
  // The pack's longest real corrigendum is 11,034 characters; the ceiling keeps a whole bill out (F372 O3).
  assertEquals(await oneReasons('length', await withText(r, 'x'.repeat(20_000))), []);
  assertEquals(await oneReasons('length', await withText(r, 'x'.repeat(20_001))), ['too_long']);
});

Deno.test('rights and sensitivity: the Bills licence class, nothing barred, nothing personal', async () => {
  const r = await erratum(1);
  assertEquals(await oneReasons('licence_admitted', { ...r, licence_class: 'other' }), ['licence_not_admitted']);
  assertEquals(await oneReasons('servable_licence', { ...r, licence_class: 'BARRED_x' }), ['licence_barred']);
  assertEquals(await oneReasons('servable_licence', { ...r, servable: false }), ['not_servable']);
  assertEquals(await oneReasons('licence_admitted', r), []);
});

Deno.test('dedupe: held when the key or the text is already live, or the text repeats in the set', async () => {
  const a = await erratum(1), b = await erratum(2);
  const dup = await withText(b, String(a.text));
  const live = new FakeLive([1, 2].map((n) => liveRow(n)), [
    liveDoc({ source_key: key(1) }),
    liveDoc({ id: 'd2', source_key: key(9), content_sha256: await sha256Hex(String(b.text)) }),
  ]);
  const out = await runAll([a, b], ctxOf(live));
  assertEquals(reasons(out, key(1)), ['already_live']);
  assertEquals(reasons(out, key(2)), ['duplicate_text_live']);
  // No file link is asked of the live read: a source key only.
  assert(live.docCalls.every((q) => q.fileUrls.length === 0), 'a corrigendum has no URL to look up');
  const same = await runAll([a, dup], ctxOf(new FakeLive([1, 2].map((n) => liveRow(n)))));
  assertEquals(reasons(same, key(2)), ['duplicate_text']);
  assertEquals(reasons(same, key(1)), []);
});

Deno.test('a corrigendum is never held for sharing its bill with another document: errata repeat', async () => {
  const a = await erratum(1), b = await erratum(2, { links: [link(1)] });
  assertEquals([...(await runAll([a, b])).values()].flat(), []);
});

Deno.test('project adds the key and the role errata, never changes a field, and throws rather than guess', async () => {
  const s = screen();
  const r = await erratum(1);
  const out = s.project!(r);
  assertEquals([out.document_key, out.document_role], ['bill:2025:1', 'errata']);
  for (const k of Object.keys(r)) assertEquals(out[k], r[k], k);
  assertThrows(() => s.project!({ ...r, links: [] }), Error);
  assertThrows(() => s.project!({ ...r, links: [link(1), link(2)] }), Error);
  assertThrows(() => s.project!({ ...r, document_role: 'synopsis' }), Error, 'already set');
});

Deno.test('end to end: screened, then prepared from its own links as errata, linked to the bill, with no file URL', async () => {
  const records = [await erratum(1), await erratum(2), await erratum(3, { links: [] })];
  const run = {
    packageId: 'National/v1.1/documents/bill_corrigenda.jsonl.gz#' + 'a'.repeat(64),
    fileSha256: 'b'.repeat(64),
    decisionId: 'decision-f372',
    rulesSha256: 'c'.repeat(64),
    noLive: false,
    noPages: false,
  };
  const { screened, holds } = await runScreen(screen(), records, ctxOf(), run);
  assertEquals(screened.map((r) => r.source_key), [key(1), key(2)]);
  assertEquals(holds.map((h) => [h.source_key, h.reasons[0]]), [[key(3), 'corrigendum_unmapped']]);
  assert(!JSON.stringify(holds).includes('Corrigendum'), 'a hold carries record text');
  for (const r of screened) {
    const out = await prepareRecord(r, { maxChunks: 800, requireTextIdentity: true, corrigendaFromLinks: true });
    assertEquals(out.kind, 'request', out.kind === 'hold' ? `${out.hold.reason}: ${out.hold.detail}` : '');
    if (out.kind !== 'request') continue;
    const p = JSON.parse(out.request.payload) as Rec;
    assertEquals([p.document_role, p.doc_type, p.file_url], ['errata', 'bill_corrigendum', undefined]);
    assertEquals(p.document_key, `bill:2025:${Number.parseInt(String(r.source_key).slice(-2), 16)}`);
    assertEquals((p.citation as Rec).house, 'Lok Sabha');
    assertEquals((p.review as Rec).checks, {
      identity: true,
      completeness: true,
      sensitivity: true,
      dedupe: true,
      rights: true,
      bill_identity: true,
    });
  }
});
