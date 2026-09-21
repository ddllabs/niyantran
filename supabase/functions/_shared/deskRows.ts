// Desk-row identity and text — the Deno mirror of src/lib/deskRows.js, which
// carries the rationale. `rowPinKey`, `rowRecordText` and the URL helpers they
// need are ported verbatim from src/lib/sourceUrls.js; `pick` and `flattenRow`
// from src/lib/archiveFeed.js. Both runners assert the shared fixture
// src/lib/__fixtures__/deskRows.json, so the two copies cannot drift.

import { normalise } from './textNormalise.ts';

type Row = Record<string, unknown>;

export interface DeskRowInsert {
  tier: string;
  feature: string;
  row_key: string;
  row: Record<string, string>;
  record_text: string;
  document_key: string | null;
  snapshot_at: string;
}

// ---- sourceUrls.js, verbatim -------------------------------------------------

function isHttpUrl(u: unknown): boolean {
  return typeof u === 'string' && /^https?:\/\//i.test(u.trim());
}

function isGoogleNewsUrl(u: unknown): boolean {
  return /news\.google\.com/i.test(String(u || ''));
}

function isHubListingUrl(u: unknown): boolean {
  const s = String(u || '').trim();
  if (!s) return true;
  if (isGoogleNewsUrl(s)) return true;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return true;
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const path = (url.pathname || '/').replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  const q = url.search || '';

  if (parts.length === 0) return true;

  if (/sansad\.(in|gov\.in)$/i.test(host) && /\/(?:rs|ls)?\/?legislation$/i.test(path) && !/\.pdf$/i.test(path)) {
    return true;
  }
  if (/sci\.gov\.in$/i.test(host) && /\/view-pdf$/i.test(path)) return true;
  if (/rbi\.org\.in$/i.test(host) && /BS_PressReleaseDisplay\.aspx$/i.test(path) && !q) return true;
  if (/pib\.gov\.in$/i.test(host) && /PressReleasePage\.aspx$/i.test(path) && !/[?&](PRID|prid|id)=/i.test(q)) return true;
  if (
    /^(nseindia\.com|prsindia\.org|indiacode\.nic\.in|egazette\.gov\.in|powermin\.gov\.in|commerce\.gov\.in|understandingwar\.org|acleddata\.com)$/i
      .test(host) &&
    parts.length <= 1
  ) {
    return true;
  }
  if (/api\.fda\.gov$/i.test(host) && /enforcement\.json$/i.test(path)) return true;

  return false;
}

const RECORD_TEXT_SKIP = new Set([
  '__alId',
  '__gaId',
  '__saId',
  'members_json',
  'agenda_json',
  'sources_json',
  'attached_sources',
  'attached_documents',
  'provenance_hubs',
  'record_text',
  'document_status',
  'related_records',
  'timeline',
]);

/** Human-readable record from row columns (sourceUrls.js `rowRecordText`). */
export function rowRecordText(row: Row | null | undefined, { title = '', max = 6_000 }: { title?: string; max?: number } = {}): string {
  if (!row || typeof row !== 'object') return '';
  const lines: string[] = [];
  const head = title ||
    row.bill_name ||
    row.policy_name ||
    row.conflict_name ||
    row.title ||
    row.subject ||
    row.name ||
    row.commodity ||
    row.theatre ||
    row.programme ||
    row.leader ||
    row.facility ||
    '';
  if (head) lines.push(`Record: ${head}`);
  for (const [k, v] of Object.entries(row)) {
    if (RECORD_TEXT_SKIP.has(k) || k.startsWith('_')) continue;
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    const s = String(v).trim();
    if (!s) continue;
    if (isHttpUrl(s) && isHubListingUrl(s)) {
      lines.push(`${k}: ${s} (registry hub — provenance only, not document body)`);
      continue;
    }
    lines.push(`${k}: ${s.slice(0, 800)}`);
    if (lines.join('\n').length > max) break;
  }
  return lines.join('\n').slice(0, max);
}

/** Stable row identity (sourceUrls.js `rowPinKey`). */
export function rowPinKey(row: Row | null | undefined): string {
  if (!row || typeof row !== 'object') return '';
  return String(
    row.id ||
      row.record_id ||
      row.bill_number ||
      row.source_url ||
      row.bill_name ||
      row.title ||
      row.name ||
      row.subject ||
      '',
  )
    .trim()
    .toLowerCase()
    .slice(0, 160);
}

// ---- archiveFeed.js, verbatim ------------------------------------------------

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

export function pick(obj: unknown, keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Row;
  for (const k of keys) {
    const v = o[k];
    if (v == null || v === '') continue;
    if (typeof v === 'object' && (v as Row).value != null) return String((v as Row).value);
    if (typeof v === 'object' && (v as Row).url) return String((v as Row).url);
    if (typeof v === 'object') continue;
    return String(v);
  }
  return '';
}

export function flattenRow(item: unknown): Row {
  const src: Row = item && typeof item === 'object' && !Array.isArray(item) ? (item as Row) : { value: item };
  const out: Row = { ...src };
  out.date = pick(src, DATE_KEYS) || '';
  out.title = pick(src, TITLE_KEYS) || '';
  out.source_url = pick(src, SOURCE_URL_KEYS) || '';
  return out;
}

// ---- deskRows.js ---------------------------------------------------------------

export function fnv1a64(text: unknown): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const b of new TextEncoder().encode(String(text ?? ''))) {
    h ^= BigInt(b);
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

export function deskRecordText(row: unknown, opts?: { title?: string; max?: number }): string {
  return rowRecordText(flattenRow(row), opts);
}

export function deskRowKey(row: unknown): string {
  const flat = flattenRow(row);
  return rowPinKey(flat) || `h:${fnv1a64(normalise(deskRecordText(flat)))}`;
}

export function billDocumentKey(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Row;
  const number = String(r.bill_number ?? '').trim();
  if (!number) return null;
  const fromTitle = /,\s*(\d{4})\s*\.?\s*$/.exec(String(r.bill_name ?? ''));
  const fromDate = /^(\d{4})/.exec(String(r.date_introduced ?? '').trim());
  const year = fromTitle?.[1] ?? fromDate?.[1] ?? null;
  return year ? `bill:${year}:${number}` : null;
}

export function slimDeskRow(flat: Row | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(flat || {})) {
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    out[k] = String(v);
  }
  return out;
}

export function toDeskRow(a: { tier: string; feature: string; raw: unknown; snapshotAt: string }): DeskRowInsert {
  const flat = flattenRow(a.raw);
  return {
    tier: a.tier,
    feature: a.feature,
    row_key: deskRowKey(flat),
    row: slimDeskRow(flat),
    record_text: deskRecordText(flat),
    document_key: billDocumentKey(flat),
    snapshot_at: a.snapshotAt,
  };
}
