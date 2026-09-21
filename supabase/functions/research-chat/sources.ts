// The citation ladder applied to one finished answer (streaming spec §E.5).
// The model cites opaque handles in "sources" and plain [n] markers in the
// prose. Here those are resolved against the evidence the loop actually
// retrieved: a handle the model never received cannot become a citation, and
// a marker that resolves to nothing is stripped rather than left as a bracket
// with no bubble behind it. The three named failure modes are reported so the
// handler can decide whether a repair pass is worth paying for.

import type { CitationSource, RowCitation, TextCitation } from '../_shared/citation.types.ts';
import { citedIds, expandGroupedCitations, MAX_CITATION_ID, recoverHandleCitations, renumberCitations } from '../_shared/citations.ts';
import { handlesIn, noncesOf, restoreHandlePrefixes, stripResidualHandles } from '../_shared/handles.ts';
import type { Chunk } from '../_shared/retrieval.ts';
import type { DeskRow } from '../_shared/tools/searchDeskRows.ts';

export type Evidence =
  | { kind: 'text'; chunk: Chunk }
  | { kind: 'row'; row: DeskRow };

/** handle → the passage or row it was assigned to. */
export type EvidenceMap = Map<string, Evidence>;

export interface LadderFlags {
  /** The answer cited nothing resolvable although evidence was retrieved. */
  prose_fallback: boolean;
  /** At least one marker named a source the model never had; it was stripped. */
  marker_source_mismatch: boolean;
  /**
   * A substantial answer ended with no sources at all.
   *
   * This used to require that evidence had been retrieved, which excluded the
   * turns that need it most. A real turn re-asked a question it had already
   * answered, declined to search twice, and reproduced its own earlier answer
   * word for word with the citation markers stripped off - 829 characters, zero
   * sources, opening "The record shows". It obeyed the rule that an earlier
   * turn's passages cannot be cited and ignored the rule that uncitable claims
   * cannot be asserted, and the flag that exists to catch exactly that could not
   * fire, because a turn that retrieved nothing has no evidence.
   */
  uncited_claims: boolean;
}

export interface LadderResult {
  answer: string;
  sources: CitationSource[];
  flags: LadderFlags;
  /** Handles recovered from the prose because the model wrote them instead of citing. */
  recovered: number;
}

export const UNCITED_ANSWER_CHARS = 200;

const TITLE_KEYS = ['bill_name', 'title', 'name', 'subject', 'case_title', 'conflict_name', 'topic', 'question', 'officer_name', 'jurisdiction'];

export function rowTitle(row: DeskRow): string {
  for (const k of TITLE_KEYS) {
    const v = row.row?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return row.row_key;
}

function toSource(id: number, e: Evidence): CitationSource {
  if (e.kind === 'row') {
    const row: RowCitation = {
      id,
      kind: 'row',
      tier: e.row.tier,
      feature: e.row.feature,
      row_key: e.row.row_key,
      title: rowTitle(e.row),
      row_snapshot: e.row.row,
      snapshot_at: e.row.snapshot_at || null,
    };
    return row;
  }
  const c = e.chunk;
  const text: TextCitation = {
    id,
    kind: 'text',
    chunk_id: c.id,
    document_id: c.document_id,
    title: c.title,
    file_name: c.file_name,
    file_url: c.file_url,
    desk_tier: c.desk_tier,
    desk_feature: c.desk_feature,
    char_from: c.char_from,
    char_to: c.char_to,
    text_hash: c.text_hash,
    source_kind: c.source_kind,
    page_number: c.page_number,
  };
  return text;
}

export interface LadderInput {
  answer: string;
  /** The model's own "sources": [{ id, source }] — ids and handles are both untrusted. */
  modelSources: unknown;
  evidence: EvidenceMap;
}

/**
 * Expand grouped markers, resolve the model's handles, rescue handles it wrote
 * into the prose, keep only citations backed by retrieved evidence, renumber
 * them 1..k and rewrite the markers.
 */
export function applyCitationLadder(input: LadderInput): LadderResult {
  // 0. Put back the `ref:` the model dropped, for the nonces this turn issued.
  //    Without this a damaged handle is invisible to every rung below it.
  const nonces = noncesOf(input.evidence.keys());
  const expanded = expandGroupedCitations(restoreHandlePrefixes(String(input.answer ?? ''), nonces));

  // 1. The model's claimed sources, kept only where the handle was really issued.
  const byId = new Map<number, Evidence>();
  const handleToId: Record<string, number> = {};
  const claimed = Array.isArray(input.modelSources) ? input.modelSources : [];
  for (const raw of claimed) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, source } = raw as { id?: unknown; source?: unknown };
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > MAX_CITATION_ID) continue;
    if (typeof source !== 'string') continue;
    const handle = source.trim().replace(/^\[|\]$/g, '');
    const e = input.evidence.get(handle);
    if (!e || byId.has(id) || handleToId[handle] !== undefined) continue;
    byId.set(id, e);
    handleToId[handle] = id;
  }

  const claimedMarkers = citedIds(expanded);
  const resolvedBefore = claimedMarkers.filter((n) => byId.has(n));

  // 2. Handles written into the prose instead of cited: give the ones we issued
  //    an id (a new one when the model never listed them) and rewrite them.
  let nextId = Math.max(0, ...byId.keys()) + 1;
  let recovered = 0;
  for (const handle of handlesIn(expanded)) {
    if (!input.evidence.has(handle)) continue;
    if (handleToId[handle] === undefined) {
      if (nextId > MAX_CITATION_ID) break;
      handleToId[handle] = nextId;
      byId.set(nextId, input.evidence.get(handle)!);
      nextId++;
    }
    recovered++;
  }
  const withHandles = recovered ? recoverHandleCitations(expanded, handleToId) : expanded;

  // 3. Build the sources the surviving markers point at, then renumber.
  const cited = citedIds(withHandles);
  const sources: CitationSource[] = [];
  for (const id of cited) {
    const e = byId.get(id);
    if (e) sources.push(toSource(id, e));
  }
  const final = renumberCitations(withHandles, sources);
  // 4. Anything still shaped like a handle named nothing we retrieved. It has no
  //    bubble behind it, so it is not a citation, and it is not prose either.
  const answer = stripResidualHandles(final.answer, nonces);

  const hadEvidence = input.evidence.size > 0;
  const flags: LadderFlags = {
    prose_fallback: hadEvidence && resolvedBefore.length === 0 && final.sources.length > 0,
    marker_source_mismatch: claimedMarkers.some((n) => !byId.has(n)),
    uncited_claims: final.sources.length === 0 && answer.trim().length >= UNCITED_ANSWER_CHARS,
  };
  return { answer, sources: final.sources, flags, recovered };
}

export function ladderFired(flags: LadderFlags): boolean {
  return flags.prose_fallback || flags.marker_source_mismatch || flags.uncited_claims;
}
