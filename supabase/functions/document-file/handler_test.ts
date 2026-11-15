import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import {
  type DocumentFileDeps,
  type DocumentRow,
  handleDocumentFile,
  MESSAGES,
  type PartRow,
  SIGN_SECONDS,
  type UserFileCitationRow,
} from './handler.ts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORIGIN = 'http://localhost:5173';
const FOREIGN = 'https://evil.example';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.caller-secret-payload.signature';
const DOC = '33333333-3333-4333-8333-333333333333';
const FILE_ID = '44444444-4444-4444-8444-444444444444';
const SHA0 = 'a'.repeat(64);
const SHA1 = 'b'.repeat(64);
const SHA2 = 'c'.repeat(64);
const SIG = 'eyJhbGciOiJIUzI1NiJ9.sig-payload.sig-signature';

const LIVE: DocumentRow = {
  id: DOC,
  storage_path: `files/${SHA0}.pdf`,
  indexed_at: '2026-10-01T00:00:00Z',
  extract_hash: 'e'.repeat(64),
  page_count: 25,
};

/** Three parts: pages 1-10, 11-20, 21-25. */
const PARTS: PartRow[] = [
  { part_index: 0, page_offset: 0, page_count: 10, byte_size: 1000, storage_path: `files/${SHA0}.pdf` },
  { part_index: 1, page_offset: 10, page_count: 10, byte_size: 2000, storage_path: `files/${SHA1}.pdf` },
  { part_index: 2, page_offset: 20, page_count: 5, byte_size: 3000, storage_path: `files/${SHA2}.pdf` },
];

const PRIVATE_FILE: UserFileCitationRow = {
  id: FILE_ID,
  user_id: USER,
  storage_path: `${USER}/${FILE_ID}/document.pdf`,
  upload_status: 'uploaded',
  deleted_at: null,
  size_bytes: 4096,
  page_count: 5,
};

interface World {
  doc: DocumentRow | null;
  parts: PartRow[];
  base: string;
  verified: string[];
  docReads: Array<{ token: string; id: string }>;
  partReads: Array<{ token: string; id: string; page: number }>;
  signed: Array<{ path: string; seconds: number }>;
  userFiles: Map<string, UserFileCitationRow>;
  userFileReads: Array<{ token: string; fileId: string }>;
  signedPrivate: Array<{ path: string; seconds: number }>;
  logs: string[];
  failSign?: boolean;
  failDoc?: boolean;
  failUserFile?: boolean;
  failSignPrivate?: boolean;
}

function world(over: Partial<World> = {}): World {
  const defaultFiles = new Map<string, UserFileCitationRow>();
  defaultFiles.set(FILE_ID, { ...PRIVATE_FILE });
  return {
    doc: { ...LIVE },
    parts: PARTS.map((p) => ({ ...p })),
    base: 'https://abcdefgh.supabase.co',
    verified: [],
    docReads: [],
    partReads: [],
    signed: [],
    userFiles: defaultFiles,
    userFileReads: [],
    signedPrivate: [],
    logs: [],
    ...over,
  };
}

function deps(w: World): DocumentFileDeps {
  return {
    verify: (token) => {
      w.verified.push(token);
      return Promise.resolve(token === TOKEN ? { id: USER } : null);
    },
    document: (token, id) => {
      w.docReads.push({ token, id });
      if (w.failDoc) return Promise.reject(new Error(`documents read: boom files/${SHA0}.pdf`));
      return Promise.resolve(w.doc && w.doc.id === id ? { ...w.doc } : null);
    },
    parts: (token, id, page) => {
      w.partReads.push({ token, id, page });
      return Promise.resolve(w.parts.map((p) => ({ ...p })));
    },
    sign: (path, seconds) => {
      w.signed.push({ path, seconds });
      if (w.failSign) return Promise.reject(new Error(`storage sign ${path}: token=${SIG}`));
      // The shape supabase-js's createSignedUrl returns: SUPABASE_URL + /storage/v1 + signedURL, encodeURI'd.
      return Promise.resolve(encodeURI(`${w.base}/storage/v1/object/sign/corpus/${path}?token=${SIG}`));
    },
    userFile: (token, fileId) => {
      w.userFileReads.push({ token, fileId });
      if (w.failUserFile) return Promise.reject(new Error(`user_files read: boom ${fileId}`));
      const f = w.userFiles.get(fileId);
      return Promise.resolve(f ? { ...f } : null);
    },
    signPrivate: (path, seconds) => {
      w.signedPrivate.push({ path, seconds });
      if (w.failSignPrivate) return Promise.reject(new Error(`storage sign private ${path}: token=${SIG}`));
      return Promise.resolve(encodeURI(`${w.base}/storage/v1/object/sign/user-files/${path}?token=${SIG}`));
    },
    log: (event, fields) => w.logs.push(JSON.stringify({ event, ...fields })),
    origins: [ORIGIN],
  };
}

function post(body: unknown, opts: { auth?: string | null; origin?: string; method?: string } = {}): Request {
  const headers: Record<string, string> = { origin: opts.origin ?? ORIGIN, 'content-type': 'application/json' };
  const auth = opts.auth === undefined ? `Bearer ${TOKEN}` : opts.auth;
  if (auth !== null) headers.authorization = auth;
  const method = opts.method ?? 'POST';
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://f/document-file', init);
}

async function call(w: World, body: unknown, opts: Parameters<typeof post>[1] = {}) {
  const res = await handleDocumentFile(post(body, opts), deps(w));
  const text = await res.text();
  return { res, status: res.status, json: JSON.parse(text) as Record<string, unknown>, text };
}

function assertRefusal(
  r: { status: number; json: Record<string, unknown>; res: Response },
  status: number,
  code: keyof typeof MESSAGES,
) {
  assertEquals(r.status, status);
  assertEquals(r.json, { ok: false, code, error: MESSAGES[code] });
  assertEquals(r.res.headers.get('access-control-allow-origin'), ORIGIN);
}

const touchedNothing = (w: World) => {
  assertEquals(w.docReads, []);
  assertEquals(w.partReads, []);
  assertEquals(w.signed, []);
  assertEquals(w.userFileReads, []);
  assertEquals(w.signedPrivate, []);
};

// ─── Success ─────────────────────────────────────────────────────────────────

Deno.test('a live document page answers 200 with the part and a signed_path relative to /storage/v1', async () => {
  const w = world();
  const r = await call(w, { document_id: DOC, page: 12 });
  assertEquals(r.status, 200);
  assertEquals(r.json, {
    ok: true,
    signed_path: `object/sign/corpus/files/${SHA1}.pdf?token=${SIG}`,
    part_index: 1,
    page_offset: 10,
    page_count: 10,
    byte_size: 2000,
    expires_in: 300,
  });
  assertEquals(SIGN_SECONDS, 300);
  assertEquals(w.signed, [{ path: `files/${SHA1}.pdf`, seconds: 300 }]);
  assertEquals(r.res.headers.get('access-control-allow-origin'), ORIGIN);
  assertEquals(r.res.headers.get('cache-control'), 'no-store');
});

Deno.test('the reads go out with the caller token; only the sign step is token-free', async () => {
  const w = world();
  await call(w, { document_id: DOC, page: 1 });
  assertEquals(w.verified, [TOKEN]);
  assertEquals(w.docReads, [{ token: TOKEN, id: DOC }]);
  assertEquals(w.partReads, [{ token: TOKEN, id: DOC, page: 1 }]);
});

Deno.test('signed_path is relative when the function sees the local kong URL', async () => {
  const w = world({ base: 'http://kong:8000' });
  const r = await call(w, { document_id: DOC, page: 1 });
  assertEquals(r.status, 200);
  assertEquals(r.json.signed_path, `object/sign/corpus/files/${SHA0}.pdf?token=${SIG}`);
  assertFalse(r.text.includes('kong'));
});

Deno.test('signed_path is relative when the function sees the hosted URL', async () => {
  const w = world({ base: 'https://abcdefgh.supabase.co' });
  const r = await call(w, { document_id: DOC, page: 25 });
  assertEquals(r.status, 200);
  assertEquals(r.json.signed_path, `object/sign/corpus/files/${SHA2}.pdf?token=${SIG}`);
  assertFalse(r.text.includes('supabase.co'));
  assertFalse(r.text.includes('http'));
});

Deno.test('a signed URL outside /storage/v1/object/sign/corpus/ is refused as unavailable, never passed on', async () => {
  const w = world();
  const d = deps(w);
  d.sign = () => Promise.resolve(`https://elsewhere.example/x/object/sign/corpus/files/${SHA0}.pdf?token=${SIG}`);
  const res = await handleDocumentFile(post({ document_id: DOC, page: 1 }), d);
  const json = await res.json();
  assertEquals(res.status, 503);
  assertEquals(json, { ok: false, code: 'unavailable', error: MESSAGES.unavailable });
});

Deno.test('a /storage/v1/ URL that is not a signed corpus object with a token is refused as unavailable', async () => {
  const shapes = [
    `https://abcdefgh.supabase.co/storage/v1/object/public/corpus/files/${SHA0}.pdf`,
    `https://abcdefgh.supabase.co/storage/v1/object/sign/other-bucket/files/${SHA0}.pdf?token=${SIG}`,
    `https://abcdefgh.supabase.co/storage/v1/object/sign/corpus/files/${SHA0}.pdf`,
    `https://abcdefgh.supabase.co/storage/v1/object/sign/corpus/files/${SHA0}.pdf?token=`,
    // As long as '/storage/v1/' but another route: only the real prefix is stripped.
    `https://abcdefgh.supabase.co/abcdefghij/object/sign/corpus/files/${SHA0}.pdf?token=${SIG}`,
    'not a url',
  ];
  for (const url of shapes) {
    const w = world();
    const d = deps(w);
    d.sign = () => Promise.resolve(url);
    const res = await handleDocumentFile(post({ document_id: DOC, page: 1 }), d);
    assertEquals(res.status, 503, url);
    assertEquals(await res.json(), { ok: false, code: 'unavailable', error: MESSAGES.unavailable });
  }
});

// ─── Part lookup ─────────────────────────────────────────────────────────────

Deno.test('part lookup: page_offset < page <= page_offset + page_count, at every boundary', async () => {
  const cases: Array<[number, number]> = [
    [1, 0], // page_offset + 1 of part 0
    [10, 0], // page_offset + page_count of part 0
    [11, 1], // page_offset + 1 of part 1
    [20, 1], // page_offset + page_count of part 1
    [21, 2], // page_offset + 1 of part 2
    [25, 2], // page_offset + page_count of part 2 (the last page)
  ];
  for (const [page, part] of cases) {
    const w = world();
    const r = await call(w, { document_id: DOC, page });
    assertEquals(r.status, 200, `page ${page}`);
    assertEquals(r.json.part_index, part, `page ${page}`);
    assertEquals(w.signed[0].path, PARTS[part].storage_path, `page ${page}`);
  }
});

Deno.test('part lookup does not depend on the order the parts arrive in', async () => {
  const cases: Array<[number, number]> = [[1, 0], [10, 0], [11, 1], [20, 1], [21, 2], [25, 2]];
  for (const [page, part] of cases) {
    const w = world({ parts: [...PARTS].reverse() });
    const r = await call(w, { document_id: DOC, page });
    assertEquals(r.status, 200, `page ${page}`);
    assertEquals(r.json.part_index, part, `page ${page}`);
  }
});

Deno.test('a part never covers its own page_offset: page 10 with only part 1 (offset 10) is 404', async () => {
  const w = world({ parts: [PARTS[1]] });
  const r = await call(w, { document_id: DOC, page: 10 });
  assertRefusal(r, 404, 'not_found');
  assertEquals(w.signed, []);
});

Deno.test('a single-part document covers its pages with part 0', async () => {
  const w = world({
    doc: { ...LIVE, page_count: 3 },
    parts: [{ part_index: 0, page_offset: 0, page_count: 3, byte_size: 99, storage_path: `files/${SHA0}.pdf` }],
  });
  const r = await call(w, { document_id: DOC, page: 3 });
  assertEquals(r.status, 200);
  assertEquals(r.json.part_index, 0);
  assertEquals(r.json.byte_size, 99);
});

Deno.test('404 when no part covers the page (a gap between parts), nothing signed', async () => {
  const w = world({ parts: [PARTS[0], PARTS[2]] });
  const r = await call(w, { document_id: DOC, page: 15 });
  assertRefusal(r, 404, 'not_found');
  assertEquals(w.signed, []);
});

Deno.test('404 when the document has no parts at all', async () => {
  const w = world({ parts: [] });
  const r = await call(w, { document_id: DOC, page: 1 });
  assertRefusal(r, 404, 'not_found');
  assertEquals(w.signed, []);
});

// ─── 400 ─────────────────────────────────────────────────────────────────────

Deno.test('400 for a malformed body, a non-uuid id or a non-integer page; nothing read', async () => {
  const bodies: unknown[] = [
    'not json',
    '',
    '[]',
    'null',
    '42',
    {},
    { page: 1 },
    { document_id: DOC },
    { document_id: 'not-a-uuid', page: 1 },
    { document_id: `${DOC}x`, page: 1 },
    { document_id: 42, page: 1 },
    { document_id: DOC, page: 1.5 },
    { document_id: DOC, page: '1' },
    { document_id: DOC, page: null },
    { document_id: DOC, page: Number.MAX_SAFE_INTEGER + 2 },
  ];
  for (const body of bodies) {
    const w = world();
    const r = await call(w, body);
    assertRefusal(r, 400, 'bad_request');
    touchedNothing(w);
  }
});

Deno.test('400 for an oversized body, nothing read', async () => {
  const w = world();
  const r = await call(w, JSON.stringify({ document_id: DOC, page: 1, pad: 'x'.repeat(10_000) }));
  assertRefusal(r, 400, 'bad_request');
  touchedNothing(w);
});

Deno.test('a method other than POST or OPTIONS is refused with 400, nothing read', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const w = world();
    const r = await call(w, { document_id: DOC, page: 1 }, { method });
    assertRefusal(r, 400, 'bad_request');
    touchedNothing(w);
  }
});

// ─── 401 ─────────────────────────────────────────────────────────────────────

Deno.test('401 without a bearer, with a malformed one, or one Auth rejects; never reads the DB', async () => {
  for (const auth of [null, 'Basic abc', 'Bearer not-a-jwt', 'Bearer a.b.c']) {
    const w = world();
    const r = await call(w, { document_id: DOC, page: 1 }, { auth });
    assertRefusal(r, 401, 'unauthorized');
    touchedNothing(w);
  }
});

Deno.test('401 comes before the body is looked at (an unauthenticated malformed body is 401)', async () => {
  const w = world();
  const r = await call(w, 'not json', { auth: null });
  assertRefusal(r, 401, 'unauthorized');
  touchedNothing(w);
});

// ─── 404 ─────────────────────────────────────────────────────────────────────

Deno.test('404 for a missing document (or one RLS hides), no parts read, nothing signed', async () => {
  const w = world({ doc: null });
  const r = await call(w, { document_id: DOC, page: 1 });
  assertRefusal(r, 404, 'not_found');
  assertEquals(w.partReads, []);
  assertEquals(w.signed, []);
});

Deno.test('404 for a legacy document (storage_path null), nothing signed', async () => {
  const w = world({ doc: { ...LIVE, storage_path: null } });
  const r = await call(w, { document_id: DOC, page: 1 });
  assertRefusal(r, 404, 'not_found');
  assertEquals(w.partReads, []);
  assertEquals(w.signed, []);
});

Deno.test('404 for a document that is not live (indexed_at null or extract_hash null), nothing signed', async () => {
  for (const doc of [{ ...LIVE, indexed_at: null }, { ...LIVE, extract_hash: null }, { ...LIVE, page_count: null }]) {
    const w = world({ doc });
    const r = await call(w, { document_id: DOC, page: 1 });
    assertRefusal(r, 404, 'not_found');
    assertEquals(w.partReads, []);
    assertEquals(w.signed, []);
  }
});

// ─── 422 ─────────────────────────────────────────────────────────────────────

Deno.test('422 for page < 1 or page > page_count, no parts read, nothing signed', async () => {
  for (const page of [0, -1, 26, 1000]) {
    const w = world();
    const r = await call(w, { document_id: DOC, page });
    assertRefusal(r, 422, 'bad_page');
    assertEquals(w.partReads, []);
    assertEquals(w.signed, []);
  }
});

Deno.test('check order: a missing document wins over an out-of-range page (404, not 422)', async () => {
  const w = world({ doc: null });
  const r = await call(w, { document_id: DOC, page: 0 });
  assertRefusal(r, 404, 'not_found');
});

Deno.test('check order: an out-of-range page wins over a missing part (422, not 404)', async () => {
  const w = world({ parts: [] });
  const r = await call(w, { document_id: DOC, page: 26 });
  assertRefusal(r, 422, 'bad_page');
  assertEquals(w.partReads, []);
});

// ─── Failures ────────────────────────────────────────────────────────────────

Deno.test('a read or sign failure is 503 with a fixed message', async () => {
  for (const over of [{ failDoc: true }, { failSign: true }]) {
    const w = world(over);
    const r = await call(w, { document_id: DOC, page: 1 });
    assertRefusal(r, 503, 'unavailable');
  }
});

Deno.test('an Auth outage (verify throws) is 503, not 401, and reads nothing', async () => {
  const w = world();
  const d = deps(w);
  d.verify = () => Promise.reject(new Error('auth server down'));
  const res = await handleDocumentFile(post({ document_id: DOC, page: 1 }), d);
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { ok: false, code: 'unavailable', error: MESSAGES.unavailable });
  touchedNothing(w);
});

// ─── Logging ─────────────────────────────────────────────────────────────────

const SECRET_TEXT = [/token=/, /sign\//, /files\//, /storage/, new RegExp(SIG.split('.')[1]), /caller-secret/, /kong/];

function assertCleanLogs(logs: string[]) {
  assert(logs.length > 0, 'expected at least one log line');
  for (const line of logs) {
    for (const re of SECRET_TEXT) assertFalse(re.test(line), `log line leaks ${re}: ${line}`);
    const fields = Object.keys(JSON.parse(line)).filter((k) => k !== 'event');
    for (const f of fields) {
      assert(['user_id', 'document_id', 'file_id', 'part_index', 'page', 'outcome', 'code'].includes(f), `unexpected field ${f}`);
    }
  }
}

Deno.test('logs on success carry only user, document, part, page and outcome; never the path, URL or token', async () => {
  const w = world({ base: 'http://kong:8000' });
  await call(w, { document_id: DOC, page: 12 });
  assertCleanLogs(w.logs);
  const line = JSON.parse(w.logs[w.logs.length - 1]);
  assertEquals(line.user_id, USER);
  assertEquals(line.document_id, DOC);
  assertEquals(line.part_index, 1);
  assertEquals(line.page, 12);
  assertEquals(line.outcome, 'ok');
});

Deno.test('logs on refusals and failures never carry the path, URL, token or error text', async () => {
  const worlds: Array<[World, unknown, Parameters<typeof post>[1]]> = [
    [world(), { document_id: DOC, page: 1 }, { auth: null }],
    [world(), 'not json', {}],
    [world({ doc: null }), { document_id: DOC, page: 1 }, {}],
    [world(), { document_id: DOC, page: 99 }, {}],
    [world({ parts: [] }), { document_id: DOC, page: 1 }, {}],
    [world({ failSign: true }), { document_id: DOC, page: 1 }, {}],
    [world({ failDoc: true }), { document_id: DOC, page: 1 }, {}],
  ];
  for (const [w, body, opts] of worlds) {
    await call(w, body, opts);
    assertCleanLogs(w.logs);
  }
});

// ─── CORS ────────────────────────────────────────────────────────────────────

Deno.test('preflight answers 204 with CORS for an allowed origin, without auth and without reads', async () => {
  const w = world();
  const res = await handleDocumentFile(
    new Request('https://f/document-file', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
    deps(w),
  );
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert((res.headers.get('access-control-allow-methods') ?? '').includes('POST'));
  assert((res.headers.get('access-control-allow-headers') ?? '').includes('authorization'));
  assertEquals(w.verified, []);
  touchedNothing(w);
});

Deno.test('a foreign origin gets no Access-Control-Allow-Origin, on preflight or on POST', async () => {
  const w = world();
  const pre = await handleDocumentFile(
    new Request('https://f/document-file', { method: 'OPTIONS', headers: { origin: FOREIGN } }),
    deps(w),
  );
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get('access-control-allow-origin'), null);
  const r = await call(w, { document_id: DOC, page: 1 }, { origin: FOREIGN });
  assertEquals(r.res.headers.get('access-control-allow-origin'), null);
  const refused = await call(world(), { document_id: DOC, page: 1 }, { origin: FOREIGN, auth: null });
  assertEquals(refused.status, 401);
  assertEquals(refused.res.headers.get('access-control-allow-origin'), null);
});

// ─── Security review L1, I3 (2026-10-01) ─────────────────────────────────────

Deno.test('a part whose storage_path is not files/<sha256>.pdf is never signed (503)', async () => {
  for (const path of ['../avatars/x.png', 'staging/abc.pdf', `files/${SHA0}.pdf/../../x`, `files/${SHA0}.PDF`, '']) {
    const w = world({ parts: [{ ...PARTS[0], storage_path: path }] });
    const res = await handleDocumentFile(post({ document_id: DOC, page: 1 }), deps(w));
    assertEquals(res.status, 503, path);
    assertEquals(w.signed.length, 0, `signed ${path}`);
  }
});

Deno.test('every reply carries x-content-type-options: nosniff', async () => {
  const ok = await handleDocumentFile(post({ document_id: DOC, page: 1 }), deps(world()));
  const refused = await handleDocumentFile(post({ document_id: DOC, page: 1 }, { auth: null }), deps(world()));
  assertEquals(ok.headers.get('x-content-type-options'), 'nosniff');
  assertEquals(refused.headers.get('x-content-type-options'), 'nosniff');
});

// ─── Private User Files (Feature F341) ───────────────────────────────────────

Deno.test('private file: successful citation viewing returns 200 with signed_path relative to /storage/v1', async () => {
  const w = world();
  const r = await call(w, { file_id: FILE_ID });
  assertEquals(r.status, 200);
  assertEquals(r.json, {
    ok: true,
    signed_path: `object/sign/user-files/${USER}/${FILE_ID}/document.pdf?token=${SIG}`,
    page_count: 5,
    byte_size: 4096,
    expires_in: 300,
  });
  assertEquals(w.signedPrivate, [{ path: `${USER}/${FILE_ID}/document.pdf`, seconds: 300 }]);
  assertEquals(w.userFileReads, [{ token: TOKEN, fileId: FILE_ID }]);
  assertEquals(w.docReads, []);
  assertEquals(r.res.headers.get('access-control-allow-origin'), ORIGIN);
  assertEquals(r.res.headers.get('cache-control'), 'no-store');
  assertCleanLogs(w.logs);
});

Deno.test('private file: accepts source_origin: private and optional page', async () => {
  const cases: unknown[] = [
    { file_id: FILE_ID, source_origin: 'private' },
    { file_id: FILE_ID, source_origin: 'private', page: 2 },
    { file_id: FILE_ID, page: 3 },
    { document_id: DOC, file_id: FILE_ID, source_origin: 'private', page: 1 },
    { document_id: FILE_ID, source_origin: 'private' },
  ];
  for (const body of cases) {
    const w = world();
    const r = await call(w, body);
    assertEquals(r.status, 200);
    assertEquals(r.json.ok, true);
    assertEquals(r.json.signed_path, `object/sign/user-files/${USER}/${FILE_ID}/document.pdf?token=${SIG}`);
  }
});

Deno.test('private file: fallback page_count is 1 when file row page_count is null or undefined', async () => {
  const w = world();
  w.userFiles.set(FILE_ID, { ...PRIVATE_FILE, page_count: null });
  const r = await call(w, { file_id: FILE_ID });
  assertEquals(r.status, 200);
  assertEquals(r.json.page_count, 1);
});

Deno.test('private file: 404 when file is in Trash (deleted_at !== null), nothing signed', async () => {
  const w = world();
  w.userFiles.set(FILE_ID, { ...PRIVATE_FILE, deleted_at: '2026-11-14T10:00:00Z' });
  const r = await call(w, { file_id: FILE_ID });
  assertRefusal(r, 404, 'not_found');
  assertEquals(w.signedPrivate, []);
});

Deno.test('private file: 404 when file is owned by another user, nothing signed', async () => {
  const w = world();
  w.userFiles.set(FILE_ID, { ...PRIVATE_FILE, user_id: OTHER_USER });
  const r = await call(w, { file_id: FILE_ID });
  assertRefusal(r, 404, 'not_found');
  assertEquals(w.signedPrivate, []);
});

Deno.test('private file: 404 when file does not exist, nothing signed', async () => {
  const w = world();
  const missingId = '55555555-5555-4555-8555-555555555555';
  const r = await call(w, { file_id: missingId });
  assertRefusal(r, 404, 'not_found');
  assertEquals(w.signedPrivate, []);
});

Deno.test('private file: 404 when upload_status is not uploaded, nothing signed', async () => {
  for (const status of ['pending_upload', 'uploading', 'upload_failed']) {
    const w = world();
    w.userFiles.set(FILE_ID, { ...PRIVATE_FILE, upload_status: status });
    const r = await call(w, { file_id: FILE_ID });
    assertRefusal(r, 404, 'not_found');
    assertEquals(w.signedPrivate, []);
  }
});

Deno.test('private file: 404 when storage_path does not start with caller UUID or contains traversal', async () => {
  const badPaths = [
    `${OTHER_USER}/${FILE_ID}/document.pdf`,
    `files/${SHA0}.pdf`,
    `${USER}/../secret.pdf`,
    `${USER}\\evil.pdf`,
    'not-a-path',
    '',
  ];
  for (const path of badPaths) {
    const w = world();
    w.userFiles.set(FILE_ID, { ...PRIVATE_FILE, storage_path: path });
    const r = await call(w, { file_id: FILE_ID });
    assertRefusal(r, 404, 'not_found');
    assertEquals(w.signedPrivate, []);
  }
});

Deno.test('private file: 401 without bearer or with invalid token, never reads user_files', async () => {
  for (const auth of [null, 'Basic abc', 'Bearer not-a-jwt', 'Bearer a.b.c']) {
    const w = world();
    const r = await call(w, { file_id: FILE_ID }, { auth });
    assertRefusal(r, 401, 'unauthorized');
    touchedNothing(w);
  }
});

Deno.test('private file: 400 for malformed body, invalid UUID, or invalid fields; nothing read', async () => {
  const badBodies: unknown[] = [
    { file_id: 'not-a-uuid' },
    { file_id: `${FILE_ID}x` },
    { file_id: 123 },
    { file_id: null },
    { file_id: FILE_ID, page: '1' },
    { file_id: FILE_ID, page: 1.5 },
    { file_id: FILE_ID, page: null },
    { file_id: FILE_ID, source_origin: 'invalid' },
    { file_id: FILE_ID, source_origin: 'shared' },
    { source_origin: 'private' },
    { source_origin: 'shared' },
  ];
  for (const body of badBodies) {
    const w = world();
    const r = await call(w, body);
    assertRefusal(r, 400, 'bad_request');
    touchedNothing(w);
  }
});

Deno.test('private file: 503 when read or signing fails, or signed URL shape is invalid', async () => {
  // DB read failure
  const w1 = world({ failUserFile: true });
  const r1 = await call(w1, { file_id: FILE_ID });
  assertRefusal(r1, 503, 'unavailable');

  // Sign failure
  const w2 = world({ failSignPrivate: true });
  const r2 = await call(w2, { file_id: FILE_ID });
  assertRefusal(r2, 503, 'unavailable');

  // Unexpected signed URL shape (e.g. wrong bucket or not /storage/v1/)
  const wrongUrls = [
    `https://abcdefgh.supabase.co/storage/v1/object/sign/corpus/${USER}/${FILE_ID}/document.pdf?token=${SIG}`,
    `https://abcdefgh.supabase.co/storage/v1/object/public/user-files/${USER}/${FILE_ID}/document.pdf`,
    `https://elsewhere.example/x/object/sign/user-files/${USER}/${FILE_ID}/document.pdf?token=${SIG}`,
    'not a url',
  ];
  for (const url of wrongUrls) {
    const w = world();
    const d = deps(w);
    d.signPrivate = () => Promise.resolve(url);
    const res = await handleDocumentFile(post({ file_id: FILE_ID }), d);
    assertEquals(res.status, 503, `failed for url: ${url}, got status ${res.status}`);
    assertEquals(await res.json(), { ok: false, code: 'unavailable', error: MESSAGES.unavailable });
  }
});

Deno.test('private file: logs carry user, file_id and outcome; never the path, URL or token', async () => {
  const w = world();
  await call(w, { file_id: FILE_ID });
  assertCleanLogs(w.logs);
  const line = JSON.parse(w.logs[w.logs.length - 1]);
  assertEquals(line.user_id, USER);
  assertEquals(line.file_id, FILE_ID);
  assertEquals(line.outcome, 'ok');
});
