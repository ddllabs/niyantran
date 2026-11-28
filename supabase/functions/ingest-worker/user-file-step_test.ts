// Unit tests for executeUserFileJob in user-file-step.ts (Feature F341).
// Tests clean step progression, budget-aware execution checkpointing, and error handling.

import { assert, assertEquals, assertExists } from 'jsr:@std/assert@1';
import {
  clearInMemoryOcrPages,
  executeUserFileJob,
  type UserFileStepDeps,
} from './user-file-step.ts';
import {
  type UserFileAdvancePatch,
  type UserFileChunkCommitRow,
  type UserFileClaimedJob,
  type UserFileIndexStatus,
  type UserFileIngestDb,
  type UserFileOcrPageCheckpoint,
  type UserFileSettleCreditsParams,
  type UserFileSettleCreditsResult,
} from '../_shared/userFiles.types.ts';
import { EmbeddingError, type EmbedResult } from '../_shared/embed.ts';
import { IngestError, type MistralOcrPage, type OcrCallResult, type OcrRequest } from './types.ts';

const USER_ID = '11111111-1111-4111-a111-111111111111';
const FILE_ID = '22222222-2222-4222-a222-222222222222';
const JOB_ID = '101';
const CLAIM_TOKEN = 'token-f341-test';

function makeJob(overrides: Partial<UserFileClaimedJob> = {}): UserFileClaimedJob {
  return {
    id: JOB_ID,
    file_id: FILE_ID,
    user_id: USER_ID,
    status: 'running',
    step: 'ocr',
    attempt_count: 1,
    max_attempts: 3,
    claim_token: CLAIM_TOKEN,
    lease_until: null,
    error_code: null,
    error_message: null,
    credits_hold: 100,
    credits_settled: 0,
    created_at: '2026-11-15T00:00:00Z',
    started_at: '2026-11-15T00:00:01Z',
    finished_at: null,
    storage_path: `${USER_ID}/${FILE_ID}/sample_brief.pdf`,
    file_name: 'sample_brief.pdf',
    file_sha256: 'a'.repeat(64),
    file_size_bytes: 125000,
    page_count: null,
    ...overrides,
  };
}

interface FakeDbState {
  advances: Array<{ jobId: string; claimToken: string; patch: UserFileAdvancePatch }>;
  commits: Array<{ userId: string; fileId: string; chunks: UserFileChunkCommitRow[] }>;
  settlements: UserFileSettleCreditsParams[];
  fileStatuses: Array<{ fileId: string; status: UserFileIndexStatus; error?: string | null }>;
  ocrCheckpoints: Map<string, UserFileOcrPageCheckpoint[]>;
}

function createFakeDb(): { db: UserFileIngestDb; state: FakeDbState } {
  const state: FakeDbState = {
    advances: [],
    commits: [],
    settlements: [],
    fileStatuses: [],
    ocrCheckpoints: new Map(),
  };

  const db: UserFileIngestDb = {
    claim: () => Promise.resolve([]),
    advance: (jobId, claimToken, patch) => {
      state.advances.push({ jobId, claimToken, patch });
      return Promise.resolve();
    },
    commitChunks: (userId, fileId, chunks) => {
      state.commits.push({ userId, fileId, chunks });
      return Promise.resolve({ inserted: chunks.length, deleted: 0 });
    },
    settleCredits: (params: UserFileSettleCreditsParams): Promise<UserFileSettleCreditsResult> => {
      state.settlements.push(params);
      return Promise.resolve({
        success: true,
        credits_settled: params.p_actual_cost_paise ?? Math.round((params.p_actual_cost_usd ?? 0) * 9500),
        credits_refunded: 0,
        ledger_entry_id: 'ledger-mock-1',
      });
    },
    recordCallLog: () => Promise.resolve(),
    getOcrPages: (fileId: string) => Promise.resolve(state.ocrCheckpoints.get(fileId) ?? []),
    saveOcrPages: (fileId: string, pages: UserFileOcrPageCheckpoint[]) => {
      state.ocrCheckpoints.set(fileId, [...pages]);
      return Promise.resolve();
    },
    updateFileIndexStatus: (fileId, status, error) => {
      state.fileStatuses.push({ fileId, status, error });
      return Promise.resolve();
    },
  };

  return { db, state };
}

function fakeStorage(shouldFail = false) {
  return {
    signedUrl: (path: string, _expires: number) => {
      if (shouldFail) return Promise.reject(new Error('Storage service unavailable'));
      return Promise.resolve(`https://mock.storage/user-files/${path}?token=signed-token`);
    },
  };
}

function fakeOcrGenerator(totalPages: number) {
  return (req: OcrRequest): Promise<OcrCallResult> => {
    const pageIndex = req.pages[0];
    if (pageIndex >= totalPages) {
      // Simulate out-of-bounds error
      throw new IngestError('page_out_of_bounds', `Page index ${pageIndex} is out of bounds`, true, 400);
    }
    const page: MistralOcrPage = {
      index: pageIndex,
      markdown: `# Section ${pageIndex + 1}\n\nThis is the content for page ${pageIndex + 1} of the document.\nIt contains verifiable text for chunking and embedding.`,
      header: `Header Page ${pageIndex + 1}`,
      footer: `Footer Page ${pageIndex + 1}`,
      dimensions: { width: 800, height: 1100, dpi: 300 },
      blocks: [],
      tables: [],
      images: [],
    };
    return Promise.resolve({
      pages: [page],
      model: 'mistral-ocr-4-1',
      pagesProcessed: 1,
      docSizeBytes: 50000,
      bytes: 1200,
      latencyMs: 150,
    });
  };
}

function fakeEmbed(vectorsWidth = 1536) {
  return (texts: string[]): Promise<EmbedResult> => {
    const vectors = texts.map((_, i) => Array.from({ length: vectorsWidth }, (_, j) => (i + 1) * 0.001 + j * 0.0001));
    const promptTokens = texts.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0);
    const costUsd = promptTokens * 0.00000002;
    return Promise.resolve({
      vectors,
      model: 'openai/text-embedding-3-small',
      promptTokens,
      costUsd,
      requests: 1,
    });
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

Deno.test('executeUserFileJob: clean step progression (OCR -> Chunks -> Embeddings -> Commit -> Settle)', async () => {
  clearInMemoryOcrPages();
  const { db, state } = createFakeDb();
  const job = makeJob({ page_count: 2 });
  const deps: UserFileStepDeps = {
    db,
    storage: fakeStorage(),
    ocr: fakeOcrGenerator(2),
    embed: fakeEmbed(1536),
    now: () => 1_000,
    budgetMs: 100_000,
  };

  const outcome = await executeUserFileJob(job, deps);

  assertEquals(outcome.status, 'completed');
  assertEquals(outcome.pagesProcessed, 2);
  assertExists(outcome.chunksCommitted);
  assert(outcome.chunksCommitted! > 0);
  assert(outcome.costUsd! > 0);

  // Verify advance patch
  assertEquals(outcome.patch.status, 'completed');
  assertEquals(outcome.patch.step, 'commit');
  assertEquals(outcome.patch.page_count, 2);
  assertExists(outcome.patch.extract_hash);
  assertExists(outcome.patch.credits_settled);

  // Verify DB commits
  assertEquals(state.commits.length, 1);
  assertEquals(state.commits[0].userId, USER_ID);
  assertEquals(state.commits[0].fileId, FILE_ID);
  const chunks = state.commits[0].chunks;
  assertEquals(chunks.length, outcome.chunksCommitted);

  for (const chunk of chunks) {
    assertEquals(chunk.embedding.length, 1536);
    assertEquals(chunk.text_hash.length, 64);
    assertEquals(chunk.chunk_hash.length, 64);
    assert(chunk.page_number !== null && chunk.page_number >= 1);
    assertEquals(chunk.metadata.source, 'user_file');
    assertEquals(chunk.metadata.file_name, 'sample_brief.pdf');
  }

  // Verify credits settlement
  assertEquals(state.settlements.length, 1);
  assertEquals(state.settlements[0].p_job_id, JOB_ID);
  assertEquals(state.settlements[0].p_final_status, 'completed');
  assertEquals(state.settlements[0].p_ocr_pages, 2);
  assert(state.settlements[0].p_embed_tokens! > 0);
  assert(state.settlements[0].p_actual_cost_usd! > 0);

  // Verify index_status updated to 'indexed'
  const indexedStatus = state.fileStatuses.find((s) => s.status === 'indexed');
  assertExists(indexedStatus);
  assertEquals(indexedStatus!.fileId, FILE_ID);
});

Deno.test('executeUserFileJob: budget-aware execution checkpointing pauses and saves state', async () => {
  clearInMemoryOcrPages();
  const { db, state } = createFakeDb();
  const job = makeJob({ page_count: 3 });

  // Clock simulates elapsed time exceeding budget before page 1
  let currentTime = 1_000;
  let ocrCalls = 0;
  const deps: UserFileStepDeps = {
    db,
    storage: fakeStorage(),
    ocr: (req) => {
      ocrCalls++;
      currentTime += 60; // Advance time by 60ms
      return fakeOcrGenerator(3)(req);
    },
    embed: fakeEmbed(1536),
    now: () => currentTime,
    budgetMs: 100, // Budget is 100ms
    reserveMs: 50, // Reserve is 50ms
  };

  const outcome = await executeUserFileJob(job, deps);

  // Job should checkpoint after 1 page because remaining time (40ms) < reserveMs (50ms)
  assertEquals(outcome.status, 'checkpointed');
  assertEquals(outcome.pagesProcessed, 1);
  assertEquals(ocrCalls, 1);
  assertEquals(outcome.patch.status, 'running');
  assertEquals(outcome.patch.step, 'ocr');
  assertEquals(outcome.patch.page_count, 1);

  // Verify checkpoint was persisted
  const savedPages = state.ocrCheckpoints.get(FILE_ID);
  assertExists(savedPages);
  assertEquals(savedPages!.length, 1);
  assertEquals(savedPages![0].page_number, 1);

  // Verify no chunks committed or credits settled yet
  assertEquals(state.commits.length, 0);
  assertEquals(state.settlements.length, 0);

  // Verify advance was called with checkpoint patch
  const lastAdvance = state.advances[state.advances.length - 1];
  assertEquals(lastAdvance.patch.status, 'running');
  assertEquals(lastAdvance.patch.step, 'ocr');
  assertEquals(lastAdvance.patch.page_count, 1);
});

Deno.test('executeUserFileJob: resumes from checkpointed OCR pages and completes successfully', async () => {
  const { db, state } = createFakeDb();
  const job = makeJob({ page_count: 3 });

  // Pre-populate page 1 in checkpoint store
  state.ocrCheckpoints.set(FILE_ID, [
    {
      page_number: 1,
      text: '# Section 1\n\nPre-checkpointed text from previous invocation.',
      header: 'Header 1',
      footer: 'Footer 1',
      width_px: 800,
      height_px: 1100,
    },
  ]);

  let ocrCalls = 0;
  const requestedPageIndexes: number[] = [];
  const deps: UserFileStepDeps = {
    db,
    storage: fakeStorage(),
    ocr: (req) => {
      ocrCalls++;
      requestedPageIndexes.push(req.pages[0]);
      return fakeOcrGenerator(3)(req);
    },
    embed: fakeEmbed(1536),
    now: () => 1_000,
    budgetMs: 100_000,
  };

  const outcome = await executeUserFileJob(job, deps);

  assertEquals(outcome.status, 'completed');
  assertEquals(outcome.pagesProcessed, 3);

  // Must NOT re-OCR page index 0; only pages 1 and 2
  assertEquals(ocrCalls, 2);
  assertEquals(requestedPageIndexes, [1, 2]);

  // All 3 pages must be in the final checkpoint store
  assertEquals(state.ocrCheckpoints.get(FILE_ID)!.length, 3);
  assertEquals(state.commits.length, 1);
  assertEquals(state.settlements.length, 1);
});

Deno.test('executeUserFileJob: error handling when OCR fails advances job to failed', async () => {
  clearInMemoryOcrPages();
  const { db, state } = createFakeDb();
  const job = makeJob({ page_count: 2 });

  const deps: UserFileStepDeps = {
    db,
    storage: fakeStorage(),
    ocr: () => {
      throw new IngestError('mistral_unavailable', 'Mistral OCR HTTP 500: Internal Server Error', false, 500);
    },
    embed: fakeEmbed(1536),
    now: () => 1_000,
  };

  const outcome = await executeUserFileJob(job, deps);

  assertEquals(outcome.status, 'failed');
  assertExists(outcome.error);
  assert(outcome.error!.includes('Mistral OCR HTTP 500'));
  assertEquals(outcome.patch.status, 'failed');
  assertEquals(outcome.patch.step, 'ocr');
  assertEquals(outcome.patch.error_code, 'mistral_unavailable');

  // Verify advance was called with status 'failed'
  const advance = state.advances.find((a) => a.patch.status === 'failed');
  assertExists(advance);

  // Verify index_status updated to 'indexing_failed'
  const failedStatus = state.fileStatuses.find((s) => s.status === 'indexing_failed');
  assertExists(failedStatus);
  assertEquals(failedStatus!.fileId, FILE_ID);

  // Zero chunks committed
  assertEquals(state.commits.length, 0);
});

Deno.test('executeUserFileJob: partial OCR failure settles credits for completed pages', async () => {
  clearInMemoryOcrPages();
  const { db, state } = createFakeDb();
  const job = makeJob({ page_count: 2 });

  let callCount = 0;
  const deps: UserFileStepDeps = {
    db,
    storage: fakeStorage(),
    ocr: (req) => {
      callCount++;
      if (callCount === 1) {
        return fakeOcrGenerator(2)(req); // Page 0 succeeds
      }
      throw new IngestError('mistral_rate_limited', 'Mistral OCR HTTP 429: Too Many Requests', false, 429);
    },
    embed: fakeEmbed(1536),
    now: () => 1_000,
  };

  const outcome = await executeUserFileJob(job, deps);

  assertEquals(outcome.status, 'failed');
  assertEquals(outcome.pagesProcessed, 1);
  assert(outcome.costUsd! > 0);

  // Verified settled credits for the 1 successful page
  assertEquals(state.settlements.length, 1);
  assertEquals(state.settlements[0].p_final_status, 'failed');
  assertEquals(state.settlements[0].p_ocr_pages, 1);
  assert(state.settlements[0].p_actual_cost_usd! > 0);

  // File status set to indexing_failed
  const failedStatus = state.fileStatuses.find((s) => s.status === 'indexing_failed');
  assertExists(failedStatus);
});

Deno.test('executeUserFileJob: error handling when Embedding fails advances to failed and settles OCR credits', async () => {
  clearInMemoryOcrPages();
  const { db, state } = createFakeDb();
  const job = makeJob({ page_count: 2 });

  const deps: UserFileStepDeps = {
    db,
    storage: fakeStorage(),
    ocr: fakeOcrGenerator(2),
    embed: () => {
      throw new EmbeddingError('OpenRouter rate limit 429', { costUsd: 0, promptTokens: 0 }, 429);
    },
    now: () => 1_000,
  };

  const outcome = await executeUserFileJob(job, deps);

  assertEquals(outcome.status, 'failed');
  assertExists(outcome.error);
  assert(outcome.error!.includes('OpenRouter rate limit'));
  assertEquals(outcome.patch.status, 'failed');
  assertEquals(outcome.patch.step, 'embed');
  assertEquals(outcome.patch.error_code, 'embed_failed');

  // Verify advance called with failed status
  const advance = state.advances.find((a) => a.patch.status === 'failed');
  assertExists(advance);
  assertEquals(advance!.patch.step, 'embed');

  // Verify credits settled for OCR work done
  assertEquals(state.settlements.length, 1);
  assertEquals(state.settlements[0].p_final_status, 'failed');
  assertEquals(state.settlements[0].p_ocr_pages, 2);
  assert(state.settlements[0].p_actual_cost_usd! > 0);

  // Verify index_status is indexing_failed
  const failedStatus = state.fileStatuses.find((s) => s.status === 'indexing_failed');
  assertExists(failedStatus);

  // No chunks committed
  assertEquals(state.commits.length, 0);
});

Deno.test('executeUserFileJob: handles storage failure cleanly', async () => {
  clearInMemoryOcrPages();
  const { db, state } = createFakeDb();
  const job = makeJob();

  const deps: UserFileStepDeps = {
    db,
    storage: fakeStorage(true), // Storage fails
    ocr: fakeOcrGenerator(1),
    embed: fakeEmbed(1536),
  };

  const outcome = await executeUserFileJob(job, deps);

  assertEquals(outcome.status, 'failed');
  assertEquals(outcome.patch.error_code, 'storage_unavailable');
  assertEquals(state.commits.length, 0);
  const failedStatus = state.fileStatuses.find((s) => s.status === 'indexing_failed');
  assertExists(failedStatus);
});
