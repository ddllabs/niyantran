// Bulk runner, T1 (F285): one record in, one request or one named hold out. No database, no network.
// Spec: docs/specs/2026-11-07-bulk-runner.md. The rules are the worker's own (prepareSuppliedText,
// suppliedCommitRows, billTextIdentity); nothing here re-implements them.
import { NATIONAL_BILLS, prepareSuppliedText, SUPPLIED_TEXT } from '../../supabase/functions/_shared/suppliedText.ts';
import { billTextIdentity } from '../../supabase/functions/_shared/billIdentity.ts';
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import { suppliedCommitRows } from '../../supabase/functions/ingest-worker/supplied-step.ts';

export type Rec = Record<string, unknown>;

export type HoldReason =
  | 'over_chunk_limit'
  | 'no_text'
  | 'prepare_failed'
  | 'text_identity_failed'
  | 'corrigendum_unmapped'
  | 'superseded_by_patch'
  /** Set by plan.ts, not here: a text another record of the pack keeps (the pack's dedupe list). */
  | 'duplicate_of_keeper';

export interface Hold {
  source_key: string | null;
  reason: HoldReason;
  detail?: string;
  /** over_chunk_limit: how many chunks the text makes. */
  chunks?: number;
}

/** What a corrigendum is given: the identity of the bill it corrects (spec: bills adapter, Corrigenda). */
export interface BillIdentity {
  bill_number: string;
  bill_year: string;
  bill_name: string;
  house: string;
}

export interface PrepareOptions {
  /** Policy limit on chunks per document (700 for Bills). Default: the adapter's own 800. */
  maxChunks?: number;
  /** The collection's policy requires review check bill_identity. */
  requireTextIdentity?: boolean;
  /** source_key to the record that replaces it. */
  patches?: Record<string, Rec>;
  /** source_key of a corrigendum to the bill it belongs to. */
  corrigenda?: Record<string, BillIdentity>;
}

export interface PreparedRequest {
  source_key: string;
  /** What ingest_register_batch takes for this document. */
  request: { payload: string; payload_sha256: string; expected: unknown[]; pages: unknown[]; sections: unknown[] };
  /** The manifest item. */
  item: { source_key: string; payload_sha256: string; content_sha256: string; chunks: number; est_tokens: number };
  desk: { tier: string; feature: string };
  controlCodesRemoved: number;
}

export type Prepared = { kind: 'request' } & PreparedRequest | { kind: 'hold'; hold: Hold };

// Registration refuses control codes other than tab, LF and CR (control_codes), so they go before hashing.
// deno-lint-ignore no-control-regex
const CONTROL_CODES = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const keyOf = (r: unknown): string | null => isRec(r) && typeof r.source_key === 'string' ? r.source_key : null;
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Removes control codes from the text and moves every code-point span to where its words now are. */
function strip(record: Rec, text: string): { record: Rec; removed: number } {
  const cps = [...text];
  const at: number[] = new Array(cps.length + 1);
  const kept: string[] = [];
  for (let i = 0; i < cps.length; i++) {
    at[i] = kept.length;
    if (!CONTROL_CODES.test(cps[i])) kept.push(cps[i]);
  }
  at[cps.length] = kept.length;
  const removed = cps.length - kept.length;
  if (!removed) return { record, removed: 0 };
  const clean = kept.join('');
  const respan = (raw: unknown) =>
    Array.isArray(raw)
      ? raw.map((s) => {
        if (!isRec(s) || !Number.isSafeInteger(s.char_from) || !Number.isSafeInteger(s.char_to)) return s;
        const a = s.char_from as number, b = s.char_to as number;
        if (a < 0 || b < a || b > cps.length) return s; // malformed: left for prepareSuppliedText to refuse
        const moved: Rec = { ...s, char_from: at[a], char_to: at[b] };
        if (typeof s.text === 'string') moved.text = kept.slice(at[a], at[b]).join('');
        return moved;
      })
      : raw;
  const out: Rec = { ...record, text: clean };
  if (record.pages !== undefined) out.pages = respan(record.pages);
  if (record.sections !== undefined) out.sections = respan(record.sections);
  if (record.n_chars != null) out.n_chars = kept.length;
  return { record: out, removed };
}

export async function prepareRecord(value: unknown, options: PrepareOptions = {}, isPatch = false): Promise<Prepared> {
  const hold = (reason: HoldReason, extra: Partial<Hold> = {}): Prepared => ({
    kind: 'hold',
    hold: { source_key: keyOf(value), reason, ...extra },
  });
  if (!isRec(value)) return hold('prepare_failed', { detail: 'record must be an object' });
  const key = keyOf(value);
  if (!isPatch && key !== null && options.patches && Object.hasOwn(options.patches, key)) {
    return hold('superseded_by_patch');
  }
  if (typeof value.text !== 'string') return hold('no_text');
  let { record, removed } = strip(value, value.text);
  if (typeof record.text !== 'string' || !record.text.trim()) return hold('no_text');
  // Longer than the adapter takes at all: at about 760 characters a chunk, that is past any chunk limit too.
  if (record.text.length > SUPPLIED_TEXT.maxChars) {
    return hold('over_chunk_limit', { detail: `text over ${SUPPLIED_TEXT.maxChars} characters` });
  }
  if (removed) {
    // The hashes bind the text, so they move with it.
    const sha = await sha256Hex(record.text as string);
    record = { ...record, text_sha256: sha };
    if (record.content_sha256 !== undefined) record.content_sha256 = sha;
    if (isRec(record.review)) record.review = { ...record.review, text_sha256: sha };
  }

  const isBill = record.desk_tier === NATIONAL_BILLS.tier && record.desk_feature === NATIONAL_BILLS.feature;
  if (isBill && record.document_role === 'errata') {
    const id = key !== null && options.corrigenda && Object.hasOwn(options.corrigenda, key)
      ? options.corrigenda[key]
      : null;
    if (!id) return hold('corrigendum_unmapped');
    record = {
      ...record,
      document_key: `bill:${id.bill_year}:${id.bill_number}`,
      citation: {
        ...(isRec(record.citation) ? record.citation : {}),
        bill_number: id.bill_number,
        bill_year: id.bill_year,
        bill_name: id.bill_name,
        house: id.house,
      },
    };
  }

  let identity: ReturnType<typeof billTextIdentity> | null = null;
  if (isBill && options.requireTextIdentity) {
    const c = isRec(record.citation) ? record.citation : {};
    identity = billTextIdentity(
      record.text as string,
      { number: String(c.bill_number ?? ''), name: String(c.bill_name ?? '') },
      String(record.document_role),
    );
    // Recorded for admission to enforce, only when the check passed (or did not apply to the role).
    if (identity.pass && isRec(record.review) && isRec(record.review.checks)) {
      record = { ...record, review: { ...record.review, checks: { ...record.review.checks, bill_identity: true } } };
    }
  }

  let prepared;
  try {
    prepared = await prepareSuppliedText(record, { batch: true });
  } catch (e) {
    const detail = message(e);
    // The adapter's own ceiling (800), or no chunks at all: the same hold as a policy limit.
    if (detail.startsWith('chunk limit')) return hold('over_chunk_limit', { detail });
    return hold('prepare_failed', { detail });
  }
  const n = prepared.chunks.length;
  if (n > (options.maxChunks ?? SUPPLIED_TEXT.maxChunks)) return hold('over_chunk_limit', { chunks: n });
  if (identity && !identity.pass) {
    return hold('text_identity_failed', { detail: `title ${identity.title}, number ${identity.number}` });
  }
  const source_key = prepared.input.source_key as string;
  return {
    kind: 'request',
    source_key,
    request: {
      payload: prepared.payload,
      payload_sha256: prepared.payload_sha256,
      expected: suppliedCommitRows(prepared.chunks),
      pages: prepared.pages,
      sections: prepared.sections,
    },
    item: {
      source_key,
      payload_sha256: prepared.payload_sha256,
      content_sha256: await sha256Hex(prepared.text),
      chunks: n,
      est_tokens: prepared.chunks.reduce((s, c) => s + Math.ceil(c.embedding_input.length / 4), 0),
    },
    desk: { tier: String(record.desk_tier), feature: String(record.desk_feature) },
    controlCodesRemoved: removed,
  };
}

/** A whole pack: each record once, then each patch in place of the record it replaces. Nothing is dropped. */
export async function prepareAll(
  records: unknown[],
  options: PrepareOptions = {},
): Promise<{ requests: PreparedRequest[]; holds: Hold[]; controlCodesRemoved: number }> {
  const requests: PreparedRequest[] = [];
  const holds: Hold[] = [];
  let controlCodesRemoved = 0;
  const add = (p: Prepared) => {
    if (p.kind === 'hold') holds.push(p.hold);
    else {
      requests.push(p);
      controlCodesRemoved += p.controlCodesRemoved;
    }
  };
  for (const r of records) add(await prepareRecord(r, options));
  for (const patch of Object.values(options.patches ?? {})) add(await prepareRecord(patch, options, true));
  return { requests, holds, controlCodesRemoved };
}
