// Feature F341: Ingestion worker step adapter for private user files.
// Reuses Mistral OCR, document composition, chunkDocument (target 1000, overlap 200),
// and OpenRouter embeddings (1536 dims). Commits directly to public.user_file_chunks.

import {
  type UserFileAdvancePatch,
  type UserFileChunkCommitRow,
  type UserFileClaimedJob,
  type UserFileIndexStatus,
  type UserFileIngestDb,
  type UserFileOcrPageCheckpoint,
  type UserFileSettleCreditsParams,
  type UserFileStepOutcome,
} from '../_shared/userFiles.types.ts';
import { chunkDocument } from '../_shared/chunking.ts';
import { composeDocument, type MistralPage } from '../_shared/pageText.ts';
import {
  type EmbedDeps,
  type EmbedResult,
  EmbeddingError,
  embedTexts,
} from '../_shared/embed.ts';
import { normalise, sha256Hex } from '../_shared/textNormalise.ts';
import { buildOcrRequest, callMistralOcr, ocrCostUsd } from './mistral.ts';
import { extractHash, ocrHash } from './hashes.ts';
import {
  INGEST,
  IngestError,
  type MistralOcrPage,
  type OcrCallResult,
  type OcrRequest,
  OCR_MODEL,
} from './types.ts';

export interface UserFileStepDeps {
  db: UserFileIngestDb;
  storage: {
    signedUrl(path: string, expiresInSeconds: number): Promise<string>;
  };
  ocr?: (request: OcrRequest) => Promise<OcrCallResult>;
  embed?: (texts: string[]) => Promise<EmbedResult>;
  embedDeps?: EmbedDeps;
  now?: () => number;
  budgetMs?: number;
  reserveMs?: number;
  workerId?: string;
  claimToken?: string;
  getOcrPages?: (fileId: string) => Promise<UserFileOcrPageCheckpoint[]>;
  saveOcrPages?: (fileId: string, pages: UserFileOcrPageCheckpoint[]) => Promise<void>;
  fetch?: typeof fetch;
  mistralApiKey?: string;
  openRouterApiKey?: string;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

const inMemoryOcrPages = new Map<string, UserFileOcrPageCheckpoint[]>();

export function clearInMemoryOcrPages(): void {
  inMemoryOcrPages.clear();
}

export function toOcrCheckpoint(p: MistralOcrPage, pageNumber: number): UserFileOcrPageCheckpoint {
  return {
    page_number: pageNumber,
    text: p.markdown,
    header: p.header ?? null,
    footer: p.footer ?? null,
    width_px: p.dimensions?.width ?? null,
    height_px: p.dimensions?.height ?? null,
  };
}

export function toMistralPage(cp: UserFileOcrPageCheckpoint): MistralPage {
  return {
    index: cp.page_number - 1,
    markdown: cp.text,
    header: cp.header,
    footer: cp.footer,
    dimensions: cp.width_px && cp.height_px ? { width: cp.width_px, height: cp.height_px } : null,
  };
}

export function isOutOfBoundsError(err: unknown): boolean {
  if (err instanceof IngestError) {
    if (err.status === 400 || err.code === 'ocr_page_mismatch' || err.code === 'page_out_of_bounds') {
      return true;
    }
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('out of bounds') ||
    msg.includes('page index') ||
    msg.includes('page out of range') ||
    msg.includes('bad page index')
  );
}

/**
 * Executes an interactive personal file indexing job.
 * Pipeline stages:
 *   1. OCR (Mistral OCR extraction page by page, respecting budgetMs and checkpointing).
 *   2. Compose & Chunk (compose OCR pages and run chunkDocument with 1000 target / 200 overlap).
 *   3. Embed (OpenRouter embeddings via embedTexts).
 *   4. Commit (commit chunks to public.user_file_chunks).
 *   5. Advance & Settle credits (update job status, user_files index_status, and paise ledger).
 */
export async function executeUserFileJob(
  job: UserFileClaimedJob,
  deps: UserFileStepDeps,
): Promise<UserFileStepOutcome> {
  const now = deps.now ?? Date.now;
  const startTime = now();
  const budgetMs = deps.budgetMs ?? INGEST.budgetMs;
  const reserveMs = deps.reserveMs ?? Math.min(1000, budgetMs > 0 ? Math.max(10, budgetMs / 4) : 1000);
  const claimToken = deps.claimToken ?? deps.workerId ?? (job as unknown as Record<string, unknown>).claimed_by as string ?? job.claim_token ?? '';

  const loadPages = async (): Promise<UserFileOcrPageCheckpoint[]> => {
    if (deps.getOcrPages) return await deps.getOcrPages(job.file_id);
    if (deps.db.getOcrPages) return await deps.db.getOcrPages(job.file_id);
    return inMemoryOcrPages.get(job.file_id) ?? [];
  };

  const savePages = async (pages: UserFileOcrPageCheckpoint[]): Promise<void> => {
    if (deps.saveOcrPages) {
      await deps.saveOcrPages(job.file_id, pages);
      return;
    }
    if (deps.db.saveOcrPages) {
      await deps.db.saveOcrPages(job.file_id, pages);
      return;
    }
    inMemoryOcrPages.set(job.file_id, [...pages]);
  };

  // ─── Stage 1: Mistral OCR Extraction & Checkpointing ─────────────────────
  const storedPages: UserFileOcrPageCheckpoint[] = await loadPages();
  let ocrCost = ocrCostUsd(storedPages.length);

  let isOcrComplete = false;
  if (
    job.page_count !== null &&
    job.page_count !== undefined &&
    job.page_count > 0 &&
    storedPages.length >= job.page_count
  ) {
    isOcrComplete = true;
  }

  if (!isOcrComplete && job.step === 'ocr') {
    let signedUrl = '';
    try {
      signedUrl = await deps.storage.signedUrl(job.storage_path, INGEST.signedUrlSeconds);
    } catch (storageErr) {
      const errMsg = storageErr instanceof Error ? storageErr.message : String(storageErr);
      const patch: UserFileAdvancePatch = {
        step: 'ocr',
        status: 'failed',
        error_message: errMsg,
        error_code: 'storage_unavailable',
      };
      await deps.db.advance(job.id, claimToken, patch);
      await deps.db.updateFileIndexStatus?.(job.file_id, 'indexing_failed', errMsg);
      if (deps.db.settleCredits) {
        await deps.db.settleCredits({
          p_job_id: job.id,
          p_final_status: 'failed',
          p_ocr_pages: 0,
          p_actual_cost_usd: 0,
          p_actual_cost_paise: 0,
        });
      }
      return {
        status: 'failed',
        patch,
        pagesProcessed: storedPages.length,
        costUsd: ocrCost,
        error: errMsg,
      };
    }

    let pageIdx = storedPages.length;
    while (!isOcrComplete) {
      if (
        job.page_count !== null &&
        job.page_count !== undefined &&
        pageIdx >= job.page_count
      ) {
        isOcrComplete = true;
        break;
      }

      // Respect budgetMs: if remaining wall-clock is below reserveMs, checkpoint and exit
      const elapsed = now() - startTime;
      if (budgetMs > 0 && (budgetMs - elapsed) < reserveMs) {
        await savePages(storedPages);
        const patch: UserFileAdvancePatch = {
          step: 'ocr',
          status: 'running',
          page_count: storedPages.length,
        };
        await deps.db.advance(job.id, claimToken, patch);
        return {
          status: 'checkpointed',
          patch,
          pagesProcessed: storedPages.length,
          costUsd: ocrCost,
        };
      }

      let ocrResult: OcrCallResult;
      try {
        const ocrReq = buildOcrRequest(OCR_MODEL, signedUrl, [pageIdx]);
        if (deps.ocr) {
          ocrResult = await deps.ocr(ocrReq);
        } else {
          ocrResult = await callMistralOcr(
            {
              fetch: deps.fetch ?? fetch,
              apiKey: deps.mistralApiKey ?? '',
              now,
            },
            ocrReq,
          );
        }
      } catch (ocrErr: unknown) {
        if (storedPages.length > 0 && isOutOfBoundsError(ocrErr)) {
          // Reached end of document
          isOcrComplete = true;
          break;
        }

        const errMsg = ocrErr instanceof Error ? ocrErr.message : String(ocrErr);
        const errCode = ocrErr instanceof IngestError ? ocrErr.code : 'ocr_failed';
        const patch: UserFileAdvancePatch = {
          step: 'ocr',
          status: 'failed',
          error_message: errMsg,
          error_code: errCode,
        };
        await deps.db.advance(job.id, claimToken, patch);
        await deps.db.updateFileIndexStatus?.(job.file_id, 'indexing_failed', errMsg);
        if (deps.db.settleCredits) {
          await deps.db.settleCredits({
            p_job_id: job.id,
            p_final_status: 'failed',
            p_ocr_pages: storedPages.length,
            p_actual_cost_usd: ocrCost,
          });
        }
        return {
          status: 'failed',
          patch,
          pagesProcessed: storedPages.length,
          costUsd: ocrCost,
          error: errMsg,
        };
      }

      if (!ocrResult.pages || ocrResult.pages.length === 0) {
        isOcrComplete = true;
        break;
      }

      for (const p of ocrResult.pages) {
        const pNum = p.index + 1;
        if (!storedPages.some((sp) => sp.page_number === pNum)) {
          storedPages.push(toOcrCheckpoint(p, pNum));
        }
      }

      ocrCost = ocrCostUsd(storedPages.length);
      await savePages(storedPages);

      if (
        ocrResult.pages.length > 1 &&
        (job.page_count === null || job.page_count === undefined || pageIdx + ocrResult.pages.length >= job.page_count)
      ) {
        isOcrComplete = true;
        break;
      }

      pageIdx++;
    }
  }

  // ─── Stage 2: Compose & Chunk ──────────────────────────────────────────────
  const mistralPages: MistralPage[] = storedPages.map(toMistralPage);
  const composedDoc = composeDocument(mistralPages);
  const chunkRows = await chunkDocument(composedDoc.ocrText, {
    targetChars: 1000,
    overlapChars: 200,
  });

  // ─── Stage 3: Embedding via OpenRouter ─────────────────────────────────────
  const textsToEmbed = chunkRows.map((c) => c.content);
  let vectors: number[][] = [];
  let embedTokens = 0;
  let embedCost = 0;

  if (textsToEmbed.length > 0) {
    try {
      if (deps.embed) {
        const res = await deps.embed(textsToEmbed);
        vectors = res.vectors;
        embedTokens = res.promptTokens;
        embedCost = res.costUsd;
      } else {
        const embedDeps: EmbedDeps = deps.embedDeps ?? {
          fetch: deps.fetch ?? fetch,
          apiKey: deps.openRouterApiKey ?? '',
        };
        const res = await embedTexts(embedDeps, textsToEmbed);
        vectors = res.vectors;
        embedTokens = res.promptTokens;
        embedCost = res.costUsd;
      }
    } catch (embedErr: unknown) {
      const errMsg = embedErr instanceof Error ? embedErr.message : String(embedErr);
      const spentTokens = embedErr instanceof EmbeddingError ? embedErr.promptTokens : 0;
      const spentEmbedCost = embedErr instanceof EmbeddingError ? embedErr.costUsd : 0;
      const totalSpentUsd = ocrCost + spentEmbedCost;

      const patch: UserFileAdvancePatch = {
        step: 'embed',
        status: 'failed',
        error_message: errMsg,
        error_code: 'embed_failed',
      };
      await deps.db.advance(job.id, claimToken, patch);
      await deps.db.updateFileIndexStatus?.(job.file_id, 'indexing_failed', errMsg);
      if (deps.db.settleCredits) {
        await deps.db.settleCredits({
          p_job_id: job.id,
          p_final_status: 'failed',
          p_ocr_pages: storedPages.length,
          p_embed_tokens: spentTokens,
          p_actual_cost_usd: totalSpentUsd,
        });
      }

      return {
        status: 'failed',
        patch,
        pagesProcessed: storedPages.length,
        costUsd: totalSpentUsd,
        error: errMsg,
      };
    }
  }

  // ─── Stage 4: Commit Chunks to public.user_file_chunks ─────────────────────
  const safeSha = job.file_sha256 || '0'.repeat(64);
  const ocrHashVal = await ocrHash(safeSha, OCR_MODEL);
  const extractHashVal = await extractHash(ocrHashVal);

  const commitRows: UserFileChunkCommitRow[] = [];
  for (let i = 0; i < chunkRows.length; i++) {
    const c = chunkRows[i];
    const page =
      composedDoc.pages.find((p) => p.char_from <= c.charFrom && c.charFrom < p.char_to) ??
      composedDoc.pages[0];
    const pageNumber = page ? page.page_number : 1;
    const textHash = await sha256Hex(normalise(c.content));

    commitRows.push({
      chunk_hash: c.chunkHash,
      chunk_index: c.chunkIndex,
      page_number: Math.max(1, pageNumber),
      char_from: c.charFrom,
      char_to: c.charTo,
      content: c.content,
      token_count: c.tokenEstimate,
      text_hash: textHash,
      extract_hash: extractHashVal,
      embedding: vectors[i] ?? [],
      metadata: {
        source: 'user_file',
        file_name: job.file_name,
        page_number: Math.max(1, pageNumber),
      },
      block_ids: [],
      image_ids: [],
    });
  }

  if (commitRows.length > 0) {
    try {
      await deps.db.commitChunks(job.user_id, job.file_id, commitRows);
    } catch (commitErr: unknown) {
      const errMsg = commitErr instanceof Error ? commitErr.message : String(commitErr);
      const patch: UserFileAdvancePatch = {
        step: 'commit',
        status: 'failed',
        error_message: errMsg,
        error_code: 'commit_failed',
      };
      await deps.db.advance(job.id, claimToken, patch);
      await deps.db.updateFileIndexStatus?.(job.file_id, 'indexing_failed', errMsg);
      if (deps.db.settleCredits) {
        await deps.db.settleCredits({
          p_job_id: job.id,
          p_final_status: 'failed',
          p_ocr_pages: storedPages.length,
          p_embed_tokens: embedTokens,
          p_actual_cost_usd: ocrCost + embedCost,
        });
      }
      return {
        status: 'failed',
        patch,
        pagesProcessed: storedPages.length,
        costUsd: ocrCost + embedCost,
        error: errMsg,
      };
    }
  }

  // Record embedding provider telemetry in model_call_logs for auditability
  if (embedTokens > 0 && deps.db.recordCallLog) {
    try {
      await deps.db.recordCallLog({
        user_id: job.user_id,
        caller: 'ingest-worker',
        purpose: 'embedding',
        model_requested: 'openai/text-embedding-3-small',
        model_served: 'openai/text-embedding-3-small',
        provider: 'openrouter',
        status: 'success',
        prompt_tokens: embedTokens,
        total_tokens: embedTokens,
        cost_usd: embedCost,
        raw_usage: {
          job_id: job.id,
          file_id: job.file_id,
          chunks_count: chunkRows.length,
          stage: 'user_file_indexing',
        },
      });
    } catch {
      // Non-fatal telemetry recording failure
    }
  }

  // ─── Stage 5: Settle Credits & Advance to Completed ────────────────────────
  // Authoritative credit debit is calculated by database credit_config() using (usd_to_inr / inr_per_credit).
  // No hardcoded multiplier is used in the worker.
  const totalCostUsd = ocrCost + embedCost;

  const settleRes = await deps.db.settleCredits({
    p_job_id: job.id,
    p_final_status: 'completed',
    p_ocr_pages: storedPages.length,
    p_embed_tokens: embedTokens,
    p_actual_cost_usd: totalCostUsd,
  });

  const settledAmount = settleRes?.credits_settled ?? 0;

  const patch: UserFileAdvancePatch = {
    step: 'commit',
    status: 'completed',
    page_count: storedPages.length,
    extract_hash: extractHashVal,
    credits_settled: settledAmount,
  };

  await deps.db.advance(job.id, claimToken, patch);
  await deps.db.updateFileIndexStatus?.(job.file_id, 'indexed');

  return {
    status: 'completed',
    patch,
    pagesProcessed: storedPages.length,
    chunksCommitted: commitRows.length,
    costUsd: totalCostUsd,
  };
}
