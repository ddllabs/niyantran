import { describe, expect, it } from 'vitest';
import { createDocumentFileClient, DOCUMENT_FILE_FAILED } from './documentFile.js';

const DOC = '6f1c2a54-8a3e-4c2f-9d55-0b6f6f2f5a10';
const BASE = 'http://127.0.0.1:54321/';

// A 3-part split: pages 1-10, 11-25, 26-30.
const PARTS = [
  { part_index: 0, page_offset: 0, page_count: 10, byte_size: 1000 },
  { part_index: 1, page_offset: 10, page_count: 15, byte_size: 2000 },
  { part_index: 2, page_offset: 25, page_count: 5, byte_size: 500 },
];

/** A fake document-file function: signs the part holding the page, numbering each signature. */
function fakeFunction({ expiresIn = 300 } = {}) {
  const calls = [];
  const request = async body => {
    calls.push(body);
    const part = PARTS.find(p => p.page_offset < body.page && body.page <= p.page_offset + p.page_count);
    if (!part) return { ok: false, code: 'bad_page', error: 'Page out of range.' };
    return {
      ok: true,
      signed_path: `object/sign/corpus/files/${String(part.part_index).repeat(64)}.pdf?token=t${calls.length}`,
      ...part,
      expires_in: expiresIn,
    };
  };
  return { request, calls };
}

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('createDocumentFileClient.partFor', () => {
  it('asks document-file for the page and builds the absolute storage URL', async () => {
    const { request, calls } = fakeFunction();
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
    const part = await client.partFor(DOC, 12);
    expect(calls).toEqual([{ document_id: DOC, page: 12 }]);
    expect(part).toEqual({
      url: `http://127.0.0.1:54321/storage/v1/object/sign/corpus/files/${'1'.repeat(64)}.pdf?token=t1`,
      partIndex: 1,
      pageOffset: 10,
      pageCount: 15,
      byteSize: 2000,
    });
  });

  it('reuses a cached part for any page inside it, without a request', async () => {
    const { request, calls } = fakeFunction();
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
    const first = await client.partFor(DOC, 11);
    expect(await client.partFor(DOC, 25)).toEqual(first);
    expect(await client.partFor(DOC, 18)).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it('requests again for a page in another part, at both sides of the boundary', async () => {
    const { request, calls } = fakeFunction();
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
    expect((await client.partFor(DOC, 10)).partIndex).toBe(0);
    expect((await client.partFor(DOC, 11)).partIndex).toBe(1);
    expect((await client.partFor(DOC, 26)).partIndex).toBe(2);
    expect(calls.map(c => c.page)).toEqual([10, 11, 26]);
  });

  it('keeps separate caches per document', async () => {
    const { request, calls } = fakeFunction();
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
    await client.partFor(DOC, 3);
    await client.partFor('another-document', 3);
    expect(calls).toHaveLength(2);
  });

  it('reuses the signature until 30 seconds before it expires, then signs again', async () => {
    const { request, calls } = fakeFunction({ expiresIn: 300 });
    const c = clock();
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: c.now });
    await client.partFor(DOC, 3);
    c.t += 269_999;
    expect((await client.partFor(DOC, 3)).url).toMatch(/token=t1$/);
    c.t += 1;
    expect((await client.partFor(DOC, 3)).url).toMatch(/token=t2$/);
    expect(calls).toHaveLength(2);
  });

  it('does not cache a signature that expires within 30 seconds', async () => {
    const { request, calls } = fakeFunction({ expiresIn: 20 });
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
    await client.partFor(DOC, 3);
    await client.partFor(DOC, 3);
    expect(calls).toHaveLength(2);
  });

  it('invalidate drops one part so the next call signs anew', async () => {
    const { request, calls } = fakeFunction();
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
    await client.partFor(DOC, 3);
    await client.partFor(DOC, 12);
    client.invalidate(DOC, 0);
    expect((await client.partFor(DOC, 3)).url).toMatch(/token=t3$/);
    expect((await client.partFor(DOC, 12)).url).toMatch(/token=t2$/);
    expect(calls).toHaveLength(3);
  });

  it('shares one request between concurrent calls for the same page', async () => {
    const { request, calls } = fakeFunction();
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
    const [a, b] = await Promise.all([client.partFor(DOC, 5), client.partFor(DOC, 5)]);
    expect(a).toEqual(b);
    expect(calls).toHaveLength(1);
  });

  it('accepts a base URL without a trailing slash and a signed path with a leading one', async () => {
    const request = async () => ({ ok: true, signed_path: `/object/sign/corpus/files/${'d'.repeat(64)}.pdf?token=a`, ...PARTS[0], expires_in: 300 });
    const client = createDocumentFileClient({ request, baseUrl: 'https://abc.supabase.co', now: clock().now });
    expect((await client.partFor(DOC, 1)).url).toBe(`https://abc.supabase.co/storage/v1/object/sign/corpus/files/${'d'.repeat(64)}.pdf?token=a`);
  });
});

describe('createDocumentFileClient refusals', () => {
  it('rejects a refusal with its code and a fixed message, never the server text', async () => {
    for (const code of ['bad_request', 'unauthorized', 'not_found', 'bad_page', 'unavailable']) {
      const request = async () => ({ ok: false, code, error: 'server says https://evil.test/?token=x' });
      const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
      const error = await failure(client.partFor(DOC, 1));
      expect(error.code).toBe(code);
      expect(error.message).toBe(DOCUMENT_FILE_FAILED);
    }
  });

  it('maps an unknown refusal code to bad_response', async () => {
    const request = async () => ({ ok: false, code: '<img src=x>', error: 'x' });
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
    expect((await failure(client.partFor(DOC, 1))).code).toBe('bad_response');
  });

  it('maps a thrown request to unavailable, without its text', async () => {
    const request = async () => { throw new TypeError('Failed to fetch http://127.0.0.1:54321/functions/v1/document-file'); };
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
    const error = await failure(client.partFor(DOC, 1));
    expect(error.code).toBe('unavailable');
    expect(error.message).toBe(DOCUMENT_FILE_FAILED);
    expect(error.cause).toBeUndefined();
  });

  it('rejects a malformed success as bad_response and caches nothing', async () => {
    const bad = [
      null,
      { ok: true, ...PARTS[0], expires_in: 300 },
      { ok: true, signed_path: '', ...PARTS[0], expires_in: 300 },
      { ok: true, signed_path: `object/sign/corpus/files/${'e'.repeat(64)}.pdf?token=a`, ...PARTS[0], byte_size: 0, expires_in: 300 },
      { ok: true, signed_path: `object/sign/corpus/files/${'e'.repeat(64)}.pdf?token=a`, ...PARTS[0], page_count: 0, expires_in: 300 },
      { ok: true, signed_path: `object/sign/corpus/files/${'e'.repeat(64)}.pdf?token=a`, ...PARTS[0], expires_in: 'soon' },
      // A part that does not hold the requested page.
      { ok: true, signed_path: `object/sign/corpus/files/${'e'.repeat(64)}.pdf?token=a`, ...PARTS[1], expires_in: 300 },
    ];
    for (const body of bad) {
      let calls = 0;
      const request = async () => { calls += 1; return body; };
      const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
      expect((await failure(client.partFor(DOC, 3))).code).toBe('bad_response');
      await failure(client.partFor(DOC, 3));
      expect(calls).toBe(2);
    }
  });

  it('refuses a malformed document id or page without a request', async () => {
    const { request, calls } = fakeFunction();
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
    for (const [id, page] of [['', 1], [null, 1], [DOC, 0], [DOC, 1.5], [DOC, '2']]) {
      expect((await failure(client.partFor(id, page))).code).toBe('bad_request');
    }
    expect(calls).toHaveLength(0);
  });

  it('a failed request is not shared with the next call', async () => {
    let n = 0;
    const request = async () => {
      n += 1;
      if (n === 1) throw new Error('offline');
      return { ok: true, signed_path: `object/sign/corpus/files/${'e'.repeat(64)}.pdf?token=a`, ...PARTS[0], expires_in: 300 };
    };
    const client = createDocumentFileClient({ request, baseUrl: BASE, now: clock().now });
    await failure(client.partFor(DOC, 1));
    expect((await client.partFor(DOC, 1)).partIndex).toBe(0);
  });
});

// Security review L2 (2026-10-01): a tampered signed_path could climb out of /storage/v1 on the
// project origin. Only the shape the function produces is accepted.
describe('createDocumentFileClient signed_path shape', () => {
  const SHA = 'a'.repeat(64);
  const shaped = (signed_path) => async () => ({ ok: true, signed_path, ...PARTS[0], expires_in: 300 });
  it('refuses any signed_path that is not object/sign/corpus/files/<sha256>.pdf with a token', async () => {
    for (const bad of [
      '../../rest/v1/user_profiles?select=*',
      '..\\..\\auth/v1/user',
      `object/sign/corpus/../../../rest/v1/x?token=a`,
      `object/sign/corpus/files/../../../../auth/v1/user?token=a`,
      `object/sign/avatars/files/${SHA}.pdf?token=a`,
      `object/sign/corpus/files/${SHA}.pdf`,
      `object/sign/corpus/staging/${SHA}.pdf?token=a`,
    ]) {
      const client = createDocumentFileClient({ request: shaped(bad), baseUrl: BASE });
      expect((await failure(client.partFor(DOC, 1))).code, bad).toBe('bad_response');
    }
  });
  it('accepts the shape the function produces, on the client\'s own origin', async () => {
    const client = createDocumentFileClient({ request: shaped(`object/sign/corpus/files/${SHA}.pdf?token=abc.def`), baseUrl: BASE });
    const part = await client.partFor(DOC, 1);
    expect(part.url).toBe(`http://127.0.0.1:54321/storage/v1/object/sign/corpus/files/${SHA}.pdf?token=abc.def`);
  });
});
