import { isHubUrl } from '../../lib/corpusUpload.js';
import { titleFromFileName } from './format.js';

/**
 * The records-first Documents page's decisions, as pure functions (Amendment A of
 * docs/specs/2026-10-01-rag-v2-admin-upload.md; plan C4). The components render what these
 * decide; admin-ingest still checks everything and its refusals reach the admin as written.
 *
 * Shapes are contract.ts's: DeskRecord, RecordDocument, UnlinkedDocument, KeyHolder.
 */

export const RECORDS_PAGE = 50;
export const UPLOAD_KEY_PREFIX = 'upload:';

/** The one desk whose rows carry record keys today (D10). */
export const BILL_DESK = Object.freeze({ tier: 'national', feature: 'Bill Passage Probability Index' });
/** Desks holding the same keys as a keyed desk: chat joins by key, so they share its records. */
const ALIASES = Object.freeze({ 'national|Policy Intelligence Graph': BILL_DESK });
const KEYED = [BILL_DESK];

export const STATUS_CHIPS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'record_only', label: 'Record only' },
  { id: 'processing', label: 'Processing' },
  { id: 'failed', label: 'Failed' },
  { id: 'full_text', label: 'Full text' },
  { id: 'full_text_legacy', label: 'Full text (legacy)' },
]);
export const STATUS_LABEL = Object.freeze(Object.fromEntries(STATUS_CHIPS.map((c) => [c.id, c.label])));
export const STATUS_PILL = Object.freeze({ record_only: 'archive', processing: 'local', failed: 'inactive', full_text: 'live', full_text_legacy: 'live' });

export const LEGACY_WARNING = 'This record already has legacy text; your upload adds a second document, both will be searched.';
export const STALE_TEXT = 'This record changed since you loaded it — refreshed.';
export const DELETE_EXPLANATION = 'Deleting removes this upload and everything made from it: its pages, chunks, embeddings and jobs. '
  + 'A queued or running job is cancelled first. Chat answers that cited it will say the document is no longer available. '
  + 'This cannot be undone.';

const nf = new Intl.NumberFormat('en-US');
const count = (n) => nf.format(Number(n) || 0);

// ─── Desks ───────────────────────────────────────────────────────────────────

export const pairValue = (tier, feature) => `${tier}|${feature}`;
export function parsePairValue(value) {
  const text = String(value ?? '');
  const at = text.indexOf('|');
  return at < 1 ? null : { tier: text.slice(0, at), feature: text.slice(at + 1) };
}
const label = ({ tier, feature }) => `${tier} · ${feature}`;
const isKeyed = (pair) => KEYED.some((k) => k.tier === pair.tier && k.feature === pair.feature);

/**
 * The desk picker's three groups: keyed desks (records), desks that share a keyed desk's records
 * (shown, routed to it), and every other catalog desk (standalone uploads only, F40).
 * @param {{tier: string, feature: string}[]} pairs
 */
export function deskChoices(pairs) {
  const keyed = [];
  const aliases = [];
  const keyless = [];
  for (const pair of pairs) {
    const value = pairValue(pair.tier, pair.feature);
    if (isKeyed(pair)) keyed.push({ value, label: label(pair) });
    else if (ALIASES[value]) aliases.push({ value, label: label(pair), note: 'same records as Bill Passage' });
    else keyless.push({ value, label: label(pair) });
  }
  return { keyed, aliases, keyless };
}

/** The desk the records and unlinked lists are asked about for a picker value, or null. */
export function recordsDesk(value) {
  const pair = parsePairValue(value);
  if (!pair) return null;
  const alias = ALIASES[pairValue(pair.tier, pair.feature)];
  if (alias) return { ...alias, keyed: true, alias: true };
  return { ...pair, keyed: isKeyed(pair), alias: false };
}

// ─── Coverage, request, paging ──────────────────────────────────────────────

/** "1,236 of 9,415 bills have full text · 2 orphaned links" (units are keys). */
export function coverageLine(coverage) {
  if (!coverage) return '';
  const keys = Number(coverage.keys) || 0;
  const orphaned = Number(coverage.orphaned) || 0;
  const bills = keys === 1 ? 'bill has' : 'bills have';
  return `${count(coverage.full_text)} of ${count(keys)} ${bills} full text · ${count(orphaned)} orphaned link${orphaned === 1 ? '' : 's'}`;
}

/** api.records' request for the picker's desk, the applied search, the status chip and a page. */
export function recordsRequest({ desk, query, status, page = 0 }) {
  return {
    desk_tier: desk.tier,
    desk_feature: desk.feature,
    query: String(query ?? '').trim() || null,
    status: status && status !== 'all' ? status : null,
    limit: RECORDS_PAGE,
    offset: Math.max(0, page) * RECORDS_PAGE,
  };
}

export function pageInfo(total, page, size = RECORDS_PAGE) {
  const all = Number(total) || 0;
  if (!all) return { text: 'No records', hasPrev: false, hasNext: false };
  const from = page * size + 1;
  const to = Math.min(all, (page + 1) * size);
  return { text: `${count(from)}–${count(to)} of ${count(all)}`, hasPrev: page > 0, hasNext: to < all };
}

// ─── Records and documents ──────────────────────────────────────────────────

export function recordTitle(record) {
  return record?.rows?.[0]?.title || record?.document_key || '';
}

/** "shared by N rows" with each row's house and title for a title attribute; null for one row. */
export function sharedRowsNote(record) {
  const rows = record?.rows ?? [];
  if (rows.length < 2) return null;
  return {
    text: `shared by ${rows.length} rows`,
    title: rows.map((r) => (r.house ? `${r.house}: ${r.title}` : r.title)).join('\n'),
  };
}

const ACTIVE = new Set(['queued', 'running']);
const ENDED = new Set(['failed', 'cancelled']);

/** 'live' (in search), 'processing', 'failed' (its latest job failed or was cancelled) or 'pending'. */
export function documentState(doc) {
  if (doc?.indexed) return 'live';
  const status = doc?.job?.status;
  if (ACTIVE.has(status)) return 'processing';
  if (ENDED.has(status)) return 'failed';
  return 'pending';
}

const isUpload = (doc) => String(doc?.source_key ?? '').startsWith(UPLOAD_KEY_PREFIX);

/**
 * A record's own actions: Attach for record_only, failed and full_text_legacy (the last with the
 * D3 warning), and the ingestion-v2 document holding its key, if any (D2 allows one).
 */
export function recordActions(record) {
  const status = record?.status;
  return {
    attach: status === 'record_only' || status === 'failed' || status === 'full_text_legacy',
    legacyWarning: status === 'full_text_legacy',
    // A replacement waiting to swap in (link_target) is listed too, but holds no key.
    holder: (record?.documents ?? []).find((doc) => !doc.legacy && !doc.link_target) ?? null,
  };
}

/**
 * A document's actions in a record. Legacy text is read-only (D3); Delete is for uploads (D4); a
 * replacement waiting to swap in holds no key, so it is swapped from Documents without a record.
 */
export function documentActions(doc) {
  if (!doc || doc.legacy) return { replace: false, unlink: false, relink: false, delete: false };
  if (doc.link_target) return { replace: false, unlink: false, relink: false, delete: isUpload(doc) };
  return { replace: true, unlink: true, relink: true, delete: isUpload(doc) };
}

/** An unlinked document's actions: Link, Delete (uploads), Swap (a live replacement, D5). */
export function unlinkedActions(doc) {
  return {
    link: !doc?.legacy,
    delete: !doc?.legacy && isUpload(doc),
    swap: Boolean(doc?.link_target) && documentState(doc) === 'live',
  };
}

/** Whether to keep re-reading: a record or a document is still being processed. */
export function anyProcessing(records = [], documents = []) {
  return records.some((r) => r.status === 'processing') || documents.some((d) => documentState(d) === 'processing');
}

/** The records a document may be (re-)linked to: all but the one it holds. */
export function pickerChoices(records, currentKey) {
  return (records ?? []).filter((r) => r.document_key !== currentKey);
}

// ─── Compare-and-set requests (D11) ─────────────────────────────────────────

export const unlinkRequest = (record, doc) => ({ document_id: doc.document_id, expected_key: record.document_key });

export const relinkRequest = (record, doc, target) => ({
  document_id: doc.document_id, document_key: target.document_key, expected_key: record.document_key,
});

/** Links an unlinked document; it holds no key, or an orphaned one. */
export const linkRequest = (doc, target) => ({
  document_id: doc.document_id, document_key: target.document_key, expected_key: doc.orphaned_key ?? null,
});

/**
 * Swaps a replacement in (D5), expecting the document it replaces as recorded at registration.
 * ingest_swap compares that, then unlinks the old document if it still holds the key, or links the
 * new one directly if nothing does; anything else is the server's to refuse (`stale`, `key_held`).
 * @param {{document_id: string, replaces: string|null}} doc
 */
export const swapRequest = (doc) => ({ document_id: doc.document_id, expected_old: doc.replaces ?? null });

/** "Link the existing document": an already uploaded file, linked to the attach's record. */
export const linkExistingRequest = (offer) => ({
  document_id: offer.document_id, document_key: offer.record.document_key, expected_key: null,
});

/** How a refused action is shown; `stale` also asks for a reload. */
export function actionFailure(error) {
  if (error?.code === 'stale') return { text: STALE_TEXT, stale: true };
  return { text: error?.message || String(error), stale: false };
}

/**
 * What the page does after an action: reload after a change, and after a `stale` refusal (the
 * page was out of date, so it is refreshed and says so); any other refusal stays in the banner.
 */
export function actionOutcome(result) {
  if (result?.ok !== false) return { banner: '', reload: true };
  return { banner: result.text, reload: Boolean(result.stale) };
}

/** Calls `api[method](request)`; resolves to the answer, or to `{ok: false, text, stale}`. */
export async function runAction(api, method, request) {
  try {
    return await api[method](request);
  } catch (error) {
    return { ok: false, ...actionFailure(error) };
  }
}

// ─── The upload panel ────────────────────────────────────────────────────────

function isHttpUrl(text) {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The D6 source-URL rule: required unless "No public source" is ticked, an http(s) address, and
 * not one of the desk's hub pages (`hints`, the record's source_hint). Null when acceptable.
 */
export function sourceUrlError(draft, hints = []) {
  if (draft?.no_public_source) return null;
  const url = String(draft?.file_url ?? '').trim();
  if (!url) return 'A source URL is required, or tick “No public source”.';
  if (!isHttpUrl(url)) return 'Use an http(s) address.';
  if (isHubUrl(url, hints)) return 'That is the desk’s source page, not this document. Paste the document’s own link.';
  return null;
}

/**
 * What to do when `prepare` names a document already holding the record's key: confirm over
 * legacy text (D3), offer Replace over an ingestion-v2 document (D2), else go on.
 * @returns {'proceed'|'confirm_legacy'|'offer_replace'}
 */
export function keyHolderDecision(holder, mode) {
  if (!holder || mode !== 'attach') return 'proceed';
  return holder.legacy ? 'confirm_legacy' : 'offer_replace';
}

/**
 * A new file's form, per upload mode. Attach and Replace take the record's title and fix the
 * desk to the bill desk; a standalone upload takes the file's name and the page's desk.
 * @param {{mode: 'attach'|'replace'|'standalone', record?: object, desk?: string}} target
 */
export function draftFor(target, file) {
  const keyed = target?.mode === 'attach' || target?.mode === 'replace';
  return {
    title: keyed ? recordTitle(target.record) : titleFromFileName(file?.name),
    desk: keyed ? pairValue(BILL_DESK.tier, BILL_DESK.feature) : (target?.desk ?? ''),
    file_url: '',
    no_public_source: false,
    note: '',
    splitEvery: '',
  };
}

/**
 * uploadPlan's `meta`: the record key for Attach; the record key with `replaces` for Replace (the
 * server keeps that key as metadata.link_target, so the replacement registers unlinked and is
 * swapped in when live, D5); neither for a standalone file.
 */
export function uploadMeta(draft, plan, target) {
  const desk = parsePairValue(draft.desk) ?? { tier: '', feature: '' };
  const text = (value) => String(value ?? '').trim() || null;
  const meta = {
    title: String(draft.title ?? '').trim(),
    desk_tier: desk.tier,
    desk_feature: desk.feature,
    file_url: draft.no_public_source ? null : text(draft.file_url),
    note: text(draft.note),
    file_name: plan.file_name,
  };
  if (draft.no_public_source) meta.no_public_source = true;
  if (target?.mode === 'attach') meta.document_key = target.record.document_key;
  if (target?.mode === 'replace') {
    meta.document_key = target.record.document_key;
    meta.replaces = target.holder.document_id;
  }
  return meta;
}

// ─── Confirmations ───────────────────────────────────────────────────────────

const named = (doc) => `“${doc.title || doc.document_id}”`;
const recordName = (record) => {
  const title = recordTitle(record);
  return title && title !== record.document_key ? `${record.document_key} (${title})` : record.document_key;
};

/**
 * The in-page confirmation for a destructive action, before it runs.
 * @param {{kind: 'unlink'|'relink'|'link'|'swap'|'delete', record?: object, doc: object, target?: object}} confirm
 */
export function confirmText({ kind, record, doc, target }) {
  switch (kind) {
    case 'unlink': return `Unlink ${named(doc)} from ${record.document_key}? It stays in the corpus, listed under Documents without a record.`;
    case 'relink': return `Move ${named(doc)} from ${record.document_key} to ${recordName(target)}?`;
    case 'link': return `Link ${named(doc)} to ${recordName(target)}?`;
    case 'swap': return `Swap ${named(doc)} in for ${doc.link_target}? The document it replaces is unlinked, not deleted.`;
    case 'delete': return `Delete ${named(doc)}? ${DELETE_EXPLANATION}`;
    default: return '';
  }
}

/** The admin-ingest call a confirmed action makes: `{method, request}` for `runAction`. */
export function actionPlan({ kind, record, doc, target }) {
  switch (kind) {
    case 'unlink': return { method: 'unlink', request: unlinkRequest(record, doc) };
    case 'relink': return { method: 'link', request: relinkRequest(record, doc, target) };
    case 'link': return { method: 'link', request: linkRequest(doc, target) };
    case 'swap': return { method: 'swap', request: swapRequest(doc) };
    case 'delete': return { method: 'remove', request: { document_id: doc.document_id } };
    default: return null;
  }
}
