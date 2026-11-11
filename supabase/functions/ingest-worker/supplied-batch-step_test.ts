// The multi-job supplied-text step and the worker's multi-job claim (C3b, design 8.3). The embedding
// provider is a stub; no network.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { EMBED_MODEL, EmbeddingError, type EmbedResult } from '../_shared/embed.ts';
import { prepareSuppliedText } from '../_shared/suppliedText.ts';
import { input } from '../_shared/suppliedText_fixture.ts';
import { sha256Hex } from '../_shared/textNormalise.ts';
import { type RunDeps, runOnce } from './handler.ts';
import { INDEX_STEP } from './index-step.ts';
import { runSuppliedBatch, splitSpend } from './supplied-batch-step.ts';
import { suppliedCommitRows, suppliedTextStep } from './supplied-step.ts';
import type { AdvancePatch, IngestCallLog, IngestDb, IngestJob, PageCommitRow, StepOutcome } from './types.ts';

const FAR = 1e15;
const BOUNDS = { maxCount: 96, maxTokens: 200_000, maxInputTokens: 7_000 };

/** A distinct Law record per n, valid for prepareSuppliedText. */
async function record(n: number, long = false) {
  const base = await input();
  // A long document is cut into several chunks; a short one is a single chunk.
  const paragraph = (k: number) => `Paragraph ${k} of order ${n}. ${'The appeal number '.concat(String(n), ' is dismissed with costs. ').repeat(40)}`;
  const text = long
    ? `# Order ${n}\n\n${[1, 2, 3].map(paragraph).join('\n\n')}`
    : `# Order ${n}\n\nThe appeal number ${n} is dismissed with costs.`;
  const sha = await sha256Hex(text);
  const key = `law:hc:test/order-${n}`;
  return {
    ...base, source_key: key, text, text_sha256: sha,
    pages: [{ page_number: 1, char_from: 0, char_to: [...text].length, text }],
    review: { ...base.review, source_key: key, text_sha256: sha },
  };
}

function job(n: number, over: Partial<IngestJob> = {}): IngestJob {
  return {
    id: `job-${n}`, input_kind: 'supplied_text', batch_id: 'batch-1', document_id: `doc-${n}`, status: 'running', stage: 'index',
    file_sha256: 'f'.repeat(64), ocr_hash: null, extract_hash: null, model_id: null, pages_total: 0, pages_per_call: 25,
    claim_token: `token-${n}`, lease_until: null, attempts: 1, next_attempt_at: null, error_code: null, last_error: null,
    ocr_pages: 0, ocr_cost_usd: 0, embed_tokens: 0, embed_cost_usd: 0, requested_by: null,
    created_at: '2026-11-02T00:00:00Z', started_at: null, finished_at: null, ...over,
  };
}

/** A number that depends on the whole input, so a vector stored on the wrong chunk shows. */
const vectorOf = (input: string) => [...input].reduce((h, c, k) => (h + c.charCodeAt(0) * (k + 1)) % 1_000_003, 7);

interface Recorder {
  commits: Array<{ jobId: string; token: string; hashes: string[] }>;
  activations: Array<{ jobId: string; token: string; tokens: number; cost: number }>;
  logs: IngestCallLog[];
  embedCalls: string[][];
  stored: Map<string, Map<string, PageCommitRow>>;
}

/** The database for jobs 1..n of one batch; job k's document is doc-k. */
async function world(n: number, opts: {
  staleToken?: string;
  failEmbedFor?: string;
  /** Tokens a failed call had already spent. */
  failTokens?: number;
  /** Documents that are cut into several chunks. */
  long?: number[];
  stored?: string[];
  badPlanFor?: string;
  now?: () => number;
} = {}) {
  const plans = new Map<string, Awaited<ReturnType<typeof prepareSuppliedText>>>();
  for (let k = 1; k <= n; k++) plans.set(`doc-${k}`, await prepareSuppliedText(await record(k, opts.long?.includes(k))));
  const rec: Recorder = { commits: [], activations: [], logs: [], embedCalls: [], stored: new Map() };
  for (const doc of opts.stored ?? []) {
    rec.stored.set(doc, new Map(suppliedCommitRows(plans.get(doc)!.chunks).map((r) => [r.chunk_hash, { ...r, embedding: [1] }])));
  }
  const docOf = (jobId: string) => `doc-${jobId.slice(4)}`;
  const unused = () => Promise.reject(new Error('not used by the batch step'));
  const db: IngestDb = {
    async textInput(documentId) {
      const p = plans.get(documentId)!;
      return { payload: p.payload, payload_sha256: documentId === opts.badPlanFor ? 'bad' : p.payload_sha256, expected: suppliedCommitRows(p.chunks) };
    },
    async textCommit(jobId, token, rows) {
      if (token === opts.staleToken) throw new Error('supplied text: stale claim');
      if (token !== `token-${jobId.slice(4)}`) throw new Error('a job committed under another job\'s token');
      const doc = docOf(jobId);
      const plan = new Set(plans.get(doc)!.chunks.map((c) => c.chunkHash));
      for (const r of rows) if (!plan.has(r.chunk_hash)) throw new Error(`a row of another document reached ${doc}`);
      const mine = rec.stored.get(doc) ?? new Map();
      for (const r of rows) mine.set(r.chunk_hash, r);
      rec.stored.set(doc, mine);
      rec.commits.push({ jobId, token, hashes: rows.map((r) => r.chunk_hash) });
      return { inserted: rows.length, kept: 0, deleted: 0 };
    },
    async textActivate(jobId, token, tokens, cost) {
      rec.activations.push({ jobId, token, tokens, cost });
    },
    async storedChunks(documentId, from, to) {
      return [...(rec.stored.get(documentId)?.values() ?? [])].map((r) => ({ chunk_hash: r.chunk_hash, embed_hash: r.embed_hash })).slice(from, to + 1);
    },
    async logCall(row) {
      rec.logs.push(row);
    },
    claim: unused, advance: unused, activate: unused, files: unused, ocrPageNumbers: unused, ocrPages: unused,
    upsertOcrPages: unused, upsertPages: unused, upsertBlocks: unused, upsertImages: unused, blockIds: unused,
    imageIds: unused, chunkCommit: unused,
  };
  const embed = async (inputs: string[]): Promise<EmbedResult> => {
    rec.embedCalls.push(inputs);
    if (opts.failEmbedFor && inputs.some((i) => i.includes(opts.failEmbedFor!))) {
      const spent = opts.failTokens ?? 0;
      throw new EmbeddingError('embeddings HTTP 400: bad input', { costUsd: spent * 2e-8, promptTokens: spent }, 400);
    }
    const tokens = inputs.reduce((t, i) => t + Math.ceil(i.length / 4), 0) + 1;
    return { vectors: inputs.map((i) => [vectorOf(i)]), model: EMBED_MODEL, promptTokens: tokens, costUsd: tokens * 2e-8, requests: 1 };
  };
  const deps = {
    db, embed, storage: { signedUrl: unused, exists: unused, upload: unused }, ocr: unused,
    documentUrlOverride: () => null, now: opts.now ?? (() => 0), log: () => {},
  };
  const chunksOf = (doc: string) => plans.get(doc)!.chunks.map((c) => c.chunkHash);
  return { deps, rec, chunksOf };
}

Deno.test('batch: small documents share one embedding call; each commits under its own token and activates with its share', async () => {
  const { deps, rec, chunksOf } = await world(3);
  const out = await runSuppliedBatch(deps, [job(1), job(2), job(3)], FAR, BOUNDS);
  assertEquals(rec.embedCalls.length, 1, 'one call for three documents');
  assertEquals(rec.logs.length, 1);
  assertEquals(rec.logs[0].raw_usage.job_ids, ['job-1', 'job-2', 'job-3']);
  assertEquals(rec.logs[0].raw_usage.batch_id, 'batch-1', 'the call is attributed to its batch, so a killed claim\'s spend still counts');
  assertEquals(rec.commits.map((c) => [c.jobId, c.token]), [['job-1', 'token-1'], ['job-2', 'token-2'], ['job-3', 'token-3']]);
  for (const k of [1, 2, 3]) assertEquals(rec.commits[k - 1].hashes, chunksOf(`doc-${k}`));
  assert(out.every((o) => o.activated));
  assertEquals(rec.activations.map((a) => a.token), ['token-1', 'token-2', 'token-3']);
  assertEquals(rec.activations.reduce((t, a) => t + a.tokens, 0), rec.logs[0].prompt_tokens, 'tokens split exactly');
  const cost = rec.activations.reduce((t, a) => t + a.cost, 0);
  assert(Math.abs(cost - rec.logs[0].cost_usd) < 1e-15, 'cost split adds up to the call');
});

Deno.test('batch: splitSpend gives every token to exactly one job, by share', () => {
  assertEquals(splitSpend([1, 1, 1], 10, 0.3).map((s) => s.tokens), [4, 3, 3]);
  assertEquals(splitSpend([3, 1], 8, 0.8).map((s) => s.tokens), [6, 2]);
  assertEquals(splitSpend([0, 0], 5, 1).map((s) => s.tokens).reduce((a, b) => a + b), 5);
  const s = splitSpend([5, 2, 9], 1001, 0.00002002);
  assertEquals(s.reduce((a, b) => a + b.tokens, 0), 1001);
  assert(Math.abs(s.reduce((a, b) => a + b.cost, 0) - 0.00002002) < 1e-18);
});

Deno.test('batch: a stale claim fences its own job only; no row is ever sent under another job\'s token', async () => {
  const { deps, rec } = await world(2, { staleToken: 'token-1' });
  const out = await runSuppliedBatch(deps, [job(1), job(2)], FAR, BOUNDS);
  assertEquals(out[0].patch.error?.code, 'commit_failed');
  assertEquals(out[0].patch.error?.permanent, true, 'supplied text after paid work is reconciled, not retried');
  assert(out[0].patch.embed_tokens! > 0, 'the fenced job still reports the spend it caused');
  assertFalse(out[0].activated);
  assert(out[1].activated);
  assertEquals(rec.commits.map((c) => c.jobId), ['job-2']);
  assertEquals(rec.activations.map((a) => a.jobId), ['job-2']);
  assertFalse(rec.stored.has('doc-1'));
});

Deno.test('batch: one job\'s embedding failure leaves the others\' committed slices intact', async () => {
  const { deps, rec, chunksOf } = await world(2, { failEmbedFor: 'appeal number 2' });
  // One input per call, so job 1 and job 2 are embedded by separate calls.
  const out = await runSuppliedBatch(deps, [job(1), job(2)], FAR, { ...BOUNDS, maxCount: 1 });
  assert(out[0].activated);
  assertEquals([...rec.stored.get('doc-1')!.keys()], chunksOf('doc-1'));
  assertEquals(out[1].patch.error?.code, 'embed_failed');
  assertEquals(out[1].patch.error?.permanent, true);
  assertFalse(rec.stored.has('doc-2'));
  assertEquals(rec.logs.map((l) => l.status), ['success', 'error'], 'the failed call is logged too');
  assertEquals(rec.logs[1].raw_usage.job_ids, ['job-2']);
});

Deno.test('batch: when a shared call fails, each job is embedded alone; only the job whose own call fails is failed', async () => {
  const { deps, rec, chunksOf } = await world(3, { failEmbedFor: 'appeal number 2', failTokens: 6 });
  const out = await runSuppliedBatch(deps, [job(1), job(2), job(3)], FAR, BOUNDS);
  assertEquals(rec.embedCalls.length, 4, 'the shared call, then one call per job');
  assertEquals(rec.logs.map((l) => l.status), ['error', 'success', 'error', 'success']);
  assertEquals(rec.logs.map((l) => l.raw_usage.job_ids), [['job-1', 'job-2', 'job-3'], ['job-1'], ['job-2'], ['job-3']]);
  assert(rec.logs.every((l) => l.raw_usage.batch_id === 'batch-1'), 'every call, failed or solo, carries the batch');
  assertEquals(out.map((o) => !!o.activated), [true, false, true]);
  assertEquals(out[1].patch.error?.code, 'embed_failed');
  assertEquals(out[1].patch.error?.permanent, true);
  assertEquals(out[0].patch.error, undefined);
  assertEquals(out[2].patch.error, undefined);
  assertEquals(rec.commits.map((c) => c.jobId), ['job-1', 'job-3']);
  assertEquals(rec.commits[0].hashes, chunksOf('doc-1'));
  assertEquals(rec.commits[1].hashes, chunksOf('doc-3'));
  assertFalse(rec.stored.has('doc-2'));
  // Every token and unit of cost the four calls spent reaches exactly one job.
  const reported = [out[1].patch.embed_tokens!, ...rec.activations.map((a) => a.tokens)];
  assertEquals(reported.reduce((a, b) => a + b, 0), rec.logs.reduce((t, l) => t + (l.prompt_tokens ?? 0), 0));
  const cost = out[1].patch.embed_cost_usd! + rec.activations.reduce((t, a) => t + a.cost, 0);
  assert(Math.abs(cost - rec.logs.reduce((t, l) => t + l.cost_usd, 0)) < 1e-15, 'cost adds up to the calls');
  // The three documents are the same size, so the failed call's 6 tokens split 2/2/2; a solo call's tokens
  // go to its job alone, on top of that share.
  assertEquals(rec.activations[0].tokens, 2 + rec.logs[1].prompt_tokens!, 'job 1: its share of the failed call plus its own call');
  assertEquals(out[1].patch.embed_tokens, 2 + 6, 'job 2: its share of the failed call plus its own failed call');
  assertEquals(rec.activations[1].tokens, 2 + rec.logs[3].prompt_tokens!);
});

Deno.test('batch: when every call fails, every job fails, and the calls are the shared one plus one per job', async () => {
  const { deps, rec } = await world(3, { failEmbedFor: 'appeal number' });
  const out = await runSuppliedBatch(deps, [job(1), job(2), job(3)], FAR, BOUNDS);
  assertEquals(rec.embedCalls.length, 4);
  assertEquals(rec.logs.map((l) => l.status), ['error', 'error', 'error', 'error']);
  for (const o of out) {
    assertEquals(o.patch.error?.code, 'embed_failed');
    assertEquals(o.patch.error?.permanent, true);
    assertFalse(o.activated);
  }
  assertEquals(rec.commits, []);
});

Deno.test('batch: a failed shared call whose carried jobs cannot be retried inside the deadline reserve releases them with no error', async () => {
  const deadline = 1_000_000;
  let failed = false;
  const w = await world(3, { failEmbedFor: 'appeal number 2', failTokens: 6, now: () => (failed ? deadline - INDEX_STEP.deadlineReserveMs : 0) });
  const embed = w.deps.embed;
  w.deps.embed = async (inputs: string[]) => {
    try {
      return await embed(inputs);
    } catch (e) {
      failed = true;
      throw e;
    }
  };
  const out = await runSuppliedBatch(w.deps, [job(1), job(2), job(3)], deadline, BOUNDS);
  assertEquals(w.rec.embedCalls.length, 1, 'no solo call starts inside the reserve');
  assertEquals(w.rec.logs.map((l) => l.status), ['error']);
  for (const o of out) {
    assertEquals(o.patch.error, undefined, 'no job is failed for a call it did not get to retry');
    assertFalse(o.activated);
    assertEquals(o.patch.progressed, false, 'nothing of it was committed, so the next claim embeds it');
  }
  assertEquals(out.reduce((t, o) => t + o.patch.embed_tokens!, 0), 6, 'the failed call\'s spend is still reported, once');
  assertEquals(w.rec.commits, []);
  assertEquals(w.rec.activations, []);
});

Deno.test('batch: a job whose chunks span two windows recovers in the first by its solo call and finishes in the second, each chunk embedded once', async () => {
  // doc-2 has several chunks; two inputs per call: window 1 is doc-1's chunk and doc-2's first.
  const { deps, rec, chunksOf } = await world(2, { failEmbedFor: 'appeal number 1', long: [2] });
  const mine = chunksOf('doc-2');
  assert(mine.length >= 3, 'doc-2 needs a chunk beyond the first window');
  const later = mine.length - 1;
  const laterWindows = Array.from({ length: Math.ceil(later / 2) }, (_, k) => Math.min(2, later - 2 * k));
  const out = await runSuppliedBatch(deps, [job(1), job(2)], FAR, { ...BOUNDS, maxCount: 2 });
  assertEquals(out[0].patch.error?.code, 'embed_failed');
  assert(out[1].activated);
  assertEquals(out[1].patch.error, undefined);
  assertEquals(rec.commits.filter((c) => c.jobId === 'job-2').map((c) => c.hashes.length), [1, ...laterWindows], 'first window\'s share, then the later windows');
  assertEquals(rec.commits.filter((c) => c.jobId === 'job-2').flatMap((c) => c.hashes), mine, 'every chunk committed exactly once, in order');
  assertEquals([...rec.stored.get('doc-2')!.keys()], mine);
  const embedded = rec.embedCalls.filter((c) => !c.some((i) => i.includes('appeal number 1'))).flat();
  assertEquals(embedded.length, mine.length, 'a chunk is embedded once in any call that succeeded');
  assertEquals(rec.embedCalls.length, 1 + 2 + laterWindows.length);
});

Deno.test('batch: after a failed shared call, each chunk is stored with the vector of its own input', async () => {
  // Three inputs per call: window 1 is doc-1's chunk and doc-2's first two, so doc-2's solo call carries two inputs.
  const { deps, rec, chunksOf } = await world(2, { failEmbedFor: 'appeal number 1', long: [2] });
  const mine = chunksOf('doc-2');
  assert(mine.length >= 3, 'doc-2 needs chunks in the solo call and in a later window');
  const out = await runSuppliedBatch(deps, [job(1), job(2)], FAR, { ...BOUNDS, maxCount: 3 });
  assert(out[1].activated);
  // doc-1's calls fail, so the calls that succeeded carried doc-2's inputs only, in chunk order.
  const inputs = rec.embedCalls.filter((c) => !c.some((i) => i.includes('appeal number 1'))).flat();
  assertEquals(inputs.length, mine.length);
  assertEquals(new Set(inputs.map(vectorOf)).size, mine.length, 'the test needs a different vector for every chunk');
  assertEquals(rec.embedCalls[2].length, 2, 'the solo call for doc-2 carries its two chunks of the failed window');
  const stored = rec.stored.get('doc-2')!;
  assertEquals(mine.map((h) => stored.get(h)!.embedding), inputs.map((i) => [vectorOf(i)]));
});

Deno.test('batch: a call that was paid for and then could not be logged is not bought again', async () => {
  const w = await world(3);
  w.deps.db.logCall = () => Promise.reject(new Error('log insert failed'));
  const out = await runSuppliedBatch(w.deps, [job(1), job(2), job(3)], FAR, BOUNDS);
  assertEquals(w.rec.embedCalls.length, 1, 'only an embedding failure is retried job by job');
  for (const o of out) {
    assertEquals(o.patch.error?.code, 'internal');
    assertEquals(o.patch.error?.permanent, true);
    assertFalse(o.activated);
  }
});

Deno.test('batch: the deadline reserve reached between solo calls releases the jobs not yet retried, with no error', async () => {
  const deadline = 1_000_000;
  let late = false;
  // doc-3's input fails the shared call and would fail its own; the reserve is reached once doc-1's solo call returns.
  const w = await world(3, { failEmbedFor: 'appeal number 3', now: () => (late ? deadline - INDEX_STEP.deadlineReserveMs : 0) });
  const embed = w.deps.embed;
  w.deps.embed = async (inputs: string[]) => {
    const r = await embed(inputs);
    if (w.rec.embedCalls.length === 2) late = true;
    return r;
  };
  const out = await runSuppliedBatch(w.deps, [job(1), job(2), job(3)], deadline, BOUNDS);
  assertEquals(w.rec.embedCalls.length, 2, 'the shared call and doc-1 alone; no call starts inside the reserve');
  assertEquals(out[0].patch.error, undefined);
  assertEquals(out[0].patch.progressed, true, 'doc-1 keeps what its solo call committed');
  for (const o of [out[1], out[2]]) {
    assertEquals(o.patch.error, undefined);
    assertEquals(o.patch.progressed, false);
    assertFalse(o.activated);
  }
  const reported = out.reduce((t, o) => t + (o.patch.embed_tokens ?? 0), 0);
  assertEquals(reported, w.rec.logs.reduce((t, l) => t + (l.prompt_tokens ?? 0), 0), 'reported tokens equal the logged calls');
});

Deno.test('batch: the deadline reserve holds across jobs: no call starts inside it, unfinished jobs are released', async () => {
  let calls = 0;
  const deadline = 1_000_000;
  // The first call happens at time 0; every later check sees the reserve reached.
  const { deps, rec } = await world(2, { now: () => (calls++ === 0 ? 0 : deadline - INDEX_STEP.deadlineReserveMs) });
  const out = await runSuppliedBatch(deps, [job(1), job(2)], deadline, { ...BOUNDS, maxCount: 1 });
  assertEquals(rec.embedCalls.length, 1);
  assertFalse(out[0].activated, 'inside the reserve, even a fully committed job is not activated');
  assertEquals(out[0].patch.progressed, true, 'it is released with its committed slices');
  assertFalse(out[1].activated);
  assertEquals(out[1].patch, { progressed: false, embed_tokens: 0, embed_cost_usd: 0 }, 'released with no stage change and no error');
  assertEquals(rec.activations, []);
});

Deno.test('batch: the deadline reserve also holds before each activation; committed jobs are released for the next claim', async () => {
  const deadline = 1_000_000;
  // Embedding happens in time; from then on every check sees the reserve reached.
  let embedded = false;
  const w = await world(2, { now: () => (embedded ? deadline - INDEX_STEP.deadlineReserveMs : 0) });
  const embed = w.deps.embed;
  w.deps.embed = async (inputs: string[]) => {
    const r = await embed(inputs);
    embedded = true;
    return r;
  };
  const out = await runSuppliedBatch(w.deps, [job(1), job(2)], deadline, BOUNDS);
  assertEquals(w.rec.activations, [], 'no activation starts inside the reserve');
  for (const o of out) {
    assertFalse(o.activated);
    assertEquals(o.patch.progressed, true, 'its slices are committed');
    assertEquals(o.patch.error, undefined);
    assert(o.patch.embed_tokens! > 0, 'and its spend is reported');
  }
  assertEquals(w.rec.commits.length, 2);
});

Deno.test('batch: committed chunks are never embedded again; a job with nothing stale commits nothing new and activates', async () => {
  const { deps, rec } = await world(2, { stored: ['doc-1'] });
  const out = await runSuppliedBatch(deps, [job(1), job(2)], FAR, BOUNDS);
  assertEquals(rec.embedCalls.length, 1);
  assert(rec.embedCalls[0].every((i) => i.includes('appeal number 2')), 'only job 2 is embedded');
  assertEquals(rec.commits.map((c) => [c.jobId, c.hashes.length]), [['job-2', 1], ['job-1', 0]], 'job 1 gets the empty commit that removes strays');
  assert(out.every((o) => o.activated));
  assertEquals(rec.activations.find((a) => a.jobId === 'job-1')!.tokens, 0);
});

Deno.test('batch: a job whose stored plan changed is refused before any paid work; the others proceed', async () => {
  const { deps, rec } = await world(2, { badPlanFor: 'doc-1' });
  const out = await runSuppliedBatch(deps, [job(1), job(2)], FAR, BOUNDS);
  assertEquals(out[0].patch.error?.code, 'text_changed');
  assertEquals(out[0].patch.embed_tokens, 0);
  assert(rec.embedCalls.every((call) => call.every((i) => !i.includes('appeal number 1'))));
  assert(out[1].activated);
});

// ─── The worker's claim ──────────────────────────────────────────────────────

function runDeps(opts: { settings?: () => Promise<{ max_running: number; claim_batch: number }>; jobs: IngestJob[] }) {
  const rec = { claims: [] as number[], batchCalls: [] as string[][], indexCalls: [] as string[], advances: [] as Array<[string, string, AdvancePatch]> };
  const unused = () => Promise.reject(new Error('unused'));
  const deps: RunDeps = {
    db: {
      settings: opts.settings,
      claim: async (limit) => {
        rec.claims.push(limit);
        return opts.jobs;
      },
      advance: async (id, token, patch) => void rec.advances.push([id, token, patch]),
      activate: unused, files: unused, ocrPageNumbers: unused, ocrPages: unused, upsertOcrPages: unused, upsertPages: unused,
      upsertBlocks: unused, upsertImages: unused, blockIds: unused, imageIds: unused, storedChunks: unused, chunkCommit: unused, logCall: unused,
    },
    storage: { signedUrl: unused, exists: unused, upload: unused }, ocr: unused, embed: unused, documentUrlOverride: () => null,
    now: () => 0, log: () => {},
    steps: {
      ocr: async () => ({ patch: { progressed: true } }),
      index: async (_d, j) => {
        rec.indexCalls.push(j.id);
        return { patch: { progressed: true } };
      },
      suppliedBatch: async (_d, js): Promise<StepOutcome[]> => {
        rec.batchCalls.push(js.map((j) => j.id));
        return js.map((j, i) => (i === 0 ? { patch: { progressed: true }, activated: true } : { patch: { progressed: false, error: { code: 'x', message: `fail ${j.id}`, permanent: true } } }));
      },
    },
  };
  return { deps, rec };
}

Deno.test('worker: claim_batch comes from ingest_settings, and one batch\'s jobs run together, each reported under its token', async () => {
  const { deps, rec } = runDeps({ settings: async () => ({ max_running: 8, claim_batch: 4 }), jobs: [job(1), job(2)] });
  await runOnce(deps);
  assertEquals(rec.claims, [4]);
  assertEquals(rec.batchCalls, [['job-1', 'job-2']]);
  assertEquals(rec.indexCalls, []);
  assertEquals(rec.advances.map(([id, token]) => [id, token]), [['job-2', 'token-2']], 'an activated job is not advanced; the other is, under its own token');
});

Deno.test('worker: without settings, or when they cannot be read, it claims one job as before', async () => {
  const none = runDeps({ jobs: [job(1, { batch_id: null })] });
  await runOnce(none.deps);
  assertEquals(none.rec.claims, [1]);
  const broken = runDeps({ settings: () => Promise.reject(new Error('down')), jobs: [job(1, { batch_id: null })] });
  await runOnce(broken.deps);
  assertEquals(broken.rec.claims, [1]);
  assertEquals(broken.rec.indexCalls, ['job-1']);
});

Deno.test('worker: a multi-job claim that is not one batch runs job by job; none is left running', async () => {
  const { deps, rec } = runDeps({
    settings: async () => ({ max_running: 8, claim_batch: 3 }),
    jobs: [job(1, { batch_id: null }), job(2, { batch_id: null }), job(3, { batch_id: 'batch-2' })],
  });
  await runOnce(deps);
  assertEquals(rec.batchCalls, []);
  assertEquals(rec.indexCalls, ['job-1', 'job-2', 'job-3']);
  assertEquals(rec.advances.map(([id]) => id), ['job-1', 'job-2', 'job-3']);
});

Deno.test('worker: a batch step that throws reports every job of the claim, none left running', async () => {
  const { deps, rec } = runDeps({ settings: async () => ({ max_running: 8, claim_batch: 2 }), jobs: [job(1), job(2)] });
  deps.steps.suppliedBatch = () => Promise.reject(new Error('boom'));
  await runOnce(deps);
  assertEquals(rec.advances.map(([id, , p]) => [id, p.error?.code]), [['job-1', 'internal'], ['job-2', 'internal']]);
});

Deno.test('single job: a batch job\'s embedding call is attributed to its batch in model_call_logs', async () => {
  const { deps, rec } = await world(1);
  const out = await suppliedTextStep(deps, job(1), FAR);
  assert(out.activated);
  assertEquals(rec.logs[0].raw_usage.batch_id, 'batch-1');
  const solo = await world(1);
  await suppliedTextStep(solo.deps, job(1, { batch_id: null }), FAR);
  assertFalse('batch_id' in solo.rec.logs[0].raw_usage, 'a job without a batch logs as before');
});
