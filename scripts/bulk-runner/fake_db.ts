// An in-memory Db for the runner's tests (F285). It mirrors the ledger rules the runner leans on, and nothing else:
// the manifest is sealed by hash, an item is decided once, a re-send of a decided item changes nothing, a dry run
// writes nothing, a stopped batch registers nothing, and a job is requeued at most once. Faults are scripted per
// method: 'error' fails before any effect, 'lost' applies the effect and then loses the answer (F274).
import { manifestSha256 } from '../../src/lib/batchManifest.js';
import type {
  BatchStatus,
  Db,
  ItemStatus,
  ManifestItem,
  OpenArgs,
  OpenResult,
  RegisterDocument,
  RegisterResponse,
  RegisterResult,
  RequeueResponse,
  TextHolder,
} from './db.ts';

interface Item extends ManifestItem {
  outcome: 'planned' | 'admitted' | 'existing' | 'refused';
  reason: string | null;
  job_id: string | null;
  requeues: number;
}
interface Job {
  id: string;
  source_key: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  error_code: string | null;
  attempts: number;
}
interface Batch {
  id: string;
  args: OpenArgs;
  state: string;
  stop_reason: string | null;
  stopped_from: string | null;
  items: Map<string, Item>;
  jobs: Map<string, Job>;
}

export type Fault = 'ok' | 'error' | 'lost';
export type Method =
  | 'session'
  | 'textHolders'
  | 'open'
  | 'addItems'
  | 'seal'
  | 'register'
  | 'status'
  | 'stop'
  | 'requeue';

export class FakeDb implements Db {
  /** Every call that reached the fake, in order, with the arguments it was given. */
  calls: Array<{ method: Method; args: unknown[] }> = [];
  /** content_sha256 to live holders, for ingest_text_holders and the duplicate_text refusal. */
  holders = new Map<string, TextHolder[]>();
  /** source_key to a reason: registration refuses it. */
  refuse = new Map<string, string>();
  /** Like refuse, but only for a real call: the dry run does not see it (the pre-check and the database disagree). */
  refuseReal = new Map<string, string>();
  /** open answers this refusal. */
  openRefusal: string | null = null;
  /** seal answers manifest_hash_mismatch. */
  sealRefusal = false;
  /** source_keys whose registration answers 'existing'. */
  existing = new Set<string>();
  /** source_key to how many of its job runs fail, with this error code, before one succeeds. */
  failJobs = new Map<string, { times: number; code: string }>();
  /** Per method, the faults to apply to its next calls, in order. Beyond the list a call is ok. */
  script: Partial<Record<Method, Fault[]>> = {};
  batches = new Map<string, Batch>();
  private seq = 0;

  private async go<T>(method: Method, args: unknown[], effect: () => T | Promise<T>): Promise<T> {
    this.calls.push({ method, args });
    const fault = this.script[method]?.shift() ?? 'ok';
    if (fault === 'error') throw new Error(`${method}: connection reset`);
    const out = await effect();
    if (fault === 'lost') throw new Error(`${method}: timeout waiting for the answer`);
    return structuredClone(out);
  }

  count(method: Method): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  private batch(id: string): Batch {
    const b = this.batches.get(id);
    if (!b) throw new Error(`batch ${id} does not exist`);
    return b;
  }

  session(settings: { lock_timeout_ms: number; statement_timeout_ms: number }) {
    return this.go('session', [settings], () => undefined);
  }

  textHolders(hashes: string[]) {
    return this.go('textHolders', [hashes], () => hashes.flatMap((h) => this.holders.get(h) ?? []));
  }

  open(args: OpenArgs) {
    return this.go<OpenResult>('open', [args], () => {
      if (this.openRefusal) return { refused: this.openRefusal };
      for (const b of this.batches.values()) {
        if (b.args.manifest_sha256 !== args.manifest_sha256) continue;
        if (b.args.collection !== args.collection) return { refused: 'manifest_exists' };
        return { batch_id: b.id, state: b.state, existing: true };
      }
      const id = `batch-${++this.seq}`;
      this.batches.set(id, {
        id,
        args,
        state: 'open',
        stop_reason: null,
        stopped_from: null,
        items: new Map(),
        jobs: new Map(),
      });
      return { batch_id: id, state: 'open', existing: false };
    });
  }

  addItems(batch: string, items: ManifestItem[]) {
    return this.go('addItems', [batch, items], () => {
      const b = this.batch(batch);
      if (b.state !== 'open') throw new Error(`batch ${batch} is ${b.state}, not open`);
      for (const i of items) {
        if (!b.items.has(i.source_key)) {
          b.items.set(i.source_key, { ...i, outcome: 'planned', reason: null, job_id: null, requeues: 0 });
        }
      }
    });
  }

  seal(batch: string) {
    return this.go<{ state?: string; refused?: string }>('seal', [batch], async () => {
      const b = this.batch(batch);
      if (b.state !== 'open') return { state: b.state };
      if (this.sealRefusal) return { refused: 'manifest_hash_mismatch' };
      const hash = await manifestSha256([...b.items.values()]);
      if (hash !== b.args.manifest_sha256 || b.items.size !== b.args.items_planned) {
        return { refused: 'manifest_hash_mismatch' };
      }
      b.state = 'sealed';
      return { state: 'sealed' };
    });
  }

  register(batch: string, documents: RegisterDocument[], dryRun: boolean, _allOrNothing: boolean) {
    return this.go<RegisterResponse>('register', [batch, documents, dryRun], () => {
      const b = this.batch(batch);
      const results: RegisterResult[] = [];
      for (const d of documents) {
        const sk = String((JSON.parse(d.payload) as { source_key: string }).source_key);
        const item = b.items.get(sk);
        const refused = (reason: string): RegisterResult => ({ source_key: sk, outcome: 'refused', reason });
        if (b.state === 'open') {
          results.push(refused('batch_not_sealed'));
          continue;
        }
        if (b.state === 'stopped') {
          results.push(refused('batch_stopped'));
          continue;
        }
        if (!item) {
          results.push(refused('not_in_manifest'));
          continue;
        }
        if (item.outcome === 'refused') {
          results.push(refused(item.reason as string));
          continue;
        }
        if (item.payload_sha256 !== d.payload_sha256) {
          results.push(refused('manifest_mismatch'));
          continue;
        }
        if (item.outcome !== 'planned') {
          // A re-send of a decided item changes nothing and answers what was decided.
          results.push({
            source_key: sk,
            outcome: item.outcome as 'admitted' | 'existing',
            job_id: item.job_id ?? undefined,
          });
          continue;
        }
        const other = (this.holders.get(item.content_sha256) ?? []).find((h) => h.source_key !== sk);
        const reason = this.refuse.get(sk) ?? (dryRun ? undefined : this.refuseReal.get(sk)) ??
          (other ? 'duplicate_text' : undefined);
        if (reason) {
          if (!dryRun) {
            item.outcome = 'refused';
            item.reason = reason;
          }
          results.push(refused(reason));
        } else if (this.existing.has(sk)) {
          if (!dryRun) item.outcome = 'existing';
          results.push({ source_key: sk, outcome: 'existing' });
        } else if (dryRun) {
          results.push({ source_key: sk, outcome: 'would_admit' });
        } else {
          const job: Job = { id: `job-${sk}`, source_key: sk, status: 'queued', error_code: null, attempts: 0 };
          b.jobs.set(job.id, job);
          item.outcome = 'admitted';
          item.job_id = job.id;
          results.push({ source_key: sk, outcome: 'admitted', job_id: job.id });
        }
      }
      if (!dryRun && b.state === 'sealed') b.state = 'registering';
      if (!dryRun && b.state === 'registering' && ![...b.items.values()].some((i) => i.outcome === 'planned')) {
        b.state = 'registered';
      }
      return { results, batch: { state: b.state, stop_reason: b.stop_reason } };
    });
  }

  status(batch: string, sourceKeys?: string[]) {
    return this.go<BatchStatus>('status', [batch, sourceKeys], () => {
      const b = this.batch(batch);
      const jobs = [...b.jobs.values()];
      if (b.state === 'registered' || b.state === 'indexing') {
        if (jobs.every((j) => j.status === 'succeeded')) b.state = 'indexed';
        else if (b.state === 'registered' && jobs.some((j) => j.status !== 'queued' || j.attempts > 0)) {
          b.state = 'indexing';
        }
      }
      const items = [...b.items.values()];
      const n = (o: Item['outcome']) => items.filter((i) => i.outcome === o).length;
      const by_reason: Record<string, number> = {};
      for (const i of items) {
        if (i.outcome === 'refused') by_reason[i.reason as string] = (by_reason[i.reason as string] ?? 0) + 1;
      }
      const j = (s: Job['status']) => jobs.filter((x) => x.status === s).length;
      const indexedKey = (i: Item) =>
        i.outcome === 'admitted' && b.jobs.get(i.job_id as string)?.status === 'succeeded';
      const rows: ItemStatus[] | undefined = sourceKeys?.map((k) => b.items.get(k)).filter((i): i is Item => !!i).map(
        (i) => {
          const job = i.job_id ? b.jobs.get(i.job_id) : undefined;
          return {
            source_key: i.source_key,
            outcome: i.outcome,
            reason: i.reason,
            job_id: i.job_id,
            job_status: job?.status ?? null,
            error_code: job?.error_code ?? null,
            requeues: i.requeues,
            indexed: indexedKey(i),
          };
        },
      );
      return {
        batch_id: b.id,
        state: b.state,
        stop_reason: b.stop_reason,
        counts: {
          items: items.length,
          planned: n('planned'),
          admitted: n('admitted'),
          existing: n('existing'),
          refused: n('refused'),
          by_reason,
          existing_not_indexed: 0,
        },
        jobs: {
          queued: j('queued'),
          running: j('running'),
          succeeded: j('succeeded'),
          failed: j('failed'),
          cancelled: 0,
          uncertain: jobs.filter((x) => x.status === 'failed' && x.error_code === 'text_outcome_uncertain').length,
          spend_usd: j('succeeded') * 0.001,
          tokens: j('succeeded') * 100,
          logged_spend_usd: j('succeeded') * 0.001,
        },
        indexed: items.filter(indexedKey).length,
        ...(rows ? { items: rows } : {}),
      };
    });
  }

  stop(batch: string, reason: string) {
    return this.go('stop', [batch, reason], () => {
      const b = this.batch(batch);
      if (b.state === 'stopped' || b.state === 'accepted') return;
      b.stopped_from = b.state;
      b.state = 'stopped';
      b.stop_reason = reason;
    });
  }

  requeue(batch: string, jobIds: string[]) {
    return this.go<RequeueResponse>('requeue', [batch, jobIds], () => {
      const b = this.batch(batch);
      const results: RequeueResponse['results'] = [];
      for (const id of jobIds) {
        const job = b.jobs.get(id);
        const item = job ? b.items.get(job.source_key) : undefined;
        if (b.state === 'stopped') results.push({ job_id: id, outcome: 'refused', reason: 'batch_stopped' });
        else if (!job || !item) results.push({ job_id: id, outcome: 'refused', reason: 'not_in_batch' });
        else if (job.status !== 'failed') results.push({ job_id: id, outcome: 'refused', reason: 'not_failed' });
        else if (item.requeues >= 1) {
          const why = job.error_code === 'text_outcome_uncertain' ? 'uncertain_after_requeue' : 'failed_after_requeue';
          b.stopped_from = b.state;
          b.state = 'stopped';
          b.stop_reason = why;
          results.push({ job_id: id, outcome: 'refused', reason: why });
        } else {
          job.status = 'queued';
          job.error_code = null;
          item.requeues += 1;
          results.push({ job_id: id, outcome: 'requeued' });
        }
      }
      return { results, state: b.state, stop_reason: b.stop_reason };
    });
  }

  /** The developer's ingest_batch_resume. */
  resume(id: string) {
    const b = this.batch(id);
    b.state = b.stopped_from ?? 'sealed';
    b.stopped_from = null;
    b.stop_reason = null;
  }

  /** The worker, for a test: runs up to `max` queued jobs of every batch to the end of their try. Stopped batches are not claimed. */
  tick(max = Infinity): number {
    let ran = 0;
    for (const b of this.batches.values()) {
      if (b.state === 'stopped') continue;
      for (const job of b.jobs.values()) {
        if (job.status !== 'queued' || ran >= max) continue;
        ran += 1;
        job.attempts += 1;
        const plan = this.failJobs.get(job.source_key);
        if (plan && plan.times > 0) {
          plan.times -= 1;
          job.status = 'failed';
          job.error_code = plan.code;
        } else job.status = 'succeeded';
      }
    }
    return ran;
  }
}
