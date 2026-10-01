/**
 * The page viewer's reads, through the browser's Supabase client and the existing
 * `authenticated` grants (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "The flow" step 3).
 * The client is injected, so these run against a fake in tests.
 *
 * Results are small status objects, never errors: a failed read becomes a fixed notice in the
 * viewer, and no server text is carried.
 */
import { safeSourceUrl } from '../SourceReader.jsx';

export const DOCUMENT_COLUMNS = 'id, title, file_url, storage_path, extract_hash, page_count, indexed_at';
export const PART_COLUMNS = 'part_index, page_offset, page_count, byte_size';
export const PAGE_COLUMNS = 'page_number, text, char_from, char_to, width_px, height_px';

const nonblank = value => typeof value === 'string' && value.trim() !== '';
const withSignal = (query, signal) => (signal && typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query);

/**
 * The document and its stored parts.
 * @returns {Promise<{status: 'ok', doc: object, parts: object[]} | {status: 'gone'} | {status: 'error'}>}
 *   `parts` is empty unless the document is live and has storage; a failed parts read also
 *   leaves it empty, so the Text view still works.
 */
export async function loadDocument(client, documentId, signal) {
  let doc;
  try {
    const { data, error } = await withSignal(client.from('documents').select(DOCUMENT_COLUMNS).eq('id', documentId), signal).maybeSingle();
    if (error) return { status: 'error' };
    if (!data) return { status: 'gone' };
    doc = { ...data, file_url: safeSourceUrl(data.file_url) };
  } catch {
    return { status: 'error' };
  }
  if (doc.indexed_at == null || !nonblank(doc.storage_path)) return { status: 'ok', doc, parts: [] };
  try {
    const { data, error } = await withSignal(
      client.from('document_files').select(PART_COLUMNS).eq('document_id', documentId).order('part_index', { ascending: true }),
      signal,
    );
    return { status: 'ok', doc, parts: !error && Array.isArray(data) ? data : [] };
  } catch {
    return { status: 'ok', doc, parts: [] };
  }
}

/**
 * `document_pages` rows for one extraction, one page at a time.
 *
 * - `load(page)` resolves `{status: 'ok', row}` (row null when the page has none),
 *   `{status: 'error'}`, or `{status: 'aborted'}` when the reader paged away first.
 * - Paging aborts every fetch that is not for the new page or its neighbours.
 * - After a page loads, its neighbours are fetched into a small cache (oldest evicted first).
 * - Errors are not cached, so loading the page again retries.
 */
export function createPageLoader({ client, documentId, extractHash, total, cacheSize = 5, prefetch = true }) {
  const cache = new Map();
  const inflight = new Map();
  let disposed = false;

  function remember(page, row) {
    cache.delete(page);
    cache.set(page, row);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
  }

  async function run(page, controller) {
    try {
      const query = client.from('document_pages').select(PAGE_COLUMNS)
        .eq('document_id', documentId).eq('extract_hash', extractHash).eq('page_number', page);
      const { data, error } = await withSignal(query, controller.signal).maybeSingle();
      if (controller.signal.aborted) return { status: 'aborted' };
      if (error) return { status: 'error' };
      const row = data ?? null;
      remember(page, row);
      return { status: 'ok', row };
    } catch {
      return controller.signal.aborted ? { status: 'aborted' } : { status: 'error' };
    } finally {
      if (inflight.get(page)?.controller === controller) inflight.delete(page);
    }
  }

  function fetchPage(page) {
    if (inflight.has(page)) return inflight.get(page).promise;
    const entry = { controller: new AbortController(), promise: null };
    inflight.set(page, entry);
    entry.promise = run(page, entry.controller);
    return entry.promise;
  }

  function prefetchAround(page) {
    if (!prefetch || disposed) return;
    for (const near of [page + 1, page - 1]) {
      if (near >= 1 && near <= total && !cache.has(near)) fetchPage(near);
    }
  }

  return {
    async load(page) {
      if (!nonblank(extractHash)) return { status: 'ok', row: null };
      if (disposed) return { status: 'aborted' };
      for (const [other, entry] of inflight) {
        if (Math.abs(other - page) > 1) entry.controller.abort();
      }
      if (cache.has(page)) {
        const row = cache.get(page);
        remember(page, row);
        prefetchAround(page);
        return { status: 'ok', row };
      }
      const result = await fetchPage(page);
      if (result.status === 'ok') prefetchAround(page);
      return result;
    },
    /** The cached row (null when the page has none), or undefined when not cached. */
    peek(page) {
      return cache.has(page) ? cache.get(page) : undefined;
    },
    dispose() {
      disposed = true;
      for (const entry of inflight.values()) entry.controller.abort();
    },
  };
}
