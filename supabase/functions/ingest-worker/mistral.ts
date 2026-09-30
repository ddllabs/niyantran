// Mistral OCR: the request builder, one call, response mapping, the index check and the cost.
//
// Request shape checked against Mistral's API reference (docs.mistral.ai/api/endpoint/ocr, read
// 2026-10-01): POST /v1/ocr with `model`, `document: { type: 'document_url', document_url }`,
// `pages` as a list of 0-based integers, `table_format` ('markdown' | 'html'), `extract_header`,
// `extract_footer`, `include_blocks`, `include_image_base64`. The response carries `model`,
// `pages[]` (`index`, `markdown`, `images[]` with `image_base64`, `dimensions`, ...) and
// `usage_info` (`pages_processed`, `doc_size_bytes`). The real response in
// _shared/__fixtures__/mistral-bill-12p.json also has header, footer, blocks and tables per page.
//
// Failures are IngestErrors: 429 → mistral_rate_limited; 5xx, network failures and unreadable 200
// bodies → mistral_unavailable (both retried with backoff); any other 4xx → mistral_rejected
// (permanent). Messages never carry the API key or a URL's query string (the signed URL's token).

import {
  IngestError,
  type MistralOcrPage,
  OCR_FLAGS,
  type OcrCallResult,
  type OcrRequest,
  type RawOcrImage,
  type RawOcrPage,
} from './types.ts';

export const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr';

/** Mistral OCR price, USD per 1,000 pages processed (the rate this module was approved with). */
export const OCR_USD_PER_1000_PAGES = 4;

/** Error detail kept from a Mistral error body, after redaction. */
const MAX_DETAIL = 300;

export function ocrCostUsd(pagesProcessed: number): number {
  return (pagesProcessed * OCR_USD_PER_1000_PAGES) / 1000;
}

/** `pages` are part-local and 0-based, strictly ascending. */
export function buildOcrRequest(model: string, documentUrl: string, pages: number[]): OcrRequest {
  if (!pages.length) throw new Error('buildOcrRequest: no pages');
  for (const [i, p] of pages.entries()) {
    if (!Number.isInteger(p) || p < 0) throw new Error(`buildOcrRequest: bad page index ${p}`);
    if (i > 0 && p <= pages[i - 1]) throw new Error('buildOcrRequest: page indexes must be strictly ascending');
  }
  return {
    model,
    document: { type: 'document_url', document_url: documentUrl },
    pages: [...pages],
    ...OCR_FLAGS,
  };
}

/** Removes each secret, then every URL query string. */
export function redactText(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('[redacted]');
  return out.replace(/(https?:\/\/[^\s"'<>?#]+)\?[^\s"'<>]*/gi, '$1?[redacted]');
}

function queryOf(url: string): string {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(q + 1) : '';
}

function detailOf(text: string): string {
  try {
    const body = JSON.parse(text);
    const d = body?.message ?? body?.detail ?? body?.error?.message ?? body?.error;
    if (d !== undefined && d !== null) return typeof d === 'string' ? d : JSON.stringify(d);
  } catch {
    // not JSON: use the text itself
  }
  return text;
}

function isPage(p: unknown): p is MistralOcrPage {
  const o = p as Record<string, unknown> | null;
  return !!o && typeof o === 'object' && Number.isInteger(o.index) && typeof o.markdown === 'string';
}

function nonNegative(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export interface MistralDeps {
  fetch: typeof fetch;
  apiKey: string;
  now?: () => number;
}

/** One OCR call. Resolves only for a 200 whose body has a valid page list. */
export async function callMistralOcr(deps: MistralDeps, request: OcrRequest): Promise<OcrCallResult> {
  if (!deps.apiKey) throw new IngestError('mistral_key_missing', 'MISTRAL_API_KEY is not set', true);
  const now = deps.now ?? Date.now;
  const secrets = [deps.apiKey, queryOf(request.document.document_url)];
  const fail = (code: string, message: string, permanent: boolean, status?: number): never => {
    throw new IngestError(code, redactText(message, secrets).slice(0, MAX_DETAIL + 60), permanent, status);
  };

  const started = now();
  let res: Response;
  let body: ArrayBuffer;
  try {
    res = await deps.fetch(MISTRAL_OCR_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${deps.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    body = await res.arrayBuffer();
  } catch (e) {
    return fail(
      'mistral_unavailable',
      `Mistral OCR request failed: ${e instanceof Error ? e.message : String(e)}`,
      false,
    );
  }
  const latencyMs = now() - started;
  const bytes = body.byteLength;
  const text = new TextDecoder().decode(body);

  if (!res.ok) {
    const detail = redactText(detailOf(text), secrets).slice(0, MAX_DETAIL);
    const message = `Mistral OCR HTTP ${res.status}: ${detail}`;
    if (res.status === 429) return fail('mistral_rate_limited', message, false, 429);
    if (res.status >= 500) return fail('mistral_unavailable', message, false, res.status);
    return fail('mistral_rejected', message, true, res.status);
  }

  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('mistral_unavailable', `Mistral OCR returned an unparsable body (${bytes} bytes)`, false, res.status);
  }
  const pages = parsed && typeof parsed === 'object' ? parsed.pages : undefined;
  if (!Array.isArray(pages) || !pages.every(isPage)) {
    return fail('mistral_unavailable', 'Mistral OCR response has no valid page list', false, res.status);
  }
  const usage = (parsed!.usage_info ?? {}) as Record<string, unknown>;
  return {
    pages,
    model: typeof parsed!.model === 'string' ? parsed!.model : '',
    // A 200 without a page count is billed as the pages it returned, so the cost is never left out.
    pagesProcessed: nonNegative(usage.pages_processed) ?? pages.length,
    docSizeBytes: nonNegative(usage.doc_size_bytes),
    bytes,
    latencyMs,
  };
}

/** The returned page indexes must be exactly the requested ones (in any order, no duplicates). */
export function checkIndexes(requested: number[], returned: number[]): void {
  const a = [...requested].sort((x, y) => x - y);
  const b = [...returned].sort((x, y) => x - y);
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    throw new IngestError('ocr_page_mismatch', `requested pages [${a.join(',')}], Mistral returned [${b.join(',')}]`);
  }
}

/**
 * A Mistral page → document_ocr_pages.raw. `index` becomes the GLOBAL 0-based page
 * (pageOffset + part-local index); images are replaced by their processed entries (no base64);
 * fields outside RawOcrPage (hyperlinks, confidence scores) are dropped.
 */
export function mapOcrPage(page: MistralOcrPage, pageOffset: number, images: RawOcrImage[]): RawOcrPage {
  return {
    index: pageOffset + page.index,
    markdown: page.markdown,
    header: page.header ?? null,
    footer: page.footer ?? null,
    dimensions: page.dimensions ?? null,
    blocks: page.blocks ?? [],
    tables: page.tables ?? [],
    images,
  };
}
