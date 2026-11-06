import { assert, assertEquals } from 'jsr:@std/assert@1';
import { FakeDb } from './fake_db.ts';
import type { Db, RegisterDocument } from './db.ts';
import { fake, hex, LIMITS, many } from './fixtures.ts';
import { plan } from './plan.ts';
import type { Hold } from './prepare.ts';
import { DEFAULT_OPTIONS, run, type RunDeps, type RunOptions } from './run.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

interface Rig {
  db: FakeDb;
  deps: RunDeps;
  receipts: Map<string, string>;
  sleeps: number[];
  now: () => number;
  /** Jobs the fake worker finishes each time the runner sleeps. */
  worker: { perSleep: number };
}

function rig(db: FakeDb = new FakeDb(), extra: Partial<RunDeps> = {}): Rig {
  let now = 1_000;
  const sleeps: number[] = [];
  const receipts = new Map<string, string>();
  const worker = { perSleep: Infinity };
  return {
    db,
    receipts,
    sleeps,
    worker,
    now: () => now,
    deps: {
      db,
      clock: () => now,
      sleep: (ms: number) => {
        now += ms;
        sleeps.push(ms);
        db.tick(worker.perSleep);
        return Promise.resolve();
      },
      writeReceipt: (name: string, body: string) => {
        receipts.set(name, body);
        return Promise.resolve();
      },
      ...extra,
    },
  };
}

const OPTIONS: Partial<RunOptions> = {};
async function start(
  n: number,
  r: Rig,
  over: {
    holds?: Hold[];
    options?: Partial<RunOptions>;
    requests?: ReturnType<typeof many>;
    allowedRefusals?: string[];
  } = {},
) {
  const p = await plan(over.requests ?? many(n), LIMITS);
  const input = { collection: 'bills', plan: p, holds: over.holds ?? [], runnerCommit: 'abcdef1' };
  return run({ ...input, allowedRefusals: over.allowedRefusals }, r.deps, {
    ...OPTIONS,
    ...over.options,
  });
}
const receipt = (r: Rig): Json => {
  assertEquals(r.receipts.size >= 1, true, 'a receipt was written');
  return JSON.parse([...r.receipts.values()].at(-1) as string);
};
const methods = (db: FakeDb, from = 0) => db.calls.slice(from).map((c) => c.method);
const realRegisters = (db: FakeDb) => db.calls.filter((c) => c.method === 'register' && c.args[2] === false);
const keysOf = (c: { args: unknown[] }) =>
  (c.args[1] as RegisterDocument[]).map((d) => JSON.parse(d.payload).source_key as string);

Deno.test('a clean batch is opened, sealed, checked by dry run, registered in calls of 100, indexed and receipted', async () => {
  const r = rig();
  const res = await start(250, r);
  assertEquals(res.stop, null);
  assertEquals(res.completed, true);
  const { db } = r;
  assertEquals(db.calls[0].method, 'session');
  assertEquals(db.calls[0].args[0], { lock_timeout_ms: 5000, statement_timeout_ms: 60000 });
  const order = methods(db);
  assert(order.indexOf('textHolders') < order.indexOf('register'), 'live holders are read before the dry run');
  assert(order.indexOf('seal') < order.indexOf('register'));
  const regs = db.calls.filter((c) => c.method === 'register');
  assertEquals(regs.map((c) => [c.args[2], (c.args[1] as unknown[]).length]), [
    [true, 100],
    [true, 100],
    [true, 50],
    [false, 100],
    [false, 100],
    [false, 50],
  ]);
  const b = [...db.batches.values()][0];
  assertEquals(b.state, 'indexed');
  const rc = receipt(r);
  assertEquals(rc.manifest_sha256, b.args.manifest_sha256);
  assertEquals(rc.runner_commit, 'abcdef1');
  assertEquals(rc.counts.admitted, 250);
  assertEquals(rc.counts.indexed, 250);
  assertEquals(rc.stop, null);
  assertEquals(rc.calls.register, 3);
  assertEquals(rc.calls.dry_run, 3);
  assert(rc.spend_usd > 0);
  assert(rc.timings.ended_ms >= rc.timings.started_ms);
});

Deno.test('a rerun of a finished batch sends and spends nothing', async () => {
  const r = rig();
  await start(250, r);
  const before = r.db.calls.length;
  const again = rig(r.db);
  const res = await start(250, again);
  assertEquals(res.stop, null);
  assertEquals(res.completed, true);
  const sent = methods(r.db, before);
  for (const m of sent) assert(['session', 'open', 'status'].includes(m), `a rerun called ${m}`);
  assertEquals(realRegisters(r.db).length, 3, 'no new registration');
  assertEquals(r.db.batches.size, 1);
  assertEquals(receipt(again).counts.indexed, 250);
});

Deno.test('holds always reach the receipt, and so do plan refusals', async () => {
  const holds: Hold[] = [
    { source_key: 'h1', reason: 'over_chunk_limit', chunks: 900 },
    { source_key: null, reason: 'prepare_failed', detail: 'record must be an object' },
  ];
  const r = rig();
  await start(5, r, { holds });
  assertEquals(receipt(r).holds, holds);

  const refused = rig();
  const p = await plan(many(3, { chunks: 5 }), { ...LIMITS, chunkCeiling: 4 });
  const res = await run({ collection: 'bills', plan: p, holds, runnerCommit: 'abcdef1' }, refused.deps, {});
  assertEquals(res.completed, false);
  assertEquals(res.stop?.reason, 'over_chunk_ceiling');
  assertEquals(refused.db.calls.length, 0, 'nothing reached the database');
  assertEquals(receipt(refused).holds, holds);
  assertEquals(receipt(refused).stop.reason, 'over_chunk_ceiling');
});

Deno.test('plan-level holds travel with the holds of prepare', async () => {
  const text = hex(7, 'd');
  const p = await plan([fake(1, { text }), fake(2, { text }), fake(3)], { ...LIMITS, dedupe: { [text]: 'k000002' } });
  const r = rig();
  await run(
    { collection: 'bills', plan: p, holds: [{ source_key: 'z', reason: 'no_text' }], runnerCommit: 'abcdef1' },
    r.deps,
    {},
  );
  assertEquals(receipt(r).holds.map((h: Json) => h.reason), ['no_text', 'duplicate_of_keeper']);
});

Deno.test('pre-check: a refusal the runner did not predict stops the batch before anything is registered', async () => {
  const r = rig();
  r.db.refuse.set('k000005', 'bad_payload');
  const res = await start(250, r);
  assertEquals(res.completed, false);
  assertEquals(res.stop?.reason, 'precheck_disagreement');
  assert(res.stop?.detail?.includes('k000005'), res.stop?.detail);
  assertEquals(realRegisters(r.db).length, 0);
  const b = [...r.db.batches.values()][0];
  assertEquals(b.state, 'stopped');
  assertEquals(b.stop_reason, 'precheck_disagreement');
  assertEquals(receipt(r).disagreements[0].source_key, 'k000005');
});

Deno.test('pre-check: a refusal the runner predicted from the live holders is not a disagreement', async () => {
  const r = rig();
  const reqs = many(250);
  r.db.holders.set(reqs[3].item.content_sha256, [{
    content_sha256: reqs[3].item.content_sha256,
    source_key: 'someone-else',
    document_id: 'd1',
  }]);
  const res = await start(250, r, { requests: reqs });
  assertEquals(res.stop, null);
  assertEquals(receipt(r).counts.refused, 1);
  assertEquals(receipt(r).counts.by_reason, { duplicate_text: 1 });
  assertEquals(receipt(r).counts.admitted, 249);
  // The same text under its own key is the document itself, not a conflict.
  const own = rig();
  own.db.holders.set(reqs[3].item.content_sha256, [{
    content_sha256: reqs[3].item.content_sha256,
    source_key: reqs[3].source_key,
    document_id: 'd1',
  }]);
  assertEquals((await start(250, own, { requests: reqs })).stop, null);
});

Deno.test('pre-check: a document the runner expected to be admitted but the dry run would refuse differently is a disagreement', async () => {
  // The holder is there for the dry run but not for the runner's read: the two disagree about duplicate_text.
  const r = rig();
  const reqs = many(10);
  r.db.holders.set(reqs[2].item.content_sha256, [{
    content_sha256: reqs[2].item.content_sha256,
    source_key: 'x',
    document_id: 'd',
  }]);
  const realHolders = r.db.textHolders.bind(r.db);
  r.db.textHolders = async (h: string[]) => (await realHolders(h)).filter((x) => x.source_key !== 'x');
  const res = await start(10, r, { requests: reqs });
  assertEquals(res.stop?.reason, 'precheck_disagreement');
});

Deno.test('a refusal in the real call that the dry run did not show stops the batch', async () => {
  const r = rig();
  r.db.refuseReal.set('k000150', 'house_conflict');
  const res = await start(250, r);
  assertEquals(res.stop?.reason, 'registration_disagreement');
  assertEquals(realRegisters(r.db).length, 2, 'it stopped after the call that showed it');
  assertEquals([...r.db.batches.values()][0].state, 'stopped');
});

Deno.test('an expected refusal does not stop the batch, and is counted by reason', async () => {
  const r = rig();
  r.db.refuse.set('k000005', 'no_desk_row');
  const res = await start(20, r, { allowedRefusals: ['no_desk_row'] });
  assertEquals(res.stop, null);
  assertEquals(receipt(r).counts.by_reason, { no_desk_row: 1 });
  assertEquals(receipt(r).counts.admitted, 19);
});

Deno.test('the dry run binds the real call: an expected refusal that does not recur is a disagreement', async () => {
  const r = rig();
  r.db.refuse.set('k000005', 'no_desk_row');
  const realRegister = r.db.register.bind(r.db);
  r.db.register = (b, d, dry, aon) => {
    if (!dry) r.db.refuse.delete('k000005');
    return realRegister(b, d, dry, aon);
  };
  const res = await start(20, r, { allowedRefusals: ['no_desk_row'] });
  assertEquals(res.stop?.reason, 'registration_disagreement');
});

Deno.test('a refusal outside the allowed list still stops the batch', async () => {
  const r = rig();
  r.db.refuse.set('k000005', 'house_conflict');
  const res = await start(20, r, { allowedRefusals: ['no_desk_row'] });
  assertEquals(res.stop?.reason, 'precheck_disagreement');
});

Deno.test('a resumed batch accepts an expected refusal without a dry run', async () => {
  const r = rig();
  r.db.script.register = ['ok', 'ok', 'ok', 'error', 'error'];
  r.db.refuse.set('k000150', 'no_desk_row');
  const first = await start(250, r, { allowedRefusals: ['no_desk_row'] });
  assertEquals(first.stop?.reason, 'two_failures');
  const b = [...r.db.batches.values()][0];
  b.state = 'registering';
  r.db.script.register = [];
  const res = await start(250, r, { allowedRefusals: ['no_desk_row'] });
  assertEquals(res.stop, null);
});

Deno.test('a lost answer is read from the ledger: nothing is sent twice', async () => {
  const r = rig();
  r.db.script.register = ['ok', 'ok', 'ok', 'ok', 'lost'];
  const res = await start(250, r);
  assertEquals(res.stop, null);
  assertEquals(realRegisters(r.db).length, 3, 'the call whose answer was lost is not sent again');
  assertEquals([...r.db.batches.values()][0].jobs.size, 250);
  assertEquals(receipt(r).counts.admitted, 250);
  assert(r.sleeps.includes(DEFAULT_OPTIONS.backoffMs), 'it backed off before reading');
});

Deno.test('a failed call is re-sent with only the items still planned', async () => {
  const r = rig();
  r.db.script.register = ['ok', 'ok', 'ok', 'ok', 'error'];
  const res = await start(250, r);
  assertEquals(res.stop, null);
  const sent = realRegisters(r.db).map(keysOf);
  assertEquals(sent.map((k) => k.length), [100, 100, 100, 50]);
  assertEquals(sent[1], sent[2], 'the same documents, once the failed call is retried');
  assertEquals(receipt(r).calls.retries, 1);
});

Deno.test('a call that landed in part is re-sent for the rest only', async () => {
  const sentKeys: string[][] = [];
  let hurt = false;
  const db = new class extends FakeDb {
    override async register(batch: string, docs: RegisterDocument[], dry: boolean, aon: boolean) {
      if (!dry) sentKeys.push(docs.map((d) => JSON.parse(d.payload).source_key));
      if (!dry && !hurt && docs.length === 100) {
        // The first 40 documents are decided, then the connection drops: the ledger holds a part of the call.
        hurt = true;
        await super.register(batch, docs.slice(0, 40), dry, aon);
        throw new Error('register: connection reset');
      }
      return super.register(batch, docs, dry, aon);
    }
  }();
  const r = rig(db);
  const res = await start(100, r);
  assertEquals(res.stop, null);
  assertEquals(sentKeys.map((k) => k.length), [100, 60]);
  assertEquals(sentKeys[1][0], 'k000040');
  assertEquals([...db.batches.values()][0].jobs.size, 100);
});

Deno.test('a call whose answer was lost and then settled from the ledger does not count as a failure', async () => {
  const r = rig();
  // dry run x3, then: call 1 lost (it landed), call 2 fails once and succeeds on its retry.
  r.db.script.register = ['ok', 'ok', 'ok', 'lost', 'error', 'ok'];
  // One step, so that no status read between the calls could clear the count for the runner.
  const res = await start(250, r, { options: { pace: { ...DEFAULT_OPTIONS.pace, firstStepDocs: 1000 } } });
  assertEquals(res.stop, null);
  assertEquals(receipt(r).counts.admitted, 250);
});

Deno.test('a killed run resumes from the ledger and sends only what is planned', async () => {
  const r = rig();
  r.db.script.register = ['ok', 'ok', 'ok', 'ok', 'ok', 'error', 'error'];
  const first = await start(250, r);
  assertEquals(first.stop?.reason, 'two_failures');
  const b = [...r.db.batches.values()][0];
  assertEquals(b.state, 'stopped');
  assertEquals(b.stop_reason, 'two_failures');
  // A stopped batch is not driven on by the runner: a developer resumes it.
  const blocked = rig(r.db);
  assertEquals((await start(250, blocked)).stop?.reason, 'batch_stopped');
  assertEquals(
    realRegisters(r.db).length,
    4,
    'two calls, then the failed one and its single retry; nothing more was sent',
  );
  r.db.resume(b.id);
  const before = realRegisters(r.db).length;
  const again = rig(r.db);
  const res = await start(250, again);
  assertEquals(res.stop, null);
  const sent = realRegisters(r.db).slice(before).flatMap(keysOf);
  assertEquals(sent.length, 50);
  assertEquals(sent[0], 'k000200');
  assert(!sent.includes('k000000') && !sent.includes('k000199'), 'the registered calls were not sent again');
  assertEquals(b.state, 'indexed');
  assertEquals(b.jobs.size, 250);
});

Deno.test('two failures in a row stop the batch with a named reason; one does not', async () => {
  const bad = rig();
  bad.db.script.open = ['error', 'error'];
  const res = await start(5, bad);
  assertEquals(res.completed, false);
  assertEquals(res.stop?.reason, 'two_failures');
  assertEquals(bad.db.count('open'), 2, 'one retry, no more');

  const ok = rig();
  ok.db.script.open = ['error'];
  assertEquals((await start(5, ok)).stop, null);

  // Failures that are not in a row never add up.
  const apart = rig();
  apart.db.script.open = ['error'];
  apart.db.script.seal = ['error'];
  apart.db.script.status = ['ok', 'error', 'ok', 'error'];
  assertEquals((await start(5, apart)).stop, null);
});

Deno.test('the second failure stops the batch in the database too, when there is a batch', async () => {
  const r = rig();
  r.db.script.register = ['ok', 'error', 'error'];
  const res = await start(5, r);
  assertEquals(res.stop?.reason, 'two_failures');
  assertEquals([...r.db.batches.values()][0].state, 'stopped');
  assertEquals(receipt(r).db_stopped, true);
  assertEquals(receipt(r).stop.reason, 'two_failures');
});

Deno.test('an error that is not an Error is still a named stop, never a throw', async () => {
  const db = new FakeDb();
  db.open = () => Promise.reject('boom');
  const r = rig(db);
  const res = await start(5, r);
  assertEquals(res.stop?.reason, 'two_failures');
  assert(res.stop?.detail?.includes('boom'));
});

Deno.test('open refused, seal refused and a stopped batch are named stops', async () => {
  const a = rig();
  a.db.openRefusal = 'no_collection_policy';
  const ra = await start(5, a);
  assertEquals(ra.stop?.reason, 'open_refused');
  assertEquals(ra.stop?.detail, 'no_collection_policy');
  assertEquals(receipt(a).stop.reason, 'open_refused');

  const s = rig();
  s.db.sealRefusal = true;
  const rs = await start(5, s);
  assertEquals(rs.stop?.reason, 'seal_refused');
  assertEquals(rs.stop?.detail, 'manifest_hash_mismatch');
});

Deno.test('pacing: the next step starts only when the queue has drained', async () => {
  const queued: number[] = [];
  const db = new class extends FakeDb {
    override register(batch: string, docs: RegisterDocument[], dry: boolean, aon: boolean) {
      if (!dry) {
        queued.push(
          [...this.batches.values()].flatMap((b) => [...b.jobs.values()]).filter((j) => j.status === 'queued').length,
        );
      }
      return super.register(batch, docs, dry, aon);
    }
  }();
  const r = rig(db);
  r.worker.perSleep = 40;
  const res = await start(900, r, {
    options: { pace: { ...DEFAULT_OPTIONS.pace, firstStepDocs: 100, stepDocs: 300 } },
  });
  assertEquals(res.stop, null);
  // Calls of 100: steps are [1], [2 3 4], [5 6 7], [8 9].
  assertEquals(queued.length, 9);
  for (const stepStart of [0, 1, 4, 7]) {
    assertEquals(queued[stepStart], 0, `step starting at call ${stepStart + 1} found a queue`);
  }
  assert(queued[2] > 0 && queued[3] > 0, 'calls inside a step are not held back');
});

Deno.test('pacing: slow commits hold the next step back until they recover, and a run that never recovers stops', async () => {
  const slow = [90_000, 90_000, 90_000, 4_000];
  const r = rig(new FakeDb(), { commitMs: () => Promise.resolve(slow.length > 1 ? slow.shift() as number : slow[0]) });
  const res = await start(300, r, {
    options: { pace: { ...DEFAULT_OPTIONS.pace, firstStepDocs: 100, stepDocs: 100, maxCommitMs: 20_000 } },
  });
  assertEquals(res.stop, null);
  assert(slow.length === 1, 'every slow reading was consumed before the next step');
  const polls = r.sleeps.filter((s) => s === DEFAULT_OPTIONS.pace.drainPollMs).length;
  assert(polls >= 3, `${polls} polls while commits were slow`);

  const stuck = rig(new FakeDb(), { commitMs: () => Promise.resolve(90_000) });
  const res2 = await start(300, stuck, {
    options: {
      pace: { ...DEFAULT_OPTIONS.pace, firstStepDocs: 100, stepDocs: 100, maxCommitMs: 20_000, drainMaxMs: 60_000 },
    },
  });
  assertEquals(res2.stop?.reason, 'drain_timeout');
  assertEquals(realRegisters(stuck.db).length, 1, 'the second step was never released');
  assertEquals([...stuck.db.batches.values()][0].state, 'stopped');
});

Deno.test('watch: a failed job is requeued once; a second failure is a failure in the receipt, not a requeue', async () => {
  const once = rig();
  once.db.failJobs.set('k000003', { times: 1, code: 'embed_error' });
  const res = await start(10, once);
  assertEquals(res.stop, null);
  assertEquals(once.db.count('requeue'), 1);
  assertEquals(receipt(once).counts.indexed, 10);
  assertEquals(receipt(once).counts.failed_jobs, 0);

  const twice = rig();
  twice.db.failJobs.set('k000003', { times: 2, code: 'text_outcome_uncertain' });
  const res2 = await start(10, twice);
  assertEquals(res2.stop, null);
  assertEquals(twice.db.count('requeue'), 1, 'the rules allow one requeue');
  assertEquals(receipt(twice).counts.failed_jobs, 1);
  assertEquals(receipt(twice).counts.indexed, 9);
  assertEquals([...twice.db.batches.values()][0].state, 'indexing', 'the database never marks it indexed');
});

Deno.test('watch: a batch the database stopped ends the run with its reason', async () => {
  const r = rig();
  r.worker.perSleep = 0;
  const realSleep = r.deps.sleep;
  r.deps.sleep = async (ms) => {
    await realSleep(ms);
    if (r.sleeps.length === 2) await r.db.stop([...r.db.batches.keys()][0], 'refusal_share:house_conflict');
  };
  const res = await start(10, r);
  assertEquals(res.stop?.reason, 'batch_stopped');
  assertEquals(res.stop?.detail, 'refusal_share:house_conflict');
});

Deno.test('watch: a worker that never finishes ends the watch at its time limit, without stopping the database', async () => {
  const r = rig();
  r.worker.perSleep = 0;
  const res = await start(10, r, { options: { watch: { pollMs: 10_000, maxMs: 100_000 } } });
  assertEquals(res.stop?.reason, 'watch_timeout');
  assertEquals(r.db.count('stop'), 0);
  assertEquals(receipt(r).db_stopped, false);
  assert(r.now() - 1_000 >= 100_000 && r.now() - 1_000 < 130_000, 'it used the injected clock');
});

Deno.test('disk: at the stop line the run stops itself and the database; under it the run goes on', async () => {
  const under = rig(new FakeDb(), { diskBytes: () => Promise.resolve(99) });
  assertEquals((await start(10, under, { options: { diskStopBytes: 100 } })).stop, null);

  const over = rig(new FakeDb(), { diskBytes: () => Promise.resolve(100) });
  const res = await start(10, over, { options: { diskStopBytes: 100 } });
  assertEquals(res.stop?.reason, 'disk_stop_line');
  assertEquals([...over.db.batches.values()][0].state, 'stopped');
  assertEquals(receipt(over).stop.reason, 'disk_stop_line');
});

Deno.test('a receipt that cannot be written is a named stop, not a throw', async () => {
  const r = rig();
  r.deps.writeReceipt = () => Promise.reject(new Error('disk full'));
  const res = await start(5, r);
  assertEquals(res.stop?.reason, 'receipt_write_failed');
  assert(res.stop?.detail?.includes('disk full'));
});

Deno.test('control codes removed in prepare are totalled in the receipt', async () => {
  const r = rig();
  const p = await plan(many(3), LIMITS);
  await run({ collection: 'bills', plan: p, holds: [], controlCodesRemoved: 12, runnerCommit: 'abcdef1' }, r.deps, {});
  assertEquals(receipt(r).control_codes_removed, 12);
});

Deno.test('more than one batch: each gets its own receipt, and a stop ends the pack', async () => {
  const r = rig();
  const p = await plan(many(10_001), LIMITS);
  const res = await run({ collection: 'bills', plan: p, holds: [], runnerCommit: 'abcdef1' }, r.deps, {});
  assertEquals(res.stop, null);
  assertEquals(r.receipts.size, 2);
  assertEquals(r.db.batches.size, 2);

  const s = rig();
  s.db.script.open = ['error', 'error'];
  const res2 = await run({ collection: 'bills', plan: p, holds: [], runnerCommit: 'abcdef1' }, s.deps, {});
  assertEquals(res2.stop?.reason, 'two_failures');
  assertEquals(s.receipts.size, 1);
  assertEquals(s.db.batches.size, 0);
});

// Satisfies the type-checker that the interface FakeDb implements is the one the runner takes.
const _db: Db = new FakeDb();
void _db;
