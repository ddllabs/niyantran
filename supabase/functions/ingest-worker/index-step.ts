// The `index` step of ingest-worker (docs/specs/2026-10-01-rag-v2-ingestion-v2.md, "The `index`
// step"; chunk contract R5 write order). From the stored raw OCR of one job it composes the pages,
// writes pages, blocks and images for the job's extract_hash, maps the chunker's block and image
// references to their database ids, embeds and commits the chunks in slices, and activates the
// document last.
//
// Resumable at every point: steps 1-3 are recomputed on every claim (deterministic, upserts on the
// tables' unique keys), and a chunk already stored with the same embed_hash is never embedded again.

import { type ComposedDocument, composeDocument, locateBlocks, normaliseBox, type Box } from '../_shared/pageText.ts';
import { chunkPages, PAGE_CHUNK_VERSION, type PageChunkRow } from '../_shared/chunking.ts';
import { EMBED_MODEL, EmbeddingError } from '../_shared/embed.ts';
import { sha256Hex } from '../_shared/textNormalise.ts';
import { readAll } from './paging.ts';
import {
  type BlockRow,
  type ImageRow,
  imagePath,
  INGEST,
  IngestError,
  type IngestJob,
  type PageCommitRow,
  type PageRow,
  type RawOcrImage,
  type Step,
  type StepOutcome,
  type StoredOcrPage,
  type WorkerDeps,
} from './types.ts';

export const INDEX_STEP = Object.freeze({
  /** Rows per upsert of pages, blocks or images: a few hundred KB of JSON at most. */
  writeBatch: 500,
  /**
   * No new slice starts within this much of the deadline. One slice is one embedding call of at most
   * INGEST.commitSlice inputs plus one chunk_commit of about 1.8 MB; 10 s covers both with margin.
   */
  deadlineReserveMs: 10_000,
});

const EXTENSION = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' } as const;

/** Steps 1-2 as data: everything the step writes before the chunks, and the chunks themselves. */
export interface IndexPlan {
  document: ComposedDocument;
  chunks: PageChunkRow[];
  pages: PageRow[];
  blocks: BlockRow[];
  images: ImageRow[];
}

const coords = (box: Box | undefined) =>
  box ? { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 } : { x0: null, y0: null, x1: null, y1: null };

/**
 * Compose and chunk the stored raw pages and build the page, block and image rows. No I/O, so the
 * CPU of composing a large document can be timed on its own (plan I7). Throws `ocr_incomplete` unless
 * exactly pages 1..pagesTotal are present, each with its global index (page_number − 1).
 */
export async function planIndex(
  documentId: string,
  extractHash: string,
  pagesTotal: number,
  stored: readonly StoredOcrPage[],
): Promise<IndexPlan> {
  const byNumber = new Map(stored.map((p) => [p.page_number, p.raw]));
  const raws = [];
  for (let n = 1; n <= pagesTotal; n++) {
    const raw = byNumber.get(n);
    if (!raw) throw new IngestError('ocr_incomplete', `page ${n} of ${pagesTotal} has no stored OCR`);
    if (raw.index !== n - 1) {
      throw new IngestError('ocr_incomplete', `stored page ${n} carries index ${raw.index}, expected ${n - 1}`);
    }
    raws.push(raw);
  }

  const document = composeDocument(raws);
  const { rows: chunks } = await chunkPages({ document, pages: raws });

  const pages: PageRow[] = document.pages.map((p) => ({ document_id: documentId, extract_hash: extractHash, ...p }));

  const blocks: BlockRow[] = [];
  for (const [i, page] of document.pages.entries()) {
    const raw = raws[i];
    for (const located of locateBlocks(page.text, raw.blocks, raw.dimensions)) {
      blocks.push({
        document_id: documentId,
        extract_hash: extractHash,
        page_number: page.page_number,
        block_index: located.block_index,
        type: located.type,
        ...coords(located.box),
        char_from: located.char_from,
        char_to: located.char_to,
        content: raw.blocks[located.block_index].content ?? null,
      });
    }
  }

  // composeDocument names each image by page and ORIGINAL Mistral id (ids repeat across pages).
  // An image the OCR step skipped has no stored bytes, so it gets no row and its placeholder no link.
  const images: ImageRow[] = [];
  for (const { page_number, id, placeholder } of document.imagePlaceholders) {
    const raw = raws[page_number - 1];
    const image: RawOcrImage | undefined = raw.images.find((im) => im.id === id);
    if (!image?.sha256 || !image.mime) continue;
    images.push({
      document_id: documentId,
      extract_hash: extractHash,
      page_number,
      placeholder,
      sha256: image.sha256,
      mime: image.mime,
      storage_path: imagePath(image.sha256, EXTENSION[image.mime]),
      byte_size: image.byte_size,
      ...coords(normaliseBox(image, raw.dimensions)),
    });
  }

  return { document, chunks, pages, blocks, images };
}

async function inBatches<T>(rows: T[], write: (batch: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < rows.length; i += INDEX_STEP.writeBatch) await write(rows.slice(i, i + INDEX_STEP.writeBatch));
}

/** Step 2's writes, then the ids read back and mapped onto commit rows (R5 write order 1-3). */
async function writeExtraction(
  deps: WorkerDeps,
  documentId: string,
  extractHash: string,
  plan: IndexPlan,
): Promise<Array<Omit<PageCommitRow, 'embedding'>>> {
  const { db } = deps;
  await inBatches(plan.pages, (b) => db.upsertPages(b));
  await inBatches(plan.blocks, (b) => db.upsertBlocks(b));
  await inBatches(plan.images, (b) => db.upsertImages(b));

  const blockIds = new Map(
    (await readAll((from, to) => db.blockIds(documentId, extractHash, from, to)))
      .map((b) => [`${b.page_number}:${b.block_index}`, b.id]),
  );
  const imageIds = new Map(
    (await readAll((from, to) => db.imageIds(documentId, extractHash, from, to))).map((i) => [i.placeholder, i.id]),
  );

  return plan.chunks.map((c) => ({
    chunk_hash: c.chunk_hash,
    chunk_index: c.chunk_index,
    source_kind: 'pdf_page',
    page_number: c.page_number,
    char_from: c.char_from,
    char_to: c.char_to,
    content: c.content,
    token_count: c.token_estimate,
    chunker_version: PAGE_CHUNK_VERSION,
    metadata: { section: c.section },
    block_ids: c.block_refs.map((ref) => {
      const id = blockIds.get(`${ref.page_number}:${ref.block_index}`);
      // Every referenced block was upserted just above, so a miss is a failed write or read, not data.
      if (!id) throw new IngestError('block_ids_missing', `block ${ref.page_number}:${ref.block_index} has no stored id`);
      return id;
    }),
    image_ids: c.image_placeholders.flatMap((p) => imageIds.get(p) ?? []),
    embed_hash: c.embed_hash,
  }));
}

/** The claim's embedding spend, so it reaches the job even when a later call fails. */
interface Spend {
  tokens: number;
  cost: number;
}

/**
 * Embed one slice's chunks, logging the call (and any spend on failure) before anything is written.
 * The spend is added to `spend` whether the call succeeds or fails.
 */
async function embedSlice(
  deps: WorkerDeps,
  job: IngestJob,
  chunks: PageChunkRow[],
  spend: Spend,
): Promise<number[][]> {
  const started = deps.now();
  const base = {
    caller: 'ingest-worker',
    purpose: 'embedding',
    model_requested: EMBED_MODEL,
    provider: 'openrouter',
  } as const;
  const usage = { job_id: job.id, document_id: job.document_id, inputs: chunks.length, first_chunk_index: chunks[0].chunk_index };
  try {
    const r = await deps.embed(chunks.map((c) => c.embedding_input));
    await deps.db.logCall({
      ...base,
      model_served: r.model,
      status: 'success',
      error_message: null,
      latency_ms: deps.now() - started,
      prompt_tokens: r.promptTokens,
      total_tokens: r.promptTokens,
      cost_usd: r.costUsd,
      raw_usage: { ...usage, requests: r.requests },
    });
    spend.tokens += r.promptTokens;
    spend.cost += r.costUsd;
    return r.vectors;
  } catch (err) {
    const spent = err instanceof EmbeddingError ? { tokens: err.promptTokens, cost: err.costUsd } : { tokens: 0, cost: 0 };
    spend.tokens += spent.tokens;
    spend.cost += spent.cost;
    const message = (err as Error).message;
    await deps.db.logCall({
      ...base,
      model_served: null,
      status: 'error',
      error_message: message,
      latency_ms: deps.now() - started,
      prompt_tokens: spent.tokens,
      total_tokens: spent.tokens,
      cost_usd: spent.cost,
      raw_usage: { ...usage, status: err instanceof EmbeddingError ? err.status ?? null : null },
    });
    throw new IngestError('embed_failed', message, false, err instanceof EmbeddingError ? err.status : undefined);
  }
}

export const indexStep: Step = async (deps, job, deadline): Promise<StepOutcome> => {
  const { db } = deps;
  const documentId = job.document_id;
  const extractHash = job.extract_hash;
  const ocrHash = job.ocr_hash;
  if (!extractHash || !ocrHash) {
    throw new IngestError('index_without_hashes', 'the index step needs ocr_hash and extract_hash set', true);
  }

  // 1. Load and compose.
  const stored = await readAll((from, to) => db.ocrPages(documentId, ocrHash, from, to));
  const plan = await planIndex(documentId, extractHash, job.pages_total, stored);

  // 2. Pages, blocks and images; ids mapped onto the commit rows.
  const rows = await writeExtraction(deps, documentId, extractHash, plan);

  // 3. What is already stored for this document.
  const storedEmbed = new Map(
    (await readAll((from, to) => db.storedChunks(documentId, from, to))).map((c) => [c.chunk_hash, c.embed_hash]),
  );

  // 4. Slices in chunk order. chunk_commit deletes every chunk absent from its keep list, so each call
  // carries the whole document's list, or it would delete the slices committed before it.
  const keep = plan.chunks.map((c) => c.chunk_hash);
  let committed = false;
  const spend: Spend = { tokens: 0, cost: 0 };
  try {
    for (let from = 0; from < rows.length; from += INGEST.commitSlice) {
      const slice = plan.chunks.slice(from, from + INGEST.commitSlice);
      const stale = slice.filter((c) => storedEmbed.get(c.chunk_hash) !== c.embed_hash);
      // A slice stored whole with equal embed_hash values was committed by an earlier claim of this same
      // extract_hash from the same deterministic rows, so it is skipped (no embedding, no call).
      if (stale.length === 0) continue;

      // 5. Out of budget: release the job with no stage change; the next claim resumes at step 1.
      if (deps.now() >= deadline - INDEX_STEP.deadlineReserveMs) {
        deps.log('ingest.index_budget', { job_id: job.id, next_chunk_index: from, chunks: rows.length });
        return { patch: { progressed: committed, embed_tokens: spend.tokens, embed_cost_usd: spend.cost } };
      }

      const embedded = await embedSlice(deps, job, stale, spend);
      const vectors = new Map(stale.map((c, i) => [c.chunk_hash, embedded[i]]));
      const commit: PageCommitRow[] = rows.slice(from, from + INGEST.commitSlice).map((r) => {
        const embedding = vectors.get(r.chunk_hash);
        return embedding ? { ...r, embedding } : r;
      });
      await db.chunkCommit(documentId, commit, keep);
      committed = true;
    }
    // With every slice skipped, no call above removed chunks outside the keep list: one empty commit
    // does. (Any committed slice already did, and nothing else writes this document's chunks.)
    if (!committed) await db.chunkCommit(documentId, [], keep);
  } catch (err) {
    // Reported rather than thrown, so the spend of this claim reaches the job's totals as well as
    // model_call_logs. Slices committed before the failure stay committed.
    const e = err instanceof IngestError ? err : new IngestError('internal', (err as Error).message);
    return {
      patch: {
        progressed: committed,
        embed_tokens: spend.tokens,
        embed_cost_usd: spend.cost,
        error: { code: e.code, message: e.message, permanent: e.permanent },
      },
    };
  }

  // 6. Activation: the last write. It sets indexed_at, which makes the chunks visible.
  await db.activate(job.id, job.claim_token, {
    extract_hash: extractHash,
    ocr_text: plan.document.ocrText,
    content_sha256: await sha256Hex(plan.document.ocrText),
    page_count: job.pages_total,
    embed_tokens: spend.tokens,
    embed_cost_usd: spend.cost,
  });
  deps.log('ingest.index_activated', { job_id: job.id, chunks: rows.length, embed_tokens: spend.tokens });
  return { patch: { progressed: true }, activated: true };
};
