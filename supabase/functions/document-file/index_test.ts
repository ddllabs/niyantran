import { assertEquals, assertFalse, assertRejects } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { CORPUS_BUCKET, createDocumentFileHandler, supabaseDocumentFileDeps } from './index.ts';

// ─── A recording supabase-js stand-in ────────────────────────────────────────

type Call = [string, ...unknown[]];

interface Recorded {
  client: string;
  table?: string;
  bucket?: string;
  calls: Call[];
}

interface Script {
  documents?: { data: unknown; error: unknown };
  parts?: { data: unknown; error: unknown };
  sign?: { data: unknown; error: unknown };
  user?: { id: string } | null;
}

/** Every builder call is recorded with the client it was made on: `user:<token>` or `service`. */
function clients(script: Script) {
  const log: Recorded[] = [];
  const made: string[] = [];
  const builder = (r: Recorded, result: () => { data: unknown; error: unknown }) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'lt', 'order', 'limit', 'range']) {
      b[m] = (...a: unknown[]) => {
        r.calls.push([m, ...a]);
        return b;
      };
    }
    b.maybeSingle = () => {
      r.calls.push(['maybeSingle']);
      return Promise.resolve(result());
    };
    b.then = (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, no);
    return b;
  };
  const make = (name: string) => {
    made.push(name);
    return {
      from(table: string) {
        const r: Recorded = { client: name, table, calls: [] };
        log.push(r);
        const res = table === 'documents' ? script.documents : script.parts;
        return builder(r, () => res ?? { data: null, error: null });
      },
      storage: {
        from(bucket: string) {
          return {
            createSignedUrl(path: string, seconds: number) {
              log.push({ client: name, bucket, calls: [['createSignedUrl', path, seconds]] });
              return Promise.resolve(script.sign ?? { data: null, error: { message: 'no script' } });
            },
          };
        },
      },
      auth: {
        getUser(token: string) {
          log.push({ client: name, calls: [['getUser', token]] });
          const user = script.user === undefined ? { id: USER } : script.user;
          return Promise.resolve(
            user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad' } },
          );
        },
      },
    } as unknown as SupabaseClient;
  };
  return {
    log,
    made,
    userClient: (token: string) => make(`user:${token}`),
    serviceClient: () => make('service'),
  };
}

const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.caller-secret-payload.signature';
const DOC = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64);
const SIG = 'eyJhbGciOiJIUzI1NiJ9.sig-payload.sig-signature';
const ORIGIN = 'http://localhost:5173';

const LIVE = {
  id: DOC,
  storage_path: `files/${SHA}.pdf`,
  indexed_at: '2026-10-01T00:00:00Z',
  extract_hash: 'e'.repeat(64),
  page_count: 5,
};
const PART = { part_index: 0, page_offset: 0, page_count: 5, byte_size: 1234, storage_path: `files/${SHA}.pdf` };

// ─── The reads: caller's client, RLS ─────────────────────────────────────────

Deno.test('document() reads documents with the caller token, by id, one row', async () => {
  const c = clients({ documents: { data: LIVE, error: null } });
  const deps = supabaseDocumentFileDeps(c);
  assertEquals(await deps.document(TOKEN, DOC), LIVE);
  assertEquals(c.made, [`user:${TOKEN}`]);
  assertEquals(c.log[0].client, `user:${TOKEN}`);
  assertEquals(c.log[0].table, 'documents');
  assertEquals(c.log[0].calls, [
    ['select', 'id, storage_path, indexed_at, extract_hash, page_count'],
    ['eq', 'id', DOC],
    ['maybeSingle'],
  ]);
});

Deno.test('document() is null when RLS hides the row or it is missing', async () => {
  const c = clients({ documents: { data: null, error: null } });
  assertEquals(await supabaseDocumentFileDeps(c).document(TOKEN, DOC), null);
});

Deno.test('document() throws a fixed message on a read error, without the PostgREST text', async () => {
  const c = clients({ documents: { data: null, error: { message: `boom files/${SHA}.pdf` } } });
  const e = await assertRejects(() => supabaseDocumentFileDeps(c).document(TOKEN, DOC));
  assertFalse(String(e).includes('files/'));
});

Deno.test('parts() reads document_files with the caller token: the last part starting before the page', async () => {
  const c = clients({ parts: { data: [{ ...PART, byte_size: '1234' }], error: null } });
  const deps = supabaseDocumentFileDeps(c);
  assertEquals(await deps.parts(TOKEN, DOC, 3), [PART]);
  assertEquals(c.made, [`user:${TOKEN}`]);
  assertEquals(c.log[0].table, 'document_files');
  assertEquals(c.log[0].calls, [
    ['select', 'part_index, page_offset, page_count, byte_size, storage_path'],
    ['eq', 'document_id', DOC],
    ['lt', 'page_offset', 3],
    ['order', 'page_offset', { ascending: false }],
    ['range', 0, 0],
  ]);
});

Deno.test('parts() throws a fixed message on a read error', async () => {
  const c = clients({ parts: { data: null, error: { message: `boom files/${SHA}.pdf` } } });
  const e = await assertRejects(() => supabaseDocumentFileDeps(c).parts(TOKEN, DOC, 1));
  assertFalse(String(e).includes('files/'));
});

// ─── Signing: service role, corpus bucket, 300 s ─────────────────────────────

Deno.test('sign() uses the service client on the corpus bucket and returns the signed URL', async () => {
  const url = `http://kong:8000/storage/v1/object/sign/corpus/files/${SHA}.pdf?token=${SIG}`;
  const c = clients({ sign: { data: { signedUrl: url }, error: null } });
  assertEquals(await supabaseDocumentFileDeps(c).sign(`files/${SHA}.pdf`, 300), url);
  assertEquals(CORPUS_BUCKET, 'corpus');
  assertEquals(c.made, ['service']);
  assertEquals(c.log, [{ client: 'service', bucket: 'corpus', calls: [['createSignedUrl', `files/${SHA}.pdf`, 300]] }]);
});

Deno.test('sign() throws a fixed message without the path on a storage error', async () => {
  const c = clients({ sign: { data: null, error: { message: `not found files/${SHA}.pdf` } } });
  const e = await assertRejects(() => supabaseDocumentFileDeps(c).sign(`files/${SHA}.pdf`, 300));
  assertFalse(String(e).includes('files/'));
});

// ─── Assembly ────────────────────────────────────────────────────────────────

function request(auth: string | null, body: unknown = { document_id: DOC, page: 2 }): Request {
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
  if (auth) headers.authorization = auth;
  return new Request('https://f/document-file', { method: 'POST', headers, body: JSON.stringify(body) });
}

Deno.test('wired end to end: the caller client reads, the service client signs, signed_path is relative', async () => {
  const url = `http://kong:8000/storage/v1/object/sign/corpus/files/${SHA}.pdf?token=${SIG}`;
  const c = clients({
    documents: { data: LIVE, error: null },
    parts: { data: [PART], error: null },
    sign: { data: { signedUrl: url }, error: null },
  });
  const lines: string[] = [];
  const handler = createDocumentFileHandler({
    ...c,
    origins: [ORIGIN],
    log: (e, f) => lines.push(JSON.stringify({ e, ...f })),
  });
  const res = await handler(request(`Bearer ${TOKEN}`));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('access-control-allow-origin'), ORIGIN);
  assertEquals(await res.json(), {
    ok: true,
    signed_path: `object/sign/corpus/files/${SHA}.pdf?token=${SIG}`,
    part_index: 0,
    page_offset: 0,
    page_count: 5,
    byte_size: 1234,
    expires_in: 300,
  });
  const byClient = c.log.map((r) => [r.client, r.table ?? r.bucket ?? r.calls[0][0]]);
  assertEquals(byClient, [
    [`user:${TOKEN}`, 'getUser'],
    [`user:${TOKEN}`, 'documents'],
    [`user:${TOKEN}`, 'document_files'],
    ['service', 'corpus'],
  ]);
  for (const l of lines) assertFalse(/token=|sign\/|files\/|kong/.test(l), l);
});

Deno.test('wired: an unauthenticated request never creates the service client or reads a table', async () => {
  for (const auth of [null, `Bearer ${TOKEN}`]) {
    const c = clients({ user: null, documents: { data: LIVE, error: null } });
    const handler = createDocumentFileHandler({ ...c, origins: [ORIGIN], log: () => {} });
    const res = await handler(request(auth));
    assertEquals(res.status, 401);
    assertFalse(c.made.includes('service'));
    assertEquals(c.log.filter((r) => r.table || r.bucket), []);
  }
});
