// document-file: a short-lived signature for the stored PDF part that holds one page of a live
// ingestion-v2 document (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "document-file").
//
// POST {document_id: uuid, page: int >= 1}
//   200 {ok:true, signed_path, part_index, page_offset, page_count, byte_size, expires_in}
//   refusals {ok:false, code, error}, each with one fixed message:
//     400 bad_request   not POST, a malformed or oversized body, a non-uuid id, a non-integer page
//     401 unauthorized  no valid Supabase JWT
//     404 not_found     document missing (or hidden by RLS), legacy (no storage_path), not live
//                       (indexed_at, extract_hash or page_count null), or no part covers the page
//     422 bad_page      page < 1 or page > documents.page_count
//     503 unavailable   a read or the signing failed
//
// Order: CORS preflight, requireUser, method, body, document, page range, part, sign. Nothing is
// read before the caller is known. The document and its parts are read with the CALLER's token
// (RLS); only `sign` uses the service role, and only for the storage_path that document_files
// names for this live document and page. The client never supplies a path.
//
// signed_path is the signed URL's part after `/storage/v1/`, so the browser prefixes its own
// Supabase URL: this works when the function sees `http://kong:8000` locally, and the server never
// tells the browser to fetch an arbitrary origin.
//
// Logging: user_id, document_id, page, part_index, outcome and code only. Never the path, the
// signed URL, its token, the caller's token or an error's text (which may embed any of them).

import { requireUser, type Verify } from '../_shared/auth.ts';
import { corsHeaders, preflight } from '../_shared/cors.ts';
import { HttpError } from '../_shared/http.ts';
import { log as sharedLog } from '../_shared/logging.ts';

/** The signature's lifetime, and expires_in. */
export const SIGN_SECONDS = 300;
/** The body is two short fields; anything longer is refused while it streams in. */
export const BODY_MAX_BYTES = 1024;

export const MESSAGES = {
  bad_request: 'expected POST {document_id: uuid, page: integer}',
  unauthorized: 'sign in to open this document',
  not_found: 'this document file is not available',
  bad_page: 'page is outside the document',
  unavailable: 'the document file service is unavailable; try again',
} as const;

export type ErrorCode = keyof typeof MESSAGES;

const STATUS_OF: Readonly<Record<ErrorCode, number>> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  bad_page: 422,
  unavailable: 503,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What supabase-js's createSignedUrl returns after SUPABASE_URL: the corpus bucket's sign route. */
const SIGN_PREFIX = '/storage/v1/';
const SIGNED_PATH = /^object\/sign\/corpus\/[^?#]+\?(?:.*&)?token=[^&#]+/;

// ─── Dependencies ────────────────────────────────────────────────────────────

/** documents, as the caller reads it. */
export interface DocumentRow {
  id: string;
  storage_path: string | null;
  indexed_at: string | null;
  extract_hash: string | null;
  page_count: number | null;
}

/** document_files, as the caller reads it. */
export interface PartRow {
  part_index: number;
  page_offset: number;
  page_count: number;
  byte_size: number;
  storage_path: string;
}

export interface DocumentFileDeps {
  verify?: Verify;
  /** The document as the caller sees it (caller's token, RLS), or null. */
  document(token: string, documentId: string): Promise<DocumentRow | null>;
  /** Candidate parts for the page as the caller sees them (caller's token, RLS); the rule is applied here. */
  parts(token: string, documentId: string, page: number): Promise<PartRow[]>;
  /** Service role: a signed URL for this corpus object, valid for `seconds`. */
  sign(path: string, seconds: number): Promise<string>;
  log?: (event: string, fields: Record<string, unknown>) => void;
  origins?: string[];
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

class Refusal extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

/** The part holding a global page: page_offset < page <= page_offset + page_count (ingest-worker/ocr.ts). */
export function partFor(parts: PartRow[], page: number): PartRow | null {
  return parts.find((p) => page > p.page_offset && page <= p.page_offset + p.page_count) ?? null;
}

/** The signed URL's path and query after `/storage/v1/`, or null when it is not a corpus signature. */
export function relativeSignedPath(signedUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(signedUrl);
  } catch {
    return null;
  }
  if (!u.pathname.startsWith(SIGN_PREFIX)) return null;
  const rel = u.pathname.slice(SIGN_PREFIX.length) + u.search;
  return SIGNED_PATH.test(rel) ? rel : null;
}

function isLive(d: DocumentRow): d is DocumentRow & { storage_path: string; page_count: number } {
  return typeof d.storage_path === 'string' && d.storage_path !== '' &&
    d.indexed_at !== null && d.indexed_at !== undefined &&
    typeof d.extract_hash === 'string' && d.extract_hash !== '' &&
    typeof d.page_count === 'number' && Number.isInteger(d.page_count) && d.page_count >= 1;
}

async function readBody(req: Request): Promise<{ document_id: string; page: number }> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > BODY_MAX_BYTES) throw new Refusal('bad_request');
  if (!req.body) throw new Refusal('bad_request');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > BODY_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Refusal('bad_request');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
  } catch {
    throw new Refusal('bad_request');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Refusal('bad_request');
  const { document_id, page } = parsed as Record<string, unknown>;
  if (typeof document_id !== 'string' || !UUID.test(document_id)) throw new Refusal('bad_request');
  if (typeof page !== 'number' || !Number.isSafeInteger(page)) throw new Refusal('bad_request');
  return { document_id: document_id.toLowerCase(), page };
}

function reply(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
  });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function handleDocumentFile(req: Request, deps: DocumentFileDeps): Promise<Response> {
  const pre = preflight(req, deps.origins);
  if (pre) return pre;
  const cors = corsHeaders(req, deps.origins);
  const log = deps.log ?? ((event: string, fields: Record<string, unknown>) => sharedLog(event, fields));
  // Only these fields are ever logged; each is set from a validated value.
  const seen: { user_id?: string; document_id?: string; page?: number; part_index?: number } = {};
  try {
    let token: string;
    try {
      const caller = await requireUser(req, deps.verify);
      token = caller.token;
      seen.user_id = caller.userId;
    } catch (e) {
      // A refused token is 401; an Auth outage falls through to 503.
      if (e instanceof HttpError && e.status === 401) throw new Refusal('unauthorized');
      throw e;
    }
    if (req.method !== 'POST') throw new Refusal('bad_request');
    const { document_id, page } = await readBody(req);
    seen.document_id = document_id;
    seen.page = page;

    const doc = await deps.document(token, document_id);
    if (!doc || !isLive(doc)) throw new Refusal('not_found');
    if (page < 1 || page > doc.page_count) throw new Refusal('bad_page');

    const part = partFor(await deps.parts(token, document_id, page), page);
    if (!part) throw new Refusal('not_found');
    seen.part_index = part.part_index;

    const signedPath = relativeSignedPath(await deps.sign(part.storage_path, SIGN_SECONDS));
    if (!signedPath) throw new Error('unexpected signed URL shape');

    log('document_file', { ...seen, outcome: 'ok' });
    return reply(
      {
        ok: true,
        signed_path: signedPath,
        part_index: part.part_index,
        page_offset: part.page_offset,
        page_count: part.page_count,
        byte_size: part.byte_size,
        expires_in: SIGN_SECONDS,
      },
      200,
      cors,
    );
  } catch (e) {
    const code: ErrorCode = e instanceof Refusal ? e.code : 'unavailable';
    // The error's text is never logged: a storage or PostgREST message may carry the path or URL.
    log('document_file', { ...seen, outcome: e instanceof Refusal ? 'refused' : 'failed', code });
    return reply({ ok: false, code, error: MESSAGES[code] }, STATUS_OF[code], cors);
  }
}
