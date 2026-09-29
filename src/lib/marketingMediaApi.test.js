// S5 route handler against in-memory fakes: the marketing intro video
// persists through Supabase (table app_flags, bucket marketing), GET stays
// public, and every write needs a verified internal admin. (The S4
// testing-phase flag was retired on 2026-09-28.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/authEmailProvider.mjs', () => ({
  getSupabaseAdminClient: vi.fn(() => { throw new Error('tests inject adminClient'); }),
}));

import { handleMarketingMediaApi } from '../../server/marketingMediaApi.mjs';

const ADMIN_ID = '00000000-0000-4000-8000-0000000000a1';
const STORAGE_URL = 'https://project.example.test/storage/v1';

function request(method, url, body, authorization = 'Bearer verified-token') {
  return {
    method,
    url,
    headers: { host: 'localhost', ...(authorization == null ? {} : { authorization }) },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield JSON.stringify(body); },
  };
}

async function invoke(handler, req, deps) {
  const res = { setHeader: vi.fn(), end: vi.fn() };
  const next = vi.fn();
  await handler(req, res, next, deps);
  const raw = res.end.mock.calls[0]?.[0];
  return { status: res.statusCode, body: raw ? JSON.parse(raw) : null, next };
}

/** Caller-token client for authorizeLocalUser: a verified user and profile. */
function tokenClient({ role = 'admin', admin = true, status = 'active' } = {}) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: ADMIN_ID, email: 'admin@example.test' } }, error: null })) },
    rpc: vi.fn(async (name) => ({
      data: name === 'is_platform_admin' ? admin : { user_id: ADMIN_ID, role, status },
      error: null,
    })),
  };
}

/** Secret-key client: app_flags rows plus the marketing bucket. */
function adminFake(initialRows = {}) {
  const rows = new Map(Object.entries(initialRows));
  const objects = new Map();
  const calls = { upserts: [], signed: [], removed: [], buckets: [] };
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 8, 28, 12, 0, clock++)).toISOString();

  function from(table) {
    if (table !== 'app_flags') throw new Error(`unexpected table ${table}`);
    const filters = {};
    let written = null;
    const builder = {
      select: () => builder,
      eq: (column, value) => { filters[column] = value; return builder; },
      upsert: (row, options) => {
        calls.upserts.push({ row, options });
        written = { ...row, updated_at: row.updated_at || stamp() };
        rows.set(row.key, written);
        return builder;
      },
      maybeSingle: async () => {
        const row = rows.get(filters.key);
        return { data: row ? { key: filters.key, value: row.value, updated_at: row.updated_at } : null, error: null };
      },
      single: async () => ({ data: { key: written.key, value: written.value, updated_at: written.updated_at }, error: null }),
    };
    return builder;
  }

  const storage = {
    from(bucket) {
      calls.buckets.push(bucket);
      return {
        createSignedUploadUrl: async (path, options) => {
          calls.signed.push({ path, options });
          return { data: { signedUrl: `${STORAGE_URL}/object/upload/sign/${bucket}/${path}?token=tok`, token: 'tok', path }, error: null };
        },
        info: async (path) => {
          const object = objects.get(path);
          return object
            ? { data: { name: path, size: object.size, contentType: object.contentType }, error: null }
            : { data: null, error: { message: 'Object not found', statusCode: '404' } };
        },
        getPublicUrl: (path, options) => ({
          data: { publicUrl: `${STORAGE_URL}/object/public/${bucket}/${path}${options?.cacheNonce ? `?cacheNonce=${options.cacheNonce}` : ''}` },
        }),
        remove: async (paths) => {
          calls.removed.push(...paths);
          for (const path of paths) objects.delete(path);
          return { data: [], error: null };
        },
      };
    },
  };

  const client = { from, storage };
  return {
    client,
    rows,
    objects,
    calls,
    deps: (token = tokenClient()) => ({ adminClient: () => client, clientForToken: vi.fn(() => token) }),
  };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('/api/marketing/intro-video', () => {
  const base = '/api/marketing/intro-video';

  it('serves today\'s default shape publicly when nothing is stored', async () => {
    const fake = adminFake();
    const response = await invoke(handleMarketingMediaApi, request('GET', base, undefined, null), fake.deps());
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      enabled: true,
      title: 'What nter.pro is',
      subtitle: 'A two-minute look at the terminal before you sign in.',
      videoUrl: '',
      externalUrl: '',
      posterUrl: '',
      fileName: '',
      updatedAt: '',
      bytes: 0,
      hasVideo: false,
    });
  });

  it.each([
    ['PUT', base, { title: 'Hijacked' }],
    ['DELETE', base, undefined],
    ['POST', `${base}/upload-url`, { contentType: 'video/mp4', bytes: 10 }],
    ['POST', `${base}/finalize`, { path: 'intro-video/intro-video.mp4' }],
  ])('rejects %s %s without a bearer, and for a non-admin', async (method, url, body) => {
    const fake = adminFake();
    const anonymous = await invoke(handleMarketingMediaApi, request(method, url, body, null), fake.deps());
    expect(anonymous.status).toBe(401);
    const user = await invoke(handleMarketingMediaApi, request(method, url, body), fake.deps(tokenClient({ role: 'user', admin: false })));
    expect(user.status).toBe(403);
    expect(fake.calls.upserts).toEqual([]);
    expect(fake.calls.signed).toEqual([]);
    expect(fake.calls.removed).toEqual([]);
  });

  it('issues a signed upload URL for a fixed object path, then finalizes the metadata', async () => {
    const fake = adminFake();
    const issued = await invoke(handleMarketingMediaApi,
      request('POST', `${base}/upload-url`, { contentType: 'video/webm', bytes: 2048, fileName: '../../etc/passwd.webm' }), fake.deps());
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({ ok: true, bucket: 'marketing', path: 'intro-video/intro-video.webm', token: 'tok' });
    expect(issued.body.signedUrl).toContain('/object/upload/sign/marketing/intro-video/intro-video.webm');
    expect(fake.calls.signed).toEqual([{ path: 'intro-video/intro-video.webm', options: { upsert: true } }]);
    expect(fake.calls.upserts).toEqual([]);

    // The browser uploads straight to Storage; the object now exists.
    fake.objects.set('intro-video/intro-video.webm', { size: 2048, contentType: 'video/webm' });
    const finalized = await invoke(handleMarketingMediaApi,
      request('POST', `${base}/finalize`, { path: 'intro-video/intro-video.webm' }), fake.deps());
    expect(finalized.status).toBe(200);
    expect(finalized.body).toMatchObject({ ok: true, hasVideo: true, fileName: 'intro-video.webm', bytes: 2048 });
    expect(finalized.body.videoUrl).toMatch(/^https:\/\/project\.example\.test\/storage\/v1\/object\/public\/marketing\/intro-video\/intro-video\.webm\?cacheNonce=\d+$/);
    expect(fake.calls.upserts.at(-1).row).toMatchObject({ key: 'marketing_intro_video', updated_by: ADMIN_ID });

    const read = await invoke(handleMarketingMediaApi, request('GET', base, undefined, null), fake.deps());
    expect(read.body.videoUrl).toBe(finalized.body.videoUrl);
    expect(read.body.hasVideo).toBe(true);
    expect(read.body).not.toHaveProperty('objectPath');
  });

  it('removes the previous object when a new format replaces it', async () => {
    const fake = adminFake();
    fake.objects.set('intro-video/intro-video.mp4', { size: 10, contentType: 'video/mp4' });
    await invoke(handleMarketingMediaApi, request('POST', `${base}/finalize`, { path: 'intro-video/intro-video.mp4' }), fake.deps());
    fake.objects.set('intro-video/intro-video.mov', { size: 20, contentType: 'video/quicktime' });
    const next = await invoke(handleMarketingMediaApi, request('POST', `${base}/finalize`, { path: 'intro-video/intro-video.mov' }), fake.deps());
    expect(next.body.fileName).toBe('intro-video.mov');
    expect(fake.calls.removed).toEqual(['intro-video/intro-video.mp4']);
  });

  it.each([
    [{ contentType: 'text/html', bytes: 10 }, 400],
    [{ contentType: 'video/mp4', bytes: 0 }, 400],
    [{ contentType: 'video/mp4', bytes: 50 * 1024 * 1024 + 1 }, 413],
  ])('refuses to sign %o', async (body, status) => {
    const fake = adminFake();
    const response = await invoke(handleMarketingMediaApi, request('POST', `${base}/upload-url`, body), fake.deps());
    expect(response.status).toBe(status);
    expect(fake.calls.signed).toEqual([]);
  });

  it.each([
    ['a path outside the fixed set', { path: 'other/evil.mp4' }, 400],
    ['an object that was never uploaded', { path: 'intro-video/intro-video.mp4' }, 409],
  ])('refuses to finalize %s', async (_label, body, status) => {
    const fake = adminFake();
    const response = await invoke(handleMarketingMediaApi, request('POST', `${base}/finalize`, body), fake.deps());
    expect(response.status).toBe(status);
    expect(fake.calls.upserts).toEqual([]);
  });

  it('DELETE removes the Storage object and clears the metadata', async () => {
    const fake = adminFake();
    fake.objects.set('intro-video/intro-video.mp4', { size: 10, contentType: 'video/mp4' });
    await invoke(handleMarketingMediaApi, request('PUT', base, { title: 'Kept title', externalUrl: 'https://youtu.be/abcdefgh' }), fake.deps());
    await invoke(handleMarketingMediaApi, request('POST', `${base}/finalize`, { path: 'intro-video/intro-video.mp4' }), fake.deps());
    const cleared = await invoke(handleMarketingMediaApi, request('DELETE', base), fake.deps());
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ ok: true, title: 'Kept title', videoUrl: '', externalUrl: '', fileName: '', bytes: 0, hasVideo: false });
    expect(fake.calls.removed).toEqual(['intro-video/intro-video.mp4']);
    const read = await invoke(handleMarketingMediaApi, request('GET', base, undefined, null), fake.deps());
    expect(read.body.hasVideo).toBe(false);
    expect(read.body.videoUrl).toBe('');
  });

  it('PUT updates the metadata from a pre-parsed body and rejects script URLs', async () => {
    const fake = adminFake();
    const parsed = { ...request('PUT', base), body: { enabled: false, title: 'New title', externalUrl: 'https://vimeo.com/123' } };
    const saved = await invoke(handleMarketingMediaApi, parsed, fake.deps());
    expect(saved.body).toMatchObject({ ok: true, enabled: false, title: 'New title', externalUrl: 'https://vimeo.com/123', hasVideo: false });
    const bad = await invoke(handleMarketingMediaApi, request('PUT', base, { externalUrl: 'javascript:alert(1)' }), fake.deps());
    expect(bad.status).toBe(400);
    expect(fake.calls.upserts).toHaveLength(1);
  });

  it('no longer accepts a raw-body upload to the route itself', async () => {
    const fake = adminFake();
    const response = await invoke(handleMarketingMediaApi, request('POST', base, 'binary'), fake.deps());
    expect(response.status).toBe(405);
    expect(fake.calls.upserts).toEqual([]);
  });
});
