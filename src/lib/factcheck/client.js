// F344 T5: browser client for the `factcheck` Edge Function. One function per
// action (start, transcribe, extract, check, stop); requests and responses are
// the plan's wire shapes (snake_case). Nothing here logs tokens, audio or text.
import { accessToken, functionsUrl } from '../supabaseClient.js';

/** Failure of a factcheck call. status 0 means the network failed. */
export class FactCheckError extends Error {
  constructor(status, reason, extra = {}) {
    super(`factcheck ${status} ${reason}`);
    this.name = 'FactCheckError';
    this.status = status;
    this.reason = reason;
    if (extra.needed !== undefined) this.needed = extra.needed;
    if (extra.available !== undefined) this.available = extra.available;
    if (extra.creditsPerMinute !== undefined) this.creditsPerMinute = extra.creditsPerMinute;
    if (extra.retryAfterMs !== undefined) this.retryAfterMs = extra.retryAfterMs;
  }
  /** A 429, a 5xx or a network failure may succeed if tried again. */
  get retryable() { return this.status === 0 || this.status === 429 || this.status >= 500; }
}

const FALLBACK_REASON = { 400: 'bad_request', 401: 'unauthorized' };

async function toError(response) {
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  const status = response.status;
  const sent = body && typeof body.reason === 'string' ? body.reason : null;
  const reason = sent || FALLBACK_REASON[status] || (status >= 500 ? 'server_error' : 'error');
  const extra = {};
  if (typeof body?.needed === 'number') extra.needed = body.needed;
  if (typeof body?.available === 'number') extra.available = body.available;
  if (typeof body?.credits_per_minute === 'number') extra.creditsPerMinute = body.credits_per_minute;
  const retryAfter = Number(response.headers.get('retry-after'));
  if (status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) extra.retryAfterMs = retryAfter * 1000;
  return new FactCheckError(status, reason, extra);
}

export function createFactCheckClient({
  fetchImpl = (...args) => globalThis.fetch(...args),
  getToken = () => accessToken(),
  url = functionsUrl('factcheck'),
} = {}) {
  async function call(body, signal) {
    const token = await getToken();
    if (!token) throw new FactCheckError(401, 'signed_out');
    const headers = { Authorization: `Bearer ${token}` };
    if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST', headers, signal,
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new FactCheckError(0, 'network');
    }
    if (!response.ok) throw await toError(response);
    try { return await response.json(); } catch { throw new FactCheckError(0, 'bad_response'); }
  }
  const json = action => ({ signal, ...fields } = {}) => call({ ...fields, action }, signal);
  return {
    start: json('start'),
    extract: json('extract'),
    check: json('check'),
    stop: json('stop'),
    transcribe({ session_id, seq, file, signal }) {
      const form = new FormData();
      form.append('action', 'transcribe');
      form.append('session_id', session_id);
      form.append('seq', String(seq));
      form.append('file', file, 'piece.wav');
      return call(form, signal);
    },
  };
}

const defaultClient = createFactCheckClient();
export const { start, transcribe, extract, check, stop } = defaultClient;
