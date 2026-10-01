import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  createAdminIngestHandler,
  objectFetcher,
  platformAdmin,
  READ_PAGE,
  supabaseAdminDb,
  supabaseAdminStorage,
  workerStarter,
} from './index.ts';

// ─── A recording supabase-js stand-in ────────────────────────────────────────

type Call = [string, ...unknown[]];

interface Recorded {
  table?: string;
  rpc?: string;
  args?: unknown;
  calls: Call[];
}

/** Every builder method is recorded; awaiting the builder (or maybeSingle) yields `result(recorded)`. */
function recordingClient(result: (r: Recorded) => { data: unknown; error: unknown }) {
  const log: Recorded[] = [];
  const builder = (r: Recorded) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'lt', 'gt', 'not', 'order', 'limit', 'range', 'abortSignal']) {
      b[m] = (...a: unknown[]) => {
        r.calls.push([m, ...a]);
        return b;
      };
    }
    b.maybeSingle = () => {
      r.calls.push(['maybeSingle']);
      return Promise.resolve(result(r));
    };
    b.then = (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(result(r)).then(ok, no);
    return b;
  };
  const client = {
    from(table: string) {
      const r: Recorded = { table, calls: [] };
      log.push(r);
      return builder(r);
    },
    rpc(name: string, args?: unknown) {
      const r: Recorded = { rpc: name, args, calls: [] };
      log.push(r);
      return builder(r);
    },
  };
  return { client: client as unknown as SupabaseClient, log };
}

const SHA = 'a'.repeat(64);
const STAGED = 'staging/44444444-4444-4444-8444-444444444444.pdf';

function rangeOf(r: Recorded): [number, number] | undefined {
  const c = r.calls.find((c) => c[0] === 'range');
  return c ? [c[1] as number, c[2] as number] : undefined;
}

// ─── Database ────────────────────────────────────────────────────────────────

Deno.test('documentsBySha reads one bounded page with each document latest job', async () => {
  const { client, log } = recordingClient(() => ({
    data: [
      {
        id: 'd1',
        source_key: 'upload:x',
        title: 'T1',
        indexed_at: '2026-10-01T00:00:00Z',
        ingest_jobs: [{ status: 'succeeded' }],
      },
      { id: 'd2', source_key: 'corpus:y', title: 'T2', indexed_at: null, ingest_jobs: [] },
    ],
    error: null,
  }));
  const docs = await supabaseAdminDb(() => client).documentsBySha(SHA);
  assertEquals(docs, [
    { document_id: 'd1', source_key: 'upload:x', title: 'T1', indexed: true, job_status: 'succeeded' },
    { document_id: 'd2', source_key: 'corpus:y', title: 'T2', indexed: false, job_status: null },
  ]);
  const r = log[0];
  assertEquals(r.table, 'documents');
  assertEquals(r.calls[0], ['select', 'id, source_key, title, indexed_at, ingest_jobs(status, created_at)']);
  assert(r.calls.some((c) => c[0] === 'eq' && c[1] === 'file_sha256' && c[2] === SHA));
  assert(
    r.calls.some((c) =>
      c[0] === 'order' && c[1] === 'created_at' &&
      JSON.stringify(c[2]) === JSON.stringify({ ascending: false, referencedTable: 'ingest_jobs' })
    ),
  );
  assert(
    r.calls.some((c) =>
      c[0] === 'limit' && c[1] === 1 && JSON.stringify(c[2]) === JSON.stringify({ referencedTable: 'ingest_jobs' })
    ),
  );
  const [from, to] = rangeOf(r)!;
  assert(to - from + 1 <= READ_PAGE);
});

Deno.test('a database error is thrown, not returned as an empty list', async () => {
  const { client } = recordingClient(() => ({ data: null, error: { message: 'permission denied' } }));
  const db = supabaseAdminDb(() => client);
  await assertRejects(() => db.documentsBySha(SHA), Error, 'permission denied');
  await assertRejects(() => db.documentModules(), Error, 'permission denied');
  await assertRejects(() => db.jobs(5, null), Error, 'permission denied');
  await assertRejects(() => db.emails(['u']), Error, 'permission denied');
});

Deno.test('documentModules calls document_modules() and keeps well-formed pairs verbatim', async () => {
  const { client, log } = recordingClient(() => ({
    data: [
      { desk_tier: 'national', desk_feature: 'Regulatory Body Watch (RBI / SEBI / TRAI / CCI)' },
      { desk_tier: 'national', desk_feature: null },
      { desk_tier: 3, desk_feature: 'x' },
    ],
    error: null,
  }));
  assertEquals(await supabaseAdminDb(() => client).documentModules(), [
    { desk_tier: 'national', desk_feature: 'Regulatory Body Watch (RBI / SEBI / TRAI / CCI)' },
  ]);
  assertEquals(log[0].rpc, 'document_modules');
});

Deno.test('register calls ingest_register with {p} and hands back a refusal as a value', async () => {
  const p = { source_key: 'upload:x' } as never;
  const ok = recordingClient(() => ({
    data: { document_id: 'd', job_id: 'j', status: 'queued', resumed: false },
    error: null,
  }));
  assertEquals(await supabaseAdminDb(() => ok.client).register(p), {
    data: { document_id: 'd', job_id: 'j' },
    error: null,
  });
  assertEquals(ok.log[0].rpc, 'ingest_register');
  assertEquals(ok.log[0].args, { p });
  const refused = recordingClient(() => ({
    data: null,
    error: { message: 'ingest_register: parts cover 1 pages, page_count is 2', code: 'P0001', details: null },
  }));
  assertEquals(await supabaseAdminDb(() => refused.client).register(p), {
    data: null,
    error: { message: 'ingest_register: parts cover 1 pages, page_count is 2', code: 'P0001' },
  });
});

Deno.test('jobs embeds the document, pages on created_at and flattens the row', async () => {
  const { client, log } = recordingClient(() => ({
    data: [{
      id: 'j1',
      document_id: 'd1',
      status: 'failed',
      stage: 'ocr',
      ocr_pages: 3,
      pages_total: 10,
      attempts: 2,
      next_attempt_at: null,
      error_code: 'mistral_4xx',
      last_error: 'bad file',
      ocr_cost_usd: '0.012',
      embed_tokens: 0,
      embed_cost_usd: 0,
      requested_by: 'u1',
      created_at: '2026-10-01T10:00:00.5+00:00',
      finished_at: null,
      documents: {
        title: 'T',
        source_key: 'upload:x',
        desk_tier: 'national',
        desk_feature: 'Cabinet Decisions',
        indexed_at: null,
        document_key: 'bill:2025:XLV',
      },
    }],
    error: null,
  }));
  const rows = await supabaseAdminDb(() => client).jobs(21, '2026-10-01T11:00:00Z');
  assertEquals(rows[0], {
    job_id: 'j1',
    document_id: 'd1',
    title: 'T',
    source_key: 'upload:x',
    desk_tier: 'national',
    desk_feature: 'Cabinet Decisions',
    indexed: false,
    document_key: 'bill:2025:XLV',
    status: 'failed',
    stage: 'ocr',
    ocr_pages: 3,
    pages_total: 10,
    attempts: 2,
    next_attempt_at: null,
    error_code: 'mistral_4xx',
    last_error: 'bad file',
    ocr_cost_usd: 0.012,
    embed_tokens: 0,
    embed_cost_usd: 0,
    requested_by: 'u1',
    created_at: '2026-10-01T10:00:00.5+00:00',
    finished_at: null,
  });
  const r = log[0];
  assertEquals(r.table, 'ingest_jobs');
  assert(String(r.calls[0][1]).includes('documents(title, source_key, desk_tier, desk_feature, indexed_at, document_key:metadata->>document_key)'));
  assert(r.calls.some((c) => c[0] === 'lt' && c[1] === 'created_at' && c[2] === '2026-10-01T11:00:00Z'));
  assertEquals(
    r.calls.filter((c) => c[0] === 'order').map((c) => [c[1], c[2]]),
    [['created_at', { ascending: false }], ['id', { ascending: false }]],
  );
  assertEquals(rangeOf(r), [0, 20]);
});

Deno.test('jobs without a cursor has no created_at filter, and refuses a page wider than PostgREST max rows', async () => {
  const { client, log } = recordingClient(() => ({ data: [], error: null }));
  const db = supabaseAdminDb(() => client);
  await db.jobs(21, null);
  assertEquals(log[0].calls.filter((c) => c[0] === 'lt'), []);
  await assertRejects(() => db.jobs(READ_PAGE + 1, null), Error, 'at most');
  await assertRejects(() => db.emails(Array.from({ length: READ_PAGE + 1 }, (_, i) => `u${i}`)), Error, 'at most');
  assertEquals(log.length, 1);
});

Deno.test('emails come from user_profiles for exactly the ids asked', async () => {
  const { client, log } = recordingClient(() => ({
    data: [{ user_id: 'u1', email: 'a@example.org' }, { user_id: 'u2', email: null }],
    error: null,
  }));
  assertEquals(await supabaseAdminDb(() => client).emails(['u1', 'u2']), { u1: 'a@example.org' });
  assertEquals(log[0].table, 'user_profiles');
  assertEquals(log[0].calls[0], ['select', 'user_id, email']);
  assert(log[0].calls.some((c) => c[0] === 'in' && c[1] === 'user_id' && JSON.stringify(c[2]) === '["u1","u2"]'));
  assertEquals(rangeOf(log[0]), [0, 1]);
});

Deno.test('retry, cancel and discard call their RPCs with the right argument names', async () => {
  const { client, log } = recordingClient((r) =>
    r.rpc === 'ingest_discard'
      ? { data: null, error: { message: 'ingest_discard: already live' } }
      : { data: { status: 'queued', stage: 'ocr', extra: 1 }, error: null }
  );
  const db = supabaseAdminDb(() => client);
  assertEquals(await db.retry('j'), { data: { status: 'queued', stage: 'ocr' }, error: null });
  assertEquals(await db.cancel('j'), { data: { status: 'queued', stage: 'ocr' }, error: null });
  assertEquals(await db.discard('d', 'u'), {
    data: null,
    error: { message: 'ingest_discard: already live', code: undefined },
  });
  assertEquals(log.map((r) => [r.rpc, r.args]), [
    ['ingest_retry', { p_job: 'j' }],
    ['ingest_cancel', { p_job: 'j' }],
    ['ingest_discard', { p_document: 'd', p_actor: 'u' }],
  ]);
});

// ─── Amendment A ─────────────────────────────────────────────────────────────

Deno.test('records and unlinked call their read functions with the p_ argument names', async () => {
  const records = { records: [], total: 0, coverage: { keys: 1, full_text: 0, orphaned: 0 } };
  const unlinked = { documents: [], total: 0 };
  const { client, log } = recordingClient((r) => ({
    data: r.rpc === 'admin_desk_records' ? records : unlinked,
    error: null,
  }));
  const db = supabaseAdminDb(() => client);
  const q = { tier: 'national', feature: 'Bill Passage Probability Index', query: 'finance', limit: 20, offset: 40 };
  assertEquals(await db.records({ ...q, status: 'record_only' }), { data: records, error: null });
  assertEquals(await db.unlinked(q), { data: unlinked, error: null });
  assertEquals(log.map((r) => [r.rpc, r.args]), [
    ['admin_desk_records', {
      p_tier: 'national',
      p_feature: 'Bill Passage Probability Index',
      p_query: 'finance',
      p_status: 'record_only',
      p_limit: 20,
      p_offset: 40,
    }],
    ['admin_unlinked_documents', {
      p_tier: 'national',
      p_feature: 'Bill Passage Probability Index',
      p_query: 'finance',
      p_limit: 20,
      p_offset: 40,
    }],
  ]);
  // A missing or malformed answer is an error, not an empty page.
  const empty = recordingClient(() => ({ data: null, error: null }));
  assert((await supabaseAdminDb(() => empty.client).records({ ...q, status: null })).error);
  assert((await supabaseAdminDb(() => empty.client).unlinked(q)).error);
});

Deno.test('link, unlink, swap and delete call their SQL functions with p_actor and hand back refusals', async () => {
  const { client, log } = recordingClient((r) => {
    if (r.rpc === 'ingest_link') return { data: { document_id: 'd', document_key: 'k', extra: 1 }, error: null };
    if (r.rpc === 'ingest_unlink') return { data: { document_id: 'd', document_key: null }, error: null };
    if (r.rpc === 'ingest_swap') {
      return { data: { document_id: 'd', document_key: 'k', old_document_id: null }, error: null };
    }
    return {
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "documents_v2_document_key_unique"',
        details: "Key ((metadata ->> 'document_key'::text))=(k) already exists.",
        hint: null,
      },
    };
  });
  const db = supabaseAdminDb(() => client);
  assertEquals(await db.link('d', 'k', null, 'u'), { data: { document_id: 'd', document_key: 'k' }, error: null });
  assertEquals(await db.unlink('d', 'k', 'u'), { data: { document_id: 'd', document_key: null }, error: null });
  assertEquals(await db.swap('d', null, 'u'), {
    data: { document_id: 'd', document_key: 'k', old_document_id: null },
    error: null,
  });
  assertEquals(await db.deleteDocument('d', 'u'), {
    data: null,
    error: {
      code: '23505',
      message: 'duplicate key value violates unique constraint "documents_v2_document_key_unique"',
      details: "Key ((metadata ->> 'document_key'::text))=(k) already exists.",
    },
  });
  assertEquals(log.map((r) => [r.rpc, r.args]), [
    ['ingest_link', { p_document: 'd', p_key: 'k', p_expected_key: null, p_actor: 'u' }],
    ['ingest_unlink', { p_document: 'd', p_expected_key: 'k', p_actor: 'u' }],
    ['ingest_swap', { p_new: 'd', p_expected_old: null, p_actor: 'u' }],
    ['ingest_delete', { p_document: 'd', p_actor: 'u' }],
  ]);
});

Deno.test('keyHolder reads one document by key, ingestion-v2 and indexed first', async () => {
  const { client, log } = recordingClient(() => ({
    data: [{ id: 'd1', title: 'Bill', storage_path: null, indexed_at: '2026-01-01T00:00:00Z' }],
    error: null,
  }));
  const db = supabaseAdminDb(() => client);
  assertEquals(await db.keyHolder('bill:2025:XLV'), { document_id: 'd1', title: 'Bill', legacy: true });
  const r = log[0];
  assertEquals(r.table, 'documents');
  assert(r.calls.some((c) => c[0] === 'eq' && c[1] === 'metadata->>document_key' && c[2] === 'bill:2025:XLV'));
  assertEquals(
    r.calls.filter((c) => c[0] === 'order').map((c) => [c[1], c[2]]),
    [
      ['storage_path', { ascending: true, nullsFirst: false }],
      ['indexed_at', { ascending: false, nullsFirst: false }],
      ['id', { ascending: true }],
    ],
  );
  assertEquals(rangeOf(r), [0, 0]);

  const v2 = recordingClient(() => ({
    data: [{ id: 'd2', title: 'New', storage_path: 'd2/x.pdf', indexed_at: null }],
    error: null,
  }));
  assertEquals(await supabaseAdminDb(() => v2.client).keyHolder('k'), {
    document_id: 'd2',
    title: 'New',
    legacy: false,
  });
  const none = recordingClient(() => ({ data: [], error: null }));
  assertEquals(await supabaseAdminDb(() => none.client).keyHolder('k'), null);
  const down = recordingClient(() => ({ data: null, error: { message: 'down' } }));
  await assertRejects(() => supabaseAdminDb(() => down.client).keyHolder('k'), Error, 'down');
});

Deno.test('deskSourceUrls reads distinct source URLs a page at a time, skipping past each page', async () => {
  // 1,000 rows of the hub, then a page with one more URL: two reads, the second after the first's last value.
  const pages = [
    Array.from({ length: READ_PAGE }, () => ({ source_url: 'https://sansad.in/ls/legislation/bills' })),
    [{ source_url: 'https://sansad.in/rs/legislation/bills' }, { source_url: '' }],
  ];
  let n = 0;
  const { client, log } = recordingClient(() => ({ data: pages[n++] ?? [], error: null }));
  const urls = await supabaseAdminDb(() => client).deskSourceUrls('national', 'Bill Passage Probability Index');
  assertEquals(urls, ['https://sansad.in/ls/legislation/bills', 'https://sansad.in/rs/legislation/bills']);
  assertEquals(log.length, 2);
  for (const r of log) {
    assertEquals(r.table, 'desk_rows');
    assertEquals(r.calls[0], ['select', 'source_url:row->>source_url']);
    assert(r.calls.some((c) => c[0] === 'eq' && c[1] === 'tier' && c[2] === 'national'));
    assert(r.calls.some((c) => c[0] === 'eq' && c[1] === 'feature' && c[2] === 'Bill Passage Probability Index'));
    assert(r.calls.some((c) => c[0] === 'not' && c[1] === 'row->>source_url' && c[2] === 'is' && c[3] === null));
    assert(r.calls.some((c) => c[0] === 'order' && c[1] === 'row->>source_url'));
    assertEquals(rangeOf(r), [0, READ_PAGE - 1]);
  }
  assertEquals(log[0].calls.filter((c) => c[0] === 'gt'), []);
  assertEquals(log[1].calls.filter((c) => c[0] === 'gt'), [[
    'gt',
    'row->>source_url',
    'https://sansad.in/ls/legislation/bills',
  ]]);

  const down = recordingClient(() => ({ data: null, error: { message: 'down' } }));
  await assertRejects(() => supabaseAdminDb(() => down.client).deskSourceUrls('t', 'f'), Error, 'down');
});

Deno.test('deskSourceUrls stops with an error rather than read without bound', async () => {
  let n = 0;
  const { client, log } = recordingClient(() => ({
    data: Array.from({ length: READ_PAGE }, (_, i) => ({ source_url: `https://x/${String(n).padStart(4, '0')}/${i}` })),
    error: null,
  }));
  const counting = { ...client, from: (t: string) => (n++, client.from(t)) } as unknown as SupabaseClient;
  await assertRejects(() => supabaseAdminDb(() => counting).deskSourceUrls('t', 'f'), Error, 'source URLs');
  assert(log.length <= 20, `read ${log.length} pages`);
});

Deno.test('documentIdBySourceKey reads one row by key', async () => {
  const { client, log } = recordingClient(() => ({ data: { id: 'd9' }, error: null }));
  assertEquals(await supabaseAdminDb(() => client).documentIdBySourceKey('upload:x'), 'd9');
  assert(log[0].calls.some((c) => c[0] === 'eq' && c[1] === 'source_key' && c[2] === 'upload:x'));
});

// ─── Storage ─────────────────────────────────────────────────────────────────

interface StorageCall {
  op: string;
  args: unknown[];
}

function fakeStorageClient(answers: Partial<Record<string, (...a: unknown[]) => unknown>> = {}) {
  const calls: StorageCall[] = [];
  const bucketNames: string[] = [];
  const op = (name: string, fallback: (...a: unknown[]) => unknown) => (...args: unknown[]) => {
    calls.push({ op: name, args });
    return Promise.resolve((answers[name] ?? fallback)(...args));
  };
  const client = {
    storage: {
      from(bucket: string) {
        bucketNames.push(bucket);
        return {
          exists: op('exists', () => ({ data: false, error: { status: 400, message: 'not found' } })),
          createSignedUploadUrl: op('createSignedUploadUrl', (path) => ({
            data: { signedUrl: `https://x/upload/sign/${path}?token=tok`, token: 'tok', path },
            error: null,
          })),
          info: op('info', () => ({ data: { size: 10 }, error: null })),
          move: op('move', () => ({ data: { message: 'ok' }, error: null })),
          remove: op('remove', () => ({ data: [], error: null })),
        };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, calls, bucketNames };
}

const noFetch = () => Promise.reject(new Error('no fetch expected'));

Deno.test('exists reads 400/404 as absent and throws on anything else', async () => {
  const yes = fakeStorageClient({ exists: () => ({ data: true, error: null }) });
  assertEquals(await supabaseAdminStorage(() => yes.client, noFetch).exists(`files/${SHA}.pdf`), true);
  assertEquals(yes.bucketNames, ['corpus']);
  const no = fakeStorageClient({
    exists: () => ({ data: false, error: { statusCode: '404', message: 'Object not found' } }),
  });
  assertEquals(await supabaseAdminStorage(() => no.client, noFetch).exists(`files/${SHA}.pdf`), false);
  const down = fakeStorageClient({ exists: () => ({ data: false, error: { status: 500, message: 'boom' } }) });
  await assertRejects(() => supabaseAdminStorage(() => down.client, noFetch).exists(`files/${SHA}.pdf`), Error, 'boom');
});

Deno.test('signUpload signs a staging path only, without upsert, and returns just the token', async () => {
  const s = fakeStorageClient();
  const storage = supabaseAdminStorage(() => s.client, noFetch);
  assertEquals(await storage.signUpload(STAGED), { token: 'tok' });
  assertEquals(s.calls, [{ op: 'createSignedUploadUrl', args: [STAGED] }]);
  await assertRejects(() => storage.signUpload(`files/${SHA}.pdf`), Error, 'staging');
  assertEquals(s.calls.length, 1);
});

Deno.test('open reports the metadata size and streams the object only when asked', async () => {
  const s = fakeStorageClient({ info: () => ({ data: { size: 3 }, error: null }) });
  const fetched: string[] = [];
  const storage = supabaseAdminStorage(() => s.client, (path) => {
    fetched.push(path);
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  });
  const staged = await storage.open(STAGED);
  assertEquals(staged?.size, 3);
  assertEquals(fetched, []);
  const bytes = new Uint8Array(await new Response(await staged!.stream()).arrayBuffer());
  assertEquals([...bytes], [1, 2, 3]);
  assertEquals(fetched, [STAGED]);

  const missing = fakeStorageClient({
    info: () => ({ data: null, error: { status: 404, message: 'Object not found' } }),
  });
  assertEquals(await supabaseAdminStorage(() => missing.client, noFetch).open(STAGED), null);

  const failing = supabaseAdminStorage(() => s.client, () => Promise.resolve(new Response('no', { status: 500 })));
  await assertRejects(async () => await (await failing.open(STAGED))!.stream(), Error, '500');
  await assertRejects(() => storage.open(`files/${SHA}.pdf`), Error, 'staging');
});

Deno.test('move goes only from staging/ to files/<sha>.pdf, and a taken destination is "exists"', async () => {
  const s = fakeStorageClient();
  const storage = supabaseAdminStorage(() => s.client, noFetch);
  assertEquals(await storage.move(STAGED, `files/${SHA}.pdf`), 'moved');
  assertEquals(s.calls, [{ op: 'move', args: [STAGED, `files/${SHA}.pdf`] }]);
  await assertRejects(() => storage.move(`files/${SHA}.pdf`, `files/${'b'.repeat(64)}.pdf`), Error, 'staging');
  await assertRejects(() => storage.move(STAGED, 'files/other.pdf'), Error, 'files/');
  assertEquals(s.calls.length, 1);

  for (
    const error of [{ status: 409, message: 'x' }, { statusCode: '409', message: 'Duplicate' }, {
      message: 'The resource already exists',
    }]
  ) {
    const taken = fakeStorageClient({ move: () => ({ data: null, error }) });
    assertEquals(await supabaseAdminStorage(() => taken.client, noFetch).move(STAGED, `files/${SHA}.pdf`), 'exists');
  }
  const down = fakeStorageClient({ move: () => ({ data: null, error: { status: 500, message: 'down' } }) });
  await assertRejects(
    () => supabaseAdminStorage(() => down.client, noFetch).move(STAGED, `files/${SHA}.pdf`),
    Error,
    'down',
  );
});

Deno.test('removeStaged deletes a staging object and refuses every other path without calling storage', async () => {
  const s = fakeStorageClient();
  const storage = supabaseAdminStorage(() => s.client, noFetch);
  await storage.removeStaged(STAGED);
  assertEquals(s.calls, [{ op: 'remove', args: [[STAGED]] }]);
  for (const path of [`files/${SHA}.pdf`, 'staging/', 'staging/../files/x.pdf', 'files/', '']) {
    await assertRejects(() => storage.removeStaged(path), Error, 'staging');
  }
  assertEquals(s.calls.length, 1);
  const down = fakeStorageClient({ remove: () => ({ data: null, error: { message: 'down' } }) });
  await assertRejects(() => supabaseAdminStorage(() => down.client, noFetch).removeStaged(STAGED), Error, 'down');
});

Deno.test('objectFetcher GETs a staging object from the corpus bucket with the secret key', async () => {
  const seen: Array<[string, Headers]> = [];
  const get = objectFetcher({
    fetch: (url, init) => {
      seen.push([String(url), new Headers(init?.headers)]);
      return Promise.resolve(new Response('x'));
    },
    url: 'https://ref.supabase.co',
    key: 'sb_secret_test',
  });
  await get(STAGED);
  assertEquals(seen[0][0], `https://ref.supabase.co/storage/v1/object/corpus/${STAGED}`);
  assertEquals(seen[0][1].get('apikey'), 'sb_secret_test');
  assertEquals(seen[0][1].get('authorization'), 'Bearer sb_secret_test');
  await assertRejects(() => get(`files/${SHA}.pdf`), Error, 'staging');
  assertEquals(seen.length, 1);
});

// ─── The worker, the admin check, the wiring ─────────────────────────────────

Deno.test('workerStarter POSTs to ingest-worker with the secret header', async () => {
  const seen: Array<[string, RequestInit | undefined]> = [];
  const start = workerStarter({
    fetch: (url, init) => {
      seen.push([String(url), init]);
      return Promise.resolve(new Response('{"accepted":true}', { status: 202 }));
    },
    url: 'https://ref.supabase.co',
    secret: 'worker-secret',
    timeoutMs: 1000,
  });
  await start();
  assertEquals(seen[0][0], 'https://ref.supabase.co/functions/v1/ingest-worker');
  assertEquals(seen[0][1]?.method, 'POST');
  assertEquals(new Headers(seen[0][1]?.headers).get('x-ingest-secret'), 'worker-secret');
});

Deno.test('workerStarter fails without a secret, on a non-2xx answer, and on its timeout', async () => {
  let calls = 0;
  await assertRejects(
    () =>
      workerStarter({
        fetch: () => (calls++, Promise.resolve(new Response())),
        url: 'https://r',
        secret: '',
        timeoutMs: 10,
      })(),
    Error,
    'INGEST_WORKER_SECRET',
  );
  assertEquals(calls, 0);
  await assertRejects(
    () =>
      workerStarter({
        fetch: () => Promise.resolve(new Response('no', { status: 401 })),
        url: 'https://r',
        secret: 's',
        timeoutMs: 10,
      })(),
    Error,
    '401',
  );
  const hang = (_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  await assertRejects(
    () => workerStarter({ fetch: hang, url: 'https://r', secret: 's', timeoutMs: 5 })(),
    Error,
    'aborted',
  );
});

Deno.test('platformAdmin asks is_platform_admin() with a client for the caller token', async () => {
  const tokens: string[] = [];
  const { client, log } = recordingClient(() => ({ data: true, error: null }));
  const isAdmin = platformAdmin((token) => (tokens.push(token), client));
  assertEquals(await isAdmin('caller.jwt.token'), true);
  assertEquals(tokens, ['caller.jwt.token']);
  assertEquals(log[0].rpc, 'is_platform_admin');
  const no = recordingClient(() => ({ data: false, error: null }));
  assertEquals(await platformAdmin(() => no.client)('t.t.t'), false);
  const down = recordingClient(() => ({ data: null, error: { message: 'down' } }));
  await assertRejects(() => platformAdmin(() => down.client)('t.t.t'), Error, 'down');
});

Deno.test('the served handler answers preflight and 401 without creating the service client', async () => {
  let service = 0;
  const handler = createAdminIngestHandler({
    serviceClient: () => {
      service++;
      throw new Error('no service client expected');
    },
    env: () => undefined,
  });
  const pre = await handler(
    new Request('https://f/admin-ingest', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }),
  );
  assertEquals(pre.status, 204);
  const res = await handler(
    new Request('https://f/admin-ingest', { method: 'POST', headers: { origin: 'http://localhost:5173' }, body: '{}' }),
  );
  assertEquals(res.status, 401);
  assertEquals(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assertEquals(service, 0);
});
