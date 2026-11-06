// Bulk runner, T4 (F285): the runner against real PostgREST and the real worker on the load copy, with only the
// embedding provider faked. A pack of bills, each hold and an expected refusal, a runner killed between calls, a resume,
// and a rerun that must cost nothing. Nothing here reaches NTER: openRest refuses a URL that is not local.
//
//   scripts/load-proof/lp.sh bulk-proof.ts --out PATH
//   scripts/load-proof/lp.sh bulk-proof.ts --break <id>    prove a check can fail
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { drain, makeHarness } from './driver.ts';
import { psql, sha256Hex } from './lib.ts';
import { ensurePolicy, FEATURES } from './synth.ts';
import type { BatchStatus, Db, OpenResult, RegisterResponse, RequeueResponse, TextHolder } from '../bulk-runner/db.ts';
import { plan } from '../bulk-runner/plan.ts';
import { prepareAll, type Rec } from '../bulk-runner/prepare.ts';
import { DEFAULT_OPTIONS, run, type RunDeps } from '../bulk-runner/run.ts';

const arg = (flag: string) => {
  const i = Deno.args.indexOf(flag);
  return i >= 0 ? Deno.args[i + 1] : null;
};
const broken = arg('--break');
const out = arg('--out');
const outcomes: Array<{ check: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail = '') {
  outcomes.push({ check: name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

class PostgrestDb implements Db {
  constructor(private c: SupabaseClient) {}
  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.c.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  }
  session() {
    return Promise.resolve(); // corpus_ingest carries these as role settings; a pooled login sets them per session.
  }
  textHolders(p_hashes: string[]) {
    return this.rpc<TextHolder[]>('ingest_text_holders', { p_hashes });
  }
  open(p: Parameters<Db['open']>[0]) {
    return this.rpc<OpenResult>('ingest_batch_open', { p });
  }
  async addItems(p_batch: string, p_items: unknown[]) {
    await this.rpc('ingest_batch_add_items', { p_batch, p_items });
  }
  seal(p_batch: string) {
    return this.rpc<{ state?: string; refused?: string }>('ingest_batch_seal', { p_batch });
  }
  register(p_batch: string, p_documents: unknown[], p_dry_run: boolean, p_all_or_nothing: boolean) {
    return this.rpc<RegisterResponse>('ingest_register_batch', { p_batch, p_documents, p_dry_run, p_all_or_nothing });
  }
  status(p_batch: string, p_source_keys?: string[]) {
    return this.rpc<BatchStatus>('ingest_batch_status', { p_batch, p_source_keys: p_source_keys ?? null });
  }
  async stop(p_batch: string, p_reason: string) {
    await this.rpc('ingest_batch_stop', { p_batch, p_reason });
  }
  requeue(p_batch: string, p_job_ids: string[]) {
    return this.rpc<RequeueResponse>('ingest_batch_requeue', { p_batch, p_job_ids });
  }
}

/** Dies after `calls` real registrations: everything from then on throws, as a dead process answers nothing. */
function killedAfter(db: Db, calls: number): Db {
  let n = 0;
  const dead = () => n >= calls;
  const guard = <T>(f: () => Promise<T>) => dead() ? Promise.reject(new Error('runner killed')) : f();
  return {
    session: (s) => guard(() => db.session(s)),
    textHolders: (h) => guard(() => db.textHolders(h)),
    open: (a) => guard(() => db.open(a)),
    addItems: (b, i) => guard(() => db.addItems(b, i)),
    seal: (b) => guard(() => db.seal(b)),
    register: (b, d, dry, aon) =>
      guard(async () => {
        const r = await db.register(b, d, dry, aon);
        if (!dry) n += 1;
        return r;
      }),
    status: (b, k) => guard(() => db.status(b, k)),
    stop: (b, r) => guard(() => db.stop(b, r)),
    requeue: (b, j) => guard(() => db.requeue(b, j)),
  };
}

const tag = crypto.randomUUID().slice(0, 8);
const ROLE = 'as_introduced';
async function record(n: number, over: Rec = {}, cite: Rec = {}, body = ''): Promise<Rec> {
  const number = String(parseInt((await sha256Hex(`${tag}:${n}`)).slice(0, 7), 16) + 1000);
  const name = `The Runner Proof ${tag} ${n} Measure Bill, 2025`;
  const text = `BILL NO. ${number} OF 2025\n\n${name}\n\nA Bill to prove the runner, number ${n}.${body}`;
  const hash = await sha256Hex(text);
  const source_key = (await sha256Hex(`record:${tag}:${n}`)).slice(0, 40);
  return {
    source_key,
    title: name,
    text,
    text_sha256: hash,
    desk_tier: FEATURES.bills.tier,
    desk_feature: FEATURES.bills.feature,
    file_name: `${number}_2025.pdf`,
    file_url: `https://sansad.in/getFile/BillsTexts/LSBillTexts/Asintroduced/${number}_2025.pdf?source=legislation`,
    document_key: `bill:2025:${number}`,
    document_role: ROLE,
    licence_class: 'gov_open',
    citation: {
      kind: 'bill',
      bill_number: number,
      bill_year: '2025',
      house: 'Lok Sabha',
      bill_name: name,
      status: 'Pending',
      introduced_on: '2025-03-04',
      ...cite,
    },
    review: {
      status: 'eligible',
      source_key,
      text_sha256: hash,
      rules_sha256: 'a'.repeat(64),
      package_id: 'bulk-proof',
      mapping_version: 'bulk-proof-1',
      decision_id: 'bulk-proof-decision',
      checks: { identity: true, completeness: true, sensitivity: true, dedupe: true, rights: true },
    },
    pages: [],
    ...over,
  };
}
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
async function seedRows(records: Rec[]) {
  const rows = records.map((r) => {
    const c = r.citation as Record<string, string>;
    return {
      row_key: `bp-${r.source_key}`,
      document_key: r.document_key,
      record_text: c.bill_name,
      row: {
        bill_number: c.bill_number,
        house: c.house,
        bill_name: c.bill_name,
        date_introduced: '2025-03-04',
        source_url: 'https://sansad.in/rs/legislation',
      },
    };
  });
  await psql(`insert into public.desk_rows(tier,feature,row_key,row,record_text,snapshot_at,document_key)
    select 'national', ${q(FEATURES.bills.feature)}, r->>'row_key', r->'row', r->>'record_text', now(), r->>'document_key'
      from jsonb_array_elements($lp$${JSON.stringify(rows)}$lp$::jsonb) r`);
}

const h = await makeHarness();
const COUNT = 230;
const records: Rec[] = [];
for (let n = 1; n <= COUNT; n++) records.push(await record(n));
const controlled = 5, noRow = 7, tooLong = 9, patched = 11, erratum = 13;
// One record of each kind the prepare step and the admission have to tell apart.
const dirty = await record(controlled, {}, {}, ' Stray\u0001code.');
records[controlled - 1] = dirty;
records[tooLong - 1] = await record(tooLong, {}, {}, Array.from({ length: 900 }, (_, i) => `\n\nClause ${i} of this long bill says something of its own, numbered ${i * 7}.`).join(''));
const original = records[patched - 1];
const patch = await record(patched, {}, {}, ' Patched.');
const bill = records[20];
const billCite = bill.citation as Record<string, string>;
const errata = await record(erratum, {
  document_role: 'errata',
  document_key: 'pending',
  file_url: `https://sansad.in/getFile/BillsTexts/LSBillTexts/Errata/${tag}_1.pdf`,
});
records[erratum - 1] = errata;
await seedRows(records.filter((_r, i) => i !== noRow - 1 && i !== erratum - 1));

const collection = `bulk-proof-${tag}`;
await ensurePolicy(h.svc, collection, undefined, {
  desk_tier: FEATURES.bills.tier,
  desk_feature: FEATURES.bills.feature,
  adapter: 'national_bills',
});
await psql(`update public.ingest_settings set claim_batch = 10, max_running = 10`);

const prepared = await prepareAll(records, {
  maxChunks: 20,
  patches: { [String(original.source_key)]: patch },
  corrigenda: {
    [String(errata.source_key)]: {
      bill_number: billCite.bill_number,
      bill_year: billCite.bill_year,
      bill_name: billCite.bill_name,
      house: billCite.house,
    },
  },
});
const reasons = prepared.holds.map((x) => x.reason).sort();
check('prepare holds the long record and the patched original, by name',
  JSON.stringify(reasons) === JSON.stringify(['over_chunk_limit', 'superseded_by_patch']), JSON.stringify(reasons));
check('control codes were removed and counted', prepared.controlCodesRemoved === 1, String(prepared.controlCodesRemoved));

const limits = {
  usdPerMTokens: 0.02,
  budgetUsd: 1000,
  chunkCeiling: 100_000_000,
  diskUsedBytes: 0,
  diskStopBytes: 1e15,
  partitioned: [FEATURES.bills.feature],
};
const p = await plan(prepared.requests, limits);
if (!p.ok) throw new Error(`plan refused: ${p.stop} ${p.detail}`);
check('one batch of the admissible records', p.batches.length === 1, String(p.batches[0].items_planned));

const receipts = new Map<string, Rec>();
const opts = {
  pace: { firstStepDocs: 100, stepDocs: 100, maxCommitMs: 60_000, drainPollMs: 500, drainMaxMs: 300_000 },
  watch: { pollMs: 500, maxMs: 300_000 },
  backoffMs: 50,
  session: DEFAULT_OPTIONS.session,
};
const allowedRefusals = ['no_desk_row'];
const deps = (db: Db): RunDeps => ({
  db,
  clock: () => performance.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  writeReceipt: (name, body) => {
    receipts.set(name, JSON.parse(body));
    return Promise.resolve();
  },
});
const input = { collection, plan: p, holds: prepared.holds, controlCodesRemoved: prepared.controlCodesRemoved, runnerCommit: 'abcdef1', allowedRefusals };

const runner = await h.rest.client('corpus_ingest');
const real = new PostgrestDb(runner);
const batchId = async () =>
  await psql(`select id from public.ingest_batches where collection = ${q(collection)} order by created_at desc limit 1`);
const pendingOf = (id: string) => async () =>
  Number(await psql(`select count(*) from public.ingest_jobs where batch_id = '${id}' and status in ('queued','running')`));

// 1. The runner dies after its first real call, with the batch part registered.
const killed = await run(input, deps(killedAfter(real, 1)), opts);
check('the killed run ended with a named stop', killed.stop !== null, `${killed.stop?.reason} ${killed.stop?.detail ?? ''}`.slice(0, 300));
const id = await batchId();
const decided = () => psql(`select outcome, count(*) from public.ingest_batch_items where batch_id = '${id}' group by 1 order by 1`);
console.log(`  after the kill: ${(await decided()).replaceAll('\n', ', ')}, state ${await psql(`select state from public.ingest_batches where id = '${id}'`)}`);
check('the batch is left part registered, not stopped',
  await psql(`select state from public.ingest_batches where id = '${id}'`) === 'registering');

// 2. The worker keeps going on what was registered, as it does on a real deployment.
await drain(h, { concurrency: 2, pending: pendingOf(id) });

// 3. A new runner resumes from the ledger, with workers running.
let workers = true;
const background = (async () => {
  while (workers) {
    await drain(h, { concurrency: 2, pending: pendingOf(id) });
    await new Promise((r) => setTimeout(r, 300));
  }
})();
// The break makes the ledger look as if nothing was sent, so the resume sends everything again.
const forgetful: Db = {
  ...Object.fromEntries(['session', 'textHolders', 'open', 'addItems', 'seal', 'register', 'stop', 'requeue'].map((m) => [
    m,
    // deno-lint-ignore no-explicit-any
    (...a: unknown[]) => (real as any)[m](...a),
  ])) as unknown as Db,
  status: async (b, k) => {
    const s = await real.status(b, k);
    return { ...s, items: s.items?.map((i) => ({ ...i, outcome: 'planned' as const })) };
  },
};
const resumed = await run(input, deps(broken === 'bulk:resend' ? forgetful : real), opts);
workers = false;
await background;
check('the resume finished with no stop', resumed.completed && resumed.stop === null, JSON.stringify(resumed.stop));
const resumeCalls = (receipts.get([...receipts.keys()].at(-1)!) as Rec).calls as { dry_run: number; register: number };
check('the resume sent only what was left, in two calls, with no second dry run',
  resumeCalls.register === 2 && resumeCalls.dry_run === 0, JSON.stringify(resumeCalls));

const planned = p.batches[0].items_planned;
const n = async (sql: string) => Number(await psql(sql));
const items = (o: string) => n(`select count(*) from public.ingest_batch_items where batch_id = '${id}' and outcome = '${o}'`);
const admitted = await items('admitted');
if (broken === 'bulk:double') {
  await psql(`insert into public.ingest_batch_items(batch_id,source_key,payload_sha256,content_sha256,chunks,est_tokens,outcome)
    select batch_id, source_key || 'x', payload_sha256, content_sha256, chunks, est_tokens, 'admitted' from public.ingest_batch_items
     where batch_id = '${id}' limit 1`);
}
check('every planned document is decided', await items('planned') === 0, `of ${planned}`);
check('all but the expected refusal were admitted, once each',
  await items('admitted') === planned - 1 && admitted === planned - 1, String(await items('admitted')));
check('the record with no listing row was refused by name, and written nowhere',
  await n(`select count(*) from public.ingest_batch_items where batch_id = '${id}' and reason = 'no_desk_row'`) === 1 &&
    await n(`select count(*) from public.documents where source_key = ${q(String(records[noRow - 1].source_key))}`) === 0);
const docs = `(select document_id from public.ingest_batch_items where batch_id = '${id}' and document_id is not null)`;
check('one job and one indexed document each',
  await n(`select count(*) from public.documents where id in ${docs} and indexed_at is not null`) === planned - 1 &&
    await n(`select count(*) from public.ingest_jobs where batch_id = '${id}' and status = 'succeeded'`) === planned - 1);
check('the patched text loaded and the original never did',
  await n(`select count(*) from public.documents where id in ${docs} and ocr_text like '% Patched.'`) === 1);
const dirtyText = await psql(`select position(chr(1) in ocr_text) from public.documents where source_key = ${q(String(dirty.source_key))}`);
check('the control code never reached the document', dirtyText === '0', dirtyText);
check("the corrigendum sits on its bill, as errata, linked to that bill's row",
  await n(`select count(*) from public.record_document_links l join public.documents d on d.id = l.document_id
    where d.source_key = ${q(String(errata.source_key))} and l.role = 'errata' and l.row_key = ${q(`bp-${bill.source_key}`)}`) === 1);
check('every chunk is in the Bills partition',
  await n(`select count(*) from public.document_chunks where document_id in ${docs} and tableoid::regclass::text <> 'document_chunks_bills'`) === 0);
const name = [...receipts.keys()].at(-1)!;
const receipt = receipts.get(name) as Rec;
check('the receipt carries the holds, and the refusal by reason',
  (receipt.holds as unknown[]).length === 2 &&
    (receipt.counts as { by_reason: Record<string, number> }).by_reason.no_desk_row === 1, JSON.stringify(receipt.counts));

// 4. A rerun of the finished batch sends nothing and buys nothing.
const embeds = await n(`select count(*) from public.model_call_logs where raw_usage->>'batch_id' = '${id}'`);
const again = await run(input, deps(real), opts);
const after = receipts.get(name) as Rec;
const calls = after.calls as { dry_run: number; register: number };
check('a rerun sends nothing', again.completed && calls.register === 0 && calls.dry_run === 0, JSON.stringify(calls));
check('a rerun buys nothing',
  await n(`select count(*) from public.model_call_logs where raw_usage->>'batch_id' = '${id}'`) === embeds, String(embeds));

await psql(`update public.ingest_settings set claim_batch = 1, max_running = 2`);
h.close();
const passed = outcomes.filter((o) => o.ok).length;
console.log(`\n${passed} of ${outcomes.length} checks passed`);
if (out) await Deno.writeTextFile(out, JSON.stringify({ outcomes, receipt, broken }, null, 2));
Deno.exit(passed === outcomes.length ? 0 : 1);
