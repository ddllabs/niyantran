import { describe, expect, it } from 'vitest';
import { createRangeReader, PDF_FETCH_FAILED, PDF_RANGE_MISMATCH } from './rangeTransport.js';

const SECRET = 'https://example.test/storage/v1/object/sign/corpus/a.pdf?token=SECRET';

/** A scripted fetch: each call takes the next step (a status, a byte count to return, or 'throw'). */
function scriptedFetch(steps) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, range: init?.headers?.Range });
    const step = steps[calls.length - 1];
    if (step === 'throw') throw new TypeError(`Failed to fetch ${url}`);
    const { status, bytes = 0 } = step;
    return new Response(new Uint8Array(bytes), { status });
  };
  return { fetch, calls };
}

/** URL provider that hands out a new signature after each invalidate(). */
function urls() {
  let n = 1;
  const state = { invalidations: 0 };
  return {
    state,
    getUrl: async () => `${SECRET}${n}`,
    invalidate: () => { state.invalidations += 1; n += 1; },
  };
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('createRangeReader', () => {
  it('requests an inclusive byte range for pdf.js\'s exclusive end and returns the bytes', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 206, bytes: 1024 }]);
    const { getUrl, invalidate, state } = urls();
    const buf = await createRangeReader({ getUrl, invalidate, fetch }).read(0, 1024);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(1024);
    expect(calls).toEqual([{ url: `${SECRET}1`, range: 'bytes=0-1023' }]);
    expect(state.invalidations).toBe(0);
  });

  it('asks for a mid-file range', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 206, bytes: 500 }]);
    const { getUrl, invalidate } = urls();
    await createRangeReader({ getUrl, invalidate, fetch }).read(65536, 66036);
    expect(calls[0].range).toBe('bytes=65536-66035');
  });

  for (const status of [400, 401, 403]) {
    it(`renews the signature and retries once on ${status}`, async () => {
      const { fetch, calls } = scriptedFetch([{ status }, { status: 206, bytes: 10 }]);
      const { getUrl, invalidate, state } = urls();
      const buf = await createRangeReader({ getUrl, invalidate, fetch }).read(10, 20);
      expect(buf.byteLength).toBe(10);
      expect(state.invalidations).toBe(1);
      expect(calls.map(c => c.url)).toEqual([`${SECRET}1`, `${SECRET}2`]);
      expect(calls[1].range).toBe('bytes=10-19');
    });
  }

  it('gives a fixed error, without the URL, when the retry also fails', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 403 }, { status: 403 }, { status: 206, bytes: 10 }]);
    const { getUrl, invalidate } = urls();
    const error = await failure(createRangeReader({ getUrl, invalidate, fetch }).read(0, 10));
    expect(error.message).toBe(PDF_FETCH_FAILED);
    expect(String(error.stack)).not.toContain('SECRET');
    expect(calls).toHaveLength(2);
  });

  it('does not retry other statuses', async () => {
    for (const status of [404, 416, 500]) {
      const { fetch, calls } = scriptedFetch([{ status }, { status: 206, bytes: 10 }]);
      const { getUrl, invalidate, state } = urls();
      const error = await failure(createRangeReader({ getUrl, invalidate, fetch }).read(0, 10));
      expect(error.message).toBe(PDF_FETCH_FAILED);
      expect(calls).toHaveLength(1);
      expect(state.invalidations).toBe(0);
    }
  });

  it('retries a network error once with a fresh URL', async () => {
    const { fetch, calls } = scriptedFetch(['throw', { status: 206, bytes: 10 }]);
    const { getUrl, invalidate, state } = urls();
    const buf = await createRangeReader({ getUrl, invalidate, fetch }).read(0, 10);
    expect(buf.byteLength).toBe(10);
    expect(state.invalidations).toBe(1);
    expect(calls.map(c => c.url)).toEqual([`${SECRET}1`, `${SECRET}2`]);
  });

  it('gives the fixed error, never the network error text, after two network errors', async () => {
    const { fetch, calls } = scriptedFetch(['throw', 'throw', { status: 206, bytes: 10 }]);
    const { getUrl, invalidate } = urls();
    const error = await failure(createRangeReader({ getUrl, invalidate, fetch }).read(0, 10));
    expect(error.message).toBe(PDF_FETCH_FAILED);
    expect(error.message).not.toContain('SECRET');
    expect(error.cause).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it('rejects a body of the wrong length with a fixed error (e.g. 200 with the whole file)', async () => {
    const { fetch } = scriptedFetch([{ status: 200, bytes: 5000 }]);
    const { getUrl, invalidate } = urls();
    const error = await failure(createRangeReader({ getUrl, invalidate, fetch }).read(0, 10));
    expect(error.message).toBe(PDF_RANGE_MISMATCH);
  });

  it('rejects a short 206 body with the same fixed error', async () => {
    const { fetch } = scriptedFetch([{ status: 206, bytes: 9 }]);
    const { getUrl, invalidate } = urls();
    const error = await failure(createRangeReader({ getUrl, invalidate, fetch }).read(0, 10));
    expect(error.message).toBe(PDF_RANGE_MISMATCH);
  });

  it('gives the fixed error when no signed URL can be obtained', async () => {
    const { fetch, calls } = scriptedFetch([{ status: 206, bytes: 10 }]);
    const getUrl = async () => { throw new Error(`refused ${SECRET}`); };
    const error = await failure(createRangeReader({ getUrl, invalidate: () => {}, fetch }).read(0, 10));
    expect(error.message).toBe(PDF_FETCH_FAILED);
    expect(calls).toHaveLength(0);
  });

  it('refuses an empty or malformed range without fetching', async () => {
    const { fetch, calls } = scriptedFetch([]);
    const { getUrl, invalidate } = urls();
    const reader = createRangeReader({ getUrl, invalidate, fetch });
    for (const [begin, end] of [[10, 10], [10, 5], [-1, 5], [0.5, 4], [0, '8']]) {
      expect((await failure(reader.read(begin, end))).message).toBe(PDF_FETCH_FAILED);
    }
    expect(calls).toHaveLength(0);
  });
});
