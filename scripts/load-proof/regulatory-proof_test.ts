// The Regulatory proof's own logic: its arguments, its pass rule and the two ways it can be broken. No database.
import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import {
  type Args,
  basisOf,
  BREAK_REASON,
  breakSeen,
  breakVerdict,
  databaseOfUri,
  evaluate,
  type Facts,
  type Held,
  heldChunkRange,
  outAllowed,
  parseArgs,
  parseField,
  partReceipt,
  policyFor,
  REGULATORY,
  REHEARSAL_DB,
  rehearsalCollection,
  type Snap,
  stripBasis,
  withWorkers,
} from './regulatory-proof.ts';
import { readRecordsText } from '../bulk-runner/cli.ts';

const key = (i: number) => i.toString(16).padStart(40, '0');
const snap = (docs: number): Snap => ({ docs, chunks: docs * 3, links: docs, digest: `d${docs}` });

function goodFacts(count = 100): Facts {
  const keys = Array.from({ length: count }, (_, i) => key(i + 1));
  const basis = Object.fromEntries(keys.map((k, i) => [k, i % 2 ? 'page_check' : 'density_only']));
  return {
    expected: count,
    basis,
    maxChunks: 700,
    exitCode: 0,
    stop: null,
    runnerError: null,
    workerError: null,
    ledger: { items: count, admitted: count, existing: 0, refused: 0, planned: 0 },
    refusedReasons: {},
    holds: [],
    precheckReasons: {},
    docs: { present: count, indexed: count, inDesk: count },
    chunks: { stored: count * 50, plannedByLedger: count * 50, inRegulatoryPartition: count * 50 },
    links: { forNew: 0, before: 60, after: 60 },
    stored: { ...basis },
    before: { bills: snap(30), pq: snap(30), regulatory: snap(474), deskRows: 'a'.repeat(32) },
    after: { bills: snap(30), pq: snap(30), regulatory: snap(474), deskRows: 'a'.repeat(32) },
    acceptance: [{ sampled: 50, ok: true, failures: 0 }],
    acceptanceSample: 50,
  };
}

/** The facts of a run in which the runner held back `n` records over the chunk limit: the rest are admitted. */
function heldFacts(n: number, count = 100, maxChunks = 700): Facts {
  const f = goodFacts(count);
  const admitted = count - n;
  f.maxChunks = maxChunks;
  f.holds = Array.from(
    { length: n },
    (_, i) => ({ key: key(i + 1), reason: 'over_chunk_limit', chunks: maxChunks + 10 + i }),
  );
  for (let i = 1; i <= n; i++) delete f.stored[key(i)];
  f.ledger = { items: admitted, admitted, existing: 0, refused: 0, planned: 0 };
  f.docs = { present: admitted, indexed: admitted, inDesk: admitted };
  f.chunks = { stored: admitted * 50, plannedByLedger: admitted * 50, inRegulatoryPartition: admitted * 50 };
  f.acceptance = [{ sampled: Math.min(50, admitted), ok: true, failures: 0 }];
  return f;
}

const failing = (f: Facts) => evaluate(f).filter((c) => !c.ok).map((c) => c.name);

Deno.test('the good facts pass every check', () => {
  assertEquals(failing(goodFacts()), []);
  assert(evaluate(goodFacts()).length >= 12);
});

Deno.test('at 700 chunks, records held over the limit are the designed outcome and the rest must all be admitted', () => {
  assertEquals(failing(heldFacts(4)), []);
  assertEquals(failing(heldFacts(1)), []);
  // Every other record is still held to the full rule.
  const notAdmitted = heldFacts(4);
  notAdmitted.ledger.admitted = 95;
  notAdmitted.ledger.planned = 1;
  assert(failing(notAdmitted).some((n) => /every record not held is admitted/.test(n)));
  const missing = heldFacts(4);
  missing.docs.present = 95;
  assert(failing(missing).some((n) => /every record not held is admitted/.test(n)));
  // A held record that nevertheless left a document, or a basis not stored for an admitted one.
  const leaked = heldFacts(4);
  leaked.stored[key(1)] = 'page_check';
  assert(failing(leaked).some((n) => /completeness_basis is stored/.test(n)));
  const unstored = heldFacts(4);
  unstored.stored[key(50)] = null;
  assert(failing(unstored).some((n) => /completeness_basis is stored/.test(n)));
});

Deno.test('only over_chunk_limit may be held; anything else, or a hold that is not over the limit, fails', () => {
  const other = heldFacts(4);
  other.holds[0].reason = 'prepare_failed';
  assert(failing(other).some((n) => /held back only records over the 700-chunk limit/.test(n)));
  const noText = heldFacts(4);
  noText.holds[2].reason = 'no_text';
  assert(failing(noText).some((n) => /held back only/.test(n)));
  const under = heldFacts(4);
  under.holds[1].chunks = 650;
  assert(failing(under).some((n) => /held back only/.test(n)), 'a hold not over the limit');
  const stranger = heldFacts(4);
  stranger.holds[1].key = key(500);
  assert(failing(stranger).some((n) => /held back only/.test(n)), 'a hold for a record not in the input');
  const twice = heldFacts(4);
  twice.holds[1].key = twice.holds[0].key;
  assert(failing(twice).some((n) => /held back only/.test(n)), 'one record held twice');
  const unnamed = heldFacts(4);
  unnamed.holds[1].key = null;
  assert(failing(unnamed).some((n) => /held back only/.test(n)));
});

Deno.test('at 800 chunks nothing may be held', () => {
  assertEquals(failing(heldFacts(0, 100, 800)), []);
  const f = heldFacts(2, 100, 800);
  assert(failing(f).some((n) => /held none of them back/.test(n)));
});

Deno.test('the held range is numbers only', () => {
  assertEquals(heldChunkRange([]), null);
  const holds: Held[] = [
    { key: key(1), reason: 'over_chunk_limit', chunks: 720 },
    { key: key(2), reason: 'over_chunk_limit', chunks: 910 },
    { key: key(3), reason: 'over_chunk_limit', chunks: null },
  ];
  assertEquals(heldChunkRange(holds), { min: 720, max: 910, unreported: 1 });
});

Deno.test('a failed worker loop or a thrown runner fails a check', () => {
  const w = goodFacts();
  w.workerError = 'psql failed';
  assert(failing(w).some((n) => /worker loop did not fail/.test(n)));
  const r = goodFacts();
  r.runnerError = 'boom';
  assert(failing(r).some((n) => /runner finished/.test(n)));
});

Deno.test('each way the rehearsal can go wrong fails a named check', () => {
  const cases: Array<[string, (f: Facts) => void, RegExp]> = [
    ['runner exit', (f) => (f.exitCode = 1), /runner finished/],
    ['runner stop', (f) => (f.stop = 'precheck_disagreement'), /runner finished/],
    [
      'one record not admitted',
      (f) => ((f.ledger.admitted = 99), (f.ledger.planned = 1)),
      /every record not held is admitted/,
    ],
    [
      'one record held by prepare for another reason',
      (f) => (f.holds = [{ key: key(1), reason: 'prepare_failed', chunks: null }]),
      /held back only/,
    ],
    ['a document missing', (f) => (f.docs.present = 99), /every record not held is admitted/],
    [
      'an existing item',
      (f) => ((f.ledger.existing = 1), (f.ledger.admitted = 99)),
      /every record not held is admitted/,
    ],
    [
      'a refusal in the ledger',
      (f) => ((f.ledger.refused = 1), (f.refusedReasons = { suggested_key_held: 1 })),
      /0 refusals/,
    ],
    ['a refusal foreseen by the dry run', (f) => (f.precheckReasons = { suggested_key_held: 1 }), /0 refusals/],
    ['a document not indexed', (f) => (f.docs.indexed = 99), /Regulatory desk and indexed/],
    ['a document in another desk', (f) => (f.docs.inDesk = 99), /Regulatory desk and indexed/],
    [
      'no chunks stored',
      (f) => ((f.chunks.stored = 0), (f.chunks.plannedByLedger = 0), (f.chunks.inRegulatoryPartition = 0)),
      /document_chunks_regulatory/,
    ],
    ['a chunk in the default partition', (f) => (f.chunks.inRegulatoryPartition -= 1), /document_chunks_regulatory/],
    ['chunks differ from the plan', (f) => (f.chunks.stored += 1), /document_chunks_regulatory/],
    ['a link row for a new document', (f) => (f.links.forNew = 1), /no record_document_links row/],
    ['a link row anywhere', (f) => (f.links.after = 61), /no record_document_links row/],
    ['a basis not stored', (f) => (f.stored[key(3)] = null), /completeness_basis is stored/],
    ['a basis changed', (f) => (f.stored[key(3)] = 'page_check'), /completeness_basis is stored/],
    ['a bad basis in the input', (f) => (f.basis[key(3)] = 'none'), /completeness basis the screen recorded/],
    ['a Bills digest moved', (f) => (f.after.bills = { ...f.after.bills, digest: 'x' }), /Bills documents/],
    ['a question document added', (f) => (f.after.pq = snap(31)), /Parliamentary Question documents/],
    [
      'a live Regulatory chunk changed',
      (f) => (f.after.regulatory = { ...f.after.regulatory, chunks: 1 }),
      /pre-existing Regulatory/,
    ],
    ['no Bills rows to compare', (f) => ((f.before.bills = snap(0)), (f.after.bills = snap(0))), /Bills documents/],
    [
      'no live Regulatory rows to compare',
      (f) => ((f.before.regulatory = snap(0)), (f.after.regulatory = snap(0))),
      /pre-existing Regulatory/,
    ],
    ['a listing row changed', (f) => (f.after.deskRows = 'b'.repeat(32)), /listing rows/],
    ['acceptance failed', (f) => (f.acceptance = [{ sampled: 50, ok: false, failures: 2 }]), /acceptance/],
    ['acceptance on a short sample', (f) => (f.acceptance = [{ sampled: 49, ok: true, failures: 0 }]), /acceptance/],
    ['acceptance on the old 50 when the file asks for 30', (f) => (f.acceptanceSample = 30), /acceptance/],
    ['no acceptance report', (f) => (f.acceptance = []), /acceptance/],
  ];
  for (const [label, mutate, expected] of cases) {
    const f = goodFacts();
    mutate(f);
    const names = failing(f);
    assert(
      names.some((n) => expected.test(n)),
      `${label}: expected a failing check matching ${expected}, got ${JSON.stringify(names)}`,
    );
  }
});

Deno.test('a short input is judged against its own size', () => {
  const f = goodFacts(10);
  f.acceptance = [{ sampled: 10, ok: true, failures: 0 }];
  assertEquals(failing(f), []);
});

Deno.test('arguments: defaults, every option, and the refusals', () => {
  const a: Args = parseArgs([], '/h');
  assertEquals(a.count, 100);
  assertEquals(a.broken, null);
  assertEquals(a.maxChunks, 700);
  assertEquals(parseArgs(['--max-chunks', '800'], '/h').maxChunks, 800);
  assertThrows(() => parseArgs(['--max-chunks', '801'], '/h'), Error, '--max-chunks');
  assertEquals(a.screenDir, '/h/niyantran-eval-cache/reg-next/full/screen-live-d93325ed');
  assertEquals(parseArgs(['--break', 'held-key', '--count', '10'], '/h').broken, 'held-key');
  assertEquals(parseArgs(['--break', 'no-basis'], '/h').broken, 'no-basis');
  assertEquals(parseArgs(['--break', 'held-url'], '/h').broken, 'held-url');
  assertThrows(() => parseArgs(['--break', 'other'], '/h'), Error, '--break must be one of');
  assertThrows(() => parseArgs(['--break'], '/h'), Error, 'bad argument');
  assertThrows(() => parseArgs(['--count', '0'], '/h'), Error, '--count');
  assertThrows(() => parseArgs(['--count', '5', '--count', '6'], '/h'), Error, 'given twice');
  assertThrows(() => parseArgs(['--nope', 'x'], '/h'), Error, 'unknown option');
});

const part = [
  { source_key: key(1), completeness_basis: 'density_only', document_key_suggested: 'reg:a', n: 1 },
  { source_key: key(2), completeness_basis: 'page_check', document_key_suggested: 'reg:b', n: 2 },
].map((r) => JSON.stringify(r)).join('\n') + '\n';

Deno.test('a record field is read by source key, null when absent, an error for an unknown record', () => {
  assertEquals(parseField(part, key(1), 'document_key_suggested'), 'reg:a');
  assertEquals(parseField(part, key(1), 'file_url'), null);
  assertEquals(parseField(part, key(2), 'n'), null);
  assertThrows(() => parseField(part, key(9), 'file_url'), Error, 'no such record');
});

Deno.test('the no-basis break removes one basis, only from that line, and the receipt follows the new bytes', async () => {
  const broken = stripBasis(part, 1);
  const lines = broken.split('\n');
  assertEquals(lines[0], part.split('\n')[0]);
  assertEquals('completeness_basis' in JSON.parse(lines[1]), false);
  assertEquals(JSON.parse(lines[1]).document_key_suggested, 'reg:b');
  assertEquals(Object.keys(basisOf(part)).length, 2);
  assertThrows(() => stripBasis(part, 2), Error, 'no line 2');
  assertThrows(() => stripBasis(broken, 1), Error, 'no completeness_basis');
  const receipt = JSON.parse(await partReceipt(broken, { records: 'r', sha256: 'f'.repeat(64) }));
  assertEquals(receipt.lines_written, 2);
  assertEquals(receipt.source.sha256, 'f'.repeat(64));
  assert(/^[0-9a-f]{64}$/.test(receipt.output_sha256));
  assert(receipt.output_sha256 !== (await partReceipt(part, {}).then((s) => JSON.parse(s).output_sha256)));
});

Deno.test('the rehearsal collection keeps the original and sets a rehearsal budget, ceiling and partition list', () => {
  const original = {
    collection: 'national-regulatory',
    prepare: { maxChunks: 800, requireTextIdentity: true, dropInvalidCitationDates: true },
    limits: {
      usdPerMTokens: 0.02,
      budgetUsd: 10,
      chunkCeiling: 400000,
      diskUsedBytes: 1,
      diskStopBytes: 2,
      partitioned: ['A'],
      chunksNow: { A: 1 } as Record<string, number>,
    },
    acceptance: { sample: 30, requireLinks: true },
    screen: { decisionId: 'x', settings: { licenceClasses: ['govt_material_confirm_counsel'] } },
  };
  const c = rehearsalCollection(original, {
    decisionId: 'rehearsal-1',
    diskUsedBytes: 7,
    maxChunks: 700,
  }) as typeof original;
  assertEquals(c.collection, 'national-regulatory');
  assertEquals(c.prepare.maxChunks, 700);
  assertEquals(c.limits.budgetUsd, 5);
  assertEquals(c.limits.diskUsedBytes, 7);
  assertEquals(c.limits.partitioned, ['A', REGULATORY.feature]);
  assertEquals(c.limits.chunksNow, {});
  assertEquals(c.acceptance, { sample: 30, requireLinks: false }, 'the file own sample size is kept');
  assertEquals(c.screen.decisionId, 'rehearsal-1');
  assertEquals(c.screen.settings, original.screen.settings);
  assertEquals(original.limits.budgetUsd, 10, 'the original is not changed');
});

Deno.test('the policy names the search-only adapter and the spec thresholds', () => {
  const p = policyFor('national-regulatory', 'd') as {
    admitted: Array<Record<string, string>>;
    stop_thresholds: Record<string, number>;
    licence_classes: string[];
    require_page_count: boolean;
  };
  assertEquals(p.admitted, [{
    desk_tier: 'national',
    desk_feature: REGULATORY.feature,
    adapter: 'national_search_only',
  }]);
  assertEquals(p.stop_thresholds.min_decided, 400);
  assertEquals(p.licence_classes, ['govt_material_confirm_counsel']);
  assertEquals(p.require_page_count, true);
});

Deno.test('the database name rule admits rehearsal databases and refuses the load copy and other names', () => {
  for (
    const ok of [
      'niyantran_ingest_load_reg_test',
      'niyantran_ingest_load_reg_base_test',
      'niyantran_ingest_load_x_reg2_test',
    ]
  ) {
    assert(REHEARSAL_DB.test(ok), ok);
  }
  for (
    const bad of [
      'niyantran_ingest_load_test',
      'niyantran_ingest_load_f287_test',
      'niyantran_ingest_load_reg',
      'niyantran_ingest_load_reg_test; drop database x',
      'other_ingest_load_reg_test',
      'niyantran_ingest_load_Reg_test',
      'niyantran_ingest_loadreg_test',
      '',
    ]
  ) {
    assert(!REHEARSAL_DB.test(bad), bad);
  }
});

Deno.test('the database PostgREST serves is read from its URI, and nothing else of the URI is kept', () => {
  assertEquals(
    databaseOfUri('postgres://role:secret@127.0.0.1:5432/niyantran_ingest_load_reg_test'),
    'niyantran_ingest_load_reg_test',
  );
  assertEquals(databaseOfUri('postgresql://r:p@h:5432/d1?sslmode=disable'), 'd1');
  assertEquals(databaseOfUri('not a uri'), null);
  assertEquals(databaseOfUri('postgres://r:p@h:5432/'), null);
});

Deno.test('--out must lie inside the rehearsal folder, dots resolved', () => {
  const root = '/h/niyantran-eval-cache/reg-next/rehearsal';
  assert(outAllowed(`${root}/run-1`, '/h'));
  assert(outAllowed(root, '/h'));
  assert(!outAllowed('/h/niyantran-eval-cache/reg-next/full/x', '/h'));
  assert(!outAllowed('/h/niyantran-eval-cache/load-proof/x', '/h'));
  assert(!outAllowed(`${root}/../full/x`, '/h'));
  assert(!outAllowed(`${root}-other/x`, '/h'));
  assert(!outAllowed('relative/path', '/h'));
});

Deno.test('a break is judged by its reason', () => {
  const refused = { [key(8)]: 'suggested_key_held' };
  assert(breakSeen('held-key', key(8), { refused, holds: [] }).ok);
  assert(!breakSeen('held-key', key(8), { refused: { [key(8)]: 'file_url_held' }, holds: [] }).ok, 'the wrong reason');
  assert(
    !breakSeen('held-key', key(8), { refused: { [key(9)]: 'suggested_key_held' }, holds: [] }).ok,
    'another record',
  );
  assert(!breakSeen('held-key', key(8), { refused: {}, holds: [] }).ok, 'nothing refused');
  assert(breakSeen('held-url', key(8), { refused: { [key(8)]: 'file_url_held' }, holds: [] }).ok);
  assert(!breakSeen('held-url', key(8), { refused, holds: [] }).ok);
  const overLimit: Held = { key: key(1), reason: 'over_chunk_limit', chunks: 720 };
  const noBasis: Held = { key: key(8), reason: 'prepare_failed', chunks: null };
  assert(breakSeen('no-basis', key(8), { refused: {}, holds: [overLimit, noBasis] }).ok, 'beside designed holds');
  assert(!breakSeen('no-basis', key(8), { refused: {}, holds: [overLimit] }).ok, 'no prepare hold');
  assert(!breakSeen('no-basis', key(8), { refused: {}, holds: [noBasis, { ...noBasis, key: key(9) }] }).ok, 'two');
  assert(
    !breakSeen('no-basis', key(8), { refused: {}, holds: [{ ...noBasis, reason: 'no_text' }] }).ok,
    'another reason',
  );
  assert(!breakSeen('no-basis', key(8), { refused: {}, holds: [{ ...noBasis, key: key(9) }] }).ok, 'another record');
  assertEquals(BREAK_REASON['no-basis'], 'prepare_failed');
});

Deno.test('a break is confirmed only when its reason was seen, nothing crashed and an ordinary check failed', () => {
  const seen = { name: 's', ok: true, detail: '' };
  const failed = [{ name: 'c', ok: false, detail: '' }];
  const confirmed = breakVerdict('held-key', { seen, checks: failed, crashed: null });
  assert(confirmed.confirmed && /BREAK CONFIRMED/.test(confirmed.line));
  const crash = breakVerdict('held-key', { seen, checks: failed, crashed: 'the runner threw: x' });
  assert(!crash.confirmed && /BREAK NOT CONFIRMED/.test(crash.line));
  const other = breakVerdict('held-key', { seen: { ...seen, ok: false }, checks: failed, crashed: null });
  assert(!other.confirmed && /intended reason was not seen/.test(other.line));
  const vacuous = breakVerdict('held-url', { seen, checks: [{ name: 'c', ok: true, detail: '' }], crashed: null });
  assert(!vacuous.confirmed && /no ordinary check failed/.test(vacuous.line));
});

Deno.test('a worker loop that fails is recorded, the body is abandoned and the settings are restored', async () => {
  const log: string[] = [];
  const r = await withWorkers({
    setup: () => (log.push('setup'), Promise.resolve()),
    start: async () => {
      await new Promise((res) => setTimeout(res, 5));
      throw new Error('psql failed');
    },
    restore: () => (log.push('restore'), Promise.resolve()),
    body: () => new Promise<number>(() => {}), // never finishes: nothing drains its queue
  });
  assertEquals(r.workerError, 'psql failed');
  assertEquals(r.result, null);
  assertEquals(log, ['setup', 'restore']);
});

Deno.test('the settings are restored when the body throws, when setup throws, and when the loop fails while stopping', async () => {
  let restored = 0;
  const base = {
    setup: () => Promise.resolve(),
    start: async (running: () => boolean) => {
      while (running()) await new Promise((res) => setTimeout(res, 2));
    },
    restore: () => (restored++, Promise.resolve()),
    body: () => Promise.resolve(7),
  };
  const ok = await withWorkers(base);
  assertEquals([ok.result, ok.bodyError, ok.workerError, restored], [7, null, null, 1]);
  const threw = await withWorkers({ ...base, body: () => Promise.reject(new Error('runner broke')) });
  assertEquals([threw.result, threw.bodyError, threw.workerError, restored], [null, 'runner broke', null, 2]);
  await assertRejects(() => withWorkers({ ...base, setup: () => Promise.reject(new Error('no db')) }), Error, 'no db');
  assertEquals(restored, 3);
  const lateFail = await withWorkers({
    ...base,
    start: async (running) => {
      while (running()) await new Promise((res) => setTimeout(res, 2));
      throw new Error('failed while stopping');
    },
  });
  assertEquals([lateFail.result, lateFail.workerError, restored], [7, 'failed while stopping', 4]);
});

Deno.test("the broken-basis part and its rewritten receipt are accepted by the runner's own reader", async () => {
  const source = { records: 'screened.jsonl', sha256: 'a'.repeat(64), from_line: 1, to_line: 2 };
  const broken = stripBasis(part, 1);
  const files = new Map<string, string>([
    ['/p/part-000.jsonl', broken],
    ['/p/part-000.jsonl.receipt.json', await partReceipt(broken, source)],
  ]);
  const read = (p: string) => {
    const t = files.get(p);
    if (t === undefined) throw new Deno.errors.NotFound(p);
    return t;
  };
  const deps = {
    readText: (p: string) => Promise.resolve(read(p)),
    readBytes: (p: string) => Promise.resolve(new TextEncoder().encode(read(p))),
  };
  const r = await readRecordsText('/p/part-000.jsonl', deps);
  assertEquals(r.records.length, 2);
  assertEquals('completeness_basis' in (r.records[1] as object), false);
  // The unrewritten receipt would not do: the reader checks the hash, which is what the rewrite is for.
  files.set('/p/part-000.jsonl.receipt.json', await partReceipt(part, source));
  await assertRejects(() => readRecordsText('/p/part-000.jsonl', deps), Error, 'receipt_mismatch');
});
