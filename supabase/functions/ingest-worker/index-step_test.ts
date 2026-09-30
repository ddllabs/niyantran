// The index step (ingestion-v2 spec, "The `index` step"; plan I3) against in-memory fakes. No network.

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { EMBED_MODEL, EmbeddingError, type EmbedResult } from '../_shared/embed.ts';
import { PAGE_CHUNK_VERSION } from '../_shared/chunking.ts';
import { composeDocument, normaliseBox } from '../_shared/pageText.ts';
import { sha256Hex } from '../_shared/textNormalise.ts';
import { indexStep, INDEX_STEP, planIndex } from './index-step.ts';
import {
  type ActivatePatch,
  type BlockRow,
  imagePath,
  INGEST,
  IngestError,
  type IngestCallLog,
  type IngestDb,
  type IngestJob,
  type ImageRow,
  type PageCommitRow,
  type PageRow,
  type RawOcrPage,
  type StoredOcrPage,
  type WorkerDeps,
} from './types.ts';

const DOC = 'doc-1';
const OCR_HASH = 'o'.repeat(64);
const EXTRACT_HASH = 'x'.repeat(64);

// ─── Fakes ───────────────────────────────────────────────────────────────────

interface StoredChunk extends PageCommitRow {
  id: string;
}

type Event =
  | { op: 'upsertPages' | 'upsertBlocks' | 'upsertImages'; n: number }
  | { op: 'embed'; n: number }
  | { op: 'log'; status: string }
  | { op: 'commit'; rows: number; keep: number }
  | { op: 'activate' };

/** A PostgREST range read: refuses a range wider than db-max-rows, and returns at most that many rows. */
function ranged<T>(rows: T[], from: number, to: number): Promise<T[]> {
  if (to - from + 1 > INGEST.readPage) {
    return Promise.reject(new Error(`range ${from}-${to} wider than db-max-rows ${INGEST.readPage}: read unpaged`));
  }
  return Promise.resolve(rows.slice(from, Math.min(to + 1, from + INGEST.readPage)));
}

/** In-memory tables with the SQL's keys and chunk_commit's rules. */
function fakeDb(ocrPages: StoredOcrPage[]) {
  const events: Event[] = [];
  const pages = new Map<string, PageRow & { id: string }>();
  const blocks = new Map<string, BlockRow & { id: string }>();
  const images = new Map<string, ImageRow & { id: string }>();
  const chunks = new Map<string, StoredChunk>();
  const logs: IngestCallLog[] = [];
  const commits: Array<{ rows: PageCommitRow[]; keep: string[] }> = [];
  const activations: Array<{ jobId: string; token: string; patch: ActivatePatch }> = [];
  let seq = 0;
  const id = (prefix: string) => `${prefix}-${String(++seq).padStart(6, '0')}`;
  const unsupported = () => Promise.reject(new Error('not used by the index step'));

  const db: IngestDb = {
    claim: unsupported,
    advance: unsupported,
    activate(jobId, token, patch) {
      events.push({ op: 'activate' });
      activations.push({ jobId, token, patch });
      return Promise.resolve();
    },
    files: unsupported,
    ocrPageNumbers: unsupported,
    ocrPages(documentId, ocrHash, from, to) {
      const rows = ocrPages
        .filter(() => documentId === DOC && ocrHash === OCR_HASH)
        .sort((a, b) => a.page_number - b.page_number);
      return ranged(structuredClone(rows), from, to);
    },
    upsertOcrPages: unsupported,
    upsertPages(rows) {
      events.push({ op: 'upsertPages', n: rows.length });
      for (const r of rows) {
        const key = `${r.document_id}|${r.extract_hash}|${r.page_number}`;
        pages.set(key, { ...r, id: pages.get(key)?.id ?? id('page') });
      }
      return Promise.resolve();
    },
    upsertBlocks(rows) {
      events.push({ op: 'upsertBlocks', n: rows.length });
      for (const r of rows) {
        const key = `${r.document_id}|${r.extract_hash}|${r.page_number}|${r.block_index}`;
        blocks.set(key, { ...r, id: blocks.get(key)?.id ?? id('block') });
      }
      return Promise.resolve();
    },
    upsertImages(rows) {
      events.push({ op: 'upsertImages', n: rows.length });
      for (const r of rows) {
        const key = `${r.document_id}|${r.extract_hash}|${r.placeholder}`;
        images.set(key, { ...r, id: images.get(key)?.id ?? id('image') });
      }
      return Promise.resolve();
    },
    blockIds(documentId, extractHash, from, to) {
      const rows = [...blocks.values()]
        .filter((b) => b.document_id === documentId && b.extract_hash === extractHash)
        .sort((a, b) => a.page_number - b.page_number || a.block_index - b.block_index)
        .map((b) => ({ id: b.id, page_number: b.page_number, block_index: b.block_index }));
      return ranged(rows, from, to);
    },
    imageIds(documentId, extractHash, from, to) {
      const rows = [...images.values()]
        .filter((i) => i.document_id === documentId && i.extract_hash === extractHash)
        .sort((a, b) => (a.placeholder < b.placeholder ? -1 : a.placeholder > b.placeholder ? 1 : 0))
        .map((i) => ({ id: i.id, placeholder: i.placeholder }));
      return ranged(rows, from, to);
    },
    storedChunks(documentId, from, to) {
      const rows = [...chunks.values()]
        .filter(() => documentId === DOC)
        .sort((a, b) => (a.chunk_hash < b.chunk_hash ? -1 : a.chunk_hash > b.chunk_hash ? 1 : 0))
        .map((c) => ({ chunk_hash: c.chunk_hash, embed_hash: c.embed_hash ?? null }));
      return ranged(rows, from, to);
    },
    chunkCommit(documentId, rows, keep) {
      assertEquals(documentId, DOC);
      events.push({ op: 'commit', rows: rows.length, keep: keep.length });
      commits.push({ rows: structuredClone(rows), keep: [...keep] });
      let deleted = 0;
      const keepSet = new Set(keep);
      for (const h of [...chunks.keys()]) if (!keepSet.has(h)) (chunks.delete(h), deleted++);
      let inserted = 0;
      let kept = 0;
      for (const r of rows) {
        const stored = chunks.get(r.chunk_hash);
        if (!r.embedding && stored && stored.embed_hash !== r.embed_hash) {
          return Promise.reject(new Error(`chunk_commit: chunk ${r.chunk_hash} changed embed_hash without a new embedding`));
        }
        if (stored) {
          chunks.set(r.chunk_hash, { ...r, embedding: r.embedding ?? stored.embedding, id: stored.id });
          kept++;
        } else {
          if (!r.embedding) return Promise.reject(new Error(`chunk_commit: new chunk ${r.chunk_hash} has no embedding`));
          chunks.set(r.chunk_hash, { ...r, id: id('chunk') });
          inserted++;
        }
      }
      return Promise.resolve({ inserted, kept, deleted });
    },
    logCall(row) {
      events.push({ op: 'log', status: row.status });
      logs.push(row);
      return Promise.resolve();
    },
  };
  return { db, events, pages, blocks, images, chunks, logs, commits, activations };
}

interface EmbedFake {
  embed: WorkerDeps['embed'];
  calls: string[][];
}

/** OpenRouter stand-in: tokens are ceil(chars / 4), priced at 2e-8 per token; `failOn` makes call n throw. */
function fakeEmbed(events: Event[], opts: { failOn?: number; onCall?: () => void } = {}): EmbedFake {
  const calls: string[][] = [];
  const embed = (inputs: string[]): Promise<EmbedResult> => {
    calls.push(inputs);
    events.push({ op: 'embed', n: inputs.length });
    opts.onCall?.();
    if (opts.failOn === calls.length) {
      return Promise.reject(new EmbeddingError('embeddings HTTP 502 after 3 attempts', { costUsd: 0.00042, promptTokens: 21000 }, 502));
    }
    const promptTokens = inputs.reduce((n, s) => n + Math.ceil(s.length / 4), 0);
    return Promise.resolve({
      vectors: inputs.map((_, i) => [i, inputs.length, 0.5]),
      model: 'text-embedding-3-small',
      promptTokens,
      costUsd: promptTokens * 0.00000002,
      requests: 1,
    });
  };
  return { embed, calls };
}

function job(overrides: Partial<IngestJob> = {}): IngestJob {
  return {
    id: 'job-1',
    document_id: DOC,
    status: 'running',
    stage: 'index',
    file_sha256: 'f'.repeat(64),
    ocr_hash: OCR_HASH,
    extract_hash: EXTRACT_HASH,
    model_id: 'mistral-ocr-4-1',
    pages_total: 0,
    pages_per_call: 25,
    claim_token: 'token-1',
    lease_until: null,
    attempts: 1,
    next_attempt_at: null,
    error_code: null,
    last_error: null,
    ocr_pages: 0,
    ocr_cost_usd: 0,
    embed_tokens: 0,
    embed_cost_usd: 0,
    requested_by: null,
    created_at: '2026-10-01T00:00:00Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

/** A clock that stands still unless a test moves it. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, set: (v: number) => (t = v), advance: (ms: number) => (t += ms) };
}

function deps(db: IngestDb, embed: WorkerDeps['embed'], now: () => number): WorkerDeps {
  return {
    db,
    storage: {
      signedUrl: () => Promise.reject(new Error('no storage in the index step')),
      exists: () => Promise.reject(new Error('no storage in the index step')),
      upload: () => Promise.reject(new Error('no storage in the index step')),
    },
    ocr: () => Promise.reject(new Error('no OCR in the index step')),
    embed,
    documentUrlOverride: () => null,
    now,
    log: () => {},
  };
}

const FAR = Number.MAX_SAFE_INTEGER;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function rawPage(index: number, markdown: string, extra: Partial<RawOcrPage> = {}): RawOcrPage {
  return { index, markdown, header: null, footer: null, dimensions: null, blocks: [], tables: [], images: [], ...extra };
}

/** A chunk as an earlier run committed it: only chunk_hash and embed_hash are read back by the step. */
const seeded = (c: { chunk_hash: string; chunk_index: number; embed_hash: string }): StoredChunk =>
  ({ chunk_hash: c.chunk_hash, embed_hash: c.embed_hash, id: `c${c.chunk_index}`, embedding: [1] }) as StoredChunk;

const stored = (pages: RawOcrPage[]): StoredOcrPage[] => pages.map((raw) => ({ page_number: raw.index + 1, raw }));

/**
 * A long synthetic document: `pageCount` pages of distinct paragraphs, about 950 characters each, so every
 * paragraph is one chunk and the document spans several commit slices.
 */
function longDocument(pageCount: number, parasPerPage: number): StoredOcrPage[] {
  const pages: RawOcrPage[] = [];
  for (let p = 0; p < pageCount; p++) {
    const paras: string[] = [];
    for (let k = 0; k < parasPerPage; k++) {
      const words: string[] = [];
      for (let w = 0; words.join(' ').length < 900; w++) words.push(`p${p}k${k}w${w}`);
      paras.push(`${words.join(' ')}.`);
    }
    pages.push(rawPage(p, paras.join('\n\n')));
  }
  return stored(pages);
}

/** The 12-page bill as the OCR step stores it: global index, no base64, images none. */
async function billPages(): Promise<StoredOcrPage[]> {
  const fixture = JSON.parse(
    await Deno.readTextFile(new URL('../_shared/__fixtures__/mistral-bill-12p.json', import.meta.url)),
  ) as { pages: Array<RawOcrPage & Record<string, unknown>> };
  return stored(fixture.pages.map((p) => ({
    index: p.index,
    markdown: p.markdown,
    header: p.header ?? null,
    footer: p.footer ?? null,
    dimensions: p.dimensions ?? null,
    blocks: p.blocks ?? [],
    tables: p.tables ?? [],
    images: [],
  })));
}

/**
 * Two pages with images (the placeholder mapping). Page 1 references img-0.jpeg twice (one placeholder)
 * and img-1.jpeg, which the OCR step skipped as too large (no row). Page 2 reuses the id img-0.jpeg (a
 * different image, a different placeholder) and lists img-1.jpeg without referencing it.
 */
const IMAGE_PAGES: StoredOcrPage[] = stored([
  rawPage(0, 'Chart of reserves.\n\n![img-0.jpeg](img-0.jpeg)\n\nAgain: ![img-0.jpeg](img-0.jpeg)\n\n![img-1.jpeg](img-1.jpeg)', {
    dimensions: { dpi: 100, width: 1000, height: 2000 },
    images: [
      { id: 'img-0.jpeg', top_left_x: 100, top_left_y: 200, bottom_right_x: 500, bottom_right_y: 600, sha256: 'a'.repeat(64), mime: 'image/jpeg', byte_size: 1234 },
      { id: 'img-1.jpeg', top_left_x: 0, top_left_y: 0, bottom_right_x: 10, bottom_right_y: 10, sha256: null, mime: null, byte_size: null, skipped: 'too_large' },
    ],
    blocks: [
      { type: 'text', content: 'Chart of reserves.', top_left_x: 100, top_left_y: 100, bottom_right_x: 900, bottom_right_y: 150 },
      { type: 'image', content: '', top_left_x: 100, top_left_y: 200, bottom_right_x: 500, bottom_right_y: 600 },
    ],
  }),
  rawPage(1, 'Liabilities by quarter.\n\n![img-0.jpeg](img-0.jpeg)', {
    dimensions: null,
    images: [
      { id: 'img-0.jpeg', top_left_x: 5, top_left_y: 5, bottom_right_x: 50, bottom_right_y: 50, sha256: 'c'.repeat(64), mime: 'image/png', byte_size: 99 },
      { id: 'img-1.jpeg', sha256: 'd'.repeat(64), mime: 'image/webp', byte_size: 7 },
    ],
  }),
]);

/** Runs the step once to completion and returns the fake's state. */
async function runToCompletion(pages: StoredOcrPage[], pagesTotal = pages.length) {
  const f = fakeDb(pages);
  const e = fakeEmbed(f.events);
  const out = await indexStep(deps(f.db, e.embed, clock().now), job({ pages_total: pagesTotal }), FAR);
  return { ...f, embed: e, out };
}

// ─── Guards ──────────────────────────────────────────────────────────────────

Deno.test('index: refuses a job without ocr_hash or extract_hash (permanent)', async () => {
  for (const missing of [{ ocr_hash: null }, { extract_hash: null }]) {
    const f = fakeDb(IMAGE_PAGES);
    const e = fakeEmbed(f.events);
    const err = await assertRejects(() => indexStep(deps(f.db, e.embed, clock().now), job({ pages_total: 2, ...missing }), FAR), IngestError);
    assertEquals([err.code, err.permanent], ['index_without_hashes', true]);
    assertEquals(f.events, []);
  }
});

Deno.test('index: refuses when a page of 1..pages_total is missing, before writing anything', async () => {
  const f = fakeDb([IMAGE_PAGES[1]]);
  const e = fakeEmbed(f.events);
  const err = await assertRejects(() => indexStep(deps(f.db, e.embed, clock().now), job({ pages_total: 2 }), FAR), IngestError);
  assertEquals(err.code, 'ocr_incomplete');
  assertEquals(f.events, []);
});

// ─── Writes: pages, blocks, images and the id mapping ────────────────────────

Deno.test('index: image rows use composeDocument placeholders, matched by page and original id; skipped images get none', async () => {
  const r = await runToCompletion(IMAGE_PAGES);
  const rows = [...r.images.values()].sort((a, b) => a.placeholder.localeCompare(b.placeholder));
  assertEquals(rows.map((i) => [i.placeholder, i.page_number, i.sha256, i.mime, i.storage_path, i.byte_size]), [
    ['img:1-0', 1, 'a'.repeat(64), 'image/jpeg', imagePath('a'.repeat(64), 'jpeg'), 1234],
    ['img:2-0', 2, 'c'.repeat(64), 'image/png', imagePath('c'.repeat(64), 'png'), 99],
    ['img:2-1', 2, 'd'.repeat(64), 'image/webp', imagePath('d'.repeat(64), 'webp'), 7],
  ]);
  // Box normalised against its own page; a page without dimensions stores null coordinates.
  assertEquals([rows[0].x0, rows[0].y0, rows[0].x1, rows[0].y1], [0.1, 0.1, 0.5, 0.3]);
  assertEquals([rows[1].x0, rows[1].y0, rows[1].x1, rows[1].y1], [null, null, null, null]);
  assert(rows.every((i) => i.document_id === DOC && i.extract_hash === EXTRACT_HASH));
});

Deno.test('index: chunk image_ids map placeholders to stored ids; a placeholder with no stored image is dropped', async () => {
  const r = await runToCompletion(IMAGE_PAGES);
  const idOf = (p: string) => [...r.images.values()].find((i) => i.placeholder === p)!.id;
  const byPage = new Map([...r.chunks.values()].map((c) => [c.page_number, c]));
  assert(byPage.get(1)!.content.includes('![img:1-1](img:1-1)'), 'the skipped image keeps its placeholder in the text');
  assertEquals(byPage.get(1)!.image_ids, [idOf('img:1-0')]);
  assertEquals(byPage.get(2)!.image_ids, [idOf('img:2-0')]);
});

Deno.test('index: page rows are the composed pages; block rows carry index, normalised box, page-local span and content', async () => {
  const r = await runToCompletion(IMAGE_PAGES);
  const doc = composeDocument(IMAGE_PAGES.map((p) => p.raw));
  const pages = [...r.pages.values()].sort((a, b) => a.page_number - b.page_number);
  assertEquals(pages.map(({ id: _id, document_id: _d, extract_hash: _x, ...rest }) => rest), doc.pages);
  const blocks = [...r.blocks.values()].sort((a, b) => a.page_number - b.page_number || a.block_index - b.block_index);
  assertEquals(blocks.map((b) => [b.page_number, b.block_index, b.type, b.char_from, b.char_to, b.content]), [
    [1, 0, 'text', 0, 18, 'Chart of reserves.'],
    [1, 1, 'image', null, null, ''],
  ]);
  const box = normaliseBox(IMAGE_PAGES[0].raw.blocks[0], IMAGE_PAGES[0].raw.dimensions)!;
  assertEquals([blocks[0].x0, blocks[0].y0, blocks[0].x1, blocks[0].y1], [box.x0, box.y0, box.x1, box.y1]);
});

Deno.test('index: block_ids are the stored ids of each chunk block_refs, on the 12-page bill', async () => {
  const pages = await billPages();
  const r = await runToCompletion(pages);
  const plan = await planIndex(DOC, EXTRACT_HASH, pages.length, pages);
  const idOf = new Map([...r.blocks.values()].map((b) => [`${b.page_number}:${b.block_index}`, b.id]));
  let linked = 0;
  for (const c of plan.chunks) {
    const want = c.block_refs.map((ref) => idOf.get(`${ref.page_number}:${ref.block_index}`)!);
    assertEquals(r.chunks.get(c.chunk_hash)!.block_ids, want);
    linked += want.length;
  }
  assert(linked > 0, 'the bill links chunks to blocks');
});

Deno.test('index: reads are paged: 1,200 blocks and 1,000 stray stored chunks past the row cap', async () => {
  // Three pages of 400 one-line blocks each; the chunks on page 3 link blocks past row 1,000.
  const pages = stored([0, 1, 2].map((p) => {
    const lines = Array.from({ length: 400 }, (_, k) => `Line ${p}-${k} of the long schedule.`);
    return rawPage(p, lines.join('\n\n'), { blocks: lines.map((content) => ({ type: 'text', content })) });
  }));
  const f = fakeDb(pages);
  // Strays sort before every hex hash: an unpaged read would see only these and re-embed everything.
  for (let i = 0; i < 1000; i++) {
    const h = `!stray-${String(i).padStart(4, '0')}`;
    f.chunks.set(h, { chunk_hash: h, embed_hash: 'e', id: `s${i}` } as StoredChunk);
  }
  const plan = await planIndex(DOC, EXTRACT_HASH, 3, pages);
  const last = plan.chunks.at(-1)!;
  // Every real chunk but the last is already committed.
  for (const c of plan.chunks) if (c !== last) f.chunks.set(c.chunk_hash, seeded(c));
  const e = fakeEmbed(f.events);

  const out = await indexStep(deps(f.db, e.embed, clock().now), job({ pages_total: 3 }), FAR);

  assertEquals(out.activated, true);
  assertEquals(f.events.filter((x) => x.op === 'upsertBlocks').map((x) => (x as { n: number }).n), [500, 500, 200]);
  assertEquals(e.calls, [[last.embedding_input]], 'every committed chunk was found stored past row 1,000');
  assertEquals(f.chunks.size, plan.chunks.length, 'the strays are deleted');
  assert(last.page_number === 3 && last.block_refs.length > 0);
  assertEquals(f.chunks.get(last.chunk_hash)!.block_ids.length, last.block_refs.length, 'page 3 blocks mapped');
});

// ─── Embedding and commits ───────────────────────────────────────────────────

Deno.test('index: commits slice by slice, each with at most commitSlice rows and the full keep list', async () => {
  const pages = longDocument(25, 10);
  const r = await runToCompletion(pages);
  const plan = await planIndex(DOC, EXTRACT_HASH, pages.length, pages);
  assert(plan.chunks.length > 2 * INGEST.commitSlice, `need 3+ slices, got ${plan.chunks.length} chunks`);
  const keep = plan.chunks.map((c) => c.chunk_hash);
  assertEquals(r.commits.length, Math.ceil(plan.chunks.length / INGEST.commitSlice));
  for (const [i, c] of r.commits.entries()) {
    assertEquals(c.keep, keep);
    assertEquals(c.rows.map((row) => row.chunk_hash), keep.slice(i * INGEST.commitSlice, (i + 1) * INGEST.commitSlice));
  }
  // One embed per slice, of that slice's chunks, before its commit.
  assertEquals(r.events.filter((e) => e.op === 'embed' || e.op === 'commit').map((e) => e.op),
    r.commits.flatMap(() => ['embed', 'commit']));
  assertEquals(r.chunks.size, plan.chunks.length);
});

Deno.test('index: commit rows carry the page chunk contract fields', async () => {
  const pages = await billPages();
  const r = await runToCompletion(pages);
  const plan = await planIndex(DOC, EXTRACT_HASH, pages.length, pages);
  const all = r.commits.flatMap((c) => c.rows);
  assertEquals(all.length, plan.chunks.length);
  for (const [i, row] of all.entries()) {
    const c = plan.chunks[i];
    assertEquals(row.chunk_hash, c.chunk_hash);
    assertEquals(row.chunk_index, c.chunk_index);
    assertEquals(row.source_kind, 'pdf_page');
    assertEquals([row.page_number, row.char_from, row.char_to, row.content], [c.page_number, c.char_from, c.char_to, c.content]);
    assertEquals(row.token_count, c.token_estimate);
    assertEquals(row.chunker_version, PAGE_CHUNK_VERSION);
    assertEquals(row.metadata, { section: c.section });
    assertEquals(row.embed_hash, c.embed_hash);
    assertEquals(row.embedding?.length, 3, 'a new chunk carries its vector');
  }
  // What was embedded is the embedding input (section prefix + content), not the bare content.
  assertEquals(r.embed.calls.flat(), plan.chunks.map((c) => c.embedding_input));
  assert(plan.chunks.some((c) => c.embedding_input !== c.content));
});

Deno.test('index: a stored chunk with an unchanged embed_hash is never embedded', async () => {
  const pages = longDocument(25, 10);
  const plan = await planIndex(DOC, EXTRACT_HASH, pages.length, pages);
  const f = fakeDb(pages);
  // Every chunk but three already stored, as a previous run committed them.
  const missing = new Set([5, 150, plan.chunks.length - 1]);
  for (const c of plan.chunks) {
    if (!missing.has(c.chunk_index)) f.chunks.set(c.chunk_hash, seeded(c));
  }
  const e = fakeEmbed(f.events);
  const out = await indexStep(deps(f.db, e.embed, clock().now), job({ pages_total: pages.length }), FAR);
  assertEquals(out.activated, true);
  assertEquals(e.calls.flat(), [...missing].map((i) => plan.chunks[i].embedding_input));
  assertEquals(f.chunks.size, plan.chunks.length);
});

Deno.test('index: a stored chunk whose embed_hash changed is re-embedded and its vector replaced', async () => {
  const pages = await billPages();
  const plan = await planIndex(DOC, EXTRACT_HASH, pages.length, pages);
  const f = fakeDb(pages);
  for (const c of plan.chunks) f.chunks.set(c.chunk_hash, seeded(c));
  const changed = plan.chunks[3];
  f.chunks.get(changed.chunk_hash)!.embed_hash = 'stale-section-input';
  const e = fakeEmbed(f.events);

  const out = await indexStep(deps(f.db, e.embed, clock().now), job({ pages_total: pages.length }), FAR);

  assertEquals(out.activated, true);
  assertEquals(e.calls, [[changed.embedding_input]]);
  const after = f.chunks.get(changed.chunk_hash)!;
  assertEquals([after.id, after.embed_hash, after.embedding], [`c3`, changed.embed_hash, [0, 1, 0.5]]);
});

Deno.test('index: the embedding cost is logged before the commit it pays for, with job and document ids', async () => {
  const pages = longDocument(25, 10);
  const r = await runToCompletion(pages);
  const ops = r.events.filter((e) => e.op === 'embed' || e.op === 'log' || e.op === 'commit').map((e) => e.op);
  assertEquals(ops, r.commits.flatMap(() => ['embed', 'log', 'commit']));
  for (const [i, log] of r.logs.entries()) {
    const inputs = r.embed.calls[i];
    const tokens = inputs.reduce((n, s) => n + Math.ceil(s.length / 4), 0);
    assertEquals(log.caller, 'ingest-worker');
    assertEquals(log.purpose, 'embedding');
    assertEquals(log.provider, 'openrouter');
    assertEquals(log.model_requested, EMBED_MODEL);
    assertEquals(log.model_served, 'text-embedding-3-small');
    assertEquals(log.status, 'success');
    assertEquals([log.prompt_tokens, log.total_tokens], [tokens, tokens]);
    assertEquals(log.cost_usd, tokens * 0.00000002);
    assertEquals(log.raw_usage.job_id, 'job-1');
    assertEquals(log.raw_usage.document_id, DOC);
  }
});

Deno.test('index: an EmbeddingError logs the spend, commits nothing more and reports embed_failed with the claim\'s costs', async () => {
  const pages = longDocument(25, 10);
  const f = fakeDb(pages);
  const e = fakeEmbed(f.events, { failOn: 2 });
  const out = await indexStep(deps(f.db, e.embed, clock().now), job({ pages_total: pages.length }), FAR);
  assertEquals([out.patch.error?.code, out.patch.error?.permanent], ['embed_failed', false]);
  assertEquals([out.activated, out.patch.stage, out.patch.progressed], [undefined, undefined, true]);
  // The job's totals match the call log: slice 0's embedding and the failed call's partial spend.
  const loggedTokens = f.logs.reduce((n, l) => n + (l.prompt_tokens ?? 0), 0);
  const loggedCost = f.logs.reduce((n, l) => n + l.cost_usd, 0);
  assertEquals(out.patch.embed_tokens, loggedTokens);
  assert(Math.abs((out.patch.embed_cost_usd ?? 0) - loggedCost) < 1e-12);
  assertEquals(f.commits.length, 1, 'slice 0 committed, slice 1 not');
  const failed = f.logs.at(-1)!;
  assertEquals([failed.status, failed.cost_usd, failed.prompt_tokens], ['error', 0.00042, 21000]);
  assert(failed.error_message?.includes('502'));
  assertEquals([failed.raw_usage.job_id, failed.raw_usage.document_id], ['job-1', DOC]);
  assertEquals(f.activations, []);
});

Deno.test('index: a failed activation reports its error with the claim\'s embedding spend (I7 finding)', async () => {
  // Seen in the local end-to-end run: ingest_activate raised after every slice was committed, and the
  // claim's embedding cost reached model_call_logs but never the job's totals.
  const pages = longDocument(25, 10);
  const f = fakeDb(pages);
  f.db.activate = () => Promise.reject(new Error('ingest_activate: forced failure'));
  const e = fakeEmbed(f.events);
  const out = await indexStep(deps(f.db, e.embed, clock().now), job({ pages_total: pages.length }), FAR);
  assertEquals([out.activated, out.patch.stage, out.patch.progressed], [undefined, undefined, true]);
  assertEquals([out.patch.error?.code, out.patch.error?.permanent], ['internal', false]);
  assert(out.patch.error?.message.includes('forced failure'));
  const loggedTokens = f.logs.reduce((n, l) => n + (l.prompt_tokens ?? 0), 0);
  assert(loggedTokens > 0);
  assertEquals(out.patch.embed_tokens, loggedTokens);
});

// ─── Budget, resume and activation ───────────────────────────────────────────

Deno.test('index: out of budget before a slice, it returns without a stage change or activation', async () => {
  const pages = longDocument(25, 10);
  const f = fakeDb(pages);
  const c = clock(0);
  // Each embed takes 30 s: slice 0 starts at t=0, before the reserve; slice 1 would start at t=30 s,
  // inside the reserve before a deadline of 20 s + reserve.
  const e = fakeEmbed(f.events, { onCall: () => c.advance(30_000) });
  const out = await indexStep(deps(f.db, e.embed, c.now), job({ pages_total: pages.length }), 20_000 + INDEX_STEP.deadlineReserveMs);
  assertEquals(out.activated, undefined);
  assertEquals(out.patch.stage, undefined);
  assertEquals(out.patch.progressed, true);
  const tokens = e.calls[0].reduce((n, s) => n + Math.ceil(s.length / 4), 0);
  assertEquals([out.patch.embed_tokens, out.patch.embed_cost_usd], [tokens, tokens * 0.00000002]);
  assertEquals(f.commits.length, 1);
  assertEquals(f.activations, []);
});

Deno.test('index: resume after pages were written but nothing committed embeds every chunk once', async () => {
  const pages = longDocument(25, 10);
  const plan = await planIndex(DOC, EXTRACT_HASH, pages.length, pages);
  const f = fakeDb(pages);
  const e = fakeEmbed(f.events);
  const c = clock(0);
  // First claim: past the deadline once the pages are written.
  const first = await indexStep(deps(f.db, e.embed, c.now), job({ pages_total: pages.length }), 0);
  assertEquals(first.patch, { progressed: false, embed_tokens: 0, embed_cost_usd: 0 });
  assertEquals([f.pages.size, f.commits.length, e.calls.length], [pages.length, 0, 0]);
  const pageIds = [...f.pages.values()].map((p) => p.id);

  const second = await indexStep(deps(f.db, e.embed, c.now), job({ pages_total: pages.length }), FAR);
  assertEquals(second.activated, true);
  assertEquals(e.calls.flat(), plan.chunks.map((x) => x.embedding_input));
  assertEquals([...f.pages.values()].map((p) => p.id), pageIds, 'rewritten in place');
});

Deno.test('index: resume after slice k committed never re-embeds a committed chunk', async () => {
  const pages = longDocument(25, 10);
  const plan = await planIndex(DOC, EXTRACT_HASH, pages.length, pages);
  const f = fakeDb(pages);
  const c = clock(0);
  const e = fakeEmbed(f.events, { onCall: () => c.advance(1_000) });
  // Two slices fit before the deadline; the third does not.
  const deadline = 2_000 + INDEX_STEP.deadlineReserveMs;
  const first = await indexStep(deps(f.db, e.embed, c.now), job({ pages_total: pages.length }), deadline);
  assertEquals([first.patch.progressed, f.commits.length, first.activated], [true, 2, undefined]);

  const second = await indexStep(deps(f.db, e.embed, c.now), job({ pages_total: pages.length }), FAR);
  assertEquals(second.activated, true);
  const embedded = e.calls.flat();
  assertEquals(embedded, plan.chunks.map((x) => x.embedding_input), 'each chunk embedded exactly once, in order');
  assertEquals(f.chunks.size, plan.chunks.length);
});

Deno.test('index: activation is the last write, happens once, and carries the composed text', async () => {
  const pages = await billPages();
  const r = await runToCompletion(pages);
  assertEquals(r.out, { patch: { progressed: true }, activated: true });
  assertEquals(r.events.at(-1), { op: 'activate' });
  assertEquals(r.activations.length, 1);
  const doc = composeDocument(pages.map((p) => p.raw));
  const tokens = r.logs.reduce((n, l) => n + (l.prompt_tokens ?? 0), 0);
  assertEquals(r.activations[0], {
    jobId: 'job-1',
    token: 'token-1',
    patch: {
      extract_hash: EXTRACT_HASH,
      ocr_text: doc.ocrText,
      content_sha256: await sha256Hex(doc.ocrText),
      page_count: 12,
      embed_tokens: tokens,
      embed_cost_usd: r.logs.reduce((n, l) => n + l.cost_usd, 0),
    },
  });
});

Deno.test('index: a rerun with everything committed embeds nothing, still deletes strays, and activates', async () => {
  const pages = await billPages();
  const plan = await planIndex(DOC, EXTRACT_HASH, pages.length, pages);
  const f = fakeDb(pages);
  for (const c of plan.chunks) f.chunks.set(c.chunk_hash, seeded(c));
  f.chunks.set('stray', { chunk_hash: 'stray', embed_hash: 'e', id: 'stray' } as StoredChunk);
  const e = fakeEmbed(f.events);
  const out = await indexStep(deps(f.db, e.embed, clock().now), job({ pages_total: pages.length }), FAR);
  assertEquals(out.activated, true);
  assertEquals([e.calls.length, f.logs.length], [0, 0]);
  assertEquals(f.chunks.has('stray'), false);
  assertEquals(f.chunks.size, plan.chunks.length);
  assertEquals(f.activations[0].patch.embed_tokens, 0);
  assertEquals(f.events.at(-1), { op: 'activate' });
});

Deno.test('index: the 12-page bill end to end: 12 pages, every block, every chunk committed, activated', async () => {
  const pages = await billPages();
  const r = await runToCompletion(pages);
  assertEquals(r.out.activated, true);
  assertEquals(r.pages.size, 12);
  assertEquals(r.blocks.size, pages.reduce((n, p) => n + p.raw.blocks.length, 0));
  assertEquals(r.images.size, 0);
  const plan = await planIndex(DOC, EXTRACT_HASH, 12, pages);
  assertEquals(r.chunks.size, plan.chunks.length);
  assert(plan.chunks.length > 10);
  assertEquals(r.embed.calls.flat().length, plan.chunks.length);
  // Writes before any chunk commit (R5 write order).
  const firstCommit = r.events.findIndex((e) => e.op === 'commit');
  const lastWrite = r.events.findLastIndex((e) => e.op.startsWith('upsert'));
  assert(lastWrite < firstCommit);
  // Batches of at most writeBatch rows.
  for (const e of r.events) if (e.op.startsWith('upsert')) assert((e as { n: number }).n <= INDEX_STEP.writeBatch);
});
