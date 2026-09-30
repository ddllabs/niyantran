import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { callMistralOcr, ocrCostUsd } from './mistral.ts';
import { ocrHash } from './hashes.ts';
import { nextRange, OCR_CALL_RESERVE_MS, ocrStep } from './ocr.ts';
import {
  type FilePart,
  filePath,
  INGEST,
  type IngestCallLog,
  IngestError,
  type IngestJob,
  type MistralOcrPage,
  OCR_MODEL,
  type OcrCallResult,
  type OcrRequest,
  type StoredOcrPage,
  type WorkerDeps,
} from './types.ts';
import { dataUri, MAGIC, PNG_1X1_BASE64, toBase64, withMagic } from './__fixtures__/images.ts';

const FIXTURE_TEXT = await Deno.readTextFile(new URL('../_shared/__fixtures__/mistral-bill-12p.json', import.meta.url));
const FIXTURE = JSON.parse(FIXTURE_TEXT);
const FIXTURE_PAGES = FIXTURE.pages as MistralOcrPage[];

const DOC_ID = 'doc-1';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const PINNED_HASH = 'o'.repeat(64);
const FAR = 1e12;

function part(sha256: string, part_index: number, page_offset: number, page_count: number): FilePart {
  return {
    document_id: DOC_ID,
    part_index,
    page_offset,
    page_count,
    sha256,
    byte_size: 1000,
    storage_path: filePath(sha256),
  };
}

function makeJob(over: Partial<IngestJob> = {}): IngestJob {
  return {
    id: 'job-1',
    document_id: DOC_ID,
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

/** A job whose model and hashes are already pinned (a resumed job). */
const pinnedJob = (over: Partial<IngestJob> = {}) =>
  makeJob({ model_id: 'mistral-ocr-pinned', ocr_hash: PINNED_HASH, extract_hash: 'e'.repeat(64), ...over });

const synthDoc = (n: number): MistralOcrPage[] =>
  Array.from({ length: n }, (_, i) => ({ index: i, markdown: `page ${i + 1}` }));

/** Persistent state shared by invocations: stored OCR pages, bucket objects, logs and an event trace. */
class World {
  events: string[] = [];
  pages = new Map<string, Map<number, StoredOcrPage>>();
  objects = new Map<string, Uint8Array>();
  logs: IngestCallLog[] = [];
  requests: OcrRequest[] = [];
  t = 0;
  failUpserts = 0;
  /** Mistral's answer; by default the fake below. */
  mistral: (req: OcrRequest) => Promise<OcrCallResult>;
  constructor(
    public parts: FilePart[],
    public doc: MistralOcrPage[],
    opts: { bytes?: (call: number) => number; msPerCall?: number } = {},
  ) {
    this.mistral = (req) => {
      const sha = /\/([0-9a-f]{64})\.pdf/.exec(req.document.document_url)?.[1];
      const p = this.parts.find((x) => x.sha256 === sha);
      if (!p) throw new Error(`fake Mistral: no part for ${req.document.document_url}`);
      // Mistral OCRs the part file, so a page's index is its index in the part.
      const pages = req.pages.map((i) => ({ ...structuredClone(this.doc[p.page_offset + i]), index: i }));
      this.t += opts.msPerCall ?? 0;
      return Promise.resolve({
        pages,
        model: 'mistral-ocr-latest',
        pagesProcessed: req.pages.length,
        docSizeBytes: 5000,
        bytes: opts.bytes?.(this.requests.length) ?? 1000,
        latencyMs: 7,
      });
    };
  }
  stored(hash: string): Map<number, StoredOcrPage> {
    if (!this.pages.has(hash)) this.pages.set(hash, new Map());
    return this.pages.get(hash)!;
  }
  seed(hash: string, pageNumbers: number[]) {
    for (const n of pageNumbers) {
      this.stored(hash).set(n, {
        page_number: n,
        raw: {
          index: n - 1,
          markdown: 'seeded',
          header: null,
          footer: null,
          dimensions: null,
          blocks: [],
          tables: [],
          images: [],
        },
      });
    }
  }
}

/** PostgREST's db-max-rows: a wider range is refused, and at most INGEST.readPage rows come back. */
function capped<T>(rows: T[], from: number, to: number, what: string): Promise<T[]> {
  if (to - from + 1 > INGEST.readPage) {
    return Promise.reject(new Error(`${what}: range ${from}-${to} is wider than db-max-rows`));
  }
  return Promise.resolve(rows.slice(from, Math.min(to + 1, from + INGEST.readPage)));
}

const unexpected = (name: string) => () => Promise.reject(new Error(`unexpected call: ${name}`));

function makeDeps(w: World, over: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    db: {
      claim: unexpected('claim'),
      advance: unexpected('advance'),
      activate: unexpected('activate'),
      files: (doc, from, to) => capped(w.parts.filter((p) => p.document_id === doc), from, to, 'files'),
      ocrPageNumbers: (doc, hash, from, to) =>
        capped(doc === DOC_ID ? [...w.stored(hash).keys()].sort((a, b) => a - b) : [], from, to, 'ocrPageNumbers'),
      ocrPages: unexpected('ocrPages'),
      upsertOcrPages: (doc, hash, pages) => {
        w.events.push(`upsert:${pages.map((p) => p.page_number).join(',')}`);
        if (w.failUpserts > 0) {
          w.failUpserts--;
          return Promise.reject(new Error('worker killed before the upsert'));
        }
        assertEquals(doc, DOC_ID);
        for (const p of pages) w.stored(hash).set(p.page_number, structuredClone(p));
        return Promise.resolve();
      },
      upsertPages: unexpected('upsertPages'),
      upsertBlocks: unexpected('upsertBlocks'),
      upsertImages: unexpected('upsertImages'),
      blockIds: unexpected('blockIds'),
      imageIds: unexpected('imageIds'),
      storedChunks: unexpected('storedChunks'),
      chunkCommit: unexpected('chunkCommit'),
      logCall: (row) => {
        w.events.push(`log:${row.status}`);
        w.logs.push(structuredClone(row));
        return Promise.resolve();
      },
    },
    storage: {
      signedUrl: (path, secs) => {
        w.events.push(`sign:${path}:${secs}`);
        return Promise.resolve(`https://proj.supabase.co/storage/v1/object/sign/corpus/${path}?token=t`);
      },
      exists: (path) => {
        w.events.push(`exists:${path}`);
        return Promise.resolve(w.objects.has(path));
      },
      upload: (path, bytes) => {
        w.events.push(`upload:${path}`);
        w.objects.set(path, bytes);
        return Promise.resolve();
      },
    },
    ocr: (req) => {
      w.events.push(`ocr:${req.pages.join(',')}`);
      w.requests.push(structuredClone(req));
      return w.mistral(req);
    },
    embed: unexpected('embed'),
    documentUrlOverride: () => null,
    now: () => w.t,
    log: () => {},
    ...over,
  };
}

const requestedPages = (w: World) => w.requests.map((r) => r.pages);

// ─── Range selection (pure) ──────────────────────────────────────────────────

Deno.test('nextRange: first missing page, its part, up to perCall consecutive missing pages as part-local indexes', () => {
  const parts = [part(SHA_A, 0, 0, 5), part(SHA_B, 1, 5, 7)];
  const r1 = nextRange(new Set([1, 2, 3, 6, 7]), parts, 12, 25)!;
  assertEquals([r1.part.part_index, r1.pageNumbers, r1.local], [0, [4, 5], [3, 4]]);
  const r2 = nextRange(new Set([1, 2, 3, 4, 5, 6, 7]), parts, 12, 25)!;
  assertEquals([r2.part.part_index, r2.pageNumbers, r2.local], [1, [8, 9, 10, 11, 12], [2, 3, 4, 5, 6]]);
  // A gap inside a part: the range stops at the next stored page.
  const r3 = nextRange(new Set([1, 3]), parts, 12, 25)!;
  assertEquals([r3.pageNumbers, r3.local], [[2], [1]]);
  // perCall bounds the range.
  assertEquals(nextRange(new Set(), parts, 12, 2)!.local, [0, 1]);
  assertEquals(nextRange(new Set(Array.from({ length: 12 }, (_, i) => i + 1)), parts, 12, 25), null);
});

Deno.test('nextRange: a missing page no part covers is a permanent ocr_part_missing', () => {
  let err: unknown;
  try {
    nextRange(new Set(), [part(SHA_A, 0, 0, 5)], 12, 25);
    nextRange(new Set([1, 2, 3, 4, 5]), [part(SHA_A, 0, 0, 5)], 12, 25);
  } catch (e) {
    err = e;
  }
  assert(err instanceof IngestError);
  assertEquals([err.code, err.permanent], ['ocr_part_missing', true]);
});

// ─── The step ────────────────────────────────────────────────────────────────

Deno.test('ocrStep on the real 12-page fixture: one call, 12 pages stored, cost logged, stage index, hashes set', async () => {
  const w = new World([part(SHA_A, 0, 0, 12)], FIXTURE_PAGES);
  const fetchFixture = (() => Promise.resolve(new Response(FIXTURE_TEXT))) as typeof fetch;
  w.mistral = (req) => callMistralOcr({ fetch: fetchFixture, apiKey: 'k' }, req);
  const job = makeJob();

  const { patch, activated } = await ocrStep(makeDeps(w), job, FAR);

  const hash = await ocrHash(job.file_sha256, OCR_MODEL);
  assertEquals(requestedPages(w), [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]]);
  assertEquals(w.requests[0].model, OCR_MODEL);
  assertEquals(activated, undefined);
  assertEquals(patch.progressed, true);
  assertEquals(patch.stage, 'index');
  assertEquals(patch.ocr_pages, 12);
  assertEquals(patch.ocr_cost_usd, 0.048);
  assertEquals(patch.pages_per_call, undefined);
  assertEquals([patch.model_id, patch.ocr_hash], [OCR_MODEL, hash]);
  assert(patch.extract_hash && patch.extract_hash.length === 64);
  assertEquals(patch.error, undefined);

  const stored = w.stored(hash);
  assertEquals([...stored.keys()].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (const [n, row] of stored) {
    assertEquals(row.raw.index, n - 1);
    assertEquals(row.raw.markdown, FIXTURE_PAGES[n - 1].markdown);
    assertEquals(row.raw.blocks, FIXTURE_PAGES[n - 1].blocks);
  }

  assertEquals(w.logs.length, 1);
  const log = w.logs[0];
  assertEquals(
    [log.caller, log.purpose, log.provider, log.status, log.model_requested, log.model_served, log.cost_usd],
    ['ingest-worker', 'ocr', 'mistral', 'success', OCR_MODEL, 'mistral-ocr-latest', 0.048],
  );
  assertEquals(log.raw_usage.job_id, 'job-1');
  assertEquals(log.raw_usage.document_id, DOC_ID);
  assertEquals(log.raw_usage.page_numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assertEquals(log.raw_usage.pages_processed, 12);
  assertEquals(log.raw_usage.doc_size_bytes, 159325);
  assertEquals(log.raw_usage.bytes, new TextEncoder().encode(FIXTURE_TEXT).length);
});

Deno.test('ocrStep logs the cost BEFORE any image upload or page write, with job and document ids', async () => {
  const doc = synthDoc(3);
  doc[1].images = [{
    id: 'img-0.png',
    top_left_x: 1,
    top_left_y: 2,
    bottom_right_x: 3,
    bottom_right_y: 4,
    image_base64: dataUri('image/png', PNG_1X1_BASE64),
  }];
  const w = new World([part(SHA_A, 0, 0, 3)], doc);
  await ocrStep(makeDeps(w), pinnedJob({ pages_total: 3 }), FAR);

  const kinds = w.events.map((e) => e.split(':')[0]);
  assertEquals(kinds, ['sign', 'ocr', 'log', 'exists', 'upload', 'upsert']);
  assertEquals(w.logs[0].raw_usage.job_id, 'job-1');
  assertEquals(w.logs[0].raw_usage.document_id, DOC_ID);
});

Deno.test('ocrStep across two parts: part-local indexes requested, global pages stored', async () => {
  const w = new World([part(SHA_A, 0, 0, 5), part(SHA_B, 1, 5, 7)], FIXTURE_PAGES);
  const { patch } = await ocrStep(makeDeps(w), pinnedJob(), FAR);

  assertEquals(requestedPages(w), [[0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5, 6]]);
  assert(w.requests[0].document.document_url.includes(`files/${SHA_A}.pdf`));
  assert(w.requests[1].document.document_url.includes(`files/${SHA_B}.pdf`));
  assertEquals(w.requests.map((r) => r.model), ['mistral-ocr-pinned', 'mistral-ocr-pinned']);
  const stored = w.stored(PINNED_HASH);
  for (let n = 1; n <= 12; n++) {
    assertEquals(stored.get(n)!.raw.index, n - 1);
    assertEquals(stored.get(n)!.raw.markdown, FIXTURE_PAGES[n - 1].markdown);
  }
  assertEquals(w.logs.map((l) => l.raw_usage.page_numbers), [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11, 12]]);
  assertEquals([patch.stage, patch.ocr_pages, patch.ocr_cost_usd], ['index', 12, ocrCostUsd(5) + ocrCostUsd(7)]);
  // A pinned job reports no new identity.
  assertEquals([patch.model_id, patch.ocr_hash, patch.extract_hash], [undefined, undefined, undefined]);
});

Deno.test('ocrStep resumes from stored pages across parts, with a gap, and never requests a stored page', async () => {
  const w = new World([part(SHA_A, 0, 0, 5), part(SHA_B, 1, 5, 7)], synthDoc(12));
  w.seed(PINNED_HASH, [1, 2, 3, 6, 7, 10]);
  const { patch } = await ocrStep(makeDeps(w), pinnedJob(), FAR);

  assertEquals(requestedPages(w), [[3, 4], [2, 3], [5, 6]]); // pages 4-5 (A), 8-9 and 11-12 (B)
  assertEquals(w.logs.map((l) => l.raw_usage.page_numbers), [[4, 5], [8, 9], [11, 12]]);
  assertEquals([...w.stored(PINNED_HASH).keys()].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assertEquals(w.stored(PINNED_HASH).get(1)!.raw.markdown, 'seeded'); // untouched
  assertEquals([patch.stage, patch.ocr_pages], ['index', 6]);
});

Deno.test('ocrStep: pages already stored are never paid for again (all stored → no call, stage index)', async () => {
  const w = new World([part(SHA_A, 0, 0, 12)], synthDoc(12));
  w.seed(PINNED_HASH, Array.from({ length: 12 }, (_, i) => i + 1));
  const { patch } = await ocrStep(makeDeps(w), pinnedJob(), FAR);
  assertEquals(w.requests, []);
  assertEquals(w.logs, []);
  assertEquals(patch, { progressed: true, stage: 'index' });
});

Deno.test("ocrStep: stored pages only count for the job's own ocr_hash", async () => {
  const w = new World([part(SHA_A, 0, 0, 12)], synthDoc(12));
  w.seed('x'.repeat(64), Array.from({ length: 12 }, (_, i) => i + 1));
  await ocrStep(makeDeps(w), pinnedJob(), FAR);
  assertEquals(requestedPages(w), [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]]);
});

Deno.test('ocrStep: pages_per_call bounds each call', async () => {
  const w = new World([part(SHA_A, 0, 0, 12)], synthDoc(12));
  const { patch } = await ocrStep(makeDeps(w), pinnedJob({ pages_per_call: 5 }), FAR);
  assertEquals(requestedPages(w), [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11]]);
  assertEquals([patch.stage, patch.ocr_pages, patch.pages_per_call], ['index', 12, undefined]);
});

Deno.test('ocrStep adaptive range: a response over INGEST.largeResponseBytes halves pages_per_call for the next calls', async () => {
  const w = new World([part(SHA_A, 0, 0, 40)], synthDoc(40), {
    bytes: (call) => (call === 1 ? INGEST.largeResponseBytes + 1 : 1000),
  });
  const { patch } = await ocrStep(makeDeps(w), pinnedJob({ pages_total: 40, pages_per_call: 25 }), FAR);
  assertEquals(requestedPages(w).map((p) => p.length), [25, 12, 3]);
  assertEquals(patch.pages_per_call, 12);
  assertEquals(patch.stage, 'index');
});

Deno.test('ocrStep adaptive range: exactly the threshold does not halve, and it never goes below 1', async () => {
  const atThreshold = new World([part(SHA_A, 0, 0, 12)], synthDoc(12), { bytes: () => INGEST.largeResponseBytes });
  assertEquals(
    (await ocrStep(makeDeps(atThreshold), pinnedJob({ pages_per_call: 25 }), FAR)).patch.pages_per_call,
    undefined,
  );

  const huge = new World([part(SHA_A, 0, 0, 3)], synthDoc(3), { bytes: () => INGEST.largeResponseBytes * 10 });
  const { patch } = await ocrStep(makeDeps(huge), pinnedJob({ pages_total: 3, pages_per_call: 2 }), FAR);
  assertEquals(requestedPages(huge), [[0, 1], [2]]);
  assertEquals(patch.pages_per_call, 1);
});

Deno.test("ocrStep: a crash between Mistral's response and the page upsert does not skip pages on resume", async () => {
  const doc = synthDoc(12);
  doc[0].images = [{ id: 'img-0.png', image_base64: PNG_1X1_BASE64 }];
  const w = new World([part(SHA_A, 0, 0, 12)], doc);
  w.failUpserts = 1;
  const first = await ocrStep(makeDeps(w), pinnedJob(), FAR);
  // The call was billed and logged, nothing was stored: the cost is reported with the failure.
  assertEquals(w.stored(PINNED_HASH).size, 0);
  assertEquals(w.logs.length, 1);
  assertEquals(first.patch.progressed, false);
  assertEquals(first.patch.ocr_cost_usd, 0.048);
  assertEquals(first.patch.ocr_pages, undefined);
  assertEquals(first.patch.error?.code, 'internal');
  assertEquals(w.objects.size, 1); // the image went up before the crash

  w.events = [];
  const second = await ocrStep(makeDeps(w), pinnedJob(), FAR);
  assertEquals(requestedPages(w), [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]]);
  assertEquals([...w.stored(PINNED_HASH).keys()].length, 12);
  assertEquals([second.patch.stage, second.patch.ocr_pages], ['index', 12]);
  assertEquals(w.logs.length, 2); // both calls were paid for, both are recorded
  assert(!w.events.some((e) => e.startsWith('upload:')), 'an image already stored is not uploaded again');
});

Deno.test('ocrStep: the budget reserve stops new calls', async () => {
  const none = new World([part(SHA_A, 0, 0, 12)], synthDoc(12));
  const idle = await ocrStep(makeDeps(none), makeJob(), OCR_CALL_RESERVE_MS - 1);
  assertEquals(none.requests, []);
  assertEquals(idle.patch.progressed, false);
  assertEquals(idle.patch.stage, undefined);
  assert(idle.patch.ocr_hash, 'a fresh job still reports its identity');

  // Each call takes 35 s: with 100 s left, calls start at 100 s and 65 s left, not at 30 s.
  const w = new World([part(SHA_A, 0, 0, 12)], synthDoc(12), { msPerCall: 35_000 });
  const { patch } = await ocrStep(makeDeps(w), pinnedJob({ pages_per_call: 1 }), INGEST.budgetMs);
  assertEquals(requestedPages(w), [[0], [1]]);
  assertEquals([patch.progressed, patch.ocr_pages, patch.stage], [true, 2, undefined]);
  assertEquals(OCR_CALL_RESERVE_MS, 40_000);
});

Deno.test('ocrStep reads stored pages past the 1,000-row cap (paged reads)', async () => {
  const w = new World([part(SHA_A, 0, 0, 1500)], synthDoc(1500));
  w.seed(PINNED_HASH, Array.from({ length: 1200 }, (_, i) => i + 1));
  const { patch } = await ocrStep(makeDeps(w), pinnedJob({ pages_total: 1500 }), FAR);
  assertEquals(w.requests[0].pages[0], 1200); // page 1201, not 1001
  assertEquals(w.requests.length, 12);
  assertEquals([patch.stage, patch.ocr_pages], ['index', 300]);
});

Deno.test('ocrStep: a failure after progress returns the progress without the error', async () => {
  const w = new World([part(SHA_A, 0, 0, 12)], synthDoc(12));
  const real = w.mistral;
  w.mistral = (req) =>
    w.requests.length === 2
      ? Promise.reject(new IngestError('mistral_rate_limited', 'HTTP 429', false, 429))
      : real(req);
  const { patch } = await ocrStep(makeDeps(w), pinnedJob({ pages_per_call: 5 }), FAR);
  assertEquals(patch, { progressed: true, ocr_pages: 5, ocr_cost_usd: ocrCostUsd(5) });
});

Deno.test('ocrStep: a failed call before any progress throws its IngestError, writes nothing, and logs an unbilled error row', async () => {
  const w = new World([part(SHA_A, 0, 0, 12)], synthDoc(12));
  w.mistral = () =>
    Promise.reject(new IngestError('mistral_rate_limited', 'Mistral OCR HTTP 429: slow down', false, 429));
  const err = await assertRejects(() => ocrStep(makeDeps(w), pinnedJob(), FAR), IngestError);
  assertEquals((err as IngestError).code, 'mistral_rate_limited');
  assert(!w.events.some((e) => e.startsWith('upsert') || e.startsWith('upload')));
  assertEquals(w.logs.length, 1);
  assertEquals([w.logs[0].status, w.logs[0].cost_usd, w.logs[0].raw_usage.job_id, w.logs[0].raw_usage.error_code], [
    'error',
    0,
    'job-1',
    'mistral_rate_limited',
  ]);
});

Deno.test('ocrStep: an index mismatch is logged with its cost, stores nothing, and reports ocr_page_mismatch', async () => {
  const w = new World([part(SHA_A, 0, 0, 12)], synthDoc(12));
  const real = w.mistral;
  w.mistral = async (req) => {
    const r = await real(req);
    return { ...r, pages: r.pages.slice(1) }; // billed for 12, returned 11
  };
  const { patch } = await ocrStep(makeDeps(w), pinnedJob(), FAR);
  assertEquals(w.stored(PINNED_HASH).size, 0);
  assertEquals([w.logs[0].status, w.logs[0].cost_usd], ['error', 0.048]);
  assertEquals(w.events.map((e) => e.split(':')[0]), ['sign', 'ocr', 'log']);
  assertEquals([patch.progressed, patch.ocr_cost_usd, patch.error?.code, patch.error?.permanent], [
    false,
    0.048,
    'ocr_page_mismatch',
    false,
  ]);
});

Deno.test('ocrStep: a 10-minute signed URL for the part, or the override when one is given', async () => {
  const signed = new World([part(SHA_A, 0, 0, 2)], synthDoc(2));
  await ocrStep(makeDeps(signed), pinnedJob({ pages_total: 2 }), FAR);
  assertEquals(signed.events[0], `sign:files/${SHA_A}.pdf:600`);
  assertEquals(INGEST.signedUrlSeconds, 600);

  const overridden = new World([part(SHA_A, 0, 0, 2)], synthDoc(2));
  const deps = makeDeps(overridden, { documentUrlOverride: (sha) => `https://public.example/${sha}.pdf` });
  await ocrStep(deps, pinnedJob({ pages_total: 2 }), FAR);
  assertEquals(overridden.requests[0].document.document_url, `https://public.example/${SHA_A}.pdf`);
  assert(!overridden.events.some((e) => e.startsWith('sign:')));
});

Deno.test('ocrStep stores images without base64: uploads accepted ones once, notes skipped ones', async () => {
  const big = toBase64(withMagic([...MAGIC.png], INGEST.maxImageBytes + 1));
  const doc = synthDoc(2);
  doc[0].images = [
    {
      id: 'a.png',
      top_left_x: 1,
      top_left_y: 1,
      bottom_right_x: 9,
      bottom_right_y: 9,
      image_base64: dataUri('image/png', PNG_1X1_BASE64),
    },
    { id: 'big.png', image_base64: dataUri('image/png', big) },
  ];
  doc[1].images = [{ id: 'again.png', image_base64: PNG_1X1_BASE64 }]; // same bytes as a.png
  const w = new World([part(SHA_A, 0, 0, 2)], doc);
  await ocrStep(makeDeps(w), pinnedJob({ pages_total: 2 }), FAR);

  const p1 = w.stored(PINNED_HASH).get(1)!.raw;
  assertEquals(p1.images.map((i) => [i.id, i.mime, i.skipped]), [['a.png', 'image/png', undefined], [
    'big.png',
    null,
    'too_large',
  ]]);
  assertEquals(p1.images[0].top_left_x, 1);
  assertEquals(w.objects.size, 1);
  assertEquals([...w.objects.keys()], [`img/${p1.images[0].sha256}.png`]);
  assertEquals(w.events.filter((e) => e.startsWith('upload:')).length, 1);
  for (const row of w.stored(PINNED_HASH).values()) assert(!JSON.stringify(row).includes('base64'));
});
