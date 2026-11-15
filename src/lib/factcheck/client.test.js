// F344 T5: the browser half of the factcheck Edge Function contract. One
// function per action; request shapes and the HTTP-status error mapping.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseClient.js', () => ({
  accessToken: async () => 'tok-default',
  functionsUrl: name => `https://example.test/functions/v1/${name}`,
}));

import { FactCheckError, createFactCheckClient, start, stop } from './client.js';

function make(responder) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, init });
    return responder(url, init, calls.length);
  });
  const client = createFactCheckClient({
    fetchImpl, getToken: async () => 'tok-1', url: 'https://example.test/functions/v1/factcheck',
  });
  return { client, calls, fetchImpl };
}
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('JSON actions', () => {
  it('start posts {action, ...} with the bearer token and returns the body', async () => {
    const reply = { session_id: 's1', credits_per_minute: 500, credits_held: 2500, ends_at: '2026-11-15T10:00:00Z' };
    const { client, calls } = make(() => json(200, reply));
    const out = await client.start({ video_id: 'v', channel_id: 'c', video_kind: 'live', start_position_s: null, minutes: 5 });
    expect(out).toEqual(reply);
    expect(calls[0].url).toBe('https://example.test/functions/v1/factcheck');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok-1');
    expect(calls[0].init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body)).toEqual({
      action: 'start', video_id: 'v', channel_id: 'c', video_kind: 'live', start_position_s: null, minutes: 5,
    });
  });

  it('start sends the displayed price as expected_credits_per_minute', async () => {
    const { client, calls } = make(() => json(200, {}));
    await client.start({ video_id: 'v', channel_id: 'c', video_kind: 'live', start_position_s: null, minutes: 5, expected_credits_per_minute: 500 });
    expect(JSON.parse(calls[0].init.body).expected_credits_per_minute).toBe(500);
  });

  it.each([
    ['extract', { session_id: 's', turn: { text: 't', spoken_at: 'x', position_s: null }, recent: ['a'], ledger: {}, seed: { channel: 'c', title: 't' } }],
    ['check', { session_id: 's', claim_id: 'c1' }],
    ['stop', { session_id: 's' }],
  ])('%s sends its action name and its fields', async (name, args) => {
    const { client, calls } = make(() => json(200, { ok: true }));
    await client[name](args);
    expect(JSON.parse(calls[0].init.body)).toEqual({ action: name, ...args });
  });

  it('does not let a caller override the action', async () => {
    const { client, calls } = make(() => json(200, {}));
    await client.check({ action: 'stop', session_id: 's', claim_id: 'c' });
    expect(JSON.parse(calls[0].init.body).action).toBe('check');
  });

  it('passes an abort signal through to fetch', async () => {
    const { client, calls } = make(() => json(200, {}));
    const ctl = new AbortController();
    await client.stop({ session_id: 's', signal: ctl.signal });
    expect(calls[0].init.signal).toBe(ctl.signal);
    expect(JSON.parse(calls[0].init.body)).toEqual({ action: 'stop', session_id: 's' });
  });
});

describe('transcribe', () => {
  it('posts multipart form-data with action, session_id, seq and file, and no JSON content type', async () => {
    const { client, calls } = make(() => json(200, { seq: 3, text: 'hello', seconds_left: 250 }));
    const wav = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
    const out = await client.transcribe({ session_id: 's1', seq: 3, file: wav });
    expect(out).toEqual({ seq: 3, text: 'hello', seconds_left: 250 });
    const { init } = calls[0];
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('action')).toBe('transcribe');
    expect(init.body.get('session_id')).toBe('s1');
    expect(init.body.get('seq')).toBe('3');
    const file = init.body.get('file');
    expect(file.size).toBe(3);
    expect(file.name).toBe('piece.wav');
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(init.headers['Content-Type']).toBeUndefined();
  });
});

describe('bad success bodies', () => {
  it('a 2xx response that is not JSON becomes status 0, reason bad_response', async () => {
    const { client } = make(() => new Response('<html>gateway</html>', { status: 200 }));
    const err = await client.check({ session_id: 's', claim_id: 'c' }).catch(e => e);
    expect(err).toBeInstanceOf(FactCheckError);
    expect(err).toMatchObject({ status: 0, reason: 'bad_response', retryable: true });
  });
});

describe('error mapping', () => {
  const cases = [
    [402, { reason: 'insufficient', needed: 2500, available: 100 }, { status: 402, reason: 'insufficient', needed: 2500, available: 100 }],
    [409, { reason: 'price_changed', credits_per_minute: 700 }, { status: 409, reason: 'price_changed', creditsPerMinute: 700 }],
    [403, { reason: 'not_allowed' }, { status: 403, reason: 'not_allowed' }],
    [404, { reason: 'not_found' }, { status: 404, reason: 'not_found' }],
    [409, { reason: 'settled' }, { status: 409, reason: 'settled' }],
    [409, { reason: 'ended' }, { status: 409, reason: 'ended' }],
    [429, { reason: 'rate_limited' }, { status: 429, reason: 'rate_limited' }],
    [401, {}, { status: 401, reason: 'unauthorized' }],
    [400, { error: 'bad' }, { status: 400, reason: 'bad_request' }],
    [500, {}, { status: 500, reason: 'server_error' }],
    [502, 'not json', { status: 502, reason: 'server_error' }],
  ];
  it.each(cases)('HTTP %s %j', async (status, body, expected) => {
    const { client } = make(() => typeof body === 'string' ? new Response(body, { status }) : json(status, body));
    const err = await client.check({ session_id: 's', claim_id: 'c' }).catch(e => e);
    expect(err).toBeInstanceOf(FactCheckError);
    expect(err).toMatchObject(expected);
  });

  it('reads Retry-After on a 429', async () => {
    const { client } = make(() => json(429, { reason: 'rate_limited' }, { 'retry-after': '7' }));
    const err = await client.check({ session_id: 's', claim_id: 'c' }).catch(e => e);
    expect(err.retryAfterMs).toBe(7000);
  });

  it('maps a network failure to status 0 and reason network, and keeps it retryable', async () => {
    const { client } = make(() => { throw new TypeError('Failed to fetch'); });
    const err = await client.check({ session_id: 's', claim_id: 'c' }).catch(e => e);
    expect(err).toBeInstanceOf(FactCheckError);
    expect(err).toMatchObject({ status: 0, reason: 'network', retryable: true });
  });

  it('lets an abort through as an AbortError, not a network failure', async () => {
    const { client } = make(() => { throw new DOMException('aborted', 'AbortError'); });
    const err = await client.stop({ session_id: 's' }).catch(e => e);
    expect(err.name).toBe('AbortError');
  });

  it('marks 429 and 5xx retryable, and the rest not', async () => {
    const flags = {};
    for (const status of [402, 403, 404, 409, 429, 500]) {
      const { client } = make(() => json(status, {}));
      flags[status] = (await client.check({ session_id: 's', claim_id: 'c' }).catch(e => e)).retryable;
    }
    expect(flags).toEqual({ 402: false, 403: false, 404: false, 409: false, 429: true, 500: true });
  });

  it('fails without a network call when signed out', async () => {
    const fetchImpl = vi.fn();
    const client = createFactCheckClient({ fetchImpl, getToken: async () => null, url: 'u' });
    const err = await client.stop({ session_id: 's' }).catch(e => e);
    expect(err).toMatchObject({ status: 401, reason: 'signed_out' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never puts the token, the audio or the transcript in an error message', async () => {
    const { client } = make(() => json(500, { error: 'tok-1 secret transcript text' }));
    const err = await client.extract({ session_id: 's', turn: { text: 'private words' } }).catch(e => e);
    expect(err.message).not.toMatch(/tok-1|private words|secret/);
  });
});

describe('default client', () => {
  it('uses accessToken and functionsUrl("factcheck")', async () => {
    const fetchMock = vi.fn(async () => json(200, { minutes_used: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await stop({ session_id: 's' });
      expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/functions/v1/factcheck');
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-default');
      expect(typeof start).toBe('function');
    } finally { vi.unstubAllGlobals(); }
  });
});
