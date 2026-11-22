// Tests for the OCR text route (F391, scripts/bulk-runner/ocr_route.ts). Records are built by hand in the pack's shape; the
// database is a fake that records what it is asked; the Budget screen is the real one with a fake page check and a fake
// live reader. Nothing here touches a database, the network or a real pack, and no document text of a real pack is used.
import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { createHash } from 'node:crypto';
import { resolve } from 'jsr:@std/path@1';
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import {
  buildOcrRecord,
  DEFAULT_REASON,
  type EnqueueItem,
  type EnqueueResult,
  type OcrCliDeps,
  ocrCommand,
  type OcrDb,
  OcrRecordError,
  parseOcrArgs,
  planOcr,
  PsqlOcrDb,
  type QueueRow,
  readHolds,
  type SelectOptions,
} from './ocr_route.ts';
import { type CliDeps, main } from './cli.ts';
import BUDGET from './screens/budget.json' with { type: 'json' };
import { makeSearchOnlyScreen, parseSearchOnlyConfig } from './screens/search_only.ts';
import { runScreen } from './screen.ts';
import { textBinds } from './screens/bills.ts';
import type { Check, Finding, LiveReader, ScreenContext } from './screen_types.ts';
import type { Rec } from './prepare.ts';

const HOSTS = ['www.indiabudget.gov.in'];
const key = (n: number) => n.toString(16).padStart(40, '0');
const url = (n: number) => `https://www.indiabudget.gov.in/doc/budget_speech/bs${n}.pdf`;
const MARKER = 'HOSTILE-MARKER-4d2c';

/** Pages of control-code text, as the pack has them: spaces and digits replaced by control codes. */
const garbled = (pages: number) =>
  Array.from(
    { length: pages },
    (_, i) => `Rs\u0001${i}\u0002crore\u0003for\u0004the\u0005scheme\u0006in\u0007year\u0001`.repeat(30),
  );

async function packRecord(n: number, texts: string[], over: Rec = {}): Promise<Rec> {
  const text = texts.join('\f');
  let at = 0;
  const pages = texts.map((t, i) => {
    const span = { page_number: i + 1, char_from: at, char_to: at + [...t].length, text: t };
    at = span.char_to + 1;
    return span;
  });
  return {
    schema: 'nter.citation_pack/1.1',
    source_key: key(n),
    desk_tier: 'national',
    desk_feature: BUDGET.desk_feature,
    desk_rows_feature: BUDGET.desk_rows_feature,
    doc_type: 'budget_document',
    title: `Budget document number ${n}`,
    file_name: `bs${n}.pdf`,
    file_url: url(n),
    source_host: 'indiabudget.gov.in',
    licence_class: 'govt_work_permission_required',
    extraction: 'pdf_text',
    text_engine: 'pdftotext -layout (text layer)',
    ocr_quality: null,
    integrity: 'unverified',
    file_bytes: 12345,
    content_sha256: await sha256Hex(text),
    n_chars: [...text].length,
    page_count: texts.length,
    page_split: 'exact',
    pages_with_text: texts.length,
    citation: { kind: 'budget', collection: 'c', issuer: 'Ministry of Finance', source: 'S', licence_note: 'n' },
    links: [],
    pages,
    text,
    document_key_suggested: `budget:${n}`,
    ...over,
  };
}

const row = (r: Rec, over: Partial<QueueRow> = {}): QueueRow => ({
  source_key: String(r.source_key),
  official_url: String(r.file_url),
  expected_pages: Number(r.page_count),
  pack_sha256: String(r.content_sha256),
  status: 'done',
  pages: Number(r.page_count),
  cost_usd: Number(r.page_count) * 0.004,
  error_code: null,
  attempts: 1,
  page_texts: Array.from(
    { length: Number(r.page_count) },
    (_, i) => `Clean words on page ${i + 1} of the budget speech. `.repeat(40),
  ),
  ...over,
});

const opts = (over: Partial<SelectOptions> = {}): SelectOptions => ({
  reason: DEFAULT_REASON,
  limit: 20,
  offset: 0,
  budgetUsd: 2,
  hosts: HOSTS,
  ...over,
});
const hold = (n: number, reasons = [DEFAULT_REASON]) => ({ source_key: key(n), reasons });

// ---- arguments ----

Deno.test('parseOcrArgs: the two commands, their options and their refusals', () => {
  assertEquals(parseOcrArgs(['ocr-enqueue', '--records', 'r', '--holds', 'h', '--limit', '20', '--dry-run']), {
    cmd: 'ocr-enqueue',
    records: 'r',
    holds: 'h',
    reason: 'control_codes_excess',
    limit: 20,
    offset: 0,
    psql: 'psql',
    budgetUsd: 2,
    dryRun: true,
  });
  assertEquals(
    parseOcrArgs(['ocr-collect', '--records', 'r', '--holds', 'h', '--out', 'o', '--offset', '20']).cmd,
    'ocr-collect',
  );
  assertThrows(() => parseOcrArgs(['ocr-collect', '--records', 'r', '--holds', 'h']), Error, '--out is required');
  assertThrows(
    () => parseOcrArgs(['ocr-collect', '--records', 'r', '--holds', 'h', '--out', 'o', '--dry-run']),
    Error,
    '--dry-run',
  );
  assertThrows(
    () => parseOcrArgs(['ocr-enqueue', '--records', 'r', '--holds', 'h', '--out', 'o']),
    Error,
    'unknown option --out',
  );
  assertThrows(() => parseOcrArgs(['ocr-enqueue', '--records', 'r']), Error, '--holds is required');
  assertThrows(
    () => parseOcrArgs(['ocr-enqueue', '--records', 'r', '--holds', 'h', '--limit', 'x']),
    Error,
    'whole number',
  );
  assertThrows(
    () => parseOcrArgs(['ocr-enqueue', '--records', 'r', '--holds', 'h', '--reason', 'No Good!']),
    Error,
    '--reason',
  );
  assertThrows(
    () => parseOcrArgs(['ocr-enqueue', '--records', 'r', '--holds', 'h', '--budget-usd', '2usd']),
    Error,
    'number',
  );
  assertThrows(() => parseOcrArgs(['plan']), Error, 'usage');
});

Deno.test('readHolds: keeps the key and the reasons, never the findings, and refuses a line without them', () => {
  const lines = JSON.stringify({ source_key: key(1), reasons: ['a'], findings: [{ detail: MARKER }] }) + '\n\n';
  assertEquals(readHolds(lines), [{ source_key: key(1), reasons: ['a'] }]);
  assertThrows(() => readHolds('{"source_key":"x"}\n'), Error, 'no source_key or reasons');
  assertThrows(() => readHolds('not json\n'), Error, 'not JSON');
});

// ---- the plan ----

Deno.test('planOcr: selects only records held for that one reason, in key order, with the pages and the estimate', async () => {
  const recs = [
    await packRecord(1, ['a'.repeat(10)]),
    await packRecord(2, ['b', 'c', 'd']),
    await packRecord(3, ['e']),
    await packRecord(4, ['f', 'g']),
  ];
  // The hold file lists the keys out of order: the plan sorts them, so a batch (--limit/--offset) is the same every time.
  const holds = [hold(4), hold(3, [DEFAULT_REASON, 'too_long']), hold(2), hold(1, ['too_long'])];
  const p = planOcr(recs, holds, opts());
  assertEquals(p.ok, true);
  assertEquals(p.items.map((i) => i.source_key), [key(2), key(4)]);
  assertEquals(p.items[0], {
    source_key: key(2),
    official_url: url(2),
    expected_pages: 3,
    pack_sha256: recs[1].content_sha256,
  });
  assertEquals(p.counts, { records: 4, eligible: 2, other_holds: 2, selected: 2, pages: 5 });
  assertEquals(p.ocr_usd, 0.02);
});

Deno.test('planOcr: limit and offset slice the eligible keys; 116 records of 361 pages cost US$1.444', () => {
  const recs: Rec[] = [], holds = [];
  for (let n = 1; n <= 116; n++) {
    recs.push({ source_key: key(n), file_url: url(n), page_count: n <= 106 ? 3 : 4, content_sha256: 'a'.repeat(64) });
    holds.push(hold(n));
  }
  // 106 x 3 + 10 x 4 = 358; two more pages on the last record make the measured 361.
  recs[115].page_count = 7;
  const all = [
    planOcr(recs, holds, opts({ limit: 50 })),
    planOcr(recs, holds, opts({ limit: 50, offset: 50 })),
    planOcr(recs, holds, opts({ limit: 50, offset: 100 })),
  ];
  assertEquals(all.map((p) => p.counts.selected), [50, 50, 16]);
  assertEquals(all.reduce((s, p) => s + p.counts.pages, 0), 361);
  assertEquals(Number(all.reduce((s, p) => s + p.ocr_usd, 0).toFixed(3)), 1.444);
  assertEquals(planOcr(recs, holds, opts({ limit: 20 })).items.length, 20);
});

Deno.test('planOcr: every refusal names its reason and holds the whole plan', async () => {
  const ok = await packRecord(1, ['a']);
  const cases: Array<[string, Rec]> = [
    ['file_url', { ...ok, file_url: 'https://www.rbi.org.in/doc/x.pdf' }],
    ['file_url', { ...ok, file_url: 'https://www.indiabudget.gov.in.evil.example/x.pdf' }],
    ['file_url', { ...ok, file_url: 'http://www.indiabudget.gov.in/x.pdf' }],
    ['file_url', { ...ok, file_url: 'https://user:pw@www.indiabudget.gov.in/x.pdf' }],
    ['file_url', { ...ok, file_url: 'https://www.indiabudget.gov.in:8443/x.pdf' }],
    ['file_url', { ...ok, file_url: 'https://www.indiabudget.gov.in/x.pdf?a=1' }],
    ['file_url', { ...ok, file_url: 'https://www.indiabudget.gov.in/x.html' }],
    ['file_url', { ...ok, file_url: null }],
    ['page_count', { ...ok, page_count: 0 }],
    ['page_count', { ...ok, page_count: 1001 }],
    ['page_count', { ...ok, page_count: 1.5 }],
    ['content_sha256', { ...ok, content_sha256: 'abc' }],
  ];
  for (const [reason, rec] of cases) {
    const p = planOcr([rec], [hold(1)], opts());
    assertEquals(p.ok, false, reason);
    assertEquals(p.items, []);
    assertEquals(p.refused, [{ source_key: key(1), reason }]);
  }
  assertEquals(planOcr([], [hold(1)], opts()).refused, [{ source_key: key(1), reason: 'record_missing' }]);
  assertEquals(planOcr([ok], [hold(1, ['other'])], opts()).refused, [{ source_key: '', reason: 'nothing_selected' }]);
  assertEquals(planOcr([ok], [hold(1)], opts({ budgetUsd: 0.003 })).refused, [{
    source_key: '',
    reason: 'over_budget',
  }]);
  assertThrows(() => planOcr([ok], [hold(1)], opts({ limit: 51 })), Error, 'limit');
  assertThrows(() => planOcr([ok], [hold(1)], opts({ limit: 0 })), Error, 'limit');
  assertThrows(() => planOcr([ok], [hold(1)], opts({ offset: -1 })), Error, 'offset');
  assertThrows(() => planOcr([ok], [hold(1)], opts({ budgetUsd: 0 })), Error, 'budget');
});

Deno.test('planOcr: a link the URL parser would rewrite, or whose extension is not lower-case .pdf, is refused, never queued rewritten', async () => {
  const ok = await packRecord(1, ['a']);
  // Queued as the parser's href these would be paid for and then refused at collect as url_mismatch, and never re-queued.
  for (
    const file_url of [
      'https://www.indiabudget.gov.in/doc/a b.pdf',
      'https://www.indiabudget.gov.in/doc/café.pdf',
      'https://WWW.indiabudget.gov.in/doc/a.pdf',
      'https://www.indiabudget.gov.in/doc/a/../b.pdf',
      'https://www.indiabudget.gov.in/doc/a.PDF',
      'https://www.indiabudget.gov.in/doc/a.Pdf',
    ]
  ) {
    const p = planOcr([{ ...ok, file_url }], [hold(1)], opts());
    assertEquals(p.ok, false, file_url);
    assertEquals(p.items, [], file_url);
    assertEquals(p.refused, [{ source_key: key(1), reason: 'file_url' }], file_url);
  }
  const good = planOcr([ok], [hold(1)], opts());
  assertEquals(good.items[0].official_url, ok.file_url);
});

Deno.test("planOcr: the hosts are the Budget screen configuration's own, one list for the screen and the queue", () => {
  assertEquals(parseSearchOnlyConfig(BUDGET).url_hosts, HOSTS);
});

// ---- the record built from the OCR text ----

Deno.test("buildOcrRecord: the pack's own record with the OCR text, spans and hashes that bind, and the OCR text type", async () => {
  const orig = await packRecord(1, garbled(3));
  const { record, controlCodesRemoved } = await buildOcrRecord(orig, row(orig));
  assertEquals(controlCodesRemoved, 0);
  assertEquals(record.extraction, 'ocr_mistral');
  assertEquals(record.text_engine, 'mistral-ocr-4-1');
  assertEquals(record.page_split, 'exact');
  assertEquals(record.page_count, 3);
  assertEquals(record.pages_with_text, 3);
  assertEquals(record.content_sha256, await sha256Hex(record.text as string));
  assertEquals(record.n_chars, [...(record.text as string)].length);
  // The pack's text is gone; nothing else of the pack's record changed.
  assert(!(record.text as string).includes('\u0001'));
  const { text: _t, pages: _p, content_sha256: _c, n_chars: _n, extraction: _e, text_engine: _te, ...rest } = record;
  const { text: _t2, pages: _p2, content_sha256: _c2, n_chars: _n2, extraction: _e2, text_engine: _te2, ...restOrig } =
    orig;
  assertEquals(rest, restOrig);
  // The screen's own text_binds check accepts the spans, the form feeds and the hashes.
  assertEquals(await textBinds.one!(record, {} as ScreenContext), []);
  // Each page is its span, and pages are joined by form feeds.
  const spans = record.pages as Array<{ char_from: number; char_to: number; text: string }>;
  const cps = [...(record.text as string)];
  for (const s of spans) assertEquals(cps.slice(s.char_from, s.char_to).join(''), s.text);
  assertEquals((record.text as string).split('\f').length, 3);
});

Deno.test('buildOcrRecord: control codes in the OCR text (page breaks too) are removed and counted, never kept inside a page', async () => {
  const orig = await packRecord(1, garbled(2));
  const dirty = row(orig, { page_texts: ['one\u0001 two\fthree\ttab', 'four\u0000\u0007 five'] });
  const { record, controlCodesRemoved } = await buildOcrRecord(orig, dirty);
  assertEquals(controlCodesRemoved, 4);
  assertEquals(record.text, 'one twothree\ttab\ffour five');
  assertEquals(await textBinds.one!(record, {} as ScreenContext), []);
});

Deno.test('buildOcrRecord: an empty OCR page is a page with no text, and counts as such', async () => {
  const orig = await packRecord(1, garbled(3));
  const { record } = await buildOcrRecord(orig, row(orig, { page_texts: ['words', '', '  \n '] }));
  assertEquals(record.pages_with_text, 1);
  assertEquals(await textBinds.one!(record, {} as ScreenContext), []);
});

Deno.test("buildOcrRecord: text that is not this record's own request is refused, whatever it holds", async () => {
  const orig = await packRecord(1, garbled(2));
  const refuse = async (r: QueueRow, code: string) => {
    const e = await assertRejects(() => buildOcrRecord(orig, r), OcrRecordError);
    assertEquals(e.code, code);
  };
  await refuse(row(orig, { source_key: key(2) }), 'row_key_mismatch');
  await refuse(row(orig, { status: 'queued', page_texts: null }), 'not_done');
  await refuse(row(orig, { status: 'failed', page_texts: null }), 'not_done');
  // Even a row that is not done yet carries text, it is not used.
  await refuse(row(orig, { status: 'failed' }), 'not_done');
  await refuse(row(orig, { status: 'running' }), 'not_done');
  await refuse(row(orig, { pack_sha256: 'b'.repeat(64) }), 'pack_hash_mismatch');
  await refuse(row(orig, { official_url: url(9) }), 'url_mismatch');
  await refuse(row(orig, { expected_pages: 3 }), 'page_count_mismatch');
  await refuse(row(orig, { page_texts: ['only one'] }), 'page_count_mismatch');
  await refuse(row(orig, { page_texts: ['a', 5 as unknown as string] }), 'page_text_not_string');
});

// ---- the screen allows the OCR text type, and holds the rest ----

const SETTINGS: Rec = {
  licenceClasses: ['govt_work_permission_required'],
  minCharsPerPage: 600,
  minPagesForDensity: 5,
  requirePageCount: true,
};
const PREPARE = { maxChunks: 700, requireTextIdentity: true, dropInvalidCitationDates: true };
const live: LiveReader = {
  documents: () => Promise.resolve([]),
  identity: () => Promise.resolve({ database: 'fake', server: 'fake', documents: 1, deskRows: 0 }),
  deskRows: () => Promise.reject(new Error('no listing rows')),
};
const passPage: Check = {
  name: 'text_per_page',
  covers: ['completeness'],
  needs: 'pages',
  onlyIfClean: true,
  all: () => Promise.resolve(new Map<string, Finding[]>()),
} as unknown as Check;
const screen = () =>
  makeSearchOnlyScreen(BUDGET, { ...passPage, stats: { scans: [] } } as unknown as Check, {
    configFile: 'scripts/bulk-runner/screens/budget.json',
  });
const screenRun = (records: Rec[]) =>
  runScreen(screen(), records, { live, settings: SETTINGS, prepare: PREPARE } as ScreenContext, {
    packageId: 'National/v1.1/documents/budget.jsonl.gz#' + 'a'.repeat(64),
    fileSha256: 'b'.repeat(64),
    decisionId: 'decision-1',
    rulesSha256: 'c'.repeat(64),
    noLive: false,
    noPages: false,
  });

Deno.test('screen: the pack record with control codes is held for them; the same record with OCR text is eligible', async () => {
  const orig = await packRecord(1, garbled(1));
  const before = await screenRun([orig]);
  assertEquals(before.screened, []);
  assertEquals(before.holds.map((h) => h.reasons), [['control_codes_excess']]);
  const { record } = await buildOcrRecord(orig, row(orig));
  const after = await screenRun([record]);
  assertEquals(after.holds, []);
  assertEquals(after.screened.length, 1);
  assertEquals(after.screened[0].extraction, 'ocr_mistral');
  assertEquals(after.screened[0].completeness_basis, 'page_check');
});

Deno.test('screen: only the allowed text types pass; every other check still holds an OCR record', async () => {
  assertEquals(parseSearchOnlyConfig(BUDGET).extraction_allowed, ['pdf_text', 'ocr_mistral']);
  const orig = await packRecord(1, garbled(1));
  const { record } = await buildOcrRecord(orig, row(orig));
  const reasons = async (r: Rec) => (await screenRun([r])).holds.map((h) => h.reasons);
  assertEquals(await reasons({ ...record, extraction: 'doc' }), [['extraction_not_allowed']]);
  // The pack's own OCR text type (tesseract) is still not allowed on this desk.
  assertEquals(await reasons({ ...record, extraction: 'ocr' }), [['extraction_not_allowed']]);
  assertEquals(await reasons({ ...record, extraction: 'html' }), [['extraction_not_allowed']]);
  assert((await reasons({ ...record, file_url: 'https://www.rbi.org.in/x.pdf' })).length === 1);
  assert((await reasons({ ...record, text: 'tampered' })).flat().includes('text_hash_mismatch'));
  assert((await reasons({ ...record, licence_class: 'gov_open' })).flat().includes('licence_not_admitted'));
  assert((await reasons({ ...record, citation: { kind: 'budget' } })).flat().includes('citation_incomplete'));
});

// ---- the commands ----

class FakeOcrDb implements OcrDb {
  calls: string[] = [];
  enqueued: EnqueueItem[][] = [];
  constructor(
    public rows: QueueRow[] = [],
    public result: (items: EnqueueItem[]) => EnqueueResult = (i) =>
      i.map((x) => ({ source_key: x.source_key, outcome: 'queued' as const })),
  ) {}
  session() {
    this.calls.push('session');
    return Promise.resolve();
  }
  enqueue(items: EnqueueItem[]) {
    this.calls.push('enqueue');
    this.enqueued.push(items);
    return Promise.resolve(this.result(items));
  }
  read(keys: string[]) {
    this.calls.push(`read ${keys.length}`);
    return Promise.resolve(this.rows.filter((r) => keys.includes(r.source_key)));
  }
  status() {
    this.calls.push('status');
    return Promise.resolve({ by_status: { queued: 2 } });
  }
}

const OUT = resolve(Deno.env.get('TMPDIR') ?? '/tmp', 'f391-out-test');

async function world(n = 3, extra: Rec = {}) {
  const recs: Rec[] = [];
  for (let i = 1; i <= n; i++) recs.push(await packRecord(i, garbled(2), extra));
  const body = recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const files = new Map<string, string>([
    ['/in/records.jsonl', body],
    [
      '/in/holds.jsonl',
      recs.map((r) =>
        JSON.stringify({
          source_key: r.source_key,
          set: 'records',
          reasons: [DEFAULT_REASON],
          findings: [{ detail: MARKER }],
        })
      ).join('\n') + '\n',
    ],
    [
      '/in/records.jsonl.receipt.json',
      JSON.stringify({
        pack: 'National/v1.1',
        entry: 'documents/budget_documents.jsonl.gz',
        manifest_sha256: 'd'.repeat(64),
        lines_written: n,
        output_sha256: createHash('sha256').update(body).digest('hex'),
        output_bytes: body.length,
      }),
    ],
  ]);
  const logs: string[] = [];
  const written = new Map<string, string>();
  const made: string[] = [];
  const db = new FakeOcrDb();
  const deps: OcrCliDeps = {
    readText: (p) => files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Deno.errors.NotFound(p)),
    readBytes: (p) =>
      files.has(p)
        ? Promise.resolve(new TextEncoder().encode(files.get(p)!))
        : Promise.reject(new Deno.errors.NotFound(p)),
    writeText: (p, b) => {
      if (written.has(p)) return Promise.reject(new Error('exists'));
      written.set(p, b);
      return Promise.resolve();
    },
    makeDir: (d) => (made.push(d), Promise.resolve()),
    commonDir: () => Promise.resolve(null),
    ocrDb: () => db,
    log: (l) => logs.push(l),
    now: () => 1_700_000_000_000,
  };
  return { recs, files, logs, written, made, db, deps };
}

const enqueueArgs = (
  extra: string[] = [],
) => ['ocr-enqueue', '--records', '/in/records.jsonl', '--holds', '/in/holds.jsonl', ...extra];
const collectArgs = (
  extra: string[] = [],
) => ['ocr-collect', '--records', '/in/records.jsonl', '--holds', '/in/holds.jsonl', '--out', OUT, ...extra];

Deno.test('ocr-enqueue: queues the selected records and prints counts, never a URL or text', async () => {
  const w = await world(3);
  assertEquals(await ocrCommand(enqueueArgs(['--limit', '2']), w.deps), 0);
  assertEquals(w.db.enqueued.length, 1);
  assertEquals(w.db.enqueued[0].map((i) => i.source_key), [key(1), key(2)]);
  assertEquals(w.db.calls, ['session', 'enqueue', 'status']);
  const out = w.logs.join('\n');
  assert(out.includes('selected 2: 4 pages, OCR estimate US$0.016'));
  assert(out.includes('queued 2 of 2'));
  assert(
    !out.includes('indiabudget') && !out.includes(MARKER) && !out.includes('Rs'),
    'no URL and no text in the output',
  );
});

Deno.test('ocr-enqueue --dry-run touches no database', async () => {
  const w = await world(3);
  assertEquals(await ocrCommand(enqueueArgs(['--dry-run']), w.deps), 0);
  assertEquals(w.db.calls, []);
  assert(w.logs.join('\n').includes('dry run: nothing queued'));
});

Deno.test('ocr-enqueue: a plan with a refusal sends nothing; duplicates alone are not a failure; another refusal is', async () => {
  const bad = await world(2, { file_url: 'https://www.rbi.org.in/x.pdf' });
  assertEquals(await ocrCommand(enqueueArgs(), bad.deps), 1);
  assertEquals(bad.db.calls, []);
  const dup = await world(2);
  dup.db.result = (items) =>
    items.map((i) => ({ source_key: i.source_key, outcome: 'refused' as const, reason: 'duplicate' }));
  assertEquals(await ocrCommand(enqueueArgs(), dup.deps), 0);
  assert(dup.logs.join('\n').includes('2 refused: duplicate'));
  const other = await world(2);
  other.db.result = (items) =>
    items.map((i) => ({ source_key: i.source_key, outcome: 'refused' as const, reason: 'host_not_official' }));
  assertEquals(await ocrCommand(enqueueArgs(), other.deps), 1);
  const over = await world(2);
  assertEquals(await ocrCommand(enqueueArgs(['--budget-usd', '0.01']), over.deps), 1);
  assertEquals(over.db.calls, []);
});

Deno.test('ocr-collect: writes a records file in the pack format and a receipt that vouches for it; only done requests', async () => {
  const w = await world(3);
  w.db.rows = [
    row(w.recs[0]),
    row(w.recs[1], { status: 'running', page_texts: null, pages: null, cost_usd: null }),
    row(w.recs[2], { status: 'failed', page_texts: null, error_code: 'mistral_rejected' }),
  ];
  assertEquals(await ocrCommand(collectArgs(), w.deps), 1);
  assertEquals(w.made, [OUT]);
  const recordsPath = `${OUT}/ocr-records.jsonl`;
  assertEquals([...w.written.keys()].sort(), [recordsPath, `${recordsPath}.receipt.json`]);
  const body = w.written.get(recordsPath)!;
  const lines = body.trim().split('\n').map((l) => JSON.parse(l) as Rec);
  assertEquals(lines.length, 1);
  assertEquals(lines[0].source_key, key(1));
  assertEquals(lines[0].extraction, 'ocr_mistral');
  assertEquals(await textBinds.one!(lines[0], {} as ScreenContext), []);
  const receipt = JSON.parse(w.written.get(`${recordsPath}.receipt.json`)!);
  assertEquals(receipt.output_sha256, createHash('sha256').update(body).digest('hex'));
  assertEquals(receipt.lines_written, 1);
  assertEquals(receipt.output_bytes, new TextEncoder().encode(body).length);
  assertEquals(receipt.pack, 'National/v1.1');
  assertEquals(receipt.manifest_sha256, 'd'.repeat(64));
  assertEquals(receipt.derived_from.hold_reason, DEFAULT_REASON);
  assertEquals(receipt.ocr.complete, false);
  assertEquals(receipt.ocr.pages, 2);
  const out = w.logs.join('\n');
  assert(out.includes('done 1, pending 1, failed 1, not queued 0, not built 0'));
  assert(out.includes(`${key(3)} failed: mistral_rejected`));
  assert(!out.includes(MARKER) && !out.includes('Clean words') && !out.includes('indiabudget'));
});

Deno.test('ocr-collect: all done is complete and exits 0; nothing done writes nothing and exits 1', async () => {
  const w = await world(2);
  w.db.rows = w.recs.map((r) => row(r));
  assertEquals(await ocrCommand(collectArgs(), w.deps), 0);
  assertEquals(JSON.parse(w.written.get(`${OUT}/ocr-records.jsonl.receipt.json`)!).ocr.complete, true);
  const none = await world(2);
  assertEquals(await ocrCommand(collectArgs(), none.deps), 1);
  assertEquals(none.written.size, 0);
  assert(none.logs.join('\n').includes('not queued 2'));
});

Deno.test("ocr-collect: a row that is not the record's own request is not built", async () => {
  const w = await world(2);
  w.db.rows = [row(w.recs[0], { pack_sha256: 'e'.repeat(64) }), row(w.recs[1])];
  assertEquals(await ocrCommand(collectArgs(), w.deps), 1);
  assert(w.logs.join('\n').includes(`${key(1)} not built: pack_hash_mismatch`));
  assertEquals(w.written.get(`${OUT}/ocr-records.jsonl`)!.trim().split('\n').length, 1);
});

Deno.test('ocr-collect: refuses a records file its receipt does not vouch for, and an output inside a checkout', async () => {
  const w = await world(2);
  w.db.rows = w.recs.map((r) => row(r));
  w.files.set('/in/records.jsonl', w.files.get('/in/records.jsonl')! + ' ');
  await assertRejects(() => ocrCommand(collectArgs(), w.deps), Error, "not the receipt's output_sha256");
  const w2 = await world(2);
  w2.files.delete('/in/records.jsonl.receipt.json');
  await assertRejects(() => ocrCommand(collectArgs(), w2.deps), Error, 'receipt');
  const w3 = await world(2);
  await assertRejects(
    () =>
      ocrCommand([
        'ocr-collect',
        '--records',
        '/in/records.jsonl',
        '--holds',
        '/in/holds.jsonl',
        '--out',
        `${Deno.cwd()}/out-inside`,
      ], w3.deps),
    Error,
  );
  assertEquals(w3.written.size, 0);
  assertEquals(w3.db.calls, []);
});

Deno.test('ocr-collect: reads the queue ten keys at a time', async () => {
  const w = await world(23);
  await ocrCommand(collectArgs(['--limit', '23']), w.deps);
  assertEquals(w.db.calls.filter((c) => c.startsWith('read')), ['read 10', 'read 10', 'read 3']);
});

// ---- psql and the entry point ----

Deno.test('PsqlOcrDb: connects only as corpus_ingest, and quotes what it sends so no record text can end the literal', async () => {
  const scripts: string[] = [];
  const exec = (who: string, answer = '[]') => (sql: string) => {
    scripts.push(sql);
    return Promise.resolve({
      code: 0,
      stdout: sql.includes('current_user') ? `${who}\n` : answer,
      stderr: '',
      timedOut: false,
    });
  };
  await assertRejects(() => new PsqlOcrDb(exec('postgres')).session(), Error, 'only as corpus_ingest');
  await new PsqlOcrDb(exec('corpus_ingest')).session();
  const db = new PsqlOcrDb(
    exec('corpus_ingest', JSON.stringify({ results: [{ source_key: key(1), outcome: 'queued' }] })),
  );
  const item = {
    source_key: key(1),
    official_url: `${url(1)}$q$;drop table x;--`,
    expected_pages: 1,
    pack_sha256: 'a'.repeat(64),
  };
  assertEquals((await db.enqueue([item]))[0].outcome, 'queued');
  const sent = scripts.at(-1)!;
  assert(sent.includes('public.budget_ocr_enqueue('));
  assert(sent.includes('set statement_timeout'));
  // The literal's tag is not one that occurs in the text.
  const tag = /\$q[0-9a-f]{12}\$/.exec(sent)![0];
  assertEquals(sent.split(tag).length, 3);
  await assertRejects(
    () => new PsqlOcrDb(() => Promise.resolve({ code: 1, stdout: '', stderr: 'boom', timedOut: false })).read([key(1)]),
    Error,
    'psql exited 1',
  );
  await assertRejects(
    () => new PsqlOcrDb(() => Promise.resolve({ code: 0, stdout: '', stderr: '', timedOut: true })).status(),
    Error,
    'no answer',
  );
});

Deno.test('cli main: ocr-enqueue is dispatched to this route', async () => {
  const w = await world(2);
  const deps = { ...w.deps } as unknown as CliDeps;
  assertEquals(await main(enqueueArgs(['--dry-run']), deps), 0);
  assert(w.logs.join('\n').includes('dry run: nothing queued'));
});
