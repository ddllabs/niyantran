// An in-memory Db for the runner's tests (F285). It mirrors the rules of the real functions the runner leans on, read
// from 20261102130000_batch_registration.sql, and nothing else: the manifest is sealed by hash and sums, and refused
// over_policy_ceiling when the collection's reservations pass its ceiling or budget; an item is decided once and a
// re-send of a decided item answers existing; a dry run writes nothing; a stopped batch registers nothing; a call that
// pushes one refusal reason past its share stops the batch (refusal_share:<reason>); the worker does not claim a batch
// whose spend reached est_cost_usd or whose uncertain or failed jobs passed the policy; a job is requeued at most once,
// and the first requeue stops the batch when uncertain jobs exceed uncertain_max; existing_not_indexed is real. Faults are scripted per
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
  spend: number;
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

export interface FakePolicy {
  active: boolean;
  chunk_ceiling: number;
  budget_usd: number;
  stop_thresholds: {
    refusal_share: number;
    refusal_share_by_reason: Record<string, number>;
    failure_rate: number;
    uncertain_max: number;
    min_decided: number;
  };
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
  /** The collection's policy, generous by default: tests lower what they exercise. */
  policy: FakePolicy = {
    active: true,
    chunk_ceiling: 1e12,
    budget_usd: 1e9,
    stop_thresholds: {
      refusal_share: 1,
      refusal_share_by_reason: {},
      failure_rate: 1,
      uncertain_max: 1e9,
      min_decided: 1,
    },
  };
  /** What one run of a job costs, failed or not. */
  jobCost = 1e-9;
  /** source_keys of existing items whose document is indexed; the others are existing_not_indexed. */
  indexedExisting = new Set<string>();
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
      const all = [...b.items.values()];
      const hash = await manifestSha256(all);
      if (
        hash !== b.args.manifest_sha256 || all.length !== b.args.items_planned ||
        all.reduce((n, i) => n + i.chunks, 0) !== b.args.chunks_planned ||
        all.reduce((n, i) => n + i.est_tokens, 0) !== b.args.est_tokens
      ) return { refused: 'manifest_hash_mismatch' };
      const others = [...this.batches.values()].filter((x) =>
        x.id !== b.id && x.args.collection === b.args.collection && x.state !== 'open'
      );
      if (
        !this.policy.active ||
        others.reduce((n, x) => n + x.args.chunks_planned, 0) + b.args.chunks_planned > this.policy.chunk_ceiling ||
        others.reduce((n, x) => n + x.args.est_cost_usd, 0) + b.args.est_cost_usd > this.policy.budget_usd
      ) return { refused: 'over_policy_ceiling' };
      b.state = 'sealed';
      return { state: 'sealed' };
    });
  }

  register(batch: string, documents: RegisterDocument[], dryRun: boolean, _allOrNothing: boolean) {
    return this.go<RegisterResponse>('register', [batch, documents, dryRun], () => {
      const b = this.batch(batch);
      const results: RegisterResult[] = [];
      const ocr: NonNullable<RegisterResponse['ocr_route']> = [];
      const wasStopped = b.state === 'stopped' || b.state === 'open';
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
          // A re-send of a decided item changes nothing, and its document exists: the answer is existing.
          results.push({ source_key: sk, outcome: 'existing', job_id: item.job_id ?? undefined });
          continue;
        }
        const other = (this.holders.get(item.content_sha256) ?? []).find((h) => h.source_key !== sk);
        const reason = this.refuse.get(sk) ?? (dryRun ? undefined : this.refuseReal.get(sk)) ??
          (other ? 'duplicate_text' : undefined);
        if (reason === 'thin_text') ocr.push({ source_key: sk, file_url: `https://sansad.in/getFile/${sk}.pdf` });
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
          const job: Job = {
            id: `job-${sk}`,
            source_key: sk,
            status: 'queued',
            error_code: null,
            attempts: 0,
            spend: 0,
          };
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
      // The refusal stop rule runs on real calls that were not themselves refused for the batch's state.
      if (!dryRun && !wasStopped) {
        const st = this.policy.stop_thresholds;
        const items = [...b.items.values()];
        const decided = items.filter((i) => i.outcome !== 'planned').length;
        if (decided >= st.min_decided) {
          const byReason = new Map<string, number>();
          for (const i of items) {
            if (i.outcome === 'refused') {
              byReason.set(i.reason as string, (byReason.get(i.reason as string) ?? 0) + 1);
            }
          }
          for (const [reason, count] of [...byReason].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))) {
            if (count / decided > (st.refusal_share_by_reason[reason] ?? st.refusal_share)) {
              this.markStopped(b, `refusal_share:${reason}`);
              break;
            }
          }
        }
      }
      return { results, ocr_route: ocr, batch: { state: b.state, stop_reason: b.stop_reason } };
    });
  }

  private markStopped(b: Batch, reason: string) {
    if (b.state === 'stopped' || b.state === 'accepted') return;
    b.stopped_from = b.state;
    b.state = 'stopped';
    b.stop_reason = reason;
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
        i.outcome === 'admitted'
          ? b.jobs.get(i.job_id as string)?.status === 'succeeded'
          : i.outcome === 'existing' && this.indexedExisting.has(i.source_key);
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
        policy_sha256: 'policy-sha-1',
        counts: {
          items: items.length,
          planned: n('planned'),
          admitted: n('admitted'),
          existing: n('existing'),
          refused: n('refused'),
          by_reason,
          existing_not_indexed: items.filter((i) =>
            i.outcome === 'existing' && !this.indexedExisting.has(i.source_key)
          ).length,
        },
        jobs: {
          queued: j('queued'),
          running: j('running'),
          succeeded: j('succeeded'),
          failed: j('failed'),
          cancelled: 0,
          uncertain: jobs.filter((x) => x.status === 'failed' && x.error_code === 'text_outcome_uncertain').length,
          spend_usd: jobs.reduce((n, x) => n + x.spend, 0),
          tokens: jobs.reduce((n, x) => n + x.attempts, 0) * 100,
          logged_spend_usd: jobs.reduce((n, x) => n + x.spend, 0),
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
        else if (
          item.requeues >= 1 ||
          [...b.jobs.values()].filter((x) => x.status === 'failed' && x.error_code === 'text_outcome_uncertain')
              .length >
            this.policy.stop_thresholds.uncertain_max
        ) {
          const why = item.requeues >= 1
            ? (job.error_code === 'text_outcome_uncertain' ? 'uncertain_after_requeue' : 'failed_after_requeue')
            : 'uncertain_count';
          this.markStopped(b, why);
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

  /** ingest_batch_block_reason: why a batch's jobs may not be claimed. */
  private blockReason(b: Batch): string | null {
    const jobs = [...b.jobs.values()];
    const failed = jobs.filter((j) => j.status === 'failed').length;
    const done = jobs.filter((j) => j.status === 'failed' || j.status === 'succeeded').length;
    const uncertain = jobs.filter((j) => j.status === 'failed' && j.error_code === 'text_outcome_uncertain').length;
    const st = this.policy.stop_thresholds;
    if (jobs.reduce((n, j) => n + j.spend, 0) >= b.args.est_cost_usd) return 'spend_ceiling';
    if (uncertain > st.uncertain_max) return 'uncertain_count';
    if (done >= st.min_decided && failed / done > st.failure_rate) return 'failure_rate';
    return null;
  }

  /** The worker, for a test: runs up to `max` queued jobs of every batch to the end of their try. Stopped batches are not claimed. */
  tick(max = Infinity): number {
    let ran = 0;
    for (const b of this.batches.values()) {
      if (b.state === 'stopped') continue;
      for (const job of b.jobs.values()) {
        if (job.status !== 'queued' || ran >= max) continue;
        const blocked = this.blockReason(b);
        if (blocked) {
          this.markStopped(b, blocked);
          break;
        }
        ran += 1;
        job.attempts += 1;
        job.spend += this.jobCost;
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
