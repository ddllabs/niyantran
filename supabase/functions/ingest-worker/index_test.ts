import { assert, assertEquals, assertFalse, assertRejects } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  buildWorkerDeps,
  documentUrlOverride,
  isLocalStackUrl,
  supabaseIngestDb,
  supabaseIngestStorage,
} from './index.ts';
import { readAll } from './paging.ts';
import { CORPUS_BUCKET, INGEST, type IngestCallLog, type PageCommitRow } from './types.ts';

// ─── A recording supabase-js stand-in ────────────────────────────────────────

interface QueryCall {
  table: string;
  select?: string;
  eq: Array<[string, unknown]>;
  order: Array<[string, unknown]>;
  range?: [number, number];
  upsert?: unknown;
  upsertOptions?: Record<string, unknown>;
  insert?: unknown;
}

/**
 * PostgREST's row cap, as in ingest-documents/index_test.ts: however wide the range, at most
 * `cap` rows come back and nothing says the response was cut short.
 */
function recordingClient(
  opts: {
    rows?: (table: string) => Record<string, unknown>[];
    rpcData?: Record<string, unknown>;
    error?: { message: string };
    cap?: number;
  } = {},
) {
  const cap = opts.cap ?? 1000;
  const calls: QueryCall[] = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = <T>(data: T) =>
    Promise.resolve(opts.error ? { data: null, error: opts.error } : { data, error: null });
  const client = {
    from(table: string) {
      const call: QueryCall = { table, eq: [], order: [] };
      calls.push(call);
      const q = {
        select(columns: string) {
          call.select = columns;
          return q;
        },
        eq(column: string, value: unknown) {
          call.eq.push([column, value]);
          return q;
        },
        order(column: string, options?: unknown) {
          call.order.push([column, options]);
          return q;
        },
        range(from: number, to: number) {
          call.range = [from, to];
          const rows = opts.rows?.(table) ?? [];
          return result(rows.slice(from, Math.min(to + 1, from + cap)));
        },
        upsert(rows: unknown, options?: Record<string, unknown>) {
          call.upsert = rows;
          call.upsertOptions = options;
          return result(null);
        },
        insert(row: unknown) {
          call.insert = row;
          return result(null);
        },
      };
      return q;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      return result(opts.rpcData?.[name] ?? null);
    },
  } as unknown as SupabaseClient;
  return { client, calls, rpcs };
}

const DOC = 'doc-1';
const OCR = 'o'.repeat(64);
const EXTRACT = 'e'.repeat(64);

// ─── RPCs ────────────────────────────────────────────────────────────────────

Deno.test('claim calls ingest_claim with p_limit and the lease as an interval string', async () => {
  const jobs = [{ id: 'j1' }];
  const { client, rpcs } = recordingClient({ rpcData: { ingest_claim: jobs } });
  assertEquals(await supabaseIngestDb(client).claim(1, INGEST.leaseSeconds), jobs);
  assertEquals(rpcs, [{ name: 'ingest_claim', args: { p_limit: 1, p_lease: '300 seconds' } }]);
});

Deno.test('claim returns [] when the RPC returns null', async () => {
  const { client } = recordingClient({ rpcData: {} });
  assertEquals(await supabaseIngestDb(client).claim(1, 300), []);
});

Deno.test('advance and activate pass p_job, p_token and p', async () => {
  const { client, rpcs } = recordingClient();
  const db = supabaseIngestDb(client);
  await db.advance('j1', 't1', { progressed: true, stage: 'index' });
  const activate = {
    extract_hash: EXTRACT,
    ocr_text: 'x',
    content_sha256: 'c',
    page_count: 2,
    embed_tokens: 5,
    embed_cost_usd: 0.1,
  };
  await db.activate('j1', 't1', activate);
  assertEquals(rpcs, [
    { name: 'ingest_advance', args: { p_job: 'j1', p_token: 't1', p: { progressed: true, stage: 'index' } } },
    { name: 'ingest_activate', args: { p_job: 'j1', p_token: 't1', p: activate } },
  ]);
});

Deno.test('chunkCommit calls chunk_commit with p_document_id, p_rows and p_keep_hashes', async () => {
  const counts = { inserted: 1, kept: 2, deleted: 0 };
  const { client, rpcs } = recordingClient({ rpcData: { chunk_commit: counts } });
  const rows = [{ chunk_hash: 'h1' }] as unknown as PageCommitRow[];
  assertEquals(await supabaseIngestDb(client).chunkCommit(DOC, rows, ['h1', 'h2']), counts);
  assertEquals(rpcs, [{
    name: 'chunk_commit',
    args: { p_document_id: DOC, p_rows: rows, p_keep_hashes: ['h1', 'h2'] },
  }]);
});

Deno.test('a PostgREST error throws an Error naming the operation (the fence rejection reaches the caller)', async () => {
  const { client } = recordingClient({ error: { message: 'claim token mismatch' } });
  const db = supabaseIngestDb(client);
  await assertRejects(() => db.advance('j1', 'stale', { progressed: false }), Error, 'ingest_advance');
  await assertRejects(() => db.claim(1, 300), Error, 'ingest_claim');
  await assertRejects(() => db.files(DOC, 0, 999), Error, 'document_files');
  await assertRejects(() => db.upsertPages([{ page_number: 1 }] as never), Error, 'document_pages');
});

// ─── Paged reads ─────────────────────────────────────────────────────────────

interface PagedRead {
  name: string;
  table: string;
  read: (db: ReturnType<typeof supabaseIngestDb>, from: number, to: number) => Promise<unknown[]>;
  eq: Array<[string, unknown]>;
  order: string[];
  row: (i: number) => Record<string, unknown>;
}

const pagedReads: PagedRead[] = [
  {
    name: 'files',
    table: 'document_files',
    read: (db, f, t) => db.files(DOC, f, t),
    eq: [['document_id', DOC]],
    order: ['part_index'],
    row: (i: number) => ({
      document_id: DOC,
      part_index: i,
      page_offset: i,
      page_count: 1,
      sha256: 's',
      byte_size: 1,
      storage_path: 'p',
    }),
  },
  {
    name: 'ocrPageNumbers',
    table: 'document_ocr_pages',
    read: (db, f, t) => db.ocrPageNumbers(DOC, OCR, f, t),
    eq: [['document_id', DOC], ['ocr_hash', OCR]],
    order: ['page_number'],
    row: (i: number) => ({ page_number: i + 1 }),
  },
  {
    name: 'ocrPages',
    table: 'document_ocr_pages',
    read: (db, f, t) => db.ocrPages(DOC, OCR, f, t),
    eq: [['document_id', DOC], ['ocr_hash', OCR]],
    order: ['page_number'],
    row: (i: number) => ({ page_number: i + 1, raw: { index: i } }),
  },
  {
    name: 'blockIds',
    table: 'document_page_blocks',
    read: (db, f, t) => db.blockIds(DOC, EXTRACT, f, t),
    eq: [['document_id', DOC], ['extract_hash', EXTRACT]],
    order: ['page_number', 'block_index'],
    row: (i: number) => ({ id: `b${i}`, page_number: 1, block_index: i }),
  },
  {
    name: 'imageIds',
    table: 'document_page_images',
    read: (db, f, t) => db.imageIds(DOC, EXTRACT, f, t),
    eq: [['document_id', DOC], ['extract_hash', EXTRACT]],
    order: ['placeholder'],
    row: (i: number) => ({ id: `i${i}`, placeholder: `img:1-${i}` }),
  },
  {
    name: 'storedChunks',
    table: 'document_chunks',
    read: (db, f, t) => db.storedChunks(DOC, f, t),
    eq: [['document_id', DOC]],
    order: ['chunk_hash'],
    row: (i: number) => ({ chunk_hash: `h${i}`, embed_hash: null }),
  },
];

for (const r of pagedReads) {
  Deno.test(`${r.name} reads ${r.table} past the row cap in ranges of at most 1,000, ordered by ${r.order.join(', ')}`, async () => {
    const rows = Array.from({ length: 2240 }, (_, i) => r.row(i));
    const { client, calls } = recordingClient({ rows: (t) => (t === r.table ? rows : []) });
    const db = supabaseIngestDb(client);
    const all = await readAll((f, t) => r.read(db, f, t));
    assertEquals(all.length, 2240);
    assertEquals(calls.length, 3);
    for (const c of calls) {
      assertEquals(c.table, r.table);
      assert(c.range && c.range[1] - c.range[0] + 1 <= INGEST.readPage, `range ${c.range}`);
      assertEquals(c.eq, r.eq);
      assertEquals(c.order.map(([col]) => col), r.order);
      for (const [, options] of c.order) assertEquals((options as { ascending?: boolean })?.ascending, true);
    }
    assertEquals(calls.map((c) => c.range), [[0, 999], [1000, 1999], [2000, 2999]]);
  });

  Deno.test(`${r.name} refuses a range wider than 1,000 rows before querying`, async () => {
    const { client, calls } = recordingClient();
    await assertRejects(() => r.read(supabaseIngestDb(client), 0, 1000), Error, 'range');
    assertEquals(calls.length, 0);
  });
}

Deno.test('ocrPageNumbers returns plain numbers and ocrPages returns {page_number, raw}', async () => {
  const { client } = recordingClient({ rows: () => [{ page_number: 3, raw: { index: 2 } }] });
  const db = supabaseIngestDb(client);
  assertEquals(await db.ocrPageNumbers(DOC, OCR, 0, 999), [3]);
  assertEquals(await db.ocrPages(DOC, OCR, 0, 999), [{ page_number: 3, raw: { index: 2 } as never }]);
});

// ─── Writes ──────────────────────────────────────────────────────────────────

Deno.test('upsertOcrPages writes {document_id, ocr_hash, page_number, raw} on the table unique key', async () => {
  const { client, calls } = recordingClient();
  const raw = { index: 0 } as never;
  await supabaseIngestDb(client).upsertOcrPages(DOC, OCR, [{ page_number: 1, raw }]);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].table, 'document_ocr_pages');
  assertEquals(calls[0].upsert, [{ document_id: DOC, ocr_hash: OCR, page_number: 1, raw }]);
  assertEquals(calls[0].upsertOptions?.onConflict, 'document_id,ocr_hash,page_number');
});

Deno.test('upserts use each page-contract table unique key', async () => {
  const { client, calls } = recordingClient();
  const db = supabaseIngestDb(client);
  await db.upsertPages([{ page_number: 1 }] as never);
  await db.upsertBlocks([{ block_index: 0 }] as never);
  await db.upsertImages([{ placeholder: 'img:1-1' }] as never);
  assertEquals(calls.map((c) => [c.table, c.upsertOptions?.onConflict]), [
    ['document_pages', 'document_id,extract_hash,page_number'],
    ['document_page_blocks', 'document_id,extract_hash,page_number,block_index'],
    ['document_page_images', 'document_id,extract_hash,placeholder'],
  ]);
});

Deno.test('an empty upsert makes no request', async () => {
  const { client, calls } = recordingClient();
  const db = supabaseIngestDb(client);
  await db.upsertOcrPages(DOC, OCR, []);
  await db.upsertPages([]);
  assertEquals(calls.length, 0);
});

Deno.test('logCall inserts the row into model_call_logs', async () => {
  const { client, calls } = recordingClient();
  const row = { caller: 'ingest-worker', purpose: 'ocr', cost_usd: 0 } as unknown as IngestCallLog;
  await supabaseIngestDb(client).logCall(row);
  assertEquals(calls.map((c) => [c.table, c.insert]), [['model_call_logs', row]]);
});

// ─── Storage ─────────────────────────────────────────────────────────────────

type StorageError = { message: string; status?: number; statusCode?: string; code?: string } | null;

function fakeStorage(
  opts: {
    upload?: StorageError;
    exists?: { data: boolean; error: StorageError };
    signed?: { data: { signedUrl: string } | null; error: StorageError };
  },
) {
  const calls: Array<{ bucket: string; op: string; args: unknown[] }> = [];
  const client = {
    storage: {
      from(bucket: string) {
        return {
          upload: (
            ...args: unknown[]
          ) => (calls.push({ bucket, op: 'upload', args }),
            Promise.resolve({ data: opts.upload ? null : { path: args[0] }, error: opts.upload ?? null })),
          exists: (
            ...args: unknown[]
          ) => (calls.push({ bucket, op: 'exists', args }),
            Promise.resolve(opts.exists ?? { data: true, error: null })),
          createSignedUrl: (
            ...args: unknown[]
          ) => (calls.push({ bucket, op: 'createSignedUrl', args }),
            Promise.resolve(opts.signed ?? { data: null, error: { message: 'no' } })),
        };
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

Deno.test('upload goes to the corpus bucket without overwriting, with the content type', async () => {
  const { client, calls } = fakeStorage({});
  const bytes = new Uint8Array([1, 2, 3]);
  await supabaseIngestStorage(client).upload('img/x.png', bytes, 'image/png');
  assertEquals(calls, [{
    bucket: CORPUS_BUCKET,
    op: 'upload',
    args: ['img/x.png', bytes, { upsert: false, contentType: 'image/png' }],
  }]);
});

Deno.test('upload treats "already exists" as success, in each shape Storage reports it', async () => {
  for (
    const error of [
      { message: 'The resource already exists', statusCode: '409', status: 400 },
      { message: 'Duplicate', status: 409 },
      { message: 'x', code: 'ResourceAlreadyExists', status: 400 },
    ]
  ) {
    const { client } = fakeStorage({ upload: error });
    await supabaseIngestStorage(client).upload('img/x.png', new Uint8Array(), 'image/png');
  }
});

Deno.test('upload rethrows any other storage error', async () => {
  const { client } = fakeStorage({ upload: { message: 'payload too large', statusCode: '413', status: 413 } });
  await assertRejects(
    () => supabaseIngestStorage(client).upload('img/x.png', new Uint8Array(), 'image/png'),
    Error,
    'storage upload',
  );
});

Deno.test('exists uses the storage exists check: true, false on not found, throws otherwise', async () => {
  assert(await supabaseIngestStorage(fakeStorage({ exists: { data: true, error: null } }).client).exists('img/a.png'));
  assertFalse(
    await supabaseIngestStorage(
      fakeStorage({ exists: { data: false, error: { message: 'not found', status: 404 } } }).client,
    ).exists('img/a.png'),
  );
  assertFalse(
    await supabaseIngestStorage(fakeStorage({ exists: { data: false, error: { message: 'bad', status: 400 } } }).client)
      .exists('img/a.png'),
  );
  await assertRejects(
    () =>
      supabaseIngestStorage(fakeStorage({ exists: { data: false, error: { message: 'down', status: 503 } } }).client)
        .exists('img/a.png'),
    Error,
    'storage exists',
  );
});

Deno.test('signedUrl returns the signed URL; a failure throws without any URL in the message', async () => {
  const url = 'https://ref.supabase.co/storage/v1/object/sign/corpus/files/a.pdf?token=secret-token';
  const ok = fakeStorage({ signed: { data: { signedUrl: url }, error: null } });
  assertEquals(await supabaseIngestStorage(ok.client).signedUrl('files/a.pdf', 600), url);
  assertEquals(ok.calls[0].args, ['files/a.pdf', 600]);
  const bad = fakeStorage({ signed: { data: null, error: { message: 'Object not found', status: 404 } } });
  const err = await assertRejects(
    () => supabaseIngestStorage(bad.client).signedUrl('files/a.pdf', 600),
    Error,
    'storage sign',
  );
  assertFalse(err.message.includes('token'));
});

// ─── The local-only URL override ─────────────────────────────────────────────

const SHA = 'a'.repeat(64);
const OVERRIDE = 'https://sansad.in/getFile/bill.pdf';
const envWith = (vars: Record<string, string>) => (name: string) => vars[name];

Deno.test('the URL override is honoured for each local-stack SUPABASE_URL', () => {
  for (
    const url of [
      'http://localhost:54321',
      'http://127.0.0.1:54321',
      'http://[::1]:54321',
      'http://kong:8000',
      'http://host.docker.internal:54321',
      'http://api.localhost:54321',
    ]
  ) {
    assert(isLocalStackUrl(url), url);
    assertEquals(
      documentUrlOverride(url, envWith({ [`INGEST_DOCUMENT_URL_OVERRIDE_${SHA}`]: OVERRIDE }), SHA),
      OVERRIDE,
      url,
    );
  }
});

Deno.test('the URL override is ignored on a hosted SUPABASE_URL even when the variable is set', () => {
  let looked = 0;
  const env = (name: string) => (looked++, name === `INGEST_DOCUMENT_URL_OVERRIDE_${SHA}` ? OVERRIDE : undefined);
  for (
    const url of [
      'https://abcdefghijklmnop.supabase.co',
      'https://localhost.example.com',
      'https://kong.example.com',
      'https://example.com/localhost',
      'http://127.0.0.2:54321',
      '',
      undefined,
      'not a url',
    ]
  ) {
    assertFalse(isLocalStackUrl(url), String(url));
    assertEquals(documentUrlOverride(url, env, SHA), null, String(url));
  }
  assertEquals(looked, 0, 'the variable is not even read off-localhost');
});

Deno.test('the URL override is null when unset, and never looked up for a malformed hash', () => {
  assertEquals(documentUrlOverride('http://localhost:54321', envWith({}), SHA), null);
  assertEquals(
    documentUrlOverride('http://localhost:54321', envWith({ INGEST_DOCUMENT_URL_OVERRIDE_: OVERRIDE }), ''),
    null,
  );
  assertEquals(
    documentUrlOverride('http://localhost:54321', envWith({ ['INGEST_DOCUMENT_URL_OVERRIDE_X']: OVERRIDE }), 'X'),
    null,
  );
});

Deno.test('the URL override must itself be an http(s) URL', () => {
  const url = 'http://localhost:54321';
  assertEquals(
    documentUrlOverride(url, envWith({ [`INGEST_DOCUMENT_URL_OVERRIDE_${SHA}`]: 'file:///etc/passwd' }), SHA),
    null,
  );
  assertEquals(documentUrlOverride(url, envWith({ [`INGEST_DOCUMENT_URL_OVERRIDE_${SHA}`]: 'not a url' }), SHA), null);
});

// ─── Assembly ────────────────────────────────────────────────────────────────

Deno.test('buildWorkerDeps wires the override to SUPABASE_URL and lists the secrets for redaction', () => {
  const { client } = recordingClient();
  const env = envWith({
    SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
    MISTRAL_API_KEY: 'mistral-key-value',
    OPENROUTER_API_KEY: 'openrouter-key-value',
    INGEST_WORKER_SECRET: 'worker-secret-value',
    [`INGEST_DOCUMENT_URL_OVERRIDE_${SHA}`]: OVERRIDE,
  });
  const deps = buildWorkerDeps(client, env);
  assertEquals(deps.documentUrlOverride(SHA), null);
  assertEquals(new Set(deps.secrets), new Set(['mistral-key-value', 'openrouter-key-value', 'worker-secret-value']));
  assertEquals(typeof deps.steps.ocr, 'function');
  assertEquals(typeof deps.steps.index, 'function');

  const local = buildWorkerDeps(client, (n) => (n === 'SUPABASE_URL' ? 'http://kong:8000' : env(n)));
  assertEquals(local.documentUrlOverride(SHA), OVERRIDE);
});
