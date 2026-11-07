// Bulk runner, T4 (F285): the runner against real PostgREST and the real worker on the load copy, with only the
// embedding provider faked. A pack of bills with real page spans, each hold and an expected refusal, a policy with real
// thresholds that requires bill_identity, a runner killed between calls, a resume whose first answer is lost, an embedder
// that fails one document until the runner requeues it, disk and commit readers, and a rerun that must cost nothing
// while the workers keep running. Nothing here reaches NTER: openRest refuses a URL that is not local.
//
//   scripts/load-proof/lp.sh bulk-proof.ts --out PATH
//   scripts/load-proof/lp.sh bulk-proof.ts --break <id>    prove a check can fail; the run must then exit 1
//
// Breaks: bulk:resend (the ledger forgets what was sent), bulk:double (one admitted item becomes refused),
// bulk:noident (the identity check is not asked for), bulk:tamper (the tampered record is made consistent),
// bulk:norequeue (a failed job is never requeued), bulk:disk (the disk stop line is 1 byte),
// bulk:slowcommit (commits read as a day), bulk:buys (the rerun carries one more record, so it opens another batch).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { drain, makeHarness } from './driver.ts';
import { makeFakeEmbedder } from './fake-embed.ts';
import { CONTAINER, DB, psql, sha256Hex, sleep } from './lib.ts';
import { PsqlDb, psqlExec } from '../bulk-runner/psql_db.ts';
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

const plain = (db: Db): Db => ({
  session: (s) => db.session(s),
  textHolders: (h) => db.textHolders(h),
  open: (a) => db.open(a),
  addItems: (b, i) => db.addItems(b, i),
  seal: (b) => db.seal(b),
  register: (b, d, dry, aon) => db.register(b, d, dry, aon),
  status: (b, k) => db.status(b, k),
  stop: (b, r) => db.stop(b, r),
  requeue: (b, j) => db.requeue(b, j),
});

/** The first real call goes through and its answer is lost (F274): the runner must settle it from the ledger. */
function losingFirstAnswer(db: Db, seen: { lost: number }): Db {
  let real = 0;
  return {
    ...plain(db),
    register: async (b, d, dry, aon) => {
      const r = await db.register(b, d, dry, aon);
      if (!dry && ++real === 1) {
        seen.lost += 1;
        throw new Error('register: timeout waiting for the answer (proof)');
      }
      return r;
    },
  };
}

/** Counts requeues, and ends the embedder's failure once the runner has asked for one. */
function countingRequeues(db: Db, seen: { requeues: number }, onRequeue: () => void): Db {
  return {
    ...plain(db),
    requeue: (b, j) => {
      seen.requeues += 1;
      if (broken === 'bulk:norequeue') {
        return Promise.resolve({
          results: j.map((job_id) => ({ job_id, outcome: 'refused' as const, reason: 'proof_break' })),
          state: 'indexing',
          stop_reason: null,
        });
      }
      onRequeue();
      return db.requeue(b, j);
    },
  };
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
  const len = [...text].length, half = Math.floor(len / 2), cps = [...text];
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
    page_split: 'exact',
    pages: [
      { page_number: 1, char_from: 0, char_to: half, text: cps.slice(0, half).join('') },
      { page_number: 2, char_from: half, char_to: len, text: cps.slice(half).join('') },
    ],
    ...over,
  };
}
/** The same record with another text, every hash and span that binds it following. */
async function retext(r: Rec, text: string, keepHash = false): Promise<Rec> {
  const hash = await sha256Hex(text);
  const cps = [...text], half = Math.floor(cps.length / 2);
  const review = r.review as Rec;
  return {
    ...r,
    text,
    text_sha256: keepHash ? r.text_sha256 : hash,
    review: { ...review, text_sha256: keepHash ? review.text_sha256 : hash },
    pages: [
      { page_number: 1, char_from: 0, char_to: half, text: cps.slice(0, half).join('') },
      { page_number: 2, char_from: half, char_to: cps.length, text: cps.slice(half).join('') },
    ],
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
    select 'national', ${
    q(FEATURES.bills.feature)
  }, r->>'row_key', r->'row', r->>'record_text', now(), r->>'document_key'
      from jsonb_array_elements($lp$${JSON.stringify(rows)}$lp$::jsonb) r`);
}

// The embedder fails for one marked document, for every attempt the worker makes, until the runner requeues it.
const MARK = 'REQUEUEMARK';
let failMarked = true;
const embedder = makeFakeEmbedder({
  fail: (inputs) =>
    failMarked && inputs.some((t) => t.includes(MARK)) ? new Error('provider unavailable (proof)') : null,
});
const h = await makeHarness({ embedder });
const COUNT = 230;
const records: Rec[] = [];
for (let n = 1; n <= COUNT; n++) records.push(await record(n));
const controlled = 5,
  noRow = 7,
  tooLong = 9,
  patched = 11,
  erratum = 13,
  marked = 17,
  noIdent = 15,
  excess = 19,
  tampered = 21;
// One record of each kind the prepare step and the admission have to tell apart.
const dirty = await record(controlled, {}, {}, ' Stray\u0001code.');
records[controlled - 1] = dirty;
records[tooLong - 1] = await record(
  tooLong,
  {},
  {},
  Array.from(
    { length: 900 },
    (_, i) => `\n\nClause ${i} of this long bill says something of its own, numbered ${i * 7}.`,
  ).join(''),
);
// A text that names neither its bill's number nor its title; a text most of which is control codes (F281); a record
// whose text no longer matches the hash the pack gave it, with one control code in it (the old runner rehashed it).
records[noIdent - 1] = await retext(
  records[noIdent - 1],
  'A text about something else entirely.' + ' Filler words.'.repeat(60),
);
records[excess - 1] = await retext(
  records[excess - 1],
  `BILL ${records[excess - 1].document_key}` + ' \u0001x'.repeat(300),
);
records[marked - 1] = await record(marked, {}, {}, ` The ${MARK} bill.`);
records[tampered - 1] = await retext(
  records[tampered - 1],
  String(records[tampered - 1].text).replace('prove', 'change') + ' Stray\u0001code.',
  broken !== 'bulk:tamper',
);
const original = records[patched - 1];
const patch = await record(patched, {}, {}, ' Patched.');
const bill = records[20];
const billCite = bill.citation as Record<string, string>;
const errata = await record(erratum, {
  document_role: 'errata',
  document_key: 'pending',
  file_url: `https://sansad.in/getFile/BillsTexts/LSBillTexts/Errata/${tag}_1.pdf`,
});
delete errata.document_key;
for (const f of ['bill_number', 'bill_year', 'bill_name', 'house']) delete (errata.citation as Rec)[f];
records[erratum - 1] = errata;
await seedRows(records.filter((_r, i) => i !== noRow - 1 && i !== erratum - 1));

const collection = `bulk-proof-${tag}`;
// Real thresholds, not 1: a policy that needs the bill_identity check, stops at a tenth refused, and tolerates a few uncertain jobs.
await ensurePolicy(
  h.svc,
  collection,
  // ensurePolicy types its thresholds as numbers; the function takes the per-reason object too (synth.ts is not mine to change).
  {
    refusal_share: 0.1,
    refusal_share_by_reason: { no_desk_row: 0.1 },
    failure_rate: 0.2,
    uncertain_max: 3,
    // The marked document's failure takes its whole embedding call down, up to claim_batch (10) jobs, and the batch order
    // follows hashed keys, so it can come early. Judged from 20 decided, 10 failures before 50 decided tripped the
    // failure rate by chance; from 60 they never can, and the requeue under test still happens.
    min_decided: 60,
  } as unknown as Record<string, number>,
  {
    desk_tier: FEATURES.bills.tier,
    desk_feature: FEATURES.bills.feature,
    adapter: 'national_bills',
    required_checks: ['bill_identity'],
  },
);
await psql(`update public.ingest_settings set claim_batch = 10, max_running = 10`);

const prepOptions = {
  maxChunks: 20,
  requireTextIdentity: broken !== 'bulk:noident',
  patches: { [String(original.source_key)]: patch },
  corrigenda: {
    [String(errata.source_key)]: {
      bill_number: billCite.bill_number,
      bill_year: billCite.bill_year,
      bill_name: billCite.bill_name,
      house: billCite.house,
    },
  },
};
const prepared = await prepareAll(records, prepOptions);
const reasons = prepared.holds.map((x) => x.reason).sort();
check(
  'prepare holds the long record, the patched original, the wrong-text bill, the shifted-font text and the tampered record, by name',
  JSON.stringify(reasons) === JSON.stringify([
    'control_codes_excess',
    'over_chunk_limit',
    'prepare_failed',
    'superseded_by_patch',
    'text_identity_failed',
  ]),
  JSON.stringify(reasons),
);
check(
  'control codes were removed and counted',
  prepared.controlCodesRemoved === 1,
  String(prepared.controlCodesRemoved),
);

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
  pace: {
    firstStepDocs: 100,
    stepDocs: 100,
    maxCommitMs: 60_000,
    drainPollMs: 500,
    drainMaxMs: broken === 'bulk:slowcommit' ? 5_000 : 300_000,
  },
  watch: { pollMs: 500, maxMs: 300_000 },
  backoffMs: 50,
  session: DEFAULT_OPTIONS.session,
  diskStopBytes: broken === 'bulk:disk' ? 1 : 50e9,
};
const recentCommitMs = () => {
  const recent = h.events.commits.slice(-20);
  return recent.length ? Math.max(...recent.map((c) => c.ms)) : null;
};
const allowedRefusals = ['no_desk_row'];
const deps = (db: Db): RunDeps => ({
  db,
  clock: () => performance.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  writeReceipt: (name, body) => {
    if (receipts.has(name)) return Promise.reject(new Error(`receipt ${name} already exists`));
    receipts.set(name, JSON.parse(body));
    return Promise.resolve();
  },
  diskBytes: async () => Number(await psql('select pg_database_size(current_database())')),
  commitMs: () => Promise.resolve(broken === 'bulk:slowcommit' ? 86_400_000 : recentCommitMs()),
  runId: crypto.randomUUID().slice(0, 8),
  // Acceptance is step 10 of the bulk spec and is not built: the proof's one batch is the last, so it is not gated.
  accept: () => Promise.resolve(false),
});
const input = {
  collection,
  plan: p,
  holds: prepared.holds,
  controlCodesRemoved: prepared.controlCodesRemoved,
  runnerCommit: 'abcdef1',
  allowedRefusals,
  maxAllowedRefusalShare: 0.05,
};

// --db psql: the production Db (psql as corpus_ingest; here a local superuser sets the role, as no login exists).
const viaPsql = arg('--db') === 'psql';
const runner = await h.rest.client('corpus_ingest');
const real: Db = viaPsql
  ? new PsqlDb(
    psqlExec(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB], 'set role corpus_ingest;'),
  )
  : new PostgrestDb(runner);
console.log(`runner Db: ${viaPsql ? 'psql as corpus_ingest' : 'PostgREST as corpus_ingest'}`);
const batchId = async () =>
  await psql(
    `select id from public.ingest_batches where collection = ${q(collection)} order by created_at desc limit 1`,
  );
const pendingOf = (id: string) => async () =>
  Number(
    await psql(`select count(*) from public.ingest_jobs where batch_id = '${id}' and status in ('queued','running')`),
  );

// 1. The runner dies after its first real call, with the batch part registered.
const killed = await run(input, deps(killedAfter(real, 1)), opts);
check(
  'the killed run ended with a named stop',
  killed.stop !== null,
  `${killed.stop?.reason} ${killed.stop?.detail ?? ''}`.slice(0, 300),
);
const id = await batchId();
const decided = () =>
  psql(`select outcome, count(*) from public.ingest_batch_items where batch_id = '${id}' group by 1 order by 1`);
console.log(
  `  after the kill: ${(await decided()).replaceAll('\n', ', ')}, state ${await psql(
    `select state from public.ingest_batches where id = '${id}'`,
  )}`,
);
check(
  'the batch is left part registered, not stopped',
  await psql(`select state from public.ingest_batches where id = '${id}'`) === 'registering',
);

// 2. Workers run from here to the end, through the resume and the rerun, as on a real deployment.
let workers = true;
const background = (async () => {
  while (workers) {
    // A stopped batch keeps its queued jobs, so the queue alone never says the proof is over.
    await drain(h, { concurrency: 2, pending: pendingOf(id), shouldStop: () => (workers ? null : 'proof finished') });
    await sleep(300);
  }
})();

// 3. A new runner resumes from the ledger. Its first real answer is lost; the marked document fails to embed until the
// runner requeues it. The break makes the ledger look as if nothing was sent, so the resume sends everything again.
const forgetful: Db = {
  ...plain(real),
  status: async (b, k) => {
    const s = await real.status(b, k);
    return { ...s, items: s.items?.map((i) => ({ ...i, outcome: 'planned' as const })) };
  },
};
const seen = { lost: 0, requeues: 0 };
const resumeDb = countingRequeues(losingFirstAnswer(broken === 'bulk:resend' ? forgetful : real, seen), seen, () => {
  failMarked = false;
});
let diskReads = 0, commitReads = 0;
const resumeDeps = deps(resumeDb);
const diskReader = resumeDeps.diskBytes!, commitReader = resumeDeps.commitMs!;
resumeDeps.diskBytes = () => (diskReads++, diskReader());
resumeDeps.commitMs = () => (commitReads++, commitReader());
const resumed = await run(input, resumeDeps, opts);
const resumeName = [...receipts.keys()].at(-1)!;
check('the resume finished with no stop', resumed.completed && resumed.stop === null, JSON.stringify(resumed.stop));
const resumeCalls = (receipts.get(resumeName) as Rec).calls as { dry_run: number; register: number; retries: number };
check(
  'the resume lost one answer, settled it from the ledger, and sent only what was left, in two calls, with no dry run',
  seen.lost === 1 && resumeCalls.register === 2 && resumeCalls.dry_run === 0 && resumeCalls.retries >= 1,
  JSON.stringify({ ...resumeCalls, ...seen }),
);
check(
  'the failed document was requeued once and indexed',
  seen.requeues === 1 &&
    Number(
        await psql(
          `select requeues from public.ingest_batch_items where batch_id = '${id}' and source_key = ${
            q(String(records[marked - 1].source_key))
          }`,
        ),
      ) === 1,
  String(seen.requeues),
);
check(
  'the disk and commit readers were consulted',
  diskReads > 0 && commitReads > 0,
  `${diskReads} disk, ${commitReads} commit`,
);

const planned = p.batches[0].items_planned;
const n = async (sql: string) => Number(await psql(sql));
const items = (o: string) =>
  n(`select count(*) from public.ingest_batch_items where batch_id = '${id}' and outcome = '${o}'`);
const admitted = await items('admitted');
if (broken === 'bulk:double') {
  // One admitted item becomes refused: the ledger no longer agrees with what was sent.
  await psql(
    `update public.ingest_batch_items set outcome = 'refused', reason = 'bad_payload', document_id = null, job_id = null
      where batch_id = '${id}' and source_key = (select source_key from public.ingest_batch_items
        where batch_id = '${id}' and outcome = 'admitted' order by source_key limit 1)`,
  );
}
check('every planned document is decided', await items('planned') === 0, `of ${planned}`);
check(
  'all but the expected refusal were admitted, once each',
  await items('admitted') === planned - 1 && admitted === planned - 1,
  String(await items('admitted')),
);
check(
  'the record with no listing row was refused by name, and written nowhere',
  await n(`select count(*) from public.ingest_batch_items where batch_id = '${id}' and reason = 'no_desk_row'`) === 1 &&
    await n(`select count(*) from public.documents where source_key = ${q(String(records[noRow - 1].source_key))}`) ===
      0,
);
const docs = `(select document_id from public.ingest_batch_items where batch_id = '${id}' and document_id is not null)`;
check(
  'one job and one indexed document each',
  await n(`select count(*) from public.documents where id in ${docs} and indexed_at is not null`) === planned - 1 &&
    await n(`select count(*) from public.ingest_jobs where batch_id = '${id}' and status = 'succeeded'`) ===
      planned - 1,
);
check(
  'the patched text loaded and the original never did',
  await n(`select count(*) from public.documents where id in ${docs} and ocr_text like '% Patched.'`) === 1,
);
const dirtyText = await psql(
  `select position(chr(1) in ocr_text) from public.documents where source_key = ${q(String(dirty.source_key))}`,
);
check('the control code never reached the document', dirtyText === '0', dirtyText);
check(
  "the corrigendum sits on its bill, as errata, linked to that bill's row",
  await n(`select count(*) from public.record_document_links l join public.documents d on d.id = l.document_id
    where d.source_key = ${q(String(errata.source_key))} and l.role = 'errata' and l.row_key = ${
    q(`bp-${bill.source_key}`)
  }`) === 1,
);
check(
  'every chunk is in the Bills partition',
  await n(
    `select count(*) from public.document_chunks where document_id in ${docs} and tableoid::regclass::text <> 'document_chunks_bills'`,
  ) === 0,
);
const receipt = receipts.get(resumeName) as Rec;
const rc = receipt.counts as { by_reason: Record<string, number>; existing_not_indexed: number; indexed: number };
check(
  'the receipt carries the holds, the refusal by reason, the policy hash, the run id and a complete ledger',
  (receipt.holds as unknown[]).length === 5 && rc.by_reason.no_desk_row === 1 && rc.existing_not_indexed === 0 &&
    rc.indexed === planned - 1 && typeof receipt.policy_sha256 === 'string' && receipt.state === 'indexed' &&
    typeof receipt.run_id === 'string' && Array.isArray(receipt.ocr_route),
  JSON.stringify({ counts: receipt.counts, state: receipt.state, policy: receipt.policy_sha256 }),
);

// 4. A rerun of the finished batch sends nothing and buys nothing. The workers are still running, so anything the
// rerun queued would be embedded before the count is read again.
const logged = () =>
  n(`select count(*) from public.model_call_logs where raw_usage->>'batch_id' in
       (select id::text from public.ingest_batches where collection = ${q(collection)})`);
await sleep(2000);
const embedsBefore = { logged: await logged(), inputs: h.embedder.inputsEmbedded };
let rerunInput = input;
if (broken === 'bulk:buys') {
  // One more record: the rerun's manifest differs, so it opens another batch and queues work.
  const extra = await record(COUNT + 1);
  await seedRows([extra]);
  const more = await prepareAll([...records, extra], prepOptions);
  const bigger = await plan(more.requests, limits);
  if (!bigger.ok) throw new Error(`plan refused: ${bigger.stop}`);
  rerunInput = { ...input, plan: bigger };
}
const again = await run(rerunInput, deps(real), opts);
await sleep(4000);
workers = false;
await background;
const calls = (receipts.get([...receipts.keys()].at(-1)!) as Rec).calls as { dry_run: number; register: number };
check('a rerun sends nothing', again.completed && calls.register === 0 && calls.dry_run === 0, JSON.stringify(calls));
const embedsAfter = { logged: await logged(), inputs: h.embedder.inputsEmbedded };
check(
  'a rerun buys nothing, with the workers running',
  embedsAfter.logged === embedsBefore.logged && embedsAfter.inputs === embedsBefore.inputs,
  JSON.stringify({ before: embedsBefore, after: embedsAfter }),
);
check('no receipt was overwritten: one file for each of the three runs', receipts.size === 3, String(receipts.size));

await psql(`update public.ingest_settings set claim_batch = 1, max_running = 2`);
h.close();
const passed = outcomes.filter((o) => o.ok).length;
console.log(`\n${passed} of ${outcomes.length} checks passed`);
if (out) await Deno.writeTextFile(out, JSON.stringify({ outcomes, receipt, broken }, null, 2));
Deno.exit(passed === outcomes.length ? 0 : 1);
