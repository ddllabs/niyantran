// The `ocr` step of the ingest worker (spec "The ocr step", 1-11).
//
// The stored document_ocr_pages rows for the job's ocr_hash are the cursor: each call OCRs the
// first run of missing pages (up to pages_per_call, inside one part), logs its cost, stores the
// images, then upserts the pages. A crash anywhere after Mistral billed resumes at the same pages
// (never skipping one); a page already stored is never requested again.
//
// Order inside a call: Mistral → cost logged → index check → images → pages. The cost is logged
// before the index check so that a billed response with the wrong pages is still recorded.
//
// Failure handling:
//   - a failure after pages were stored in this invocation returns the progress patch without the
//     error (the next claim retries the rest);
//   - a failure after a billed call but before any page was stored returns a patch carrying the
//     cost and the error, so the job's ocr_cost_usd never misses a paid call;
//   - any other failure is thrown for the entry point to report.

import { jobHashes, type JobIdentity } from './hashes.ts';
import { processPageImages } from './images.ts';
import { buildOcrRequest, checkIndexes, mapOcrPage, ocrCostUsd } from './mistral.ts';
import { readAll } from './paging.ts';
import {
  type AdvancePatch,
  type FilePart,
  INGEST,
  IngestError,
  type IngestJob,
  type OcrCallResult,
  type Step,
  type StoredOcrPage,
  type WorkerDeps,
} from './types.ts';

/**
 * No OCR call starts with less than this left before the deadline. It covers one call of
 * INGEST.pagesPerCall pages (Mistral's latency plus fetching the part), the image uploads and the
 * page upsert, inside the 100 s budget.
 */
export const OCR_CALL_RESERVE_MS = 40_000;

export interface OcrRange {
  part: FilePart;
  /** Global, 1-based. */
  pageNumbers: number[];
  /** Part-local, 0-based: what Mistral is asked for. */
  local: number[];
}

/**
 * The next range to OCR: the first page in 1..pagesTotal not in `stored`, its part, and up to
 * `perCall` consecutive missing pages from there inside that part. Null when every page is stored.
 */
export function nextRange(
  stored: ReadonlySet<number>,
  parts: FilePart[],
  pagesTotal: number,
  perCall: number,
): OcrRange | null {
  let first = 0;
  for (let n = 1; n <= pagesTotal; n++) {
    if (!stored.has(n)) {
      first = n;
      break;
    }
  }
  if (!first) return null;
  const part = parts.find((p) => first > p.page_offset && first <= p.page_offset + p.page_count);
  if (!part) throw new IngestError('ocr_part_missing', `no stored file covers page ${first}`, true);
  const end = Math.min(part.page_offset + part.page_count, pagesTotal);
  const pageNumbers: number[] = [];
  for (let n = first; n <= end && pageNumbers.length < perCall && !stored.has(n); n++) pageNumbers.push(n);
  return { part, pageNumbers, local: pageNumbers.map((n) => n - part.page_offset - 1) };
}

function patchError(e: unknown): NonNullable<AdvancePatch['error']> {
  if (e instanceof IngestError) return { code: e.code, message: e.message, permanent: e.permanent };
  return { code: 'internal', message: (e instanceof Error ? e.message : String(e)).slice(0, 300), permanent: false };
}

interface Tally {
  pages: number;
  cost: number;
}

/** One OCR call and its writes. Returns the response size. `tally` counts cost as soon as it is logged. */
async function ocrOnce(
  deps: WorkerDeps,
  job: IngestJob,
  ids: JobIdentity,
  range: OcrRange,
  stored: Set<number>,
  tally: Tally,
): Promise<number> {
  const { part, pageNumbers, local } = range;
  const url = deps.documentUrlOverride(part.sha256) ??
    await deps.storage.signedUrl(part.storage_path, INGEST.signedUrlSeconds);
  const usage = {
    job_id: job.id,
    document_id: job.document_id,
    ocr_hash: ids.ocrHash,
    part_index: part.part_index,
    page_numbers: pageNumbers,
  };

  const started = deps.now();
  let result: OcrCallResult;
  try {
    result = await deps.ocr(buildOcrRequest(ids.modelId, url, local));
  } catch (e) {
    // Not billed (no 200 with a page list): recorded at cost 0 so failures are visible.
    const err = patchError(e);
    await deps.db.logCall({
      caller: 'ingest-worker',
      purpose: 'ocr',
      model_requested: ids.modelId,
      model_served: null,
      provider: 'mistral',
      status: 'error',
      error_message: `${err.code}: ${err.message}`,
      latency_ms: Math.max(0, deps.now() - started),
      prompt_tokens: null,
      total_tokens: null,
      cost_usd: 0,
      raw_usage: { ...usage, error_code: err.code, http_status: e instanceof IngestError ? e.status ?? null : null },
    }).catch((logErr) => deps.log('ocr_error_log_failed', { job_id: job.id, error: String(logErr) }));
    throw e;
  }

  const cost = ocrCostUsd(result.pagesProcessed);
  let mismatch: IngestError | null = null;
  try {
    checkIndexes(local, result.pages.map((p) => p.index));
  } catch (e) {
    mismatch = e as IngestError;
  }
  // Billed: record it before anything else is written. If this fails, nothing is written.
  await deps.db.logCall({
    caller: 'ingest-worker',
    purpose: 'ocr',
    model_requested: ids.modelId,
    model_served: result.model || null,
    provider: 'mistral',
    status: mismatch ? 'error' : 'success',
    error_message: mismatch ? `${mismatch.code}: ${mismatch.message}` : null,
    latency_ms: result.latencyMs,
    prompt_tokens: null,
    total_tokens: null,
    cost_usd: cost,
    raw_usage: {
      ...usage,
      pages_processed: result.pagesProcessed,
      doc_size_bytes: result.docSizeBytes,
      bytes: result.bytes,
    },
  });
  tally.cost += cost;
  if (mismatch) throw mismatch;

  const rows: StoredOcrPage[] = [];
  for (const page of [...result.pages].sort((a, b) => a.index - b.index)) {
    const { images, uploads } = await processPageImages(page.images);
    for (const u of uploads) {
      if (!(await deps.storage.exists(u.path))) await deps.storage.upload(u.path, u.bytes, u.contentType);
    }
    const raw = mapOcrPage(page, part.page_offset, images);
    rows.push({ page_number: raw.index + 1, raw });
  }
  await deps.db.upsertOcrPages(job.document_id, ids.ocrHash, rows);
  for (const r of rows) stored.add(r.page_number);
  tally.pages += rows.length;
  // The cursor must have moved past every requested page, or the next range would repeat (and re-pay) this one.
  if (!pageNumbers.every((n) => stored.has(n))) {
    throw new IngestError('ocr_cursor_stuck', `pages ${pageNumbers.join(',')} were not all stored`);
  }
  return result.bytes;
}

export const ocrStep: Step = async (deps, job, deadline) => {
  const ids = await jobHashes(job);
  const patch: AdvancePatch = { progressed: false, ...ids.newFields };
  const parts = await readAll((from, to) => deps.db.files(job.document_id, from, to));
  const stored = new Set(await readAll((from, to) => deps.db.ocrPageNumbers(job.document_id, ids.ocrHash, from, to)));

  let perCall = Number.isInteger(job.pages_per_call) && job.pages_per_call >= 1
    ? job.pages_per_call
    : INGEST.pagesPerCall;
  const tally: Tally = { pages: 0, cost: 0 };
  let failure: unknown = null;
  let done = false;

  for (;;) {
    try {
      const range = nextRange(stored, parts, job.pages_total, perCall);
      if (!range) {
        done = true;
        break;
      }
      if (deadline - deps.now() < OCR_CALL_RESERVE_MS) break;
      const bytes = await ocrOnce(deps, job, ids, range, stored, tally);
      if (bytes > INGEST.largeResponseBytes && perCall > 1) {
        perCall = Math.max(1, Math.floor(perCall / 2));
        patch.pages_per_call = perCall;
      }
    } catch (e) {
      failure = e;
      break;
    }
  }

  if (done) patch.stage = 'index';
  patch.progressed = done || tally.pages > 0;
  if (tally.pages) patch.ocr_pages = tally.pages;
  if (tally.cost) patch.ocr_cost_usd = tally.cost;

  if (failure) {
    const err = patchError(failure);
    if (patch.progressed) {
      deps.log('ocr_failed_after_progress', { job_id: job.id, error_code: err.code, ocr_pages: tally.pages });
      return { patch };
    }
    if (tally.cost > 0) return { patch: { ...patch, error: err } };
    throw failure;
  }
  return { patch };
};
