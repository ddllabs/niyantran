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
export const BLOCK_COLUMNS = 'page_number, type, x0, y0, x1, y1';
export const SIZE_COLUMNS = 'page_number, width_px, height_px';
/** PostgREST's row cap: a longer document is read in ranges of this many pages. */
export const PAGE_SIZE_ROWS = 1000;

const nonblank = value => typeof value === 'string' && value.trim() !== '';
const withSignal = (query, signal) => (signal && typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query);
const isFraction = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** The page's blocks that carry a box, as `{type, x0, y0, x1, y1}`; blocks with null boxes are ignored. */
function boxedBlocks(data) {
  return (Array.isArray(data) ? data : [])
    .filter(b => b && [b.x0, b.y0, b.x1, b.y1].every(isFraction))
    .map(({ type, x0, y0, x1, y1 }) => ({ type: typeof type === 'string' ? type : '', x0, y0, x1, y1 }));
}

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
 * `document_pages` rows, with their `document_page_blocks` boxes, for one extraction, one page
 * at a time.
 *
 * - `load(page)` resolves `{status: 'ok', row, blocks}` (row null when the page has none; blocks
 *   `[]` when it has no boxed block), `{status: 'error'}`, or `{status: 'aborted'}` when the
 *   reader paged away first.
 * - The row and the blocks are read together, under one abort signal.
 * - Paging aborts every fetch that is not for the new page or its neighbours.
 * - After a page loads, its neighbours are fetched into a small cache (oldest evicted first).
 * - Errors are not cached, so loading the page again retries. A failed blocks read keeps the
 *   page (the PDF view falls back to Fit width) and is not cached either.
 */
export function createPageLoader({ client, documentId, extractHash, total, cacheSize = 5, prefetch = true }) {
  const cache = new Map();
  const inflight = new Map();
  let disposed = false;

  function remember(page, entry) {
    cache.delete(page);
    cache.set(page, entry);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value);
  }

  async function run(page, controller) {
    try {
      const forPage = (table, columns) => withSignal(client.from(table).select(columns)
        .eq('document_id', documentId).eq('extract_hash', extractHash).eq('page_number', page), controller.signal);
      const pageQuery = forPage('document_pages', PAGE_COLUMNS).maybeSingle();
      // The builder is a thenable: then() starts the read now. A blocks failure never fails the page.
      const blockQuery = forPage('document_page_blocks', BLOCK_COLUMNS)
        .then(result => result, () => ({ data: null, error: true }));
      const [{ data, error }, blocksRead] = await Promise.all([pageQuery, blockQuery]);
      if (controller.signal.aborted) return { status: 'aborted' };
      if (error) return { status: 'error' };
      const entry = { row: data ?? null, blocks: blocksRead?.error ? [] : boxedBlocks(blocksRead?.data) };
      if (!blocksRead?.error) remember(page, entry);
      return { status: 'ok', ...entry };
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
      if (!nonblank(extractHash)) return { status: 'ok', row: null, blocks: [] };
      if (disposed) return { status: 'aborted' };
      for (const [other, entry] of inflight) {
        if (Math.abs(other - page) > 1) entry.controller.abort();
      }
      if (cache.has(page)) {
        const entry = cache.get(page);
        remember(page, entry);
        prefetchAround(page);
        return { status: 'ok', ...entry };
      }
      const result = await fetchPage(page);
      if (result.status === 'ok') prefetchAround(page);
      return result;
    },
    /** The cached `{row, blocks}` (row null when the page has none), or undefined when not cached. */
    peek(page) {
      return cache.has(page) ? cache.get(page) : undefined;
    },
    dispose() {
      disposed = true;
      for (const entry of inflight.values()) entry.controller.abort();
    },
  };
}

/**
 * Every page's stored size for one extraction, in page order (viewer-continuous spec, section 1),
 * read in ranges of PAGE_SIZE_ROWS under PostgREST's row cap. It stops at a short range, and in any
 * case at `total` pages (the document's page count): a server that ignored the range must not
 * keep it reading.
 * @returns {Promise<{status: 'ok', rows: {page_number: number, width_px: number|null, height_px: number|null}[]}
 *   | {status: 'error'}>}
 */
export async function loadPageSizes(client, documentId, extractHash, signal, { total = Infinity } = {}) {
  if (!nonblank(extractHash)) return { status: 'ok', rows: [] };
  const rows = [];
  try {
    for (let from = 0; from < total; from += PAGE_SIZE_ROWS) {
      const { data, error } = await withSignal(client.from('document_pages').select(SIZE_COLUMNS)
        .eq('document_id', documentId).eq('extract_hash', extractHash)
        .order('page_number', { ascending: true }).range(from, from + PAGE_SIZE_ROWS - 1), signal);
      if (error || !Array.isArray(data)) return { status: 'error' };
      rows.push(...data);
      if (data.length < PAGE_SIZE_ROWS) return { status: 'ok', rows };
    }
    return { status: 'ok', rows: rows.slice(0, total) };
  } catch {
    return { status: 'error' };
  }
}

/**
 * The pages of one extraction holding `query` (search_document_pages, security invoker): each as
 * `{page, hits, snippets}`, in page order, at most 200. A query the database would not search
 * (under 2 characters once folded) simply finds nothing there.
 * @returns {Promise<{status: 'ok', pages: {page: number, hits: number, snippets: string[]}[]}
 *   | {status: 'aborted'} | {status: 'error'}>}
 */
export async function searchPages(client, { documentId, extractHash, query, signal }) {
  if (!nonblank(extractHash)) return { status: 'ok', pages: [] };
  try {
    const { data, error } = await withSignal(
      client.rpc('search_document_pages', { p_document_id: documentId, p_extract_hash: extractHash, p_query: query }),
      signal,
    );
    if (signal?.aborted) return { status: 'aborted' };
    if (error || !Array.isArray(data)) return { status: 'error' };
    const pages = data
      .filter(r => r && Number.isSafeInteger(r.page_number) && r.page_number > 0 && Number.isSafeInteger(r.hits) && r.hits > 0)
      .map(r => ({ page: r.page_number, hits: r.hits, snippets: Array.isArray(r.snippets) ? r.snippets.filter(nonblank) : [] }));
    return { status: 'ok', pages };
  } catch {
    return signal?.aborted ? { status: 'aborted' } : { status: 'error' };
  }
}
