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
  | 'patch_not_in_pack'
  | 'patch_key_mismatch'
  | 'control_codes_excess'
  | 'corrigendum_conflict'
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
  /** Policy limit on chunks per document (700 for Bills). Required: a run says what its collection allows. */
  maxChunks: number;
  /** The collection's policy requires review check bill_identity. */
  requireTextIdentity?: boolean;
  /** source_key to the record that replaces it. */
  patches?: Record<string, Rec>;
  /** source_key of a corrigendum to the bill it belongs to. */
  corrigenda?: Record<string, BillIdentity>;
  /**
   * Drop `citation.date` from a record whose date is given but is not a calendar date (YYYY-MM-DD), before the payload
   * is built, and count it. The text and its hashes are untouched. Off unless the collection file asks (search-only
   * desks: 160 of the Regulatory pack's dates are not dates).
   */
  dropInvalidCitationDates?: boolean;
}

export interface PreparedRequest {
  source_key: string;
  /** What ingest_register_batch takes for this document. */
  request: { payload: string; payload_sha256: string; expected: unknown[]; pages: unknown[]; sections: unknown[] };
  /** The manifest item. */
  item: { source_key: string; payload_sha256: string; content_sha256: string; chunks: number; est_tokens: number };
  desk: { tier: string; feature: string };
  controlCodesRemoved: number;
  /** 1 when this record's invalid citation date was dropped (see PrepareOptions); absent in fixtures built by hand. */
  citationDatesDropped?: number;
}

export type Prepared = { kind: 'request' } & PreparedRequest | { kind: 'hold'; hold: Hold };

// Registration refuses control codes other than tab, LF and CR (control_codes), so they go before hashing.
// deno-lint-ignore no-control-regex
const CONTROL_CODES = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
// deno-lint-ignore no-control-regex
const CONTROL_CODES_G = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
// Vertical tab and form feed are page and layout breaks from PDF extraction: 508 of the 510 live bills with control codes
// have only these. They become line breaks, so the words either side stay apart, and they never count as a shifted font.
const LAYOUT_BREAKS = new Set(['\x0b', '\x0c']);

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const keyOf = (r: unknown): string | null => isRec(r) && typeof r.source_key === 'string' ? r.source_key : null;
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

/**
 * Removes control codes from the text, turning layout breaks into line breaks, and moves every code-point span to where
 * its words now are. `removed` counts both kinds of change.
 */
export function strip(record: Rec, text: string): { record: Rec; removed: number } {
  const cps = [...text];
  const at: number[] = new Array(cps.length + 1);
  const kept: string[] = [];
  let removed = 0;
  for (let i = 0; i < cps.length; i++) {
    at[i] = kept.length;
    if (!CONTROL_CODES.test(cps[i])) kept.push(cps[i]);
    else {
      removed += 1;
      if (LAYOUT_BREAKS.has(cps[i])) kept.push('\n');
    }
  }
  at[cps.length] = kept.length;
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

/**
 * A shifted font shows as a dense run of control codes, so density is judged over a window, not the whole text: a shifted
 * annexure in a long bill is a small share of the whole. More than 10 codes other than layout breaks in any 2,000
 * characters (0.5%) is held. F281's shifted-font text was 13%; no live bill has more than 10 in all.
 */
const SHIFTED_FONT_WINDOW = 2_000;
const SHIFTED_FONT_MAX_IN_WINDOW = 10;

/** The first run of more than the allowed codes within one window, or null. */
function denseRun(text: string): { at: number; span: number; count: number } | null {
  const at: number[] = [];
  let i = 0;
  for (const c of text) {
    if (CONTROL_CODES.test(c) && !LAYOUT_BREAKS.has(c)) at.push(i);
    i += 1;
  }
  for (let k = 0; k + SHIFTED_FONT_MAX_IN_WINDOW < at.length; k++) {
    const span = at[k + SHIFTED_FONT_MAX_IN_WINDOW] - at[k] + 1;
    if (span <= SHIFTED_FONT_WINDOW) return { at: at[k], span, count: SHIFTED_FONT_MAX_IN_WINDOW + 1 };
  }
  return null;
}

const isInt = (v: unknown): v is number => Number.isSafeInteger(v);

/** A real calendar date written YYYY-MM-DD. */
function isCalendarDate(v: unknown): boolean {
  if (typeof v !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** Does the record, as the pack delivered it, bind its own text? Null when it does, else why not. */
async function verify(record: Rec, text: string): Promise<string | null> {
  const hash = await sha256Hex(text);
  if (record.text_sha256 !== hash) return 'text_sha256 does not match the text';
  if (record.content_sha256 !== undefined && record.content_sha256 !== hash) {
    return 'content_sha256 does not match the text';
  }
  const review = record.review;
  if (!isRec(review)) return 'review is missing';
  if (review.text_sha256 !== hash) return 'review.text_sha256 does not bind the text';
  if (review.source_key !== record.source_key) return 'review.source_key does not bind the record';
  const length = [...text].length;
  if (record.n_chars != null && record.n_chars !== length) return 'n_chars does not match the text';
  const cps = [...text];
  for (const kind of ['pages', 'sections'] as const) {
    const raw = record[kind];
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) return `${kind} must be an array`;
    let end = 0;
    const numbers = new Set<number>();
    for (const sp of raw) {
      if (!isRec(sp)) return `a ${kind} entry is not an object`;
      const a = sp.char_from, b = sp.char_to;
      if (!isInt(a) || !isInt(b) || a < 0 || b < a || b > length) return `a ${kind} span is out of range`;
      if (kind === 'pages') {
        if (a < end || !isInt(sp.page_number) || sp.page_number < 1 || numbers.has(sp.page_number)) {
          return 'pages overlap or repeat a number';
        }
        numbers.add(sp.page_number);
        end = b;
        if (sp.text !== undefined && sp.text !== cps.slice(a, b).join('')) return 'page text does not match the text';
      }
    }
  }
  return null;
}

export async function prepareRecord(value: unknown, options: PrepareOptions, isPatch = false): Promise<Prepared> {
  if (!Number.isInteger(options?.maxChunks) || options.maxChunks < 1) throw new Error('maxChunks is required');
  const hold = (reason: HoldReason, extra: Partial<Hold> = {}): Prepared => ({
    kind: 'hold',
    hold: { source_key: keyOf(value), reason, ...extra },
  });
  if (!isRec(value)) return hold('prepare_failed', { detail: 'record must be an object' });
  const key = keyOf(value);
  if (!isPatch && key !== null && options.patches && Object.hasOwn(options.patches, key)) {
    return hold('superseded_by_patch');
  }
  const original = value.text;
  // Nothing but control codes and space is no text.
  if (typeof original !== 'string' || !original.replace(CONTROL_CODES_G, '').trim()) return hold('no_text');
  // Longer than the adapter takes at all: at about 760 characters a chunk, that is past any chunk limit too.
  if (original.length > SUPPLIED_TEXT.maxChars) {
    return hold('over_chunk_limit', { detail: `text over ${SUPPLIED_TEXT.maxChars} characters` });
  }
  // The pack's record must bind its own text before the runner changes a character of it.
  const unbound = await verify(value, original);
  if (unbound) return hold('prepare_failed', { detail: unbound });
  const dense = denseRun(original);
  if (dense) {
    return hold('control_codes_excess', {
      detail: `${dense.count} control codes within ${dense.span} characters at character ${dense.at}`,
    });
  }
  let { record, removed } = strip(value, original);
  const isBill = record.desk_tier === NATIONAL_BILLS.tier && record.desk_feature === NATIONAL_BILLS.feature;
  if (removed) {
    // The hashes bind the text, so they move with it; for a bill the pack's own hash travels as well.
    const sha = await sha256Hex(record.text as string);
    const was = record.text_sha256;
    record = { ...record, text_sha256: sha };
    if (record.content_sha256 !== undefined) record.content_sha256 = sha;
    if (isRec(record.review)) record.review = { ...record.review, text_sha256: sha };
    if (isBill) record.original_text_sha256 = was;
  }
  // Only this runner says a text matches its bill: whatever the pack claims is dropped.
  if (isRec(record.review) && isRec(record.review.checks) && 'bill_identity' in record.review.checks) {
    const { bill_identity: _claimed, ...checks } = record.review.checks;
    record = { ...record, review: { ...record.review, checks } };
  }

  if (isBill && record.document_role === 'errata') {
    const id = key !== null && options.corrigenda && Object.hasOwn(options.corrigenda, key)
      ? options.corrigenda[key]
      : null;
    if (!id) return hold('corrigendum_unmapped');
    const own = isRec(record.citation) ? record.citation : {};
    const documentKey = `bill:${id.bill_year}:${id.bill_number}`;
    const conflicts = (['bill_number', 'bill_year', 'bill_name', 'house'] as const)
      .filter((f) => own[f] != null && String(own[f]) !== id[f])
      .map((f) => `citation.${f} is ${String(own[f])}, the mapping says ${id[f]}`);
    if (record.document_key != null && record.document_key !== documentKey) {
      conflicts.push(`document_key is ${String(record.document_key)}, the mapping says ${documentKey}`);
    }
    if (conflicts.length) return hold('corrigendum_conflict', { detail: conflicts.join('; ') });
    // The pack's introduced_on belongs to whatever bill it thought this was; the mapping does not know it.
    const { introduced_on: _stale, ...rest } = own;
    record = {
      ...record,
      document_key: documentKey,
      citation: {
        ...rest,
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
    // The one place bill_identity is set: this runner made the check and it passed (or did not apply to the role).
    if (identity.pass && isRec(record.review) && isRec(record.review.checks)) {
      record = { ...record, review: { ...record.review, checks: { ...record.review.checks, bill_identity: true } } };
    }
  }

  // A date that is given but is not a date is metadata the database cannot use; the document does not depend on it.
  let datesDropped = 0;
  if (options.dropInvalidCitationDates && isRec(record.citation) && Object.hasOwn(record.citation, 'date')) {
    const date = record.citation.date;
    if (date !== undefined && date !== null && date !== '' && !isCalendarDate(date)) {
      const { date: _dropped, ...kept } = record.citation;
      record = { ...record, citation: kept };
      datesDropped = 1;
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
  if (n > options.maxChunks) return hold('over_chunk_limit', { chunks: n });
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
    citationDatesDropped: datesDropped,
  };
}

/** A whole pack: each record once, then each patch in place of the record it replaces. Nothing is dropped. */
export async function prepareAll(
  records: unknown[],
  options: PrepareOptions,
): Promise<
  { requests: PreparedRequest[]; holds: Hold[]; controlCodesRemoved: number; citationDatesDropped: number }
> {
  if (!Number.isInteger(options?.maxChunks) || options.maxChunks < 1) throw new Error('maxChunks is required');
  const requests: PreparedRequest[] = [];
  const holds: Hold[] = [];
  let controlCodesRemoved = 0;
  let citationDatesDropped = 0;
  const add = (p: Prepared) => {
    if (p.kind === 'hold') holds.push(p.hold);
    else {
      requests.push(p);
      controlCodesRemoved += p.controlCodesRemoved;
      citationDatesDropped += p.citationDatesDropped ?? 0;
    }
  };
  const inPack = new Set(records.map(keyOf));
  for (const r of records) add(await prepareRecord(r, options));
  for (const [key, patch] of Object.entries(options.patches ?? {})) {
    // A patch replaces a record of this pack under the same key; anything else is a mistake, not a load.
    if (!inPack.has(key)) holds.push({ source_key: key, reason: 'patch_not_in_pack' });
    else if (keyOf(patch) !== key) {
      holds.push({ source_key: key, reason: 'patch_key_mismatch', detail: `the patch is for ${String(keyOf(patch))}` });
    } else add(await prepareRecord(patch, options, true));
  }
  return { requests, holds, controlCodesRemoved, citationDatesDropped };
}
