// Browser helpers for S5: admin writes carry the verified bearer, and the
// intro video upload is sign -> direct Storage upload -> finalize.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({ current: { id: 'admin-id', email: 'admin@example.test', token: 'admin-token' } }));
const storage = vi.hoisted(() => ({ uploads: [], error: null }));

vi.mock('./userStore.js', () => ({
  verifiedLocalIdentity: vi.fn(async () => identity.current),
}));
vi.mock('./supabaseClient.js', () => ({
  supabase: {
    storage: {
      from: (bucket) => ({
        uploadToSignedUrl: vi.fn(async (path, token, file, options) => {
          storage.uploads.push({ bucket, path, token, file, options });
          return storage.error ? { data: null, error: storage.error } : { data: { path }, error: null };
        }),
      }),
    },
  },
}));

import { verifiedLocalIdentity } from './userStore.js';
import { clearIntroVideo, saveIntroVideoMeta, uploadIntroVideo } from './marketingIntroVideo.js';

function reply(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock;
beforeEach(() => {
  identity.current = { id: 'admin-id', email: 'admin@example.test', token: 'admin-token' };
  storage.uploads = [];
  storage.error = null;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('intro video admin helpers', () => {
  it('uploads through a signed URL and then finalizes, reporting progress', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ ok: true, bucket: 'marketing', path: 'intro-video/intro-video.mov', token: 'signed-token' }))
      .mockResolvedValueOnce(reply({ ok: true, hasVideo: true, fileName: 'intro-video.mov', bytes: 4 }));
    const progress = [];
    const file = new Blob(['abcd']);
    Object.defineProperty(file, 'name', { value: 'clip.MOV' });
    const body = await uploadIntroVideo(file, (p) => progress.push(p));

    expect(body.fileName).toBe('intro-video.mov');
    const [signUrl, signInit] = fetchMock.mock.calls[0];
    expect(signUrl).toBe('/api/marketing/intro-video/upload-url');
    expect(signInit.headers.Authorization).toBe('Bearer admin-token');
    expect(JSON.parse(signInit.body)).toEqual({ contentType: 'video/quicktime', bytes: 4, fileName: 'clip.MOV' });
    expect(storage.uploads).toHaveLength(1);
    expect(storage.uploads[0]).toMatchObject({ bucket: 'marketing', path: 'intro-video/intro-video.mov', token: 'signed-token', file });
    expect(storage.uploads[0].options).toMatchObject({ contentType: 'video/quicktime', upsert: true });
    const [finalUrl, finalInit] = fetchMock.mock.calls[1];
    expect(finalUrl).toBe('/api/marketing/intro-video/finalize');
    expect(finalInit.headers.Authorization).toBe('Bearer admin-token');
    expect(JSON.parse(finalInit.body)).toEqual({ path: 'intro-video/intro-video.mov' });
    expect(progress).toEqual([0, 10, 90, 100]);
  });

  it('does not finalize when the Storage upload fails', async () => {
    fetchMock.mockResolvedValueOnce(reply({ ok: true, bucket: 'marketing', path: 'intro-video/intro-video.mp4', token: 't' }));
    storage.error = { message: 'The object exceeded the maximum allowed size' };
    await expect(uploadIntroVideo(new Blob(['x'], { type: 'video/mp4' }))).rejects.toThrow(/maximum allowed size/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the bearer on metadata saves and deletes', async () => {
    fetchMock.mockResolvedValue(reply({ ok: true, hasVideo: false }));
    await saveIntroVideoMeta({ title: 'T' });
    await clearIntroVideo();
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.headers.Authorization])).toEqual([
      ['/api/marketing/intro-video', 'PUT', 'Bearer admin-token'],
      ['/api/marketing/intro-video', 'DELETE', 'Bearer admin-token'],
    ]);
  });
});
