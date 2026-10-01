/**
 * Client for the `document-file` Edge Function
 * (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "document-file").
 *
 * `partFor(documentId, page)` returns a short-lived signed URL for the stored PDF part that holds
 * the page, with the part's place in the document. Signatures are cached per
 * (document, part) until 30 seconds before they expire, and a cached part answers any page
 * inside it without a request. `invalidate` drops one part's signature, for the range reader
 * to call when Storage refuses it.
 *
 * Contract: POST `{document_id, page}` →
 * `{ok:true, signed_path, part_index, page_offset, page_count, byte_size, expires_in}` or
 * `{ok:false, code, error}`. `signed_path` is relative to `/storage/v1`; the client prefixes
 * its own Supabase URL, so the server never chooses the origin the browser fetches.
 *
 * Errors carry a fixed message and a `code`. Neither the server's text nor the URL is ever
 * attached: the signed URL is a bearer credential.
 */
import { accessToken, functionsUrl } from './supabaseClient.js';

export const DOCUMENT_FILE_FAILED = 'document_file_failed';

/** Refusal codes from the fixed interface; anything else becomes `bad_response`. */
const REFUSAL_CODES = new Set(['bad_request', 'unauthorized', 'not_found', 'bad_page', 'unavailable']);
/** A signature is reused until this long before it expires. */
const EXPIRY_MARGIN_MS = 30_000;

function failure(code) {
  const error = new Error(DOCUMENT_FILE_FAILED);
  error.code = code;
  return error;
}

const isInt = (value, min) => Number.isSafeInteger(value) && value >= min;
const covers = (part, page) => part.pageOffset < page && page <= part.pageOffset + part.pageCount;

/** The validated part for `page`, or null when the success body is malformed. */
function readPart(body, page, baseUrl) {
  if (!body || body.ok !== true || typeof body.signed_path !== 'string') return null;
  const path = body.signed_path.replace(/^\/+/, '');
  if (!path || !isInt(body.part_index, 0) || !isInt(body.page_offset, 0) || !isInt(body.page_count, 1)
    || !isInt(body.byte_size, 1) || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in)) return null;
  const part = {
    url: `${baseUrl.replace(/\/+$/, '')}/storage/v1/${path}`,
    partIndex: body.part_index,
    pageOffset: body.page_offset,
    pageCount: body.page_count,
    byteSize: body.byte_size,
  };
  return covers(part, page) ? part : null;
}

/**
 * @param {object} deps
 * @param {(body: {document_id: string, page: number}) => Promise<object>} deps.request
 *   POSTs to `document-file` and resolves its parsed JSON body (success or refusal)
 * @param {string} deps.baseUrl   the Supabase project URL
 * @param {() => number} [deps.now]
 */
export function createDocumentFileClient({ request, baseUrl, now = Date.now }) {
  /** `${documentId}\u0000${partIndex}` → {part, documentId, expiresAt} */
  const cache = new Map();
  /** `${documentId}\u0000${page}` → the in-flight request for that page */
  const inflight = new Map();
  const key = (documentId, n) => `${documentId}\u0000${n}`;

  function cached(documentId, page) {
    const t = now();
    for (const [k, entry] of cache) {
      if (entry.expiresAt <= t) cache.delete(k);
      else if (entry.documentId === documentId && covers(entry.part, page)) return entry.part;
    }
    return null;
  }

  async function sign(documentId, page) {
    const requestedAt = now();
    let body;
    try {
      body = await request({ document_id: documentId, page });
    } catch {
      throw failure('unavailable');
    }
    if (body && body.ok === false) {
      throw failure(REFUSAL_CODES.has(body.code) ? body.code : 'bad_response');
    }
    const part = readPart(body, page, baseUrl);
    if (!part) throw failure('bad_response');
    const expiresAt = requestedAt + body.expires_in * 1000 - EXPIRY_MARGIN_MS;
    if (expiresAt > now()) cache.set(key(documentId, part.partIndex), { part, documentId, expiresAt });
    return part;
  }

  return {
    async partFor(documentId, page) {
      if (typeof documentId !== 'string' || !documentId.trim() || !isInt(page, 1)) throw failure('bad_request');
      const hit = cached(documentId, page);
      if (hit) return hit;
      const k = key(documentId, page);
      if (!inflight.has(k)) {
        inflight.set(k, sign(documentId, page).finally(() => inflight.delete(k)));
      }
      return inflight.get(k);
    },
    invalidate(documentId, partIndex) {
      cache.delete(key(documentId, partIndex));
    },
  };
}

/**
 * The app's client: calls `document-file` with the signed-in user's token and builds URLs on
 * the same Supabase URL as the browser client (`VITE_SUPABASE_URL`, with supabaseClient's
 * fallback). Kept thin; the behaviour is tested through `createDocumentFileClient`.
 */
export function defaultDocumentFileClient({ fetch: fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  const url = functionsUrl('document-file');
  return createDocumentFileClient({
    baseUrl: url.replace(/\/functions\/v1\/document-file$/, ''),
    async request(body) {
      const token = await accessToken();
      if (!token) return { ok: false, code: 'unauthorized' };
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.json();
    },
  });
}
