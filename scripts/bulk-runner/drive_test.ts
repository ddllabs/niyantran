import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { createDriveClient, type DriveDeps, parseKey, type ServiceAccountKey, signJwt } from './drive.ts';

const FOLDER = 'application/vnd.google-apps.folder';
const SECRET_TOKEN = 'ya29.TEST-TOKEN-SECRET';
const enc = new TextEncoder();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64url = (s: string) =>
  Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

/** A key pair made here, in the test; the private half is returned as the PEM a key file holds. */
async function makeKey() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const lines = b64(der).match(/.{1,64}/g)!.join('\n');
  const key: ServiceAccountKey = {
    client_email: 'reader@example.iam.gserviceaccount.com',
    private_key: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`,
  };
  return { key, publicKey: pair.publicKey };
}
const KEYS = await makeKey();

Deno.test('parseKey: takes a key file with the two fields and refuses others without echoing them', () => {
  const k = parseKey(JSON.stringify({ ...KEYS.key, type: 'service_account', extra: 1 }));
  assertEquals(k, KEYS.key);
  const bad = [
    'not json',
    '{}',
    JSON.stringify({ client_email: 'a@b' }),
    JSON.stringify({ private_key: KEYS.key.private_key }),
    JSON.stringify({ client_email: 'a@b', private_key: 'SECRET-PEM-TEXT' }),
  ];
  for (const text of bad) {
    const e = assertThrows(() => parseKey(text), Error);
    assert(!e.message.includes('SECRET-PEM-TEXT') && !e.message.includes('not json'), e.message);
  }
});

Deno.test('signJwt: an RS256 token whose signature verifies against the public key, with the right claims', async () => {
  const jwt = await signJwt(KEYS.key, 1_700_000_000);
  const [h, c, s] = jwt.split('.');
  assertEquals(JSON.parse(new TextDecoder().decode(unb64url(h))), { alg: 'RS256', typ: 'JWT' });
  assertEquals(JSON.parse(new TextDecoder().decode(unb64url(c))), {
    iss: KEYS.key.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1_700_000_000,
    exp: 1_700_003_000,
  });
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    KEYS.publicKey,
    unb64url(s) as BufferSource,
    enc.encode(`${h}.${c}`),
  );
  assert(ok, 'signature must verify');
  assert(!jwt.includes('=') && !jwt.includes('+') && !jwt.includes('/'), 'base64url without padding');
});

Deno.test('signJwt: a tampered payload does not verify (the test can tell)', async () => {
  const [h, , s] = (await signJwt(KEYS.key, 1)).split('.');
  const forged = btoa(JSON.stringify({ iss: 'x' })).replaceAll('=', '');
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    KEYS.publicKey,
    unb64url(s) as BufferSource,
    enc.encode(`${h}.${forged}`),
  );
  assertEquals(ok, false);
});

type Handler = (url: URL, init: RequestInit, n: number) => Response | Promise<Response>;
interface Fake {
  deps: DriveDeps;
  requests: Array<{ url: URL; init: RequestInit }>;
  sleeps: number[];
  clock: { ms: number };
}
/** A fake Google: the token endpoint plus whatever `api` answers. */
function fake(api: Handler, opt: { expiresIn?: number; tokenStatus?: number; tokenBody?: unknown } = {}): Fake {
  const requests: Fake['requests'] = [];
  const sleeps: number[] = [];
  const clock = { ms: 1_700_000_000_000 };
  let tokens = 0;
  const f = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.origin + url.pathname === 'https://oauth2.googleapis.com/token') {
      if (opt.tokenStatus) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: opt.tokenStatus }));
      }
      if (opt.tokenBody !== undefined) return Promise.resolve(Response.json(opt.tokenBody));
      tokens++;
      return Promise.resolve(
        Response.json({ access_token: `${SECRET_TOKEN}-${tokens}`, expires_in: opt.expiresIn ?? 3599 }),
      );
    }
    return Promise.resolve(
      api(url, init, requests.filter((r) => r.url.origin !== 'https://oauth2.googleapis.com').length),
    );
  };
  return {
    deps: {
      fetch: f as typeof fetch,
      now: () => clock.ms,
      sleep: (ms) => {
        sleeps.push(ms);
        clock.ms += ms;
        return Promise.resolve();
      },
    },
    requests,
    sleeps,
    clock,
  };
}
const files = (...f: unknown[]) => Response.json({ files: f });

Deno.test('token: a form post of the jwt-bearer grant with a verifiable assertion, once for many calls', async () => {
  const fk = fake(() => files());
  const d = createDriveClient(KEYS.key, fk.deps);
  await d.children('f1');
  await d.children('f2');
  const posts = fk.requests.filter((r) => r.url.pathname === '/token');
  assertEquals(posts.length, 1);
  assertEquals(posts[0].init.method, 'POST');
  const body = new URLSearchParams(String(posts[0].init.body));
  assertEquals(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [h, c, s] = body.get('assertion')!.split('.');
  assert(
    await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      KEYS.publicKey,
      unb64url(s) as BufferSource,
      enc.encode(`${h}.${c}`),
    ),
  );
  const api = fk.requests.filter((r) => r.url.pathname !== '/token');
  for (const r of api) assertEquals(new Headers(r.init.headers).get('authorization'), `Bearer ${SECRET_TOKEN}-1`);
});

Deno.test('token: asked for again once it has expired', async () => {
  const fk = fake(() => files(), { expiresIn: 3600 });
  const d = createDriveClient(KEYS.key, fk.deps);
  await d.children('f1');
  fk.clock.ms += 3_600_000;
  await d.children('f1');
  assertEquals(fk.requests.filter((r) => r.url.pathname === '/token').length, 2);
});

Deno.test('token: a 401 from the API drops the token and the retry gets a new one', async () => {
  const fk = fake((_u, _i, n) => n === 1 ? new Response('', { status: 401 }) : files());
  const d = createDriveClient(KEYS.key, fk.deps);
  await d.children('f1');
  assertEquals(fk.requests.filter((r) => r.url.pathname === '/token').length, 2);
});

Deno.test('token: a refused token request stops with the status and error code only', async () => {
  const fk = fake(() => files(), { tokenStatus: 400 });
  const d = createDriveClient(KEYS.key, fk.deps);
  const e = await assertRejects(() => d.children('f1'), Error, '400');
  assert(e.message.includes('invalid_grant'));
  assert(!e.message.includes('PRIVATE KEY'));
});

Deno.test('children: lists a folder with ids, sizes and checksums, following pages', async () => {
  const fk = fake((url) => {
    if (url.searchParams.get('pageToken') === 'p2') {
      return files({ id: 'b', name: 'b.zip', mimeType: 'application/zip', size: '4250000000', sha256Checksum: 'ab' });
    }
    return Response.json({ nextPageToken: 'p2', files: [{ id: 'a', name: 'a', mimeType: FOLDER }] });
  });
  const items = await createDriveClient(KEYS.key, fk.deps).children("fo'lder");
  assertEquals(items, [
    { id: 'a', name: 'a', mimeType: FOLDER, size: undefined, sha256Checksum: undefined },
    { id: 'b', name: 'b.zip', mimeType: 'application/zip', size: 4_250_000_000, sha256Checksum: 'ab' },
  ]);
  const q = fk.requests.filter((r) => r.url.pathname === '/drive/v3/files')[0].url;
  assertEquals(q.searchParams.get('q'), "'fo\\'lder' in parents and trashed = false");
  assertEquals(q.searchParams.get('supportsAllDrives'), 'true');
  assertEquals(q.searchParams.get('includeItemsFromAllDrives'), 'true');
  assert(q.searchParams.get('fields')!.includes('sha256Checksum'));
});

Deno.test('folderByPath: starts at what is shared with the account, then walks children by name', async () => {
  const fk = fake((url) => {
    const q = url.searchParams.get('q')!;
    if (q.startsWith('sharedWithMe = true')) {
      assertEquals(q, "sharedWithMe = true and trashed = false and name = 'National'");
      return files({ id: 'nat', name: 'National', mimeType: FOLDER });
    }
    assertEquals(q, "'nat' in parents and trashed = false and name = 'v1.1'");
    return files({ id: 'v11', name: 'v1.1', mimeType: FOLDER });
  });
  const folder = await createDriveClient(KEYS.key, fk.deps).folderByPath('National/v1.1');
  assertEquals(folder.id, 'v11');
});

Deno.test('folderByPath: a missing, ambiguous or non-folder segment is an error naming it', async () => {
  const none = createDriveClient(KEYS.key, fake(() => files()).deps);
  await assertRejects(() => none.folderByPath('National'), Error, 'not found');
  const two = createDriveClient(
    KEYS.key,
    fake(() => files({ id: 'a', name: 'National', mimeType: FOLDER }, { id: 'b', name: 'National', mimeType: FOLDER }))
      .deps,
  );
  await assertRejects(() => two.folderByPath('National'), Error, 'more than one');
  const file = createDriveClient(
    KEYS.key,
    fake(() => files({ id: 'a', name: 'National', mimeType: 'text/plain' })).deps,
  );
  await assertRejects(() => file.folderByPath('National'), Error, 'not a folder');
});

const bytes = (n: number) => new Uint8Array(n).map((_, i) => i % 200);

Deno.test('readRange: a Range header, alt=media, bearer token, and a 206 body returned as is', async () => {
  const fk = fake(() => new Response(bytes(10), { status: 206 }));
  const got = await createDriveClient(KEYS.key, fk.deps).readRange('file/1', 100, 109);
  assertEquals(got, bytes(10));
  const r = fk.requests.find((x) => x.url.pathname.startsWith('/drive/v3/files/'))!;
  assertEquals(r.url.pathname, '/drive/v3/files/file%2F1');
  assertEquals(r.url.searchParams.get('alt'), 'media');
  assertEquals(r.url.searchParams.get('supportsAllDrives'), 'true');
  assertEquals(new Headers(r.init.headers).get('range'), 'bytes=100-109');
});

Deno.test('readRange: a failure is retried three times with growing waits, then stops with the status', async () => {
  const fk = fake(() => new Response('busy', { status: 503 }));
  const d = createDriveClient(KEYS.key, fk.deps);
  await assertRejects(() => d.readRange('f', 0, 9), Error, 'HTTP 503');
  assertEquals(fk.requests.filter((r) => r.url.pathname.startsWith('/drive/')).length, 4);
  assertEquals(fk.sleeps.length, 3);
  assert(fk.sleeps[0] < fk.sleeps[1] && fk.sleeps[1] < fk.sleeps[2], `waits ${fk.sleeps}`);
});

Deno.test('readRange: succeeds when a retry succeeds', async () => {
  const fk = fake((_u, _i, n) => n < 3 ? new Response('x', { status: 500 }) : new Response(bytes(4), { status: 206 }));
  assertEquals(await createDriveClient(KEYS.key, fk.deps).readRange('f', 0, 3), bytes(4));
  assertEquals(fk.sleeps.length, 2);
});

Deno.test('readRange: a 200 (the whole file) is not a range answer', async () => {
  const fk = fake(() => new Response(bytes(10), { status: 200 }));
  await assertRejects(() => createDriveClient(KEYS.key, fk.deps).readRange('f', 0, 9), Error, 'HTTP 200');
});

Deno.test('readRange: a body of the wrong length is never returned', async () => {
  const fk = fake(() => new Response(bytes(9), { status: 206 }));
  await assertRejects(() => createDriveClient(KEYS.key, fk.deps).readRange('f', 0, 9), Error, 'wanted 10');
});

Deno.test('readRange: a network failure is retried too', async () => {
  let n = 0;
  const fk = fake(() => {
    if (++n < 2) throw new TypeError('connection reset');
    return new Response(bytes(2), { status: 206 });
  });
  assertEquals(await createDriveClient(KEYS.key, fk.deps).readRange('f', 0, 1), bytes(2));
});

Deno.test('errors never carry the token, the key or the response body', async () => {
  const fk = fake(() => new Response(`body with ${SECRET_TOKEN}`, { status: 403 }));
  const d = createDriveClient(KEYS.key, fk.deps);
  const e = await assertRejects(() => d.readRange('f', 0, 9), Error, 'HTTP 403');
  assert(!e.message.includes('ya29') && !e.message.includes('PRIVATE KEY') && !e.message.includes('body with'));
});

// ---- review round ----

const erroring = () =>
  new Response(new ReadableStream({ start: (c) => c.error(new TypeError('connection reset')) }), { status: 206 });

Deno.test('readRange: a body that fails while it is read is retried like any failed range', async () => {
  const fk = fake((_u, _i, n) => n === 1 ? erroring() : new Response(bytes(6), { status: 206 }));
  assertEquals(await createDriveClient(KEYS.key, fk.deps).readRange('f', 0, 5), bytes(6));
  assertEquals(fk.sleeps.length, 1);
});

Deno.test('readRange: a short body is retried, and a second try can succeed', async () => {
  const fk = fake((_u, _i, n) => new Response(bytes(n === 1 ? 5 : 6), { status: 206 }));
  assertEquals(await createDriveClient(KEYS.key, fk.deps).readRange('f', 0, 5), bytes(6));
  assertEquals(fk.sleeps.length, 1);
});

Deno.test('readRange: a body that keeps failing stops after the retries with the reason', async () => {
  const fk = fake(() => erroring());
  await assertRejects(() => createDriveClient(KEYS.key, fk.deps).readRange('f', 0, 5), Error, 'network error');
  assertEquals(fk.sleeps.length, 3);
});

Deno.test('key problems are not retried and are not called network errors', async () => {
  const pem = (body: string) => `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
  for (
    const [body, word] of [['!!!not base64!!!', 'not PEM'], [b64(enc.encode('valid base64, not a key')), 'PKCS#8']]
  ) {
    const fk = fake(() => new Response(bytes(2), { status: 206 }));
    const key = { client_email: KEYS.key.client_email, private_key: pem(body) };
    const e = await assertRejects(() => createDriveClient(key, fk.deps).readRange('f', 0, 1), Error, word);
    assert(!e.message.includes('network error') && !e.message.includes('attempts'), e.message);
    assertEquals(fk.sleeps.length, 0);
    assertEquals(fk.requests.length, 0, 'nothing was sent');
  }
});

Deno.test('a token response without a token is one failed attempt with its own message', async () => {
  const fk = fake(() => new Response(bytes(2), { status: 206 }), { tokenBody: { expires_in: 3600 } });
  const e = await assertRejects(() => createDriveClient(KEYS.key, fk.deps).readRange('f', 0, 1), Error, 'no token');
  assert(!e.message.includes('network error'));
  assertEquals(fk.sleeps.length, 0);
  assertEquals(fk.requests.length, 1);
});
