/**
 * Byte-range reads of a stored PDF part through a short-lived signed URL
 * (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "PDF view" → "Fetching").
 *
 * The PDF view feeds `read` to a pdf.js `PDFDataRangeTransport`. Signatures last 5 minutes,
 * so a reader that stays on a page outlives them: on 400/401/403 (Storage's answers to an
 * expired or bad signature) or a network error, the reader drops the cached signature, takes
 * a fresh URL and retries once.
 *
 * Errors carry fixed messages only. The signed URL is a bearer credential, and the fetch
 * error text can embed it, so neither the URL nor the underlying error is ever attached.
 */

export const PDF_FETCH_FAILED = 'pdf_fetch_failed';
/** The body was not exactly the requested length (Storage ignored the Range, or cut it short). */
export const PDF_RANGE_MISMATCH = 'pdf_range_mismatch';

const RENEW_STATUSES = new Set([400, 401, 403]);
/** A stalled request is abandoned after this long and counts as a network error (one renewal). */
export const RANGE_TIMEOUT_MS = 30_000;

function fixedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/**
 * @param {object} deps
 * @param {() => Promise<string>} deps.getUrl   the current signed URL for the part
 * @param {() => void} deps.invalidate          forget that URL so the next getUrl signs anew
 * @param {typeof fetch} deps.fetch
 * @param {AbortSignal} [deps.signal]  aborts every in-flight read (the part was closed); no retry
 * @param {number} [deps.timeoutMs]    per-attempt timeout
 * @returns {{read(begin: number, end: number): Promise<ArrayBuffer>}} `end` is exclusive, as pdf.js passes it
 */
export function createRangeReader({ getUrl, invalidate, fetch, signal, timeoutMs = RANGE_TIMEOUT_MS }) {
  /** One attempt: the bytes, or 'renew' for a failure worth one retry with a fresh URL. */
  async function attempt(begin, end) {
    let url;
    try {
      url = await getUrl();
    } catch {
      throw fixedError(PDF_FETCH_FAILED);
    }
    if (signal?.aborted) throw fixedError(PDF_FETCH_FAILED);
    const local = new AbortController();
    const onAbort = () => local.abort();
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => local.abort(), timeoutMs);
    let res;
    let body;
    try {
      res = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` }, signal: local.signal });
      if (RENEW_STATUSES.has(res.status)) {
        res.body?.cancel?.().catch(() => {});
        return 'renew';
      }
      if (res.status !== 200 && res.status !== 206) {
        res.body?.cancel?.().catch(() => {});
        throw fixedError(PDF_FETCH_FAILED);
      }
      // Storage that ignored the Range answers 200 with the whole part: refuse it unread.
      const declared = Number(res.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > 0 && declared !== end - begin) {
        res.body?.cancel?.().catch(() => {});
        throw fixedError(PDF_RANGE_MISMATCH);
      }
      body = await res.arrayBuffer();
    } catch (error) {
      if (error?.code === PDF_FETCH_FAILED || error?.code === PDF_RANGE_MISMATCH) throw error;
      if (signal?.aborted) throw fixedError(PDF_FETCH_FAILED);
      return 'renew';
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    if (body.byteLength !== end - begin) throw fixedError(PDF_RANGE_MISMATCH);
    return body;
  }

  return {
    async read(begin, end) {
      if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin) {
        throw fixedError(PDF_FETCH_FAILED);
      }
      for (let tries = 0; tries < 2; tries += 1) {
        const result = await attempt(begin, end);
        if (result !== 'renew') return result;
        invalidate();
      }
      throw fixedError(PDF_FETCH_FAILED);
    },
  };
}
