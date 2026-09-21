/**
 * Desk-row identity and text, shared by the loader (Node), the browser and —
 * as a verbatim port — supabase/functions/_shared/deskRows.ts. Held identical
 * by src/lib/__fixtures__/deskRows.json, asserted by both runners.
 *
 * Spec: docs/specs/2026-09-20-desk-row-grounding-design.md §A and its plan
 * amendments. `pick` and `flattenRow` are copied from src/lib/archiveFeed.js
 * (which is read, not edited) so a stored row has the shape the desk shows:
 * `date`, `title` and `source_url` filled from the row's own columns.
 */

import { rowPinKey, rowRecordText } from './sourceUrls.js';
import { normalise } from './textNormalise.js';

const DATE_KEYS = ['date', 'date_introduced', 'seendate', 'pubDate', 'published', 'datetime', 'year', 'started', 'since'];
const TITLE_KEYS = [
  'title',
  'bill_name',
  'billName',
  'name',
  'headline',
  'case_title',
  'topic',
  'policy_name',
  'tender_title',
  'officer_name',
  'mp_name',
  'project_name',
  'conflict_name',
  'subject',
  'question',
];
const SOURCE_URL_KEYS = ['source_url', 'url', 'link', 'html_url', 'document_url', 'pdf_url'];

/** First non-empty scalar among `keys` (archiveFeed.js, verbatim). */
export function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    const v = obj[k];
    if (v == null || v === '') continue;
    if (typeof v === 'object' && v.value != null) return String(v.value);
    if (typeof v === 'object' && v.url) return String(v.url);
    if (typeof v === 'object') continue;
    return String(v);
  }
  return '';
}

/** The desk's row shape (archiveFeed.js, verbatim). Idempotent. */
export function flattenRow(item) {
  const src = item && typeof item === 'object' && !Array.isArray(item) ? item : { value: item };
  const out = { ...src };
  out.date = pick(src, DATE_KEYS) || '';
  out.title = pick(src, TITLE_KEYS) || '';
  out.source_url = pick(src, SOURCE_URL_KEYS) || '';
  return out;
}

/** FNV-1a, 64-bit, over UTF-8; sixteen lower-case hex characters. */
export function fnv1a64(text) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const b of new TextEncoder().encode(String(text ?? ''))) {
    h ^= BigInt(b);
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

/** `rowRecordText` over the desk's row shape. */
export function deskRecordText(row, opts) {
  return rowRecordText(flattenRow(row), opts);
}

/**
 * The frontend's row identity (`rowPinKey`) over the desk's row shape. Rows
 * with no identity column at all (commodities, several Global boards) get a
 * stable content hash instead of the empty string, so they neither collide
 * in `desk_rows` nor lose "Open in desk".
 */
export function deskRowKey(row) {
  const flat = flattenRow(row);
  return rowPinKey(flat) || `h:${fnv1a64(normalise(deskRecordText(flat)))}`;
}

/**
 * `bill:<year>:<bill_number>` — the corpus's document key for a bill row
 * (docs/research/2026-09-21-corpus-mapping-study.md). Year is the title's
 * four-digit suffix (", 2019", optionally followed by a full stop), else
 * the introduction date's year. Roman-numeral numbers stay as they are.
 */
export function billDocumentKey(row) {
  if (!row || typeof row !== 'object') return null;
  const number = String(row.bill_number ?? '').trim();
  if (!number) return null;
  const fromTitle = /,\s*(\d{4})\s*\.?\s*$/.exec(String(row.bill_name ?? ''));
  const fromDate = /^(\d{4})/.exec(String(row.date_introduced ?? '').trim());
  const year = fromTitle?.[1] ?? fromDate?.[1] ?? null;
  return year ? `bill:${year}:${number}` : null;
}

/** Scalars as strings, empties and nested values dropped — the `row` column. */
export function slimDeskRow(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat || {})) {
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    out[k] = String(v);
  }
  return out;
}

/** One `desk_rows` insert from a raw pack row. */
export function toDeskRow({ tier, feature, raw, snapshotAt }) {
  const flat = flattenRow(raw);
  return {
    tier,
    feature,
    row_key: deskRowKey(flat),
    row: slimDeskRow(flat),
    record_text: deskRecordText(flat),
    document_key: billDocumentKey(flat),
    snapshot_at: snapshotAt,
  };
}
