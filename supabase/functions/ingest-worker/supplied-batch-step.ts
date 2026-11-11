// Several supplied-text index jobs of one registration batch in one invocation (design
// docs/research/2026-11-02-batch-registration-design.md, section 4.2). The jobs' stale chunks form one
// input stream, cut into embedding calls at the EMBED_BATCH bounds, so small documents share calls.
//
// Per job, nothing is weaker than suppliedTextStep:
//   * each job's stored plan is re-planned and compared before any paid work (loadSuppliedPlan);
//   * each job commits only its own rows, under its own claim token, so a stale token fences that job
//     alone (ingest_text_commit refuses it) and no other job's rows are ever sent under it;
//   * a failed embedding call that carried several jobs is not held against them all: before any later
//     window each job's share of it is embedded alone, and only a job whose own call fails is failed
//     (permanently); a job whose call succeeds goes on as if the shared call had. A failed call that
//     carried one job fails that job. Slices other jobs committed stay. Every call, failed or solo, is
//     logged with the batch id. Inside the deadline reserve a solo call is not started: the jobs not yet
//     retried get no error and are released, their share having never been committed;
//   * no call and no activation starts within INDEX_STEP.deadlineReserveMs of the deadline; such jobs
//     are released for the next claim;
//   * a supplied-text failure after paid work is permanent (reconciled before retry), as before.
// Spend is split across the jobs of a call by their share of its estimated tokens; the exact totals
// stay in model_call_logs, one row per call, carrying the batch_id so the stop rules count a call
// whose claim was killed before it reported.

import { EMBED_BATCH, type EmbedBatchBounds, EMBED_MODEL, EmbeddingError, type EmbedResult, planBatches } from '../_shared/embed.ts';
import { type EmbeddingChunk, INDEX_STEP } from './index-step.ts';
import { readAll } from './paging.ts';
import { loadSuppliedPlan } from './supplied-step.ts';
import { type BatchStep, IngestError, type IngestJob, type PageCommitRow, type StepOutcome, type WorkerDeps } from './types.ts';

interface Spend {
  tokens: number;
  cost: number;
}

interface Member {
  job: IngestJob;
  keep: string[];
  rows: Map<string, PageCommitRow>;
  stale: EmbeddingChunk[];
  /** Stale chunks committed so far. */
  done: number;
  committed: boolean;
  spend: Spend;
  error?: IngestError;
}

const estimate = (text: string) => Math.ceil(text.length / 4);

function failure(e: unknown, spend: Spend, progressed: boolean, permanent?: boolean): StepOutcome {
  const err = e instanceof IngestError ? e : new IngestError('internal', e instanceof Error ? e.message : String(e));
  return {
    patch: {
      progressed,
      embed_tokens: spend.tokens,
      embed_cost_usd: spend.cost,
      error: { code: err.code, message: err.message, permanent: permanent ?? err.permanent },
    },
  };
}

/**
 * Splits a call's tokens across members by estimated share, exactly (largest remainder), and its cost
 * in proportion to the tokens given, the last member taking the rounding.
 */
export function splitSpend(shares: number[], tokens: number, cost: number): Spend[] {
  const total = shares.reduce((a, b) => a + b, 0);
  const weights = total > 0 ? shares.map((s) => s / total) : shares.map(() => 1 / shares.length);
  const exact = weights.map((w) => w * tokens);
  const whole = exact.map(Math.floor);
  let left = tokens - whole.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    whole[i] += 1;
    left -= 1;
  }
  let given = 0;
  return whole.map((t, i) => {
    const c = i === whole.length - 1 ? cost - given : (tokens > 0 ? cost * t / tokens : cost * weights[i]);
    given += c;
    return { tokens: t, cost: c };
  });
}

async function prepare(deps: WorkerDeps, job: IngestJob): Promise<Member> {
  const { chunks, rows } = await loadSuppliedPlan(deps, job);
  const storedEmbed = new Map(
    (await readAll((from, to) => deps.db.storedChunks(job.document_id, from, to))).map((c) => [c.chunk_hash, c.embed_hash]),
  );
  return {
    job,
    keep: chunks.map((c) => c.chunk_hash),
    rows: new Map(rows.map((r) => [r.chunk_hash, r])),
    stale: chunks.filter((c) => storedEmbed.get(c.chunk_hash) !== c.embed_hash),
    done: 0,
    committed: false,
    spend: { tokens: 0, cost: 0 },
  };
}

export async function runSuppliedBatch(
  deps: WorkerDeps,
  jobs: IngestJob[],
  deadline: number,
  bounds: Readonly<EmbedBatchBounds> = EMBED_BATCH,
): Promise<StepOutcome[]> {
  const outcomes: Array<StepOutcome | undefined> = jobs.map(() => undefined);
  const members: Array<Member | null> = [];
  // 1. Every plan, verified before anything is paid for.
  for (const [i, job] of jobs.entries()) {
    try {
      members.push(await prepare(deps, job));
    } catch (e) {
      outcomes[i] = failure(e, { tokens: 0, cost: 0 }, false);
      members.push(null);
    }
  }

  // 2. One stream over every job's stale chunks, in claim order, cut at the provider's bounds.
  const stream = members.flatMap((m, i) => (m ? m.stale.map((chunk) => ({ i, chunk })) : []));
  type Item = (typeof stream)[number];
  const sizes = planBatches(stream.map((s) => s.chunk.embedding_input), bounds.maxCount, bounds.maxTokens).map((b) => b.length);
  const base = { caller: 'ingest-worker', purpose: 'embedding', model_requested: EMBED_MODEL, provider: 'openrouter' } as const;
  const reserveReached = () => deps.now() >= deadline - INDEX_STEP.deadlineReserveMs;
  const failJobs = (involved: number[], e: unknown) => {
    for (const i of involved) members[i]!.error = e instanceof IngestError ? e : new IngestError('internal', (e as Error).message, true);
  };

  /**
   * One embedding call for these items: its spend split across the jobs it carried and added to them, and
   * the call logged, failed or not. Returns the vectors in item order; throws the IngestError the jobs get.
   */
  const embedCall = async (items: Item[]): Promise<number[][]> => {
    const involved = [...new Set(items.map((s) => s.i))];
    const shares = involved.map((i) => items.filter((s) => s.i === i).reduce((n, s) => n + estimate(s.chunk.embedding_input), 0));
    const usage = {
      ...(jobs[0].batch_id ? { batch_id: jobs[0].batch_id } : {}),
      job_id: members[involved[0]]!.job.id,
      document_id: members[involved[0]]!.job.document_id,
      job_ids: involved.map((i) => members[i]!.job.id),
      document_ids: involved.map((i) => members[i]!.job.document_id),
      inputs: items.length,
    };
    const started = deps.now();
    let r: EmbedResult;
    try {
      r = await deps.embed(items.map((s) => s.chunk.embedding_input));
    } catch (err) {
      // Whatever the failed call had already cost reaches the jobs it carried, and the log.
      const spent = err instanceof EmbeddingError ? { tokens: err.promptTokens, cost: err.costUsd } : { tokens: 0, cost: 0 };
      splitSpend(shares, spent.tokens, spent.cost).forEach((x, k) => {
        members[involved[k]]!.spend.tokens += x.tokens;
        members[involved[k]]!.spend.cost += x.cost;
      });
      const message = (err as Error).message;
      await deps.db.logCall({
        ...base, model_served: null, status: 'error', error_message: message, latency_ms: deps.now() - started,
        prompt_tokens: spent.tokens, total_tokens: spent.tokens, cost_usd: spent.cost,
        raw_usage: { ...usage, status: err instanceof EmbeddingError ? err.status ?? null : null },
      });
      throw new IngestError('embed_failed', message, true, err instanceof EmbeddingError ? err.status : undefined);
    }
    const split = splitSpend(shares, r.promptTokens, r.costUsd);
    split.forEach((x, k) => {
      members[involved[k]]!.spend.tokens += x.tokens;
      members[involved[k]]!.spend.cost += x.cost;
    });
    await deps.db.logCall({
      ...base, model_served: r.model, status: 'success', error_message: null, latency_ms: deps.now() - started,
      prompt_tokens: r.promptTokens, total_tokens: r.promptTokens, cost_usd: r.costUsd,
      raw_usage: { ...usage, requests: r.requests, shares: split.map((x) => x.tokens) },
    });
    return r.vectors;
  };

  // 3. Each job commits its own rows, under its own token.
  const commitItems = async (items: Item[], vectors: number[][]) => {
    for (const i of new Set(items.map((s) => s.i))) {
      const m = members[i]!;
      const mine = items.map((s, k) => ({ s, k })).filter(({ s }) => s.i === i);
      const rows = mine.map(({ s, k }) => ({ ...m.rows.get(s.chunk.chunk_hash)!, embedding: vectors[k] }));
      try {
        await deps.db.textCommit!(m.job.id, m.job.claim_token, rows);
        m.committed = true;
        m.done += rows.length;
      } catch (e) {
        m.error = e instanceof IngestError ? e : new IngestError('commit_failed', (e as Error).message, true);
      }
    }
  };

  let at = 0;
  for (const size of sizes) {
    const window = stream.slice(at, at + size).filter((s) => !members[s.i]!.error);
    at += size;
    if (!window.length) continue;
    if (reserveReached()) {
      deps.log('ingest.batch_budget', { job_ids: jobs.map((j) => j.id), next_input: at - size, inputs: stream.length });
      break;
    }
    const involved = [...new Set(window.map((s) => s.i))];
    let vectors: number[][];
    try {
      vectors = await embedCall(window);
    } catch (e) {
      if (!(e instanceof IngestError && e.code === 'embed_failed') || involved.length < 2) {
        // Only the jobs this call carried fail; their committed slices, and every other job, stay.
        failJobs(involved, e);
        continue;
      }
      // The call carried several jobs and one document may be the cause: each job's share is embedded alone,
      // in claim order, before any further window. Only a job whose own call fails is failed.
      let outOfTime = false;
      for (const i of involved) {
        const own = window.filter((s) => s.i === i);
        if (reserveReached()) {
          // Not started, so nothing of these jobs' share was committed: they get no error and are released
          // below, and the next claim embeds those chunks again.
          deps.log('ingest.batch_budget', { job_ids: jobs.map((j) => j.id), next_input: at - size, inputs: stream.length, solo_retry: true });
          outOfTime = true;
          break;
        }
        let solo: number[][];
        try {
          solo = await embedCall(own);
        } catch (soloError) {
          failJobs([i], soloError);
          continue;
        }
        await commitItems(own, solo);
      }
      if (outOfTime) break;
      continue;
    }
    await commitItems(window, vectors);
  }

  // 4. Each job: failed, released for the next claim, or activated (its last write).
  for (const [i, m] of members.entries()) {
    if (!m) continue;
    if (m.error) {
      outcomes[i] = failure(m.error, m.spend, m.committed, true);
    } else if (m.done < m.stale.length || deps.now() >= deadline - INDEX_STEP.deadlineReserveMs) {
      // Unfinished, or no time left to activate inside the reserve: released for the next claim, which
      // finds the committed slices and embeds nothing again.
      outcomes[i] = { patch: { progressed: m.committed, embed_tokens: m.spend.tokens, embed_cost_usd: m.spend.cost } };
    } else {
      try {
        // With nothing stale, one empty commit removes chunks outside the plan (as runIndexPlan does).
        if (!m.committed) await deps.db.textCommit!(m.job.id, m.job.claim_token, []);
        await deps.db.textActivate!(m.job.id, m.job.claim_token, m.spend.tokens, m.spend.cost);
        deps.log('ingest.index_activated', { job_id: m.job.id, chunks: m.keep.length, embed_tokens: m.spend.tokens });
        outcomes[i] = { patch: { progressed: true }, activated: true };
      } catch (e) {
        outcomes[i] = failure(e, m.spend, m.committed, true);
      }
    }
  }
  return outcomes.map((o) => o!);
}

export const suppliedBatchStep: BatchStep = (deps, jobs, deadline) => runSuppliedBatch(deps, jobs, deadline);
