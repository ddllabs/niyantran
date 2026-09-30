import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  type HandlerDeps,
  handleWorker,
  MAX_REPORTED_MESSAGE,
  redactMessage,
  type RunDeps,
  runOnce,
  secretMatches,
} from './handler.ts';
import {
  type AdvancePatch,
  INGEST,
  type IngestDb,
  IngestError,
  type IngestJob,
  type Step,
  type StepOutcome,
} from './types.ts';

// ─── Fakes ───────────────────────────────────────────────────────────────────

const SECRET = 'a'.repeat(16) + 'worker-secret-value';

function job(over: Partial<IngestJob> = {}): IngestJob {
  return {
    id: 'job-1',
    document_id: 'doc-1',
    status: 'running',
    stage: 'ocr',
    file_sha256: 'f'.repeat(64),
    ocr_hash: null,
    extract_hash: null,
    model_id: null,
    pages_total: 12,
    pages_per_call: 25,
    claim_token: 'token-1',
    lease_until: null,
    attempts: 1,
    next_attempt_at: null,
    error_code: null,
    last_error: null,
    ocr_pages: 0,
    ocr_cost_usd: 0,
    embed_tokens: 0,
    embed_cost_usd: 0,
    requested_by: null,
    created_at: '2026-10-01T00:00:00Z',
    started_at: null,
    finished_at: null,
    ...over,
  };
}

interface Recorder {
  claims: Array<[number, number]>;
  advances: Array<{ jobId: string; token: string; patch: AdvancePatch }>;
  stepCalls: Array<{ stage: string; job: IngestJob; deadline: number }>;
  logs: Array<{ event: string; fields: Record<string, unknown> }>;
}

function unused(name: string) {
  return () => Promise.reject(new Error(`${name} must not be called by the entry point`));
}

function fakeRun(opts: {
  jobs?: IngestJob[];
  claimError?: Error;
  advanceError?: Error;
  ocr?: Step;
  index?: Step;
  now?: number;
  secrets?: string[];
  logThrows?: boolean;
} = {}): { deps: RunDeps; rec: Recorder } {
  const rec: Recorder = { claims: [], advances: [], stepCalls: [], logs: [] };
  const db: IngestDb = {
    claim(limit, lease) {
      rec.claims.push([limit, lease]);
      return opts.claimError ? Promise.reject(opts.claimError) : Promise.resolve(opts.jobs ?? []);
    },
    advance(jobId, token, patch) {
      rec.advances.push({ jobId, token, patch });
      return opts.advanceError ? Promise.reject(opts.advanceError) : Promise.resolve();
    },
    activate: unused('activate'),
    files: unused('files'),
    ocrPageNumbers: unused('ocrPageNumbers'),
    ocrPages: unused('ocrPages'),
    upsertOcrPages: unused('upsertOcrPages'),
    upsertPages: unused('upsertPages'),
    upsertBlocks: unused('upsertBlocks'),
    upsertImages: unused('upsertImages'),
    blockIds: unused('blockIds'),
    imageIds: unused('imageIds'),
    storedChunks: unused('storedChunks'),
    chunkCommit: unused('chunkCommit'),
    logCall: unused('logCall'),
  };
  const recordStep = (stage: string, inner?: Step): Step => async (d, j, deadline) => {
    rec.stepCalls.push({ stage, job: j, deadline });
    if (!inner) return { patch: { progressed: true } };
    return await inner(d, j, deadline);
  };
  const deps: RunDeps = {
    db,
    storage: { signedUrl: unused('signedUrl'), exists: unused('exists'), upload: unused('upload') },
    ocr: unused('ocr'),
    embed: unused('embed'),
    documentUrlOverride: () => null,
    now: () => opts.now ?? 1_000_000,
    log: (event, fields) => {
      rec.logs.push({ event, fields });
      if (opts.logThrows) throw new Error('log sink down');
    },
    steps: { ocr: recordStep('ocr', opts.ocr), index: recordStep('index', opts.index) },
    secrets: opts.secrets,
  };
  return { deps, rec };
}

function handlerDeps(run: RunDeps, over: Partial<HandlerDeps> = {}) {
  const scheduled: Promise<unknown>[] = [];
  const logs: string[] = [];
  const deps: HandlerDeps = {
    secret: SECRET,
    waitUntil: (p) => void scheduled.push(p),
    worker: () => run,
    log: (event) => void logs.push(event),
    ...over,
  };
  return { deps, scheduled, logs };
}

function post(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/functions/v1/ingest-worker', { method: 'POST', headers });
}

// ─── The handler ─────────────────────────────────────────────────────────────

Deno.test('the right secret gets 202 and the work is handed to waitUntil', async () => {
  const { deps: run } = fakeRun();
  const h = handlerDeps(run);
  const res = await handleWorker(post({ 'x-ingest-secret': SECRET }), h.deps);
  assertEquals(res.status, 202);
  assertEquals(h.scheduled.length, 1);
  await Promise.all(h.scheduled);
});

Deno.test('a wrong secret is refused with 401, no detail and no work scheduled', async () => {
  const { deps: run, rec } = fakeRun({ jobs: [job()] });
  const h = handlerDeps(run);
  const res = await handleWorker(post({ 'x-ingest-secret': SECRET.replace(/.$/, 'X') }), h.deps);
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: 'unauthorized' });
  assertEquals(h.scheduled.length, 0);
  assertEquals(rec.claims.length, 0);
});

Deno.test('a missing x-ingest-secret header is refused', async () => {
  const { deps: run } = fakeRun();
  const h = handlerDeps(run);
  const res = await handleWorker(post({ authorization: `Bearer ${SECRET}` }), h.deps);
  assertEquals(res.status, 401);
  assertEquals(h.scheduled.length, 0);
});

Deno.test('an empty configured secret refuses every request, including an empty header (fail closed)', async () => {
  const { deps: run } = fakeRun();
  for (const given of ['', 'anything', SECRET]) {
    const h = handlerDeps(run, { secret: '' });
    const res = await handleWorker(post({ 'x-ingest-secret': given }), h.deps);
    assertEquals(res.status, 401, `header "${given}"`);
    assertEquals(await res.json(), { error: 'unauthorized' });
    assertEquals(h.scheduled.length, 0);
    assertEquals(h.logs, ['worker.secret_unset'], 'the operator sees why');
  }
});

Deno.test('a prefix or an extension of the secret is refused (length-safe comparison)', async () => {
  const { deps: run } = fakeRun();
  for (const given of [SECRET.slice(0, -1), SECRET + 'x', SECRET.slice(0, 1)]) {
    const h = handlerDeps(run);
    assertEquals((await handleWorker(post({ 'x-ingest-secret': given }), h.deps)).status, 401, given);
  }
});

Deno.test('secretMatches compares digests, so inputs of any length compare without throwing', async () => {
  assert(await secretMatches(SECRET, SECRET));
  assertFalse(await secretMatches('', SECRET));
  assertFalse(await secretMatches(SECRET, ''));
  assertFalse(await secretMatches('x'.repeat(10_000), SECRET));
  assertFalse(await secretMatches('é', 'e'));
});

Deno.test('GET is 405 and never reaches the secret check or the work', async () => {
  const { deps: run } = fakeRun();
  const h = handlerDeps(run);
  const res = await handleWorker(
    new Request('http://localhost/', { method: 'GET', headers: { 'x-ingest-secret': SECRET } }),
    h.deps,
  );
  assertEquals(res.status, 405);
  assertEquals(h.scheduled.length, 0);
});

Deno.test('the 202 does not wait for the work: a step that has not finished still gets its advance later', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { deps: run, rec } = fakeRun({
    jobs: [job()],
    ocr: async () => {
      await gate;
      return { patch: { progressed: true, ocr_pages: 3 } };
    },
  });
  const h = handlerDeps(run);
  const res = await handleWorker(post({ 'x-ingest-secret': SECRET }), h.deps);
  assertEquals(res.status, 202);
  // Let the claim resolve so the step is running and blocked on the gate.
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(rec.stepCalls.length, 1);
  assertEquals(rec.advances.length, 0, 'the step has not finished, so nothing has advanced yet');
  release();
  await Promise.all(h.scheduled);
  assertEquals(rec.advances.length, 1);
  assertEquals(rec.advances[0].patch, { progressed: true, ocr_pages: 3 });
});

Deno.test('a worker that cannot be configured gives 503 without detail and schedules nothing', async () => {
  const h = handlerDeps(fakeRun().deps, {
    worker: () => {
      throw new Error('SUPABASE_SECRET_KEYS is not set sb_secret_abcdefghijklmnop');
    },
  });
  const res = await handleWorker(post({ 'x-ingest-secret': SECRET }), h.deps);
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { error: 'worker not configured' });
  assertEquals(h.scheduled.length, 0);
  assert(h.logs.includes('worker.config_error'));
});

// ─── runOnce ─────────────────────────────────────────────────────────────────

Deno.test('runOnce claims one job with the 300 s lease; nothing claimed means no step and no advance', async () => {
  const { deps, rec } = fakeRun({ jobs: [] });
  await runOnce(deps);
  assertEquals(rec.claims, [[1, INGEST.leaseSeconds]]);
  assertEquals(rec.stepCalls.length, 0);
  assertEquals(rec.advances.length, 0);
  assert(rec.logs.some((l) => l.event === 'worker.idle'));
});

Deno.test('an ocr job runs the ocr step and advances with its patch under the claim token', async () => {
  const patch: AdvancePatch = { progressed: true, ocr_pages: 25, ocr_cost_usd: 0.1, stage: 'index' };
  const { deps, rec } = fakeRun({ jobs: [job({ stage: 'ocr' })], ocr: () => Promise.resolve({ patch }) });
  await runOnce(deps);
  assertEquals(rec.stepCalls.map((s) => s.stage), ['ocr']);
  assertEquals(rec.advances, [{ jobId: 'job-1', token: 'token-1', patch }]);
});

Deno.test('an index job runs the index step; an activated outcome is never advanced', async () => {
  const { deps, rec } = fakeRun({
    jobs: [job({ stage: 'index' })],
    index: () => Promise.resolve<StepOutcome>({ patch: { progressed: true }, activated: true }),
  });
  await runOnce(deps);
  assertEquals(rec.stepCalls.map((s) => s.stage), ['index']);
  assertEquals(rec.advances.length, 0);
});

Deno.test('an index outcome without activated is advanced', async () => {
  const { deps, rec } = fakeRun({
    jobs: [job({ stage: 'index' })],
    index: () => Promise.resolve<StepOutcome>({ patch: { progressed: true, embed_tokens: 10 } }),
  });
  await runOnce(deps);
  assertEquals(rec.advances.map((a) => a.patch), [{ progressed: true, embed_tokens: 10 }]);
});

Deno.test('the deadline passed to the step is now + 100 s', async () => {
  const { deps, rec } = fakeRun({ jobs: [job()], now: 5_000 });
  await runOnce(deps);
  assertEquals(rec.stepCalls[0].deadline, 5_000 + 100_000);
  assertEquals(INGEST.budgetMs, 100_000);
});

Deno.test('a thrown IngestError is reported with its code and permanence, no progress', async () => {
  const { deps, rec } = fakeRun({
    jobs: [job()],
    ocr: () => Promise.reject(new IngestError('mistral_rejected', 'Mistral OCR HTTP 422: bad document', true, 422)),
  });
  await runOnce(deps);
  assertEquals(rec.advances.length, 1);
  assertEquals(rec.advances[0].patch, {
    progressed: false,
    error: { code: 'mistral_rejected', message: 'Mistral OCR HTTP 422: bad document', permanent: true },
  });
});

Deno.test('a thrown plain Error is reported as internal and not permanent', async () => {
  const { deps, rec } = fakeRun({ jobs: [job()], ocr: () => Promise.reject(new TypeError('x is undefined')) });
  await runOnce(deps);
  assertEquals(rec.advances[0].patch, {
    progressed: false,
    error: { code: 'internal', message: 'x is undefined', permanent: false },
  });
});

Deno.test('a thrown non-Error value is reported as internal', async () => {
  const { deps, rec } = fakeRun({ jobs: [job()], ocr: () => Promise.reject('boom') });
  await runOnce(deps);
  assertEquals(rec.advances[0].patch.error, { code: 'internal', message: 'boom', permanent: false });
});

Deno.test('the reported message loses signed-URL tokens, keys and long hex, in the patch and in the logs', async () => {
  const signed =
    'https://ref.supabase.co/storage/v1/object/sign/corpus/files/a.pdf?token=eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJ4In0.c2lnbmF0dXJl';
  const hex = '0123456789abcdef'.repeat(4);
  const message =
    `fetch ${signed} failed; key sk-or-v1-0123456789abcdefghij; Bearer abc.def.ghi; hash ${hex}; configured ${SECRET}`;
  const { deps, rec } = fakeRun({ jobs: [job()], ocr: () => Promise.reject(new Error(message)), secrets: [SECRET] });
  await runOnce(deps);
  const reported = rec.advances[0].patch.error!.message;
  for (
    const leaked of ['token=', 'eyJhbGciOiJIUzI1NiJ9', 'sk-or-v1-0123456789abcdefghij', 'abc.def.ghi', hex, SECRET]
  ) {
    assertFalse(reported.includes(leaked), `"${leaked}" leaked into ${reported}`);
    assertFalse(JSON.stringify(rec.logs).includes(leaked), `"${leaked}" leaked into the logs`);
  }
  assertStringIncludes(reported, 'https://ref.supabase.co/storage/v1/object/sign/corpus/files/a.pdf?[redacted]');
});

Deno.test('an error patch returned by a step is redacted too', async () => {
  const { deps, rec } = fakeRun({
    jobs: [job()],
    ocr: () =>
      Promise.resolve({
        patch: { progressed: false, error: { code: 'x', message: 'see https://h/p?sig=abc', permanent: false } },
      }),
  });
  await runOnce(deps);
  assertEquals(rec.advances[0].patch.error!.message, 'see https://h/p?[redacted]');
});

Deno.test('the reported message is truncated', async () => {
  const { deps, rec } = fakeRun({ jobs: [job()], ocr: () => Promise.reject(new Error('word '.repeat(1000))) });
  await runOnce(deps);
  assert(rec.advances[0].patch.error!.message.length <= MAX_REPORTED_MESSAGE);
});

Deno.test('an advance rejected by the fence is logged once and nothing else happens', async () => {
  const { deps, rec } = fakeRun({ jobs: [job()], advanceError: new Error('ingest_advance: claim token mismatch') });
  await runOnce(deps); // resolves: no unhandled rejection inside waitUntil
  assertEquals(rec.advances.length, 1, 'never retried');
  assertEquals(rec.stepCalls.length, 1);
  assert(rec.logs.some((l) => l.event === 'worker.advance_failed'));
});

Deno.test('an unexpected stage is reported as a permanent unexpected_stage error without running a step', async () => {
  const { deps, rec } = fakeRun({ jobs: [job({ stage: 'done' })] });
  await runOnce(deps);
  assertEquals(rec.stepCalls.length, 0);
  assertEquals(rec.advances.length, 1);
  assertEquals(rec.advances[0].patch.progressed, false);
  assertEquals(rec.advances[0].patch.error?.code, 'unexpected_stage');
  assertEquals(rec.advances[0].patch.error?.permanent, true);
});

Deno.test('a failed claim is logged and runOnce still resolves', async () => {
  const { deps, rec } = fakeRun({ claimError: new Error('ingest_claim: connection refused') });
  await runOnce(deps);
  assertEquals(rec.stepCalls.length, 0);
  assert(rec.logs.some((l) => l.event === 'worker.claim_failed'));
});

Deno.test('runOnce resolves even when the log sink throws', async () => {
  const { deps, rec } = fakeRun({ jobs: [job()], logThrows: true, advanceError: new Error('fenced') });
  await runOnce(deps);
  assertEquals(rec.advances.length, 1);
});

Deno.test('redactMessage keeps ordinary text', () => {
  assertEquals(redactMessage('pages 1,2,3 were not all stored'), 'pages 1,2,3 were not all stored');
  assertEquals(redactMessage('api_key=abc123&x=1 token: zzz'), 'api_key=[redacted]&x=1 token: [redacted]');
});
