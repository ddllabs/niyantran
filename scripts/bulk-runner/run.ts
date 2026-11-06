// Bulk runner, T3 (F285): takes a plan to a sealed, registered, watched batch and a receipt. The database, the clock,
// the sleep and the receipt writer are all injected, so a test needs no network and no time. Every way of stopping
// returns a named reason in the result and in the receipt; nothing a caller must catch escapes.
// Spec: docs/specs/2026-11-07-bulk-runner.md.
import type { BatchStatus, Db, ItemStatus, RegisterResult } from './db.ts';
import { type PlannedBatch, type PlanResult, type PlanStop, splitCalls } from './plan.ts';
import type { Hold, PreparedRequest } from './prepare.ts';

export type StopReason =
  | PlanStop
  | 'open_refused'
  | 'seal_refused'
  | 'batch_stopped'
  | 'two_failures'
  | 'precheck_disagreement'
  | 'registration_disagreement'
  | 'drain_timeout'
  | 'watch_timeout'
  | 'disk_stop_line'
  | 'items_undecided'
  | 'runner_error'
  | 'receipt_write_failed';

export interface Stop {
  reason: StopReason;
  detail?: string;
}

export interface RunOptions {
  /** Cold writes run four to five times slower (F293), so work is released in steps. */
  pace: {
    /** The first step is small. */
    firstStepDocs: number;
    stepDocs: number;
    /** The next step starts only when commits are back under this. */
    maxCommitMs: number;
    drainPollMs: number;
    drainMaxMs: number;
  };
  watch: { pollMs: number; maxMs: number };
  /** Wait before the one retry of a call that failed. */
  backoffMs: number;
  session: { lock_timeout_ms: number; statement_timeout_ms: number };
  /** Stop when disk use, as diskBytes reads it, reaches this. */
  diskStopBytes?: number;
}

export const DEFAULT_OPTIONS: RunOptions = {
  pace: { firstStepDocs: 100, stepDocs: 1000, maxCommitMs: 20_000, drainPollMs: 5_000, drainMaxMs: 3_600_000 },
  watch: { pollMs: 10_000, maxMs: 86_400_000 },
  backoffMs: 2_000,
  session: { lock_timeout_ms: 5_000, statement_timeout_ms: 60_000 },
};

export interface RunDeps {
  db: Db;
  /** Milliseconds. Only differences are used. */
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Where a receipt goes: outside the repository. */
  writeReceipt: (name: string, body: string) => Promise<void>;
  /** Recent commit time in ms, if the run has a way to read it; null when unknown. */
  commitMs?: () => Promise<number | null>;
  /** Disk in use in bytes, if the run has a way to read it. */
  diskBytes?: () => Promise<number>;
}

export interface RunInput {
  collection: string;
  plan: PlanResult;
  /** The holds of prepare. The plan's own holds are added to them. */
  holds: Hold[];
  controlCodesRemoved?: number;
  runnerCommit: string;
  /**
   * Refusals this collection expects, such as no_desk_row: about 4% of live bills have no matching row. They are
   * recorded by reason and the policy's refusal thresholds govern them. Any other refusal is a disagreement.
   */
  allowedRefusals?: readonly string[];
}

export interface RunResult {
  completed: boolean;
  stop: Stop | null;
  receipts: string[];
}

/** Ends a batch's run with a named reason. Internal: it is caught in runBatch and never leaves this file. */
class Halt extends Error {
  constructor(readonly stop: Stop, readonly stopInDb: boolean) {
    super(stop.reason);
  }
}

const describe = (e: unknown) => e instanceof Error ? e.message : String(e);
const chunks = <T>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function run(input: RunInput, deps: RunDeps, overrides: Partial<RunOptions> = {}): Promise<RunResult> {
  const opt: RunOptions = { ...DEFAULT_OPTIONS, ...overrides };
  const receipts: string[] = [];
  const base = {
    schema: 1,
    collection: input.collection,
    runner_commit: input.runnerCommit,
    control_codes_removed: input.controlCodesRemoved ?? 0,
  };
  const planHolds = input.plan.ok ? input.plan.holds : [];
  const holds = [...input.holds, ...planHolds];

  async function write(name: string, body: Record<string, unknown>): Promise<Stop | null> {
    try {
      await deps.writeReceipt(name, JSON.stringify(body, null, 2));
      receipts.push(name);
      return null;
    } catch (e) {
      return { reason: 'receipt_write_failed', detail: describe(e) };
    }
  }

  if (!input.plan.ok) {
    const stop: Stop = { reason: input.plan.stop, detail: input.plan.detail };
    const failed = await write(`receipt-${input.collection}-plan-${stop.reason}.json`, {
      ...base,
      batch_id: null,
      stop,
      holds,
    });
    return { completed: false, stop: failed ?? stop, receipts };
  }

  for (const batch of input.plan.batches) {
    const out = await runBatch(batch, input, holds, deps, opt);
    const name = `receipt-${batch.manifest_sha256.slice(0, 16)}.json`;
    const failed = await write(name, { ...base, ...out.receipt, holds, stop: out.stop });
    const stop = out.stop ?? failed;
    if (stop) return { completed: false, stop, receipts };
  }
  return { completed: true, stop: null, receipts };
}

async function runBatch(
  batch: PlannedBatch,
  input: RunInput,
  holds: Hold[],
  deps: RunDeps,
  opt: RunOptions,
): Promise<{ stop: Stop | null; receipt: Record<string, unknown> }> {
  const { db } = deps;
  const t0 = deps.clock();
  const st = {
    id: null as string | null,
    fails: 0,
    retries: 0,
    dryCalls: 0,
    registerCalls: 0,
    dbStopped: false,
    dbStopError: null as string | null,
    disagreements: [] as Array<{ source_key: string | null; expected: string; got: string }>,
    last: null as BatchStatus | null,
  };
  const marks: Record<string, number> = {};
  const allowed = new Set(input.allowedRefusals ?? []);
  let stop: Stop | null = null;

  // One retry after a backoff; the second failure in a row ends the batch. Success clears the count.
  async function attempt<T>(label: string, fn: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        const v = await fn();
        st.fails = 0;
        return v;
      } catch (e) {
        st.fails += 1;
        if (st.fails >= 2) {
          throw new Halt({ reason: 'two_failures', detail: `${label}: ${describe(e)}` }, st.id !== null);
        }
        st.retries += 1;
        await deps.sleep(opt.backoffMs);
      }
    }
  }

  const status = async (keys?: string[]) => {
    const s = await attempt('status', () => db.status(st.id as string, keys));
    st.last = s;
    return s;
  };
  const stopped = (s: BatchStatus) => {
    if (s.state === 'stopped') throw new Halt({ reason: 'batch_stopped', detail: s.stop_reason ?? undefined }, false);
  };

  async function checkDisk() {
    if (opt.diskStopBytes === undefined || !deps.diskBytes) return;
    const used = await attempt('disk', deps.diskBytes);
    if (used >= opt.diskStopBytes) {
      throw new Halt({ reason: 'disk_stop_line', detail: `${used} bytes, stop line ${opt.diskStopBytes}` }, true);
    }
  }

  // Which of these keys the ledger still has as planned. At most 1,000 keys a read.
  async function plannedAmong(keys: string[]): Promise<Set<string>> {
    const planned = new Set<string>();
    for (const part of chunks(keys, 1000)) {
      const s = await status(part);
      stopped(s);
      for (const i of s.items ?? []) if (i.outcome === 'planned') planned.add(i.source_key);
    }
    return planned;
  }

  // What the pre-check expects of each document: admitted, or the one refusal it can foresee.
  function compare(
    sent: PreparedRequest[],
    results: Array<Pick<RegisterResult, 'source_key' | 'outcome' | 'reason'>>,
    predicted: Map<string, string>,
    real: boolean,
  ) {
    const found = st.disagreements.length;
    const by = new Map(results.map((r) => [r.source_key, r]));
    for (const d of sent) {
      const r = by.get(d.source_key);
      const want = predicted.get(d.source_key);
      if (!real && r?.outcome === 'refused' && r.reason && allowed.has(r.reason)) {
        predicted.set(d.source_key, r.reason); // the dry run's verdict binds the real call
        continue;
      }
      if (real && !want && r?.outcome === 'refused' && r.reason && allowed.has(r.reason)) continue; // a resumed batch had no dry run
      if (!r) {
        st.disagreements.push({ source_key: d.source_key, expected: want ?? 'a result', got: 'no result' });
      } else if (want) {
        if (r.outcome !== 'refused' || r.reason !== want) {
          st.disagreements.push({
            source_key: d.source_key,
            expected: `refused ${want}`,
            got: `${r.outcome} ${r.reason ?? ''}`.trim(),
          });
        }
      } else if (!(real ? ['admitted', 'existing'] : ['would_admit', 'existing']).includes(r.outcome)) {
        st.disagreements.push({
          source_key: d.source_key,
          expected: 'admitted',
          got: `${r.outcome} ${r.reason ?? ''}`.trim(),
        });
      }
    }
    return st.disagreements.length > found;
  }

  const disagreementDetail = () =>
    `${st.disagreements.length} documents: ` +
    st.disagreements.slice(0, 5).map((d) => `${d.source_key} expected ${d.expected}, got ${d.got}`).join('; ');

  // A real call. A failure or a lost answer is settled from the ledger, never by sending the same items blind.
  async function send(
    docs: PreparedRequest[],
  ): Promise<Array<Pick<RegisterResult, 'source_key' | 'outcome' | 'reason'>>> {
    let todo = docs;
    const answered: Array<Pick<RegisterResult, 'source_key' | 'outcome' | 'reason'>> = [];
    for (;;) {
      try {
        st.registerCalls += 1;
        const res = await db.register(st.id as string, todo.map((d) => d.request), false, false);
        st.fails = 0;
        answered.push(...res.results);
        if (res.batch.state === 'stopped') {
          throw new Halt({ reason: 'batch_stopped', detail: res.batch.stop_reason ?? undefined }, false);
        }
        return answered;
      } catch (e) {
        if (e instanceof Halt) throw e;
        st.fails += 1;
        if (st.fails >= 2) throw new Halt({ reason: 'two_failures', detail: `register: ${describe(e)}` }, true);
        st.retries += 1;
        await deps.sleep(opt.backoffMs);
        // A read that fails right after a failed call is the second failure in a row; a good read does not clear the count.
        let s: BatchStatus;
        try {
          s = await db.status(st.id as string, todo.map((d) => d.source_key));
        } catch (e2) {
          throw new Halt({ reason: 'two_failures', detail: `status after a failed register: ${describe(e2)}` }, true);
        }
        st.last = s;
        stopped(s);
        const rows = new Map((s.items ?? []).map((i: ItemStatus) => [i.source_key, i]));
        const open = todo.filter((d) => rows.get(d.source_key)?.outcome === 'planned');
        for (const d of todo) {
          const row = rows.get(d.source_key);
          if (row && row.outcome !== 'planned') {
            answered.push({ source_key: d.source_key, outcome: row.outcome, reason: row.reason ?? undefined });
          }
        }
        if (!open.length) {
          st.fails = 0; // the call had gone through: only its answer was lost
          return answered;
        }
        todo = open;
      }
    }
  }

  async function drain() {
    const began = deps.clock();
    for (;;) {
      const s = await status();
      stopped(s);
      await checkDisk();
      if (s.jobs.queued + s.jobs.running === 0) {
        const commit = deps.commitMs ? await attempt('commit time', deps.commitMs) : null;
        if (commit === null || commit <= opt.pace.maxCommitMs) return;
      }
      if (deps.clock() - began >= opt.pace.drainMaxMs) {
        throw new Halt({
          reason: 'drain_timeout',
          detail: `queue or commit time did not recover in ${opt.pace.drainMaxMs} ms`,
        }, true);
      }
      await deps.sleep(opt.pace.drainPollMs);
    }
  }

  async function watch() {
    const began = deps.clock();
    const terminal = new Set<string>();
    const keys = batch.requests.map((r) => r.source_key);
    for (;;) {
      const s = await status();
      stopped(s);
      await checkDisk();
      if (s.counts.planned > 0) {
        throw new Halt({ reason: 'items_undecided', detail: `${s.counts.planned} items are still planned` }, false);
      }
      const again: string[] = [];
      if (s.jobs.failed > terminal.size) {
        for (const part of chunks(keys, 1000)) {
          const rows = (await status(part)).items ?? [];
          for (const i of rows) {
            if (i.job_status !== 'failed' || !i.job_id) continue;
            // The rules allow one requeue; a second one would stop the batch, so the runner does not ask.
            if ((i.requeues ?? 0) < 1) again.push(i.job_id);
            else terminal.add(i.job_id);
          }
        }
        for (const part of chunks(again, 1000)) {
          const r = await attempt('requeue', () => db.requeue(st.id as string, part));
          if (r.state === 'stopped') {
            throw new Halt({ reason: 'batch_stopped', detail: r.stop_reason ?? undefined }, false);
          }
        }
      }
      if (s.jobs.queued + s.jobs.running === 0 && again.length === 0) return;
      if (deps.clock() - began >= opt.watch.maxMs) {
        throw new Halt({
          reason: 'watch_timeout',
          detail: `${s.jobs.queued + s.jobs.running} jobs unfinished after ${opt.watch.maxMs} ms`,
        }, false);
      }
      await deps.sleep(opt.watch.pollMs);
    }
  }

  try {
    await attempt('session', () => db.session(opt.session));
    const opened = await attempt('open', () =>
      db.open({
        collection: input.collection,
        manifest_sha256: batch.manifest_sha256,
        items_planned: batch.items_planned,
        chunks_planned: batch.chunks_planned,
        est_tokens: batch.est_tokens,
        est_cost_usd: batch.est_cost_usd,
        runner_commit: input.runnerCommit,
      }));
    if ('refused' in opened) throw new Halt({ reason: 'open_refused', detail: opened.refused }, false);
    st.id = opened.batch_id;
    if (opened.state === 'stopped') {
      const s = await status();
      stopped(s);
    }

    let state = opened.state;
    if (state === 'open') {
      for (const part of chunks(batch.items, 1000)) {
        await attempt('add items', () => db.addItems(st.id as string, part));
      }
      const sealed = await attempt('seal', () => db.seal(st.id as string));
      if (sealed.state !== 'sealed') {
        throw new Halt({ reason: 'seal_refused', detail: sealed.refused ?? `state ${sealed.state}` }, true);
      }
      state = 'sealed';
    }

    // What is still to send: everything for a new batch, the planned items for one begun before.
    let todo: PreparedRequest[] = [];
    if (state === 'sealed') todo = batch.requests;
    else if (state === 'registering') {
      const planned = await plannedAmong(batch.requests.map((r) => r.source_key));
      todo = batch.requests.filter((r) => planned.has(r.source_key));
    }

    const predicted = new Map<string, string>();
    if (todo.length) {
      const holders = await attempt(
        'text holders',
        () => db.textHolders([...new Set(todo.map((r) => r.item.content_sha256))]),
      );
      for (const r of todo) {
        if (holders.some((h) => h.content_sha256 === r.item.content_sha256 && h.source_key !== r.source_key)) {
          predicted.set(r.source_key, 'duplicate_text');
        }
      }
    }

    const calls = splitCalls(todo);
    if (todo.length && state === 'sealed') {
      marks.dry_run_from = deps.clock();
      for (const c of calls) {
        const docs = todo.slice(c.start, c.end);
        st.dryCalls += 1;
        const res = await attempt(
          'dry run',
          () => db.register(st.id as string, docs.map((d) => d.request), true, false),
        );
        if (compare(docs, res.results, predicted, false)) {
          throw new Halt({ reason: 'precheck_disagreement', detail: disagreementDetail() }, true);
        }
      }
      marks.dry_run_to = deps.clock();
    }

    // Paced release: the first step is small, and each next one waits for the queue and the commit time.
    const steps: Array<typeof calls> = [];
    let current: typeof calls = [], docs = 0, target = opt.pace.firstStepDocs;
    for (const c of calls) {
      current.push(c);
      docs += c.end - c.start;
      if (docs >= target) {
        steps.push(current);
        current = [];
        docs = 0;
        target = opt.pace.stepDocs;
      }
    }
    if (current.length) steps.push(current);
    marks.register_from = deps.clock();
    for (const [n, step] of steps.entries()) {
      if (n > 0) await drain();
      else await checkDisk();
      for (const c of step) {
        const sent = todo.slice(c.start, c.end);
        const answered = await send(sent);
        if (compare(sent, answered, predicted, true)) {
          throw new Halt({ reason: 'registration_disagreement', detail: disagreementDetail() }, true);
        }
      }
    }
    marks.register_to = deps.clock();

    marks.watch_from = deps.clock();
    await watch();
    marks.watch_to = deps.clock();
  } catch (e) {
    if (e instanceof Halt) {
      stop = e.stop;
      if (e.stopInDb && st.id) {
        try {
          await db.stop(st.id, e.stop.reason);
          st.dbStopped = true;
        } catch (err) {
          st.dbStopError = describe(err);
        }
      }
    } else {
      stop = { reason: 'runner_error', detail: describe(e) };
    }
  }

  // The counts in the receipt come from the ledger. If the database is the trouble, the last answer will do.
  if (st.id && stop?.reason !== 'two_failures') {
    try {
      st.last = await db.status(st.id);
    } catch { /* keep the last answer */ }
  }
  const s = st.last;
  const t1 = deps.clock();
  return {
    stop,
    receipt: {
      batch_id: st.id,
      manifest_sha256: batch.manifest_sha256,
      state: s?.state ?? null,
      planned: {
        items: batch.items_planned,
        chunks: batch.chunks_planned,
        est_tokens: batch.est_tokens,
        est_cost_usd: batch.est_cost_usd,
      },
      counts: s
        ? {
          admitted: s.counts.admitted,
          existing: s.counts.existing,
          refused: s.counts.refused,
          by_reason: s.counts.by_reason,
          indexed: s.indexed,
          failed_jobs: s.jobs.failed,
          uncertain_jobs: s.jobs.uncertain,
        }
        : null,
      spend_usd: s ? s.jobs.spend_usd : null,
      logged_spend_usd: s ? s.jobs.logged_spend_usd : null,
      calls: { dry_run: st.dryCalls, register: st.registerCalls, retries: st.retries },
      disagreements: st.disagreements,
      db_stopped: st.dbStopped,
      db_stop_error: st.dbStopError,
      holds_total: holds.length,
      timings: {
        started_ms: t0,
        ended_ms: t1,
        duration_ms: t1 - t0,
        dry_run_ms: marks.dry_run_to !== undefined ? marks.dry_run_to - marks.dry_run_from : null,
        register_ms: marks.register_to !== undefined ? marks.register_to - marks.register_from : null,
        watch_ms: marks.watch_to !== undefined ? marks.watch_to - marks.watch_from : null,
      },
    },
  };
}
