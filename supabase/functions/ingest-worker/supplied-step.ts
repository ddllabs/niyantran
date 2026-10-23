import { canonical, prepareSuppliedText } from '../_shared/suppliedText.ts';
import { type ContextChunk, TEXT_CONTEXT_VERSION } from '../_shared/textContext.ts';
import { runIndexPlan } from './index-step.ts';
import { IngestError, type PageCommitRow, type Step } from './types.ts';

export function suppliedCommitRows(chunks: ContextChunk[]): PageCommitRow[] {
  return chunks.map((c) => ({
    chunk_hash: c.chunkHash,
    chunk_index: c.chunkIndex,
    source_kind: 'document',
    page_number: null,
    char_from: c.charFrom,
    char_to: c.charTo,
    content: c.content,
    token_count: c.tokenEstimate,
    chunker_version: TEXT_CONTEXT_VERSION,
    metadata: { section: c.section },
    block_ids: [],
    image_ids: [],
    embed_hash: c.embed_hash,
  }));
}
export const suppliedTextStep: Step = async (deps, job, deadline) => {
  if (!deps.db.textInput || !deps.db.textCommit || !deps.db.textActivate) {
    throw new IngestError('text_unavailable', 'supplied-text dependencies unavailable', true);
  }
  const stored = await deps.db.textInput(job.document_id);
  let plan;
  try {
    plan = await prepareSuppliedText(JSON.parse(stored.payload));
  } catch {
    throw new IngestError('text_invalid', 'stored supplied-text validation failed', true);
  }
  const rows = suppliedCommitRows(plan.chunks);
  if (
    stored.payload_sha256 !== plan.payload_sha256 ||
    canonical(stored.expected) !== canonical(rows)
  ) {
    throw new IngestError('text_changed', 'supplied-text plan no longer matches registration', true);
  }
  return runIndexPlan(
    deps,
    job,
    deadline,
    plan.chunks.map((c) => ({
      chunk_hash: c.chunkHash,
      chunk_index: c.chunkIndex,
      embed_hash: c.embed_hash,
      embedding_input: c.embedding_input,
    })),
    rows,
    (spend) => deps.db.textActivate!(job.id, job.claim_token, spend.tokens, spend.cost),
  );
};
