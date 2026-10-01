import { assert, assertEquals, assertFalse, assertMatch } from 'jsr:@std/assert@1';
import { createHash } from 'node:crypto';
import { LIMITS, STAGING_PATH } from './contract.ts';
import {
  type AdminIngestDeps,
  type DbResult,
  handleAdminIngest,
  type Hasher,
  type KeyHolder,
  type LinkData,
  moduleName,
  type RawJobRow,
  type RecordsData,
  type RegisterPayload,
  type SwapData,
  type UnlinkedData,
  urlIdentity,
} from './handler.ts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORIGIN = 'http://localhost:5173';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.caller-secret-payload.signature';
const JOB = '22222222-2222-4222-8222-222222222222';
const DOC = '33333333-3333-4333-8333-333333333333';
const STAGED = 'staging/44444444-4444-4444-8444-444444444444.pdf';

const hex = (n: number) => n.toString(16).padStart(2, '0');
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...digest].map(hex).join('');
}
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_F = 'f'.repeat(64);

function bytesOf(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

interface World {
  objects: Map<string, Uint8Array>;
  /** Overrides the metadata size reported for a path. */
  metaSize: Map<string, number>;
  /** Extra bytes the stream yields beyond the object (a lying metadata size). */
  trailing: Map<string, number>;
  chunkSize: number;
  pulls: number;
  opened: string[];
  streamed: string[];
  removed: string[];
  moved: Array<[string, string]>;
  signed: string[];
  existsChecks: string[];
  /** Destinations that appear only when move() runs (a concurrent verify won). */
  raceOnMove: Set<string>;
  rpc: Array<{ name: string; args: unknown }>;
  modulesRead: number;
  workerStarts: number;
  isAdminCalls: string[];
  logs: string[];
}

function world(): World {
  return {
    objects: new Map(),
    metaSize: new Map(),
    trailing: new Map(),
    chunkSize: 1024,
    pulls: 0,
    opened: [],
    streamed: [],
    removed: [],
    moved: [],
    signed: [],
    existsChecks: [],
    raceOnMove: new Set(),
    rpc: [],
    modulesRead: 0,
    workerStarts: 0,
    isAdminCalls: [],
    logs: [],
  };
}

function chunked(w: World, bytes: Uint8Array): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      w.pulls++;
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + w.chunkSize));
      at += w.chunkSize;
    },
  });
}

/** Every storage or database touch is recorded in the world; `touched` sums them. */
function touched(w: World): number {
  return w.opened.length + w.removed.length + w.moved.length + w.signed.length + w.existsChecks.length +
    w.rpc.length + w.modulesRead + w.workerStarts;
}

interface Over {
  verify?: AdminIngestDeps['verify'];
  isAdmin?: boolean | Error;
  documents?: Array<
    { document_id: string; source_key: string; title: string; indexed: boolean; job_status: string | null }
  >;
  modules?: Array<{ desk_tier: string; desk_feature: string }>;
  register?: DbResult<{ document_id: string; job_id: string }>;
  existingId?: string | null;
  jobs?: RawJobRow[];
  emails?: Record<string, string>;
  retry?: DbResult<{ status: string; stage: string }>;
  cancel?: DbResult<{ status: string; stage: string }>;
  discard?: DbResult<unknown>;
  keyHolder?: KeyHolder | null;
  sourceUrls?: string[];
  records?: DbResult<RecordsData>;
  unlinked?: DbResult<UnlinkedData>;
  link?: DbResult<LinkData>;
  unlink?: DbResult<LinkData>;
  swap?: DbResult<SwapData>;
  del?: DbResult<unknown>;
  startWorker?: () => Promise<void>;
  hasher?: () => Hasher;
}

function deps(w: World, over: Over = {}): AdminIngestDeps {
  let uuid = 0;
  const call = <T>(name: string, args: unknown, result: T): Promise<T> => {
    w.rpc.push({ name, args });
    return Promise.resolve(result);
  };
  return {
    verify: over.verify ?? ((token) => Promise.resolve(token === TOKEN ? { id: ADMIN } : null)),
    isAdmin: (token) => {
      w.isAdminCalls.push(token);
      if (over.isAdmin instanceof Error) return Promise.reject(over.isAdmin);
      return Promise.resolve(over.isAdmin ?? true);
    },
    db: {
      documentsBySha: (sha) => call('documentsBySha', sha, over.documents ?? []),
      documentIdBySourceKey: (key) => call('documentIdBySourceKey', key, over.existingId ?? null),
      documentModules: () => {
        w.modulesRead++;
        return Promise.resolve(over.modules ?? []);
      },
      register: (p) =>
        call('ingest_register', p, over.register ?? { data: { document_id: DOC, job_id: JOB }, error: null }),
      jobs: (limit, before) => call('jobs', { limit, before }, (over.jobs ?? []).slice(0, limit)),
      emails: (ids) =>
        call('emails', ids, Object.fromEntries(Object.entries(over.emails ?? {}).filter(([k]) => ids.includes(k)))),
      retry: (id) => call('ingest_retry', id, over.retry ?? { data: { status: 'queued', stage: 'ocr' }, error: null }),
      cancel: (id) =>
        call('ingest_cancel', id, over.cancel ?? { data: { status: 'cancelled', stage: 'ocr' }, error: null }),
      discard: (document, actor) =>
        call('ingest_discard', { document, actor }, over.discard ?? { data: { discarded: true }, error: null }),
      keyHolder: (key) => call('keyHolder', key, over.keyHolder ?? null),
      deskSourceUrls: (tier, feature) => call('deskSourceUrls', { tier, feature }, over.sourceUrls ?? []),
      records: (q) => call('admin_desk_records', q, over.records ?? { data: RECORDS_DATA, error: null }),
      unlinked: (q) => call('admin_unlinked_documents', q, over.unlinked ?? { data: UNLINKED_DATA, error: null }),
      link: (document, key, expected, actor) =>
        call(
          'ingest_link',
          { document, key, expected, actor },
          over.link ?? {
            data: { document_id: document, document_key: key },
            error: null,
          },
        ),
      unlink: (document, expected, actor) =>
        call(
          'ingest_unlink',
          { document, expected, actor },
          over.unlink ?? {
            data: { document_id: document, document_key: null },
            error: null,
          },
        ),
      swap: (document, expected, actor) =>
        call(
          'ingest_swap',
          { document, expected, actor },
          over.swap ?? {
            data: { document_id: document, document_key: KEY, old_document_id: expected },
            error: null,
          },
        ),
      deleteDocument: (document, actor) =>
        call('ingest_delete', { document, actor }, over.del ?? { data: { deleted: true }, error: null }),
    },
    storage: {
      exists: (path) => {
        w.existsChecks.push(path);
        return Promise.resolve(w.objects.has(path));
      },
      signUpload: (path) => {
        w.signed.push(path);
        return Promise.resolve({ token: `signed-upload-token-${w.signed.length}` });
      },
      open: (path) => {
        w.opened.push(path);
        const bytes = w.objects.get(path);
        if (!bytes) return Promise.resolve(null);
        return Promise.resolve({
          size: w.metaSize.get(path) ?? bytes.length,
          stream: () => {
            w.streamed.push(path);
            const extra = w.trailing.get(path) ?? 0;
            const all = new Uint8Array(bytes.length + extra);
            all.set(bytes);
            return Promise.resolve(chunked(w, all));
          },
        });
      },
      move: (from, to) => {
        w.moved.push([from, to]);
        if (w.objects.has(to) || w.raceOnMove.has(to)) return Promise.resolve('exists' as const);
        w.objects.set(to, w.objects.get(from)!);
        w.objects.delete(from);
        return Promise.resolve('moved' as const);
      },
      removeStaged: (path) => {
        w.removed.push(path);
        w.objects.delete(path);
        return Promise.resolve();
      },
    },
    startWorker: over.startWorker ?? (() => {
      w.workerStarts++;
      return Promise.resolve();
    }),
    randomUUID: () => `44444444-4444-4444-8444-${String(++uuid).padStart(12, '0')}`,
    newHash: over.hasher,
    now: () => 0,
    log: (event, fields) => w.logs.push(JSON.stringify({ event, ...fields })),
    origins: [ORIGIN],
  };
}

function post(body: unknown, auth: string | null = `Bearer ${TOKEN}`): Request {
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
  if (auth !== null) headers.authorization = auth;
  return new Request('https://f/admin-ingest', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function call(w: World, body: unknown, over: Over = {}, auth?: string | null) {
  const res = await handleAdminIngest(post(body, auth), deps(w, over));
  return { res, body: await res.json() as Record<string, unknown> };
}

const PREPARE = {
  action: 'prepare',
  file_sha256: SHA_F,
  page_count: 12,
  parts: [{ sha256: SHA_F, byte_size: 1000, page_count: 12 }],
};
const VERIFY = { action: 'verify', staging_path: STAGED, sha256: SHA_A, byte_size: 10 };
const REG_PARTS = [
  { part_index: 0, page_offset: 0, page_count: 10, sha256: SHA_A, byte_size: 100 },
  { part_index: 1, page_offset: 10, page_count: 5, sha256: SHA_B, byte_size: 50 },
];
const REGISTER: Record<string, unknown> = {
  action: 'register',
  file_sha256: SHA_F,
  page_count: 15,
  parts: REG_PARTS,
  title: 'Budget at a Glance',
  desk_tier: 'national',
  desk_feature: 'Budget Utilisation & Schemes',
  file_url: 'https://example.gov.in/budget.pdf',
  note: 'split every 10',
  file_name: 'budget.pdf',
};
const KEY = 'bill:2025:XLV';
const OLD = '55555555-5555-4555-8555-555555555555';
const BILLS = { desk_tier: 'national', desk_feature: 'Bill Passage Probability Index' };
const HUB = 'https://sansad.in/ls/legislation/bills';
const RECORDS = { action: 'records', ...BILLS };
const UNLINKED = { action: 'unlinked', ...BILLS };
const LINK = { action: 'link', document_id: DOC, document_key: KEY, expected_key: null };
const UNLINK = { action: 'unlink', document_id: DOC, expected_key: KEY };
const SWAP = { action: 'swap', document_id: DOC, expected_old: OLD };
const DELETE = { action: 'delete', document_id: DOC };
const RECORDS_DATA: RecordsData = {
  records: [{
    document_key: KEY,
    status: 'record_only',
    rows: [{ row_key: 'r1', title: 'The Finance Bill, 2025', house: 'Lok Sabha', date: '2025-02-01' }],
    source_hint: HUB,
    documents: [],
  }],
  total: 1,
  coverage: { keys: 9415, full_text: 1236, orphaned: 0 },
};
const UNLINKED_DATA: UnlinkedData = {
  documents: [{
    document_id: DOC,
    title: 'Standalone',
    source_key: `upload:${SHA_F}`,
    legacy: false,
    indexed: true,
    job: { status: 'succeeded', stage: 'done', error_code: null },
    orphaned_key: null,
    link_target: null,
    replaces: null,
    created_at: '2026-10-01T10:00:00Z',
  }],
  total: 1,
};
const EVERY_ACTION: Record<string, unknown>[] = [
  PREPARE,
  VERIFY,
  REGISTER,
  { action: 'jobs' },
  { action: 'retry', job_id: JOB },
  { action: 'cancel', job_id: JOB },
  { action: 'discard', document_id: DOC },
  RECORDS,
  UNLINKED,
  LINK,
  UNLINK,
  SWAP,
  DELETE,
];

function storedParts(w: World) {
  w.objects.set(`files/${SHA_A}.pdf`, bytesOf(100));
  w.objects.set(`files/${SHA_B}.pdf`, bytesOf(50));
}

// ─── Access ──────────────────────────────────────────────────────────────────

Deno.test('preflight answers 204 with CORS for an allowed origin', async () => {
  const w = world();
  const res = await handleAdminIngest(
    new Request('https://f/admin-ingest', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
    deps(w),
  );
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('access-control-allow-origin'), ORIGIN);
  assertEquals(touched(w), 0);
});

Deno.test('401 on every action without a token, with CORS, nothing touched', async () => {
  for (const action of EVERY_ACTION) {
    const w = world();
    const { res, body } = await call(w, action, {}, null);
    assertEquals(res.status, 401, String(action.action));
    assertEquals(body, { ok: false, code: 'unauthorized', error: 'missing bearer token' });
    assertEquals(res.headers.get('access-control-allow-origin'), ORIGIN);
    assertEquals(touched(w), 0);
    assertEquals(w.isAdminCalls.length, 0);
  }
});

Deno.test('401 on every action with a token Auth rejects, nothing touched', async () => {
  for (const action of EVERY_ACTION) {
    const w = world();
    const { res, body } = await call(w, action, {}, 'Bearer x.y.z');
    assertEquals(res.status, 401, String(action.action));
    assertEquals(body.code, 'unauthorized');
    assertEquals(res.headers.get('access-control-allow-origin'), ORIGIN);
    assertEquals(touched(w), 0);
  }
});

Deno.test('403 on every action for a signed-in non-admin, with CORS, nothing touched', async () => {
  for (const action of EVERY_ACTION) {
    const w = world();
    const { res, body } = await call(w, action, { isAdmin: false });
    assertEquals(res.status, 403, String(action.action));
    assertEquals(body, { ok: false, code: 'forbidden', error: 'platform admins only' });
    assertEquals(res.headers.get('access-control-allow-origin'), ORIGIN);
    assertEquals(touched(w), 0);
    assertEquals(w.isAdminCalls, [TOKEN]);
  }
});

Deno.test('an is_platform_admin failure is 503 and touches nothing', async () => {
  const w = world();
  const { res, body } = await call(w, PREPARE, { isAdmin: new Error('rpc down') });
  assertEquals(res.status, 503);
  assertEquals(body.code, 'unavailable');
  assertEquals(touched(w), 0);
});

Deno.test('the body is not read before the caller is authorised', async () => {
  const w = world();
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulls++;
      c.enqueue(new TextEncoder().encode('{}'));
      c.close();
    },
  }, { highWaterMark: 0 }); // no eager pull: only a read by the handler counts
  const req = new Request('https://f/admin-ingest', { method: 'POST', headers: { origin: ORIGIN }, body });
  const res = await handleAdminIngest(req, deps(w));
  assertEquals(res.status, 401);
  assertEquals(pulls, 0);
});

Deno.test('only POST is accepted', async () => {
  const w = world();
  const res = await handleAdminIngest(
    new Request('https://f/admin-ingest', {
      method: 'GET',
      headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
    }),
    deps(w),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, 'bad_request');
  assertEquals(res.headers.get('access-control-allow-origin'), ORIGIN);
});

// ─── The body ────────────────────────────────────────────────────────────────

Deno.test('the 64 KB body cap applies while reading a stream with no length', async () => {
  const w = world();
  let pulls = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(c) {
      pulls++;
      c.enqueue(new Uint8Array(16 * 1024).fill(0x20));
    },
  });
  const req = new Request('https://f/admin-ingest', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN },
    body: endless,
  });
  const res = await handleAdminIngest(req, deps(w));
  assertEquals(res.status, 413);
  assertEquals((await res.json()).code, 'too_large');
  assert(pulls <= 6, `read ${pulls} chunks of 16 KB`);
  assertEquals(touched(w), 0);
});

Deno.test('a declared content-length over the cap is refused without reading', async () => {
  const w = world();
  const big = JSON.stringify({ action: 'jobs', pad: 'x'.repeat(LIMITS.bodyMaxBytes) });
  const { res, body } = await call(w, big);
  assertEquals(res.status, 413);
  assertEquals(body.code, 'too_large');
  assertEquals(touched(w), 0);
});

Deno.test('a body of exactly 64 KB is accepted', async () => {
  const w = world();
  const base = JSON.stringify({ action: 'jobs', pad: '' });
  const exact = JSON.stringify({ action: 'jobs', pad: 'x'.repeat(LIMITS.bodyMaxBytes - base.length) });
  assertEquals(exact.length, LIMITS.bodyMaxBytes);
  const { res } = await call(w, exact);
  assertEquals(res.status, 200);
});

Deno.test('bad JSON, a non-object and an unknown action are bad_request', async () => {
  for (const raw of ['{oops', '[1,2]', '"prepare"', 'null', JSON.stringify({ action: 'drop' }), JSON.stringify({})]) {
    const w = world();
    const { res, body } = await call(w, raw);
    assertEquals(res.status, 400, raw);
    assertEquals(body.code, 'bad_request');
    assertEquals(touched(w), 0);
  }
});

// ─── prepare ─────────────────────────────────────────────────────────────────

Deno.test('prepare validation refuses each bad input before touching storage', async () => {
  const part = PREPARE.parts[0];
  const bad: Record<string, unknown>[] = [
    { ...PREPARE, file_sha256: SHA_F.toUpperCase() },
    { ...PREPARE, file_sha256: 'f'.repeat(63) },
    { ...PREPARE, page_count: 0 },
    { ...PREPARE, page_count: 1.5 },
    { ...PREPARE, page_count: '12' },
    { ...PREPARE, parts: [] },
    { ...PREPARE, parts: 'x' },
    { ...PREPARE, parts: [{ ...part, sha256: 'z'.repeat(64) }] },
    { ...PREPARE, parts: [{ ...part, byte_size: 0 }] },
    { ...PREPARE, parts: [{ ...part, byte_size: LIMITS.partMaxBytes + 1 }] },
    { ...PREPARE, parts: [{ ...part, page_count: 11 }] }, // parts do not sum to page_count
    { ...PREPARE, page_count: 1001, parts: [{ ...part, page_count: 1001 }] }, // over partMaxPages
    {
      ...PREPARE,
      page_count: 5001,
      parts: [...Array(5)].map(() => ({ ...part, page_count: 1000 })).concat([{ ...part, page_count: 1 }]),
    },
    { ...PREPARE, parts: [null] },
  ];
  for (const b of bad) {
    const w = world();
    const { res, body } = await call(w, b);
    assertEquals(res.status, 400, JSON.stringify(b).slice(0, 200));
    assertEquals(body.code, 'bad_request');
    assertEquals(touched(w), 0);
  }
});

Deno.test('prepare accepts exactly 5,000 pages and exactly 50,000,000 bytes', async () => {
  const w = world();
  const parts = [...Array(5)].map((_, i) => ({
    sha256: hex(i).repeat(32),
    byte_size: LIMITS.partMaxBytes,
    page_count: 1000,
  }));
  const { res } = await call(w, { action: 'prepare', file_sha256: SHA_F, page_count: 5000, parts });
  assertEquals(res.status, 200);
});

Deno.test('prepare lists documents for this file (live first) and signs only parts not stored', async () => {
  const w = world();
  w.objects.set(`files/${SHA_A}.pdf`, bytesOf(10));
  const documents = [
    { document_id: 'd-old', source_key: 'corpus:x', title: 'Old', indexed: false, job_status: 'failed' },
    { document_id: 'd-live', source_key: 'upload:' + SHA_F, title: 'Live', indexed: true, job_status: 'succeeded' },
  ];
  const { res, body } = await call(w, {
    action: 'prepare',
    file_sha256: SHA_F,
    page_count: 15,
    parts: [{ sha256: SHA_A, byte_size: 10, page_count: 10, extra: 'dropped' }, {
      sha256: SHA_B,
      byte_size: 20,
      page_count: 5,
    }],
    evil: true,
  }, { documents });
  assertEquals(res.status, 200);
  assertEquals((body.documents as { document_id: string }[]).map((d) => d.document_id), ['d-live', 'd-old']);
  const parts = body.parts as Record<string, unknown>[];
  assertEquals(parts[0], { sha256: SHA_A, stored: true });
  assertEquals(parts[1].sha256, SHA_B);
  assertEquals(parts[1].stored, false);
  assertMatch(String(parts[1].staging_path), STAGING_PATH);
  assertEquals(parts[1].token, 'signed-upload-token-1');
  assertEquals(w.signed, [parts[1].staging_path]);
  assertEquals(w.existsChecks, [`files/${SHA_A}.pdf`, `files/${SHA_B}.pdf`]);
  assertEquals(w.rpc, [{ name: 'documentsBySha', args: SHA_F }]);
});

Deno.test('prepare gives every unstored part its own fresh staging path', async () => {
  const w = world();
  const { body } = await call(w, {
    action: 'prepare',
    file_sha256: SHA_F,
    page_count: 2,
    parts: [{ sha256: SHA_A, byte_size: 10, page_count: 1 }, { sha256: SHA_A, byte_size: 10, page_count: 1 }],
  });
  const paths = (body.parts as { staging_path: string }[]).map((p) => p.staging_path);
  assertEquals(new Set(paths).size, 2);
  for (const p of paths) assertMatch(p, STAGING_PATH);
});

// ─── verify ──────────────────────────────────────────────────────────────────

function noContentAddressTouched(w: World) {
  assertEquals(w.removed.filter((p) => !STAGING_PATH.test(p)), []);
}

Deno.test('verify validation: staging path, hash and size', async () => {
  const bad: Record<string, unknown>[] = [
    { ...VERIFY, staging_path: `files/${SHA_A}.pdf` },
    { ...VERIFY, staging_path: 'staging/../files/x.pdf' },
    { ...VERIFY, staging_path: 'staging/abc.pdf' },
    { ...VERIFY, staging_path: '/' + STAGED },
    { ...VERIFY, staging_path: STAGED + '\n' },
    { ...VERIFY, staging_path: STAGED.toUpperCase() },
    { ...VERIFY, sha256: 'A'.repeat(64) },
    { ...VERIFY, byte_size: 0 },
    { ...VERIFY, byte_size: LIMITS.partMaxBytes + 1 },
    { ...VERIFY, byte_size: '10' },
  ];
  for (const b of bad) {
    const w = world();
    w.objects.set(STAGED, bytesOf(10));
    const { res, body } = await call(w, b);
    assertEquals(res.status, 400, JSON.stringify(b));
    assertEquals(body.code, 'bad_request');
    assertEquals(touched(w), 0);
  }
});

Deno.test('verify hashes the stream incrementally, chunk by chunk, and moves it to its content address', async () => {
  const w = world();
  const bytes = bytesOf(5 * 1024 + 17);
  const sha = await sha256Hex(bytes);
  w.objects.set(STAGED, bytes);
  const updates: number[] = [];
  const hasher = () => {
    const h = createHash('sha256');
    return {
      update(chunk: Uint8Array) {
        updates.push(chunk.byteLength);
        h.update(chunk);
      },
      digest: () => h.digest('hex'),
    };
  };
  const { res, body } = await call(w, { ...VERIFY, sha256: sha, byte_size: bytes.length }, { hasher });
  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, stored: true, path: `files/${sha}.pdf` });
  assertEquals(updates.length, 6);
  assert(updates.every((n) => n <= 1024));
  assertEquals(w.moved, [[STAGED, `files/${sha}.pdf`]]);
  assertEquals(w.removed, []);
  assertFalse(w.objects.has(STAGED));
});

Deno.test('verify uses node:crypto by default and agrees with WebCrypto', async () => {
  const w = world();
  const bytes = bytesOf(3000, 99);
  const sha = await sha256Hex(bytes);
  w.objects.set(STAGED, bytes);
  const { res } = await call(w, { ...VERIFY, sha256: sha, byte_size: bytes.length });
  assertEquals(res.status, 200);
});

Deno.test('a hash mismatch deletes only the staged object and answers 422', async () => {
  const w = world();
  const bytes = bytesOf(2048);
  w.objects.set(STAGED, bytes);
  w.objects.set(`files/${SHA_A}.pdf`, bytesOf(2048, 1));
  const { res, body } = await call(w, { ...VERIFY, sha256: SHA_A, byte_size: bytes.length });
  assertEquals(res.status, 422);
  assertEquals(body.code, 'hash_mismatch');
  assertEquals(w.removed, [STAGED]);
  assertEquals(w.moved, []);
  assert(w.objects.has(`files/${SHA_A}.pdf`));
  noContentAddressTouched(w);
});

Deno.test('a metadata size mismatch deletes only the staged object without reading it', async () => {
  const w = world();
  w.objects.set(STAGED, bytesOf(10));
  const { res, body } = await call(w, { ...VERIFY, byte_size: 11 });
  assertEquals(res.status, 422);
  assertEquals(body.code, 'hash_mismatch');
  assertEquals(w.streamed, []);
  assertEquals(w.removed, [STAGED]);
  noContentAddressTouched(w);
});

Deno.test('a stream longer than declared stops early, is refused and only the staged object is deleted', async () => {
  const w = world();
  const bytes = bytesOf(4096);
  w.objects.set(STAGED, bytes);
  w.trailing.set(STAGED, 1024 * 1024);
  const { res, body } = await call(w, { ...VERIFY, sha256: await sha256Hex(bytes), byte_size: bytes.length });
  assertEquals(res.status, 422);
  assertEquals(body.code, 'hash_mismatch');
  assert(w.pulls <= 6, `read ${w.pulls} chunks`);
  assertEquals(w.removed, [STAGED]);
  noContentAddressTouched(w);
});

Deno.test('a stream shorter than declared is refused', async () => {
  const w = world();
  const bytes = bytesOf(100);
  w.objects.set(STAGED, bytes);
  w.metaSize.set(STAGED, 200);
  const { res } = await call(w, { ...VERIFY, sha256: await sha256Hex(bytes), byte_size: 200 });
  assertEquals(res.status, 422);
  assertEquals(w.removed, [STAGED]);
});

Deno.test('an existing destination deletes the staged copy and leaves files/ untouched', async () => {
  const w = world();
  const bytes = bytesOf(500);
  const sha = await sha256Hex(bytes);
  const original = bytesOf(500);
  w.objects.set(STAGED, bytes);
  w.objects.set(`files/${sha}.pdf`, original);
  const { res, body } = await call(w, { ...VERIFY, sha256: sha, byte_size: 500 });
  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, stored: true, path: `files/${sha}.pdf` });
  assertEquals(w.moved, []);
  assertEquals(w.removed, [STAGED]);
  assert(w.objects.get(`files/${sha}.pdf`) === original);
  noContentAddressTouched(w);
});

Deno.test('a destination that appears during the move (a race) also deletes only the staged copy', async () => {
  const w = world();
  const bytes = bytesOf(500);
  const sha = await sha256Hex(bytes);
  w.objects.set(STAGED, bytes);
  w.raceOnMove.add(`files/${sha}.pdf`);
  const { res } = await call(w, { ...VERIFY, sha256: sha, byte_size: 500 });
  assertEquals(res.status, 200);
  assertEquals(w.moved, [[STAGED, `files/${sha}.pdf`]]);
  assertEquals(w.removed, [STAGED]);
  noContentAddressTouched(w);
});

Deno.test('a missing staged object is bad_request and nothing is deleted', async () => {
  const w = world();
  const { res, body } = await call(w, VERIFY);
  assertEquals(res.status, 400);
  assertEquals(body.code, 'bad_request');
  assertEquals(w.removed, []);
  assertEquals(w.moved, []);
});

Deno.test('verify logs its bytes and hashing time for the B5 measurement', async () => {
  const w = world();
  const bytes = bytesOf(3000);
  w.objects.set(STAGED, bytes);
  await call(w, { ...VERIFY, sha256: await sha256Hex(bytes), byte_size: 3000 });
  const line = w.logs.map((l) => JSON.parse(l)).find((l) => l.event === 'admin_ingest.verify');
  assert(line, w.logs.join('\n'));
  assertEquals(line.action, 'verify');
  assertEquals(line.user_id, ADMIN);
  assertEquals(line.bytes, 3000);
  assertEquals(typeof line.hash_ms, 'number');
  assertEquals(line.outcome, 'moved');
});

// ─── register ────────────────────────────────────────────────────────────────

Deno.test('register validation refuses each bad input before any database call', async () => {
  const bad: Record<string, unknown>[] = [
    { ...REGISTER, desk_tier: 'national', desk_feature: 'Not A Module' },
    { ...REGISTER, desk_tier: 'state', desk_feature: 'Budget Utilisation & Schemes' },
    { ...REGISTER, desk_tier: '', desk_feature: '' },
    { ...REGISTER, title: '' },
    { ...REGISTER, title: '   ' },
    { ...REGISTER, title: 'x'.repeat(301) },
    { ...REGISTER, note: 'x'.repeat(2001) },
    { ...REGISTER, note: 5 },
    { ...REGISTER, file_url: 'javascript:alert(1)' },
    { ...REGISTER, file_url: 'ftp://example.org/a.pdf' },
    { ...REGISTER, file_url: 'not a url' },
    { ...REGISTER, file_name: undefined },
    { ...REGISTER, file_name: '' },
    { ...REGISTER, parts: [REG_PARTS[0], { ...REG_PARTS[1], page_offset: 9 }] },
    { ...REGISTER, parts: [REG_PARTS[0], { ...REG_PARTS[1], part_index: 2 }] },
    { ...REGISTER, parts: [REG_PARTS[1], REG_PARTS[0]] },
    { ...REGISTER, page_count: 16 },
    {
      ...REGISTER,
      page_count: 5001,
      parts: [...Array(6)].map((_, i) => ({
        part_index: i,
        page_offset: i * 1000,
        page_count: i < 5 ? 1000 : 1,
        sha256: SHA_A,
        byte_size: 100,
      })),
    },
  ];
  for (const b of bad) {
    const w = world();
    storedParts(w);
    const { res, body } = await call(w, b);
    assertEquals(res.status, 400, JSON.stringify(b).slice(0, 300));
    assertEquals(body.code, 'bad_request');
    assertEquals(w.rpc, []);
    assertEquals(w.workerStarts, 0);
  }
});

Deno.test('moduleName mirrors research-chat: case, punctuation and slashes are ignored', () => {
  assertEquals(
    moduleName('Regulatory Body Watch (RBI / SEBI / TRAI / CCI)'),
    moduleName('regulatory body watch (RBI/SEBI/TRAI/CCI)'),
  );
  assertEquals(moduleName('Budget Utilisation & Schemes'), 'budget utilisation schemes');
});

Deno.test('register sends ingest_register the whitelisted payload with the corpus spelling of the desk pair', async () => {
  const w = world();
  storedParts(w);
  const modules = [
    { desk_tier: 'national', desk_feature: 'Cabinet Decisions' },
    { desk_tier: 'national', desk_feature: 'Regulatory Body Watch (RBI / SEBI / TRAI / CCI)' },
  ];
  const { res, body } = await call(w, {
    ...REGISTER,
    desk_feature: 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)',
    requested_by: 'someone-else',
    source_key: 'corpus:hijack',
    metadata: { origin: 'forged' },
  }, { modules });
  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, document_id: DOC, job_id: JOB });
  const reg = w.rpc.find((r) => r.name === 'ingest_register')!.args as RegisterPayload;
  assertEquals(reg, {
    source_key: `upload:${SHA_F}`,
    title: 'Budget at a Glance',
    file_name: 'budget.pdf',
    file_url: 'https://example.gov.in/budget.pdf',
    desk_tier: 'national',
    desk_feature: 'Regulatory Body Watch (RBI / SEBI / TRAI / CCI)',
    file_sha256: SHA_F,
    page_count: 15,
    requested_by: ADMIN,
    metadata: {
      origin: 'admin-upload',
      uploaded_by: ADMIN,
      original_file_name: 'budget.pdf',
      note: 'split every 10',
      parts: 2,
    },
    files: [
      {
        part_index: 0,
        page_offset: 0,
        page_count: 10,
        sha256: SHA_A,
        byte_size: 100,
        storage_path: `files/${SHA_A}.pdf`,
      },
      {
        part_index: 1,
        page_offset: 10,
        page_count: 5,
        sha256: SHA_B,
        byte_size: 50,
        storage_path: `files/${SHA_B}.pdf`,
      },
    ],
    no_public_source: false,
    actor: ADMIN,
  });
  assertEquals(w.workerStarts, 1);
});

Deno.test('register falls back to the catalog spelling, matching the client spelling loosely', async () => {
  const w = world();
  storedParts(w);
  const { res } = await call(w, {
    ...REGISTER,
    desk_tier: 'National',
    desk_feature: 'budget  utilisation and schemes'.replace(' and ', ' & '),
    file_url: '',
    no_public_source: true,
    note: null,
  }, { modules: [{ desk_tier: 'state', desk_feature: 'Budget Utilisation & Schemes' }] });
  assertEquals(res.status, 200);
  const reg = w.rpc.find((r) => r.name === 'ingest_register')!.args as RegisterPayload;
  assertEquals([reg.desk_tier, reg.desk_feature], ['national', 'Budget Utilisation & Schemes']);
  assertEquals(reg.file_url, null);
  assertEquals(reg.metadata.note, null);
});

Deno.test('register refuses a part that is not at its content address, before ingest_register', async () => {
  const w = world();
  w.objects.set(`files/${SHA_A}.pdf`, bytesOf(100));
  const { res, body } = await call(w, REGISTER);
  assertEquals(res.status, 422);
  assertEquals(body.code, 'refused');
  assert(String(body.error).includes('part 1'));
  assertEquals(w.rpc.filter((r) => r.name === 'ingest_register'), []);
  assertEquals(w.workerStarts, 0);
});

Deno.test('register maps ingest_register refusals to 409 or 422 by message, anything else to 503', async () => {
  const cases: Array<[DbResult<{ document_id: string; job_id: string }>, number, string, string | undefined]> = [
    [
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
      409,
      'already_uploaded',
      DOC,
    ],
    [
      {
        data: null,
        error: {
          code: 'P0001',
          message: `ingest_register: upload:${SHA_F} is already extracted; re-extraction is refused`,
        },
      },
      409,
      'already_uploaded',
      DOC,
    ],
    [
      {
        data: null,
        error: {
          code: 'P0001',
          message: `ingest_register: upload:${SHA_F} already has an active or succeeded job; refused`,
        },
      },
      409,
      'already_uploaded',
      DOC,
    ],
    [
      { data: null, error: { code: 'P0001', message: 'ingest_register: parts cover 14 pages, page_count is 15' } },
      422,
      'refused',
      undefined,
    ],
    [{ data: null, error: { message: 'fetch failed: connection reset' } }, 503, 'unavailable', undefined],
  ];
  for (const [register, status, code, documentId] of cases) {
    const w = world();
    storedParts(w);
    const { res, body } = await call(w, REGISTER, { register, existingId: DOC });
    assertEquals(res.status, status, register.error?.message);
    assertEquals(body.code, code);
    assertEquals(body.document_id, documentId);
    if (code === 'refused') assertEquals(body.error, 'ingest_register: parts cover 14 pages, page_count is 15');
    if (code === 'unavailable') assertFalse(String(body.error).includes('connection reset'));
    assertEquals(w.workerStarts, 0);
  }
});

Deno.test('a worker start that fails is logged and the registration still succeeds', async () => {
  const w = world();
  storedParts(w);
  let starts = 0;
  const { res, body } = await call(w, REGISTER, {
    startWorker: () => {
      starts++;
      return Promise.reject(new Error('worker 500'));
    },
  });
  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, document_id: DOC, job_id: JOB });
  assertEquals(starts, 1);
  assert(w.logs.some((l) => l.includes('admin_ingest.worker_start_failed')));
});

// ─── jobs ────────────────────────────────────────────────────────────────────

function job(i: number, over: Partial<RawJobRow> = {}): RawJobRow {
  return {
    job_id: `job-${i}`,
    document_id: `doc-${i}`,
    title: `Doc ${i}`,
    source_key: `upload:${SHA_F}`,
    desk_tier: 'national',
    desk_feature: 'Cabinet Decisions',
    indexed: false,
    status: 'running',
    stage: 'ocr',
    ocr_pages: 5,
    pages_total: 10,
    attempts: 1,
    next_attempt_at: null,
    error_code: null,
    last_error: null,
    ocr_cost_usd: 0.02,
    embed_tokens: 0,
    embed_cost_usd: 0,
    requested_by: i % 2 ? 'user-odd' : null,
    created_at: `2026-10-01T10:0${9 - i}:00.123456+00:00`,
    finished_at: null,
    ...over,
  };
}

Deno.test('jobs validates limit and before', async () => {
  const bad = [
    { action: 'jobs', limit: 0 },
    { action: 'jobs', limit: LIMITS.jobsMaxLimit + 1 },
    { action: 'jobs', limit: 2.5 },
    { action: 'jobs', limit: '20' },
    { action: 'jobs', before: 'yesterday' },
    { action: 'jobs', before: '2026-10-01T10:00:00Z,id.eq.x' },
    { action: 'jobs', before: 5 },
  ];
  for (const b of bad) {
    const w = world();
    const { res } = await call(w, b);
    assertEquals(res.status, 400, JSON.stringify(b));
    assertEquals(w.rpc, []);
  }
});

Deno.test('jobs pages by created_at: limit + 1 is read, next_before is the last row returned', async () => {
  const w = world();
  const jobs = [job(1), job(2), job(3)];
  const { res, body } = await call(w, { action: 'jobs', limit: 2, before: '2026-10-01T11:00:00.000Z' }, {
    jobs,
    emails: { 'user-odd': 'admin@example.org' },
  });
  assertEquals(res.status, 200);
  assertEquals(w.rpc[0], { name: 'jobs', args: { limit: 3, before: '2026-10-01T11:00:00.000Z' } });
  const rows = body.jobs as Record<string, unknown>[];
  assertEquals(rows.map((r) => r.job_id), ['job-1', 'job-2']);
  assertEquals(body.next_before, jobs[1].created_at);
  assertEquals(rows[0].requested_by_email, 'admin@example.org');
  assertEquals(rows[1].requested_by_email, null);
  assertFalse('requested_by' in rows[0]);
  assertEquals(w.rpc[1], { name: 'emails', args: ['user-odd'] });
});

Deno.test('jobs says whether each document is live, so the tab can hide Discard', async () => {
  const w = world();
  const { body } = await call(w, { action: 'jobs' }, { jobs: [job(1, { indexed: true }), job(2)], emails: {} });
  const rows = body.jobs as Record<string, unknown>[];
  assertEquals(rows.map((r) => r.indexed), [true, false]);
});

Deno.test('jobs defaults to 20, never reads more than 51 rows, and the last page has no cursor', async () => {
  const w = world();
  const { body } = await call(w, { action: 'jobs' }, { jobs: [job(2)] });
  assertEquals(w.rpc[0], { name: 'jobs', args: { limit: 21, before: null } });
  assertEquals(body.next_before, null);
  const w2 = world();
  await call(w2, { action: 'jobs', limit: 50 });
  assertEquals((w2.rpc[0].args as { limit: number }).limit, 51);
  assert((w2.rpc[0].args as { limit: number }).limit <= 1000);
  assertEquals(w2.rpc.filter((r) => r.name === 'emails'), []);
  // Exactly `limit` rows left: a full page, and still no next page.
  const w3 = world();
  const exact = await call(w3, { action: 'jobs', limit: 2 }, { jobs: [job(1), job(2)] });
  assertEquals((exact.body.jobs as unknown[]).length, 2);
  assertEquals(exact.body.next_before, null);
});

// ─── retry / cancel / discard ────────────────────────────────────────────────

Deno.test('retry and cancel return the new status and map refusals', async () => {
  for (const action of ['retry', 'cancel'] as const) {
    const w = world();
    const ok = await call(w, { action, job_id: JOB });
    assertEquals(ok.res.status, 200);
    assertEquals(ok.body, { ok: true, status: action === 'retry' ? 'queued' : 'cancelled', stage: 'ocr' });
    assertEquals(w.rpc, [{ name: `ingest_${action}`, args: JOB }]);

    const missing = await call(world(), { action, job_id: JOB }, {
      [action]: { data: null, error: { message: `ingest_${action}: job ${JOB} does not exist` } },
    });
    assertEquals([missing.res.status, missing.body.code], [400, 'bad_request']);

    const refused = await call(world(), { action, job_id: JOB }, {
      [action]: {
        data: null,
        error: { message: `ingest_${action}: job ${JOB} has succeeded and cannot be cancelled` },
      },
    });
    assertEquals([refused.res.status, refused.body.code], [422, 'refused']);

    const down = await call(world(), { action, job_id: JOB }, {
      [action]: { data: null, error: { message: 'timeout' } },
    });
    assertEquals([down.res.status, down.body.code], [503, 'unavailable']);

    const w2 = world();
    const bad = await call(w2, { action, job_id: 'not-a-uuid' });
    assertEquals(bad.res.status, 400);
    assertEquals(w2.rpc, []);
  }
});

Deno.test('discard maps ingest_discard reasons', async () => {
  const w = world();
  const ok = await call(w, { action: 'discard', document_id: DOC });
  assertEquals(ok.body, { ok: true, discarded: true });
  assertEquals(w.rpc, [{ name: 'ingest_discard', args: { document: DOC, actor: ADMIN } }]);

  const cases: Array<[string, number, string]> = [
    ['ingest_discard: document not found', 400, 'bad_request'],
    ['ingest_discard: not an upload', 409, 'not_discardable'],
    ['ingest_discard: already live', 409, 'not_discardable'],
    ['ingest_discard: has an active or succeeded job', 409, 'not_discardable'],
    ['permission denied for function ingest_discard', 503, 'unavailable'],
  ];
  for (const [message, status, code] of cases) {
    const { res, body } = await call(world(), { action: 'discard', document_id: DOC }, {
      discard: { data: null, error: { message } },
    });
    assertEquals([res.status, body.code], [status, code], message);
    if (code === 'not_discardable') assertEquals(body.error, message);
  }
  const w2 = world();
  assertEquals((await call(w2, { action: 'discard', document_id: 'x' })).res.status, 400);
  assertEquals(w2.rpc, []);
});

// ─── Logging ─────────────────────────────────────────────────────────────────

Deno.test('every action logs its name and the admin id, and no log carries the token or a signed token', async () => {
  const w = world();
  storedParts(w);
  const bytes = bytesOf(10);
  w.objects.set(STAGED, bytes);
  const actions = [
    PREPARE,
    { ...VERIFY, sha256: await sha256Hex(bytes) },
    REGISTER,
    { action: 'jobs' },
    { action: 'retry', job_id: JOB },
    { action: 'cancel', job_id: JOB },
    { action: 'discard', document_id: DOC },
    RECORDS,
    UNLINKED,
    LINK,
    UNLINK,
    SWAP,
    DELETE,
  ];
  for (const a of actions) {
    const before = w.logs.length;
    const { res } = await call(w, a);
    assertEquals(res.status, 200, String(a.action));
    const lines = w.logs.slice(before).map((l) => JSON.parse(l));
    assert(lines.some((l) => l.action === a.action && l.user_id === ADMIN), `${a.action}: ${w.logs.slice(before)}`);
  }
  // Refusals log too.
  await call(w, PREPARE, { isAdmin: false });
  const all = w.logs.join('\n');
  assert(all.includes('admin_ingest.forbidden'));
  assertFalse(all.includes(TOKEN));
  assertFalse(all.includes('caller-secret-payload'));
  assertFalse(all.includes('signed-upload-token'));
});

// ─── Amendment A: records and unlinked ───────────────────────────────────────

const lines = (w: World) => w.logs.map((l) => JSON.parse(l) as Record<string, unknown>);

Deno.test('records sends admin_desk_records the validated query in the catalog spelling, with defaults', async () => {
  const w = world();
  const { res, body } = await call(w, {
    action: 'records',
    desk_tier: 'National',
    desk_feature: 'bill passage probability index',
    evil: 'dropped',
  });
  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, ...RECORDS_DATA });
  assertEquals(w.rpc, [{
    name: 'admin_desk_records',
    args: {
      tier: 'national',
      feature: 'Bill Passage Probability Index',
      query: null,
      status: null,
      limit: 20,
      offset: 0,
    },
  }]);
  assertEquals(w.modulesRead, 0);
});

Deno.test('records passes query, status and paging through, trimmed', async () => {
  const w = world();
  const { res } = await call(w, {
    ...RECORDS,
    query: '  finance bill ',
    status: 'record_only',
    limit: 50,
    offset: 100000,
  });
  assertEquals(res.status, 200);
  assertEquals(w.rpc[0].args, {
    tier: 'national',
    feature: 'Bill Passage Probability Index',
    query: 'finance bill',
    status: 'record_only',
    limit: 50,
    offset: 100000,
  });
  // The other bounds, and an empty query or a null status meaning none.
  for (
    const b of [
      { ...RECORDS, limit: 1, offset: 0, query: '', status: null },
      { ...RECORDS, query: 'q'.repeat(200) },
      ...['processing', 'failed', 'full_text', 'full_text_legacy', 'record_only'].map((status) => ({
        ...RECORDS,
        status,
      })),
    ]
  ) {
    const w2 = world();
    const r = await call(w2, b);
    assertEquals(r.res.status, 200, JSON.stringify(b).slice(0, 120));
  }
  const w3 = world();
  await call(w3, { ...RECORDS, query: '   ' });
  assertEquals((w3.rpc[0].args as { query: unknown }).query, null);
});

Deno.test('records and unlinked validation refuses each bad input before any database call', async () => {
  const bad: Record<string, unknown>[] = [];
  for (const base of [RECORDS, UNLINKED]) {
    bad.push(
      { ...base, desk_tier: 'national', desk_feature: 'Not A Module' },
      { ...base, desk_tier: 'state', desk_feature: 'Bill Passage Probability Index' },
      { ...base, desk_tier: undefined },
      { ...base, desk_feature: '' },
      { ...base, query: 'q'.repeat(201) },
      { ...base, query: 5 },
      { ...base, query: 'a\u0000b' },
      { ...base, limit: 0 },
      { ...base, limit: 51 },
      { ...base, limit: 1.5 },
      { ...base, limit: '10' },
      { ...base, offset: -1 },
      { ...base, offset: 100001 },
      { ...base, offset: '0' },
    );
  }
  bad.push(
    { ...RECORDS, status: 'live' },
    { ...RECORDS, status: 'FULL_TEXT' },
    { ...RECORDS, status: 3 },
  );
  for (const b of bad) {
    const w = world();
    const { res, body } = await call(w, b);
    assertEquals(res.status, 400, JSON.stringify(b).slice(0, 200));
    assertEquals(body.code, 'bad_request');
    assertEquals(touched(w), 0);
  }
});

Deno.test('unlinked sends admin_unlinked_documents the validated query and returns its documents', async () => {
  const w = world();
  const { res, body } = await call(w, { ...UNLINKED, query: 'budget', limit: 5, offset: 10, status: 'ignored' });
  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, ...UNLINKED_DATA });
  assertEquals(w.rpc, [{
    name: 'admin_unlinked_documents',
    args: { tier: 'national', feature: 'Bill Passage Probability Index', query: 'budget', limit: 5, offset: 10 },
  }]);
});

Deno.test('a records or unlinked read failure is 503 and logged with the admin id', async () => {
  for (const [b, over] of [[RECORDS, 'records'], [UNLINKED, 'unlinked']] as const) {
    const w = world();
    const { res, body } = await call(w, b, { [over]: { data: null, error: { message: 'statement timeout' } } });
    assertEquals([res.status, body.code], [503, 'unavailable']);
    assertFalse(String(body.error).includes('statement timeout'));
    assert(lines(w).some((l) => l.action === b.action && l.user_id === ADMIN && l.outcome === 'error'));
  }
});

// ─── Amendment A: link, unlink, swap, delete ─────────────────────────────────

Deno.test('link, unlink, swap and delete call their SQL functions with the admin as actor', async () => {
  const cases: Array<[Record<string, unknown>, string, unknown, Record<string, unknown>]> = [
    [LINK, 'ingest_link', { document: DOC, key: KEY, expected: null, actor: ADMIN }, {
      ok: true,
      document_id: DOC,
      document_key: KEY,
    }],
    [{ ...LINK, expected_key: 'bill:2024:I' }, 'ingest_link', {
      document: DOC,
      key: KEY,
      expected: 'bill:2024:I',
      actor: ADMIN,
    }, { ok: true, document_id: DOC, document_key: KEY }],
    [UNLINK, 'ingest_unlink', { document: DOC, expected: KEY, actor: ADMIN }, {
      ok: true,
      document_id: DOC,
      document_key: null,
    }],
    [SWAP, 'ingest_swap', { document: DOC, expected: OLD, actor: ADMIN }, {
      ok: true,
      document_id: DOC,
      document_key: KEY,
      old_document_id: OLD,
    }],
    [{ ...SWAP, expected_old: null }, 'ingest_swap', { document: DOC, expected: null, actor: ADMIN }, {
      ok: true,
      document_id: DOC,
      document_key: KEY,
      old_document_id: null,
    }],
    [DELETE, 'ingest_delete', { document: DOC, actor: ADMIN }, { ok: true, deleted: true }],
  ];
  for (const [req, name, args, want] of cases) {
    const w = world();
    const { res, body } = await call(w, { ...req, extra: 'dropped' });
    assertEquals(res.status, 200, JSON.stringify(req));
    assertEquals(body, want);
    assertEquals(w.rpc, [{ name, args }]);
  }
});

Deno.test('link, unlink, swap and delete validation refuses each bad input before any database call', async () => {
  const bad: Record<string, unknown>[] = [
    { ...LINK, document_id: 'x' },
    { ...LINK, document_id: 'ABCDEF12-3333-4333-8333-333333333333' }, // uuids are lowercase
    { ...LINK, document_key: undefined },
    { ...LINK, document_key: null },
    { ...LINK, document_key: '' },
    { ...LINK, document_key: 'k'.repeat(201) },
    { ...LINK, document_key: 'bill:2025:\nXLV' },
    { ...LINK, document_key: 'bill:2025:XLV\u007f' },
    { ...LINK, document_key: ' bill:2025:XLV' },
    { ...LINK, document_key: 7 },
    { action: 'link', document_id: DOC, document_key: KEY }, // expected_key must be said, even as null
    { ...LINK, expected_key: 5 },
    { ...LINK, expected_key: 'k'.repeat(201) },
    { ...UNLINK, document_id: undefined },
    { ...UNLINK, expected_key: null },
    { ...UNLINK, expected_key: undefined },
    { ...UNLINK, expected_key: '' },
    { ...SWAP, document_id: 'nope' },
    { ...SWAP, expected_old: 'nope' },
    { action: 'swap', document_id: DOC },
    { ...DELETE, document_id: '' },
    { ...DELETE, document_id: `${DOC} ` },
  ];
  for (const b of bad) {
    const w = world();
    const { res, body } = await call(w, b);
    assertEquals(res.status, 400, JSON.stringify(b));
    assertEquals(body.code, 'bad_request');
    assertEquals(touched(w), 0);
  }
  // The key bounds that are accepted.
  const w = world();
  assertEquals((await call(w, { ...LINK, document_key: 'k'.repeat(200) })).res.status, 200);
});

Deno.test('refusal tokens map to codes, per function', async () => {
  type Over2 = 'link' | 'unlink' | 'swap' | 'del';
  const cases: Array<[Record<string, unknown>, Over2, string, number, string]> = [
    [LINK, 'link', `ingest_link: not_found: document ${DOC}`, 400, 'bad_request'],
    [LINK, 'link', `ingest_link: legacy: ${DOC} has no storage_path`, 422, 'refused'],
    [LINK, 'link', `ingest_link: wrong_desk: ${KEY} is not a key of this desk`, 422, 'refused'],
    [LINK, 'link', `ingest_link: key_held: ${KEY} is held by ${OLD}`, 409, 'key_held'],
    [LINK, 'link', `ingest_link: stale: expected null, found ${KEY}`, 409, 'stale'],
    [LINK, 'link', 'ingest_link: conflict: something', 422, 'refused'],
    [LINK, 'link', 'ingest_link: a_new_token: something', 422, 'refused'],
    [LINK, 'link', 'ingest_unlink: stale: another function', 503, 'unavailable'],
    [LINK, 'link', 'fetch failed: connection reset', 503, 'unavailable'],
    [UNLINK, 'unlink', `ingest_unlink: not_found: document ${DOC}`, 400, 'bad_request'],
    [UNLINK, 'unlink', `ingest_unlink: legacy: ${DOC}`, 422, 'refused'],
    [UNLINK, 'unlink', `ingest_unlink: stale: expected ${KEY}, found none`, 409, 'stale'],
    [SWAP, 'swap', `ingest_swap: not_found: document ${DOC}`, 400, 'bad_request'],
    [SWAP, 'swap', `ingest_swap: not_replacement: ${DOC} has no link_target`, 422, 'refused'],
    [SWAP, 'swap', `ingest_swap: not_live: ${DOC} is not indexed`, 422, 'refused'],
    [SWAP, 'swap', `ingest_swap: key_held: ${KEY} is held by another document`, 409, 'key_held'],
    [SWAP, 'swap', `ingest_swap: stale: ${OLD} no longer holds ${KEY}`, 409, 'stale'],
    [DELETE, 'del', `ingest_delete: not_found: document ${DOC}`, 400, 'bad_request'],
    [DELETE, 'del', `ingest_delete: not_deletable: ${DOC} is not an admin upload`, 409, 'not_deletable'],
    [DELETE, 'del', `ingest_delete: legacy: ${DOC}`, 409, 'not_deletable'],
    [DELETE, 'del', 'permission denied for function ingest_delete', 503, 'unavailable'],
  ];
  for (const [req, over, message, status, code] of cases) {
    const w = world();
    const { res, body } = await call(w, req, { [over]: { data: null, error: { code: 'P0001', message } } });
    assertEquals([res.status, body.code], [status, code], message);
    if (message.includes(': legacy:') && code === 'refused') assertEquals(body.error, 'legacy documents are read-only');
    if (code === 'unavailable') assertFalse(String(body.error).includes('connection reset'));
    const line = lines(w).find((l) => l.action === req.action);
    assert(line && line.user_id === ADMIN && line.document_id === DOC, message);
  }
});

const D2_VIOLATION = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "documents_v2_document_key_unique"',
  details: `Key ((metadata ->> 'document_key'::text))=(${KEY}) already exists.`,
};
const OTHER_VIOLATION = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "documents_source_key_key"',
  details: 'Key (source_key)=(upload:x) already exists.',
};

Deno.test('a unique violation maps to key_held by its constraint name only', async () => {
  for (const [req, over] of [[LINK, 'link'], [SWAP, 'swap']] as const) {
    const held = await call(world(), req, { [over]: { data: null, error: D2_VIOLATION } });
    assertEquals([held.res.status, held.body.code], [409, 'key_held'], req.action);
    // The name in details alone (some PostgREST versions) is enough too.
    const inDetails = await call(world(), req, {
      [over]: { data: null, error: { code: '23505', message: 'duplicate key', details: D2_VIOLATION.message } },
    });
    assertEquals([inDetails.res.status, inDetails.body.code], [409, 'key_held'], req.action);
    const other = await call(world(), req, { [over]: { data: null, error: OTHER_VIOLATION } });
    assertEquals([other.res.status, other.body.code], [503, 'unavailable'], req.action);
    // The name without a unique-violation code is not a violation.
    const noCode = await call(world(), req, { [over]: { data: null, error: { message: D2_VIOLATION.message } } });
    assertEquals(noCode.body.code, 'unavailable', req.action);
  }
});

// ─── Amendment A: register ───────────────────────────────────────────────────

const LINKED_REGISTER = { ...REGISTER, ...BILLS, file_url: 'https://sansad.in/getFile/bill45.pdf' };

Deno.test('register sends document_key with key_check desk, replaces, no_public_source and the actor', async () => {
  const w = world();
  storedParts(w);
  const { res } = await call(w, { ...LINKED_REGISTER, document_key: KEY, replaces: OLD, key_check: 'none' }, {
    sourceUrls: [HUB],
  });
  assertEquals(res.status, 200);
  const reg = w.rpc.find((r) => r.name === 'ingest_register')!.args as RegisterPayload;
  assertEquals(reg.document_key, KEY);
  assertEquals(reg.key_check, 'desk');
  assertEquals(reg.replaces, OLD);
  assertEquals(reg.no_public_source, false);
  assertEquals(reg.actor, ADMIN);
  assertEquals(reg.file_url, 'https://sansad.in/getFile/bill45.pdf');
  assertFalse('link_target' in reg);
});

Deno.test('register sends no key_check, document_key or replaces when no document_key is given', async () => {
  for (const extra of [{}, { document_key: null, replaces: null }, { document_key: '', key_check: 'desk' }]) {
    const w = world();
    storedParts(w);
    const { res } = await call(w, { ...REGISTER, ...extra });
    assertEquals(res.status, 200, JSON.stringify(extra));
    const reg = w.rpc.find((r) => r.name === 'ingest_register')!.args as RegisterPayload;
    assertFalse('key_check' in reg, JSON.stringify(extra));
    assertFalse('document_key' in reg);
    assertFalse('replaces' in reg);
    assertEquals(reg.actor, ADMIN);
  }
});

Deno.test('register: an empty file_url needs no_public_source true (D6), and the two do not mix', async () => {
  const refused: Record<string, unknown>[] = [
    { ...REGISTER, file_url: '' },
    { ...REGISTER, file_url: null },
    { ...REGISTER, file_url: undefined },
    { ...REGISTER, file_url: '', no_public_source: false },
    { ...REGISTER, file_url: '', no_public_source: 'true' },
    { ...REGISTER, no_public_source: 1 },
    { ...REGISTER, no_public_source: true }, // a URL and "no public source" contradict each other
    { ...REGISTER, document_key: 'k'.repeat(201) },
    { ...REGISTER, document_key: 'a\tb' },
    { ...REGISTER, document_key: 5 },
    { ...REGISTER, replaces: 'not-a-uuid' },
    { ...REGISTER, replaces: 5 },
  ];
  for (const b of refused) {
    const w = world();
    storedParts(w);
    const { res, body } = await call(w, b);
    assertEquals(res.status, 400, JSON.stringify(b).slice(-160));
    assertEquals(body.code, 'bad_request');
    assertEquals(touched(w), 0);
  }
  const w = world();
  storedParts(w);
  const { res } = await call(w, { ...REGISTER, file_url: '', no_public_source: true });
  assertEquals(res.status, 200);
  const reg = w.rpc.find((r) => r.name === 'ingest_register')!.args as RegisterPayload;
  assertEquals([reg.file_url, reg.no_public_source], [null, true]);
  assertEquals(w.rpc.filter((r) => r.name === 'deskSourceUrls'), []);
});

Deno.test('urlIdentity ignores scheme, www, case, trailing slashes, query and fragment', () => {
  const id = urlIdentity(HUB);
  for (
    const u of [
      HUB,
      `${HUB}/`,
      `${HUB}//`,
      HUB.toUpperCase(),
      HUB.replace('https:', 'http:'),
      HUB.replace('://', '://www.'),
      `${HUB}?page=2&house=ls`,
      `${HUB}/#top`,
    ]
  ) assertEquals(urlIdentity(u), id, u);
  assert(urlIdentity('https://sansad.in/getFile/bill45.pdf') !== id);
  assert(urlIdentity('https://sansad.in/ls/legislation') !== id);
  assert(urlIdentity('https://sansad.in:8443/ls/legislation/bills') !== id);
});

Deno.test('register refuses a hub URL of the chosen desk with 422 hub_url, before ingest_register', async () => {
  for (const url of [HUB, `${HUB}/`, `${HUB.toUpperCase()}?page=3`, HUB.replace('https:', 'http:')]) {
    const w = world();
    storedParts(w);
    const { res, body } = await call(w, { ...LINKED_REGISTER, file_url: url, document_key: KEY }, {
      sourceUrls: ['', 'not a url', HUB, 'https://prsindia.org/billtrack'],
    });
    assertEquals([res.status, body.code], [422, 'hub_url'], url);
    assertEquals(w.rpc.filter((r) => r.name === 'ingest_register'), []);
    assertEquals(w.workerStarts, 0);
    assert(lines(w).some((l) => l.action === 'register' && l.user_id === ADMIN && l.outcome === 'hub_url'));
  }
});

Deno.test('the hub URLs are read once, for the chosen desk in the catalog spelling', async () => {
  const w = world();
  storedParts(w);
  const { res } = await call(w, {
    ...LINKED_REGISTER,
    desk_tier: 'NATIONAL',
    desk_feature: 'bill passage probability index',
  }, { sourceUrls: [HUB] });
  assertEquals(res.status, 200);
  assertEquals(w.rpc.filter((r) => r.name === 'deskSourceUrls'), [{
    name: 'deskSourceUrls',
    args: { tier: 'national', feature: 'Bill Passage Probability Index' },
  }]);
  // A hub URL of another desk is not this desk's hub.
  const w2 = world();
  storedParts(w2);
  const other = await call(w2, { ...REGISTER, file_url: HUB }, { sourceUrls: ['https://www.indiabudget.gov.in/'] });
  assertEquals(other.res.status, 200);
});

Deno.test('register maps key_held and conflict refusals, and the D2 violation by constraint name', async () => {
  const cases: Array<[DbResult<{ document_id: string; job_id: string }>, number, string]> = [
    [
      { data: null, error: { code: 'P0001', message: `ingest_register: key_held: ${KEY} is held by ${OLD}` } },
      409,
      'key_held',
    ],
    [
      { data: null, error: { code: 'P0001', message: 'ingest_register: conflict: resume with another key' } },
      422,
      'refused',
    ],
    [{ data: null, error: D2_VIOLATION }, 409, 'key_held'],
    [{ data: null, error: OTHER_VIOLATION }, 409, 'already_uploaded'],
  ];
  for (const [register, status, code] of cases) {
    const w = world();
    storedParts(w);
    const { res, body } = await call(w, { ...LINKED_REGISTER, document_key: KEY }, { register, existingId: DOC });
    assertEquals([res.status, body.code], [status, code], register.error?.message);
    if (code === 'key_held') {
      assertEquals(w.rpc.filter((r) => r.name === 'documentIdBySourceKey'), []);
      assertEquals(body.document_id, undefined);
    }
    assertEquals(w.workerStarts, 0);
  }
});

// ─── Amendment A: prepare reports the key holder ─────────────────────────────

Deno.test('prepare reports the document holding the asked key', async () => {
  const holder = { document_id: OLD, title: 'The Finance Bill, 2025', legacy: true };
  const w = world();
  const { res, body } = await call(w, { ...PREPARE, ...BILLS, document_key: KEY }, { keyHolder: holder });
  assertEquals(res.status, 200);
  assertEquals(body.key_holder, holder);
  assertEquals(w.rpc.filter((r) => r.name === 'keyHolder'), [{ name: 'keyHolder', args: KEY }]);

  const w2 = world();
  const none = await call(w2, { ...PREPARE, document_key: KEY });
  assertEquals(none.body.key_holder, null);

  const w3 = world();
  const noKey = await call(w3, PREPARE, { keyHolder: holder });
  assertEquals(noKey.res.status, 200);
  assertEquals(noKey.body.key_holder, null);
  assertEquals(w3.rpc.filter((r) => r.name === 'keyHolder'), []);
});

Deno.test('prepare validates its optional desk pair and key before touching anything', async () => {
  for (
    const b of [
      { ...PREPARE, document_key: 'k'.repeat(201) },
      { ...PREPARE, document_key: 'a\u0000b' },
      { ...PREPARE, document_key: 9 },
      { ...PREPARE, desk_tier: 'national', desk_feature: 'Not A Module' },
      { ...PREPARE, desk_tier: 'national' },
    ]
  ) {
    const w = world();
    const { res, body } = await call(w, b);
    assertEquals([res.status, body.code], [400, 'bad_request'], JSON.stringify(b).slice(-80));
    assertEquals(touched(w), 0);
  }
});

// ─── Amendment A: logging ────────────────────────────────────────────────────

Deno.test('refusals of the new actions log the action, the admin id and the ids, never a token', async () => {
  const w = world();
  await call(w, LINK, { link: { data: null, error: { message: `ingest_link: stale: x` } } });
  await call(w, UNLINK, { unlink: { data: null, error: { message: `ingest_unlink: legacy: x` } } });
  await call(w, SWAP, { swap: { data: null, error: D2_VIOLATION } });
  await call(w, DELETE, { del: { data: null, error: { message: `ingest_delete: not_deletable: x` } } });
  const got = lines(w);
  for (const action of ['link', 'unlink', 'swap', 'delete']) {
    const l = got.find((x) => x.action === action);
    assert(l, action);
    assertEquals(l.user_id, ADMIN);
    assertEquals(l.document_id, DOC);
    assertEquals(l.outcome, 'refused');
  }
  assertEquals(got.find((x) => x.action === 'swap')!.expected_old, OLD);
  assertEquals(got.find((x) => x.action === 'link')!.document_key, KEY);
  const all = w.logs.join('\n');
  assertFalse(all.includes(TOKEN));
  assertFalse(all.includes('caller-secret-payload'));
});
