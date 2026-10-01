import { describe, expect, it } from 'vitest';
import { BLOCK_COLUMNS, DOCUMENT_COLUMNS, PAGE_COLUMNS, PART_COLUMNS, createPageLoader, loadDocument } from './viewerData.js';

/**
 * A fake Supabase client. Every query is recorded as {table, columns, filters, order, signal};
 * `answer(query)` returns {data, error} or a promise of it (to hold a fetch open).
 */
function fakeClient(answer) {
  const queries = [];
  const client = {
    queries,
    from(table) {
      const query = { table, columns: null, filters: {}, order: null, signal: null };
      queries.push(query);
      const run = () => Promise.resolve(answer(query));
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(column, value) { query.filters[column] = value; return builder; },
        order(column, options) { query.order = [column, options]; return builder; },
        abortSignal(signal) { query.signal = signal; return builder; },
        maybeSingle() { query.single = true; return run(); },
        then(resolve, reject) { return run().then(resolve, reject); },
      };
      return builder;
    },
  };
  return client;
}

const LIVE = { id: 'd1', title: 'Bill', file_url: 'https://example.org/bill.pdf', storage_path: 'files/a.pdf', extract_hash: 'x1', page_count: 12, indexed_at: '2026-10-01' };
const PARTS = [{ part_index: 0, page_offset: 0, page_count: 12, byte_size: 999 }];

describe('loadDocument', () => {
  it('reads the document columns and its parts, in part order', async () => {
    const client = fakeClient(q => ({ data: q.table === 'documents' ? LIVE : PARTS, error: null }));
    const out = await loadDocument(client, 'd1');
    expect(out).toEqual({ status: 'ok', doc: LIVE, parts: PARTS });
    const [docQuery, partQuery] = client.queries;
    expect(docQuery).toMatchObject({ table: 'documents', columns: DOCUMENT_COLUMNS, filters: { id: 'd1' }, single: true });
    expect(DOCUMENT_COLUMNS).toBe('id, title, file_url, storage_path, extract_hash, page_count, indexed_at');
    expect(partQuery).toMatchObject({ table: 'document_files', columns: PART_COLUMNS, filters: { document_id: 'd1' }, order: ['part_index', { ascending: true }] });
    expect(PART_COLUMNS).toBe('part_index, page_offset, page_count, byte_size');
  });

  it('is gone when the row is missing, and does not ask for parts', async () => {
    const client = fakeClient(() => ({ data: null, error: null }));
    expect(await loadDocument(client, 'd1')).toEqual({ status: 'gone' });
    expect(client.queries).toHaveLength(1);
  });

  it('is an error, not gone, when the read fails or throws', async () => {
    expect(await loadDocument(fakeClient(() => ({ data: null, error: { message: 'boom' } })), 'd1')).toEqual({ status: 'error' });
    expect(await loadDocument({ from() { throw new Error('offline'); } }, 'd1')).toEqual({ status: 'error' });
  });

  it('skips the parts for a document that is not live or has no storage', async () => {
    for (const doc of [{ ...LIVE, indexed_at: null }, { ...LIVE, storage_path: null }]) {
      const client = fakeClient(() => ({ data: doc, error: null }));
      expect(await loadDocument(client, 'd1')).toEqual({ status: 'ok', doc, parts: [] });
      expect(client.queries).toHaveLength(1);
    }
  });

  it('keeps the document readable when the parts read fails', async () => {
    const client = fakeClient(q => (q.table === 'documents' ? { data: LIVE, error: null } : { data: null, error: { message: 'x' } }));
    expect(await loadDocument(client, 'd1')).toEqual({ status: 'ok', doc: LIVE, parts: [] });
  });

  it('drops an unsafe public file URL', async () => {
    const client = fakeClient(q => ({ data: q.table === 'documents' ? { ...LIVE, file_url: 'javascript:alert(1)' } : PARTS, error: null }));
    expect((await loadDocument(client, 'd1')).doc.file_url).toBeNull();
  });
});

const row = n => ({ page_number: n, text: `page ${n}`, char_from: n * 10, char_to: n * 10 + 6, width_px: 1000, height_px: 1414 });
const blocksOf = n => [
  { page_number: n, type: 'header', x0: 0.1, y0: 0.01, x1: 0.9, y1: 0.04 },
  { page_number: n, type: 'text', x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.5 },
  { page_number: n, type: 'image', x0: null, y0: null, x1: null, y1: null },
];
/** The blocks as the loader hands them on: boxed blocks only, type and box. */
const cleanBlocks = [
  { type: 'header', x0: 0.1, y0: 0.01, x1: 0.9, y1: 0.04 },
  { type: 'text', x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.5 },
];
/** Answers both page reads: the row from document_pages, the blocks from document_page_blocks. */
const pages = q => (q.table === 'document_page_blocks'
  ? { data: blocksOf(q.filters.page_number), error: null }
  : { data: row(q.filters.page_number), error: null });
const ok = n => ({ status: 'ok', row: row(n), blocks: cleanBlocks });
const rowQueries = client => client.queries.filter(q => q.table === 'document_pages');

describe('createPageLoader', () => {
  it('reads one page for the document extract, then its neighbours, and serves them from cache', async () => {
    const client = fakeClient(pages);
    const loader = createPageLoader({ client, documentId: 'd1', extractHash: 'x1', total: 12 });
    expect(await loader.load(5)).toEqual(ok(5));
    expect(client.queries[0]).toMatchObject({ table: 'document_pages', columns: PAGE_COLUMNS, filters: { document_id: 'd1', extract_hash: 'x1', page_number: 5 }, single: true });
    expect(PAGE_COLUMNS).toBe('page_number, text, char_from, char_to, width_px, height_px');
    await new Promise(r => setTimeout(r, 0));
    expect(rowQueries(client).map(q => q.filters.page_number).sort()).toEqual([4, 5, 6]);
    expect(await loader.load(6)).toEqual(ok(6));
    expect(loader.peek(4)).toEqual({ row: row(4), blocks: cleanBlocks });
    expect(rowQueries(client).filter(q => q.filters.page_number === 6)).toHaveLength(1);
  });

  it('reads the page\'s block boxes with its row, for the same extract and page, and drops null boxes', async () => {
    const client = fakeClient(pages);
    const loader = createPageLoader({ client, documentId: 'd1', extractHash: 'x1', total: 1 });
    expect(await loader.load(1)).toEqual(ok(1));
    const blockQuery = client.queries.find(q => q.table === 'document_page_blocks');
    expect(blockQuery).toMatchObject({ columns: BLOCK_COLUMNS, filters: { document_id: 'd1', extract_hash: 'x1', page_number: 1 } });
    expect(BLOCK_COLUMNS).toBe('page_number, type, x0, y0, x1, y1');
    expect(blockQuery.signal).toBeInstanceOf(AbortSignal);
    expect(await loader.load(1)).toEqual(ok(1));
    expect(client.queries.filter(q => q.table === 'document_page_blocks')).toHaveLength(1);
  });

  it('keeps the page when its blocks fail, without caching, so the blocks are read again', async () => {
    let failBlocks = true;
    const client = fakeClient(q => (q.table === 'document_page_blocks' && failBlocks ? { data: null, error: { message: 'x' } } : pages(q)));
    const loader = createPageLoader({ client, documentId: 'd1', extractHash: 'x1', total: 1 });
    expect(await loader.load(1)).toEqual({ status: 'ok', row: row(1), blocks: [] });
    expect(loader.peek(1)).toBeUndefined();
    failBlocks = false;
    expect(await loader.load(1)).toEqual(ok(1));
  });

  it('does not prefetch outside the document', async () => {
    const client = fakeClient(pages);
    const loader = createPageLoader({ client, documentId: 'd1', extractHash: 'x1', total: 1 });
    await loader.load(1);
    await new Promise(r => setTimeout(r, 0));
    expect(rowQueries(client).map(q => q.filters.page_number)).toEqual([1]);
  });

  it('caches a missing page row as null', async () => {
    const client = fakeClient(q => (q.table === 'document_page_blocks' ? { data: [], error: null } : { data: null, error: null }));
    const loader = createPageLoader({ client, documentId: 'd1', extractHash: 'x1', total: 1 });
    expect(await loader.load(1)).toEqual({ status: 'ok', row: null, blocks: [] });
    expect(await loader.load(1)).toEqual({ status: 'ok', row: null, blocks: [] });
    expect(rowQueries(client)).toHaveLength(1);
  });

  it('aborts a stale fetch, row and blocks, when the reader pages away', async () => {
    const held = [];
    const client = fakeClient(q => new Promise(resolve => held.push({ q, resolve })));
    const loader = createPageLoader({ client, documentId: 'd1', extractHash: 'x1', total: 50 });
    const first = loader.load(2);
    const second = loader.load(20);
    const stale = held.filter(h => h.q.filters.page_number === 2);
    expect(stale.map(h => h.q.table).sort()).toEqual(['document_page_blocks', 'document_pages']);
    expect(stale.every(h => h.q.signal.aborted)).toBe(true);
    stale.forEach(h => h.resolve(pages(h.q)));
    expect(await first).toEqual({ status: 'aborted' });
    held.filter(h => h.q.filters.page_number === 20).forEach(h => h.resolve(pages(h.q)));
    expect(await second).toEqual(ok(20));
    expect(loader.peek(2)).toBeUndefined();
  });

  it('reports an error without caching it, so the next load retries', async () => {
    let fail = true;
    const client = fakeClient(q => (fail && q.table === 'document_pages' ? { data: null, error: { message: 'x' } } : pages(q)));
    const loader = createPageLoader({ client, documentId: 'd1', extractHash: 'x1', total: 1 });
    expect(await loader.load(1)).toEqual({ status: 'error' });
    fail = false;
    expect(await loader.load(1)).toEqual(ok(1));
  });

  it('keeps a small cache', async () => {
    const client = fakeClient(pages);
    const loader = createPageLoader({ client, documentId: 'd1', extractHash: 'x1', total: 100, cacheSize: 3, prefetch: false });
    for (const n of [1, 2, 3, 4]) await loader.load(n);
    expect(loader.peek(1)).toBeUndefined();
    expect(loader.peek(4)).toEqual({ row: row(4), blocks: cleanBlocks });
  });

  it('has no page rows without an extract hash, and asks nothing', async () => {
    const client = fakeClient(pages);
    const loader = createPageLoader({ client, documentId: 'd1', extractHash: null, total: 3 });
    expect(await loader.load(1)).toEqual({ status: 'ok', row: null, blocks: [] });
    expect(client.queries).toHaveLength(0);
  });

  it('dispose aborts everything in flight', async () => {
    const held = [];
    const client = fakeClient(q => new Promise(resolve => held.push({ q, resolve })));
    const loader = createPageLoader({ client, documentId: 'd1', extractHash: 'x1', total: 3 });
    const pending = loader.load(1);
    loader.dispose();
    expect(held.length).toBeGreaterThan(0);
    expect(held.every(h => h.q.signal.aborted)).toBe(true);
    held.forEach(h => h.resolve(pages(h.q)));
    expect(await pending).toEqual({ status: 'aborted' });
  });
});
