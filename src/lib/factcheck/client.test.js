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

describe('sharing actions', () => {
  it('videoView posts action video_view with video_id', async () => {
    const reply = { ok: true, unlock_credits_per_minute: 100, stretches: [] };
    const { client, calls } = make(() => json(200, reply));
    expect(await client.videoView({ videoId: 'v1' })).toEqual(reply);
    expect(JSON.parse(calls[0].init.body)).toEqual({ action: 'video_view', video_id: 'v1' });
  });

  it('unlock posts stretch_id and expected_credits', async () => {
    const { client, calls } = make(() => json(200, { ok: true, charged: 300 }));
    await client.unlock({ stretchId: 'st1', expectedCredits: 300 });
    expect(JSON.parse(calls[0].init.body)).toEqual({ action: 'unlock', stretch_id: 'st1', expected_credits: 300 });
  });

  it('report posts claim_id and reason', async () => {
    const { client, calls } = make(() => json(200, { ok: true }));
    await client.report({ claimId: 'c1', reason: 'wrong' });
    expect(JSON.parse(calls[0].init.body)).toEqual({ action: 'report', claim_id: 'c1', reason: 'wrong' });
    await client.report({ claimId: 'c2' });
    expect(JSON.parse(calls[1].init.body)).toEqual({ action: 'report', claim_id: 'c2', reason: '' });
  });

  it.each([
    ['unlock', { stretchId: 's', expectedCredits: 1 }, 402, { reason: 'insufficient', needed: 300, available: 10 }, { status: 402, reason: 'insufficient', needed: 300, available: 10 }],
    ['unlock', { stretchId: 's', expectedCredits: 1 }, 409, { reason: 'price_changed', price: 500 }, { status: 409, reason: 'price_changed', price: 500 }],
    ['unlock', { stretchId: 's', expectedCredits: 1 }, 409, { reason: 'own' }, { status: 409, reason: 'own' }],
    ['unlock', { stretchId: 's', expectedCredits: 1 }, 429, { reason: 'rate_limited' }, { status: 429, reason: 'rate_limited' }],
    ['unlock', { stretchId: 's', expectedCredits: 1 }, 404, { reason: 'not_found' }, { status: 404, reason: 'not_found' }],
    ['unlock', { stretchId: 's', expectedCredits: 1 }, 403, { reason: 'off' }, { status: 403, reason: 'off' }],
    ['unlock', { stretchId: 's', expectedCredits: 1 }, 403, { reason: 'not_allowed' }, { status: 403, reason: 'not_allowed' }],
    ['report', { claimId: 'c' }, 409, { reason: 'already' }, { status: 409, reason: 'already' }],
    ['report', { claimId: 'c' }, 429, { reason: 'rate_limited' }, { status: 429, reason: 'rate_limited' }],
    ['report', { claimId: 'c' }, 404, { reason: 'not_found' }, { status: 404, reason: 'not_found' }],
    ['report', { claimId: 'c' }, 403, { reason: 'off' }, { status: 403, reason: 'off' }],
    ['videoView', { videoId: 'v' }, 403, { reason: 'not_allowed' }, { status: 403, reason: 'not_allowed' }],
    ['videoView', { videoId: 'v' }, 403, { reason: 'off' }, { status: 403, reason: 'off' }],
  ])('%s maps HTTP %i %j to a FactCheckError', async (action, args, status, body, expected) => {
    const { client } = make(() => json(status, body));
    const err = await client[action](args).catch(e => e);
    expect(err).toBeInstanceOf(FactCheckError);
    expect(err).toMatchObject(expected);
  });

  it('transcribe sends piece_no, pos_start_s and pos_end_s when given, and returns stored', async () => {
    const { client, calls } = make(() => json(200, { seq: 1, text: 'x', seconds_left: 9, stored: true }));
    const out = await client.transcribe({ session_id: 's', seq: 1, file: new Blob([new Uint8Array(2)]), pieceNo: 2, posStartS: 10.5, posEndS: 21.25 });
    expect(out.stored).toBe(true);
    const form = calls[0].init.body;
    expect([...form.keys()]).toEqual(['action', 'session_id', 'seq', 'file', 'piece_no', 'pos_start_s', 'pos_end_s']);
    expect(form.get('piece_no')).toBe('2');
    expect(form.get('pos_start_s')).toBe('10.5');
    expect(form.get('pos_end_s')).toBe('21.25');
  });

  it('transcribe without them sends exactly the four slice 1 fields', async () => {
    const { client, calls } = make(() => json(200, { seq: 1, text: 'x', seconds_left: 9 }));
    await client.transcribe({ session_id: 's', seq: 1, file: new Blob([new Uint8Array(2)]) });
    expect([...calls[0].init.body.keys()]).toEqual(['action', 'session_id', 'seq', 'file']);
    await client.transcribe({ session_id: 's', seq: 1, file: new Blob([new Uint8Array(2)]), pieceNo: 3 });
    expect([...calls[1].init.body.keys()]).toEqual(['action', 'session_id', 'seq', 'file', 'piece_no']);
  });

  it('extract passes a piece range turn through, and start returns shareable', async () => {
    const { client, calls } = make(() => json(200, { shareable: true, claims: [] }));
    const turn = { piece_from: 2, piece_to: 3, spoken_at: 'x', position_s: 5 };
    await client.extract({ session_id: 's', turn, recent: [], ledger: null, seed: {} });
    expect(JSON.parse(calls[0].init.body).turn).toEqual(turn);
    expect((await client.start({ video_id: 'v' })).shareable).toBe(true);
  });
});

describe('already_active', () => {
  it('carries the id of the session that is still active', async () => {
    const { client } = make(() => json(409, { reason: 'already_active', session_id: 'old-1' }));
    const err = await client.start({ video_id: 'v', minutes: 5 }).catch(e => e);
    expect(err).toMatchObject({ status: 409, reason: 'already_active', sessionId: 'old-1' });
  });
  it('a 429 budget answer has no Retry-After and is reported as it came', async () => {
    const { client } = make(() => json(429, { reason: 'budget' }));
    const err = await client.check({ session_id: 's', claim_id: 'c' }).catch(e => e);
    expect(err).toMatchObject({ status: 429, reason: 'budget' });
    expect(err.retryAfterMs).toBeUndefined();
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

describe('recheck', () => {
  const claim = { id: 'n1', supersedes: 'c1', status: 'checked', verdict: 'contradicted', reason: 'r', sources: [{ url: 'https://a.test', title: 'A' }], checked_at: '2026-11-16T10:00:00Z' };

  it('posts the recheck action with claim_id and expected_recheck_credits and maps the answer', async () => {
    const { client, calls } = make(() => json(200, { claim, credits_charged: 100, balance: 900 }));
    const out = await client.recheck({ claimId: 'c1', expectedRecheckCredits: 100 });
    expect(JSON.parse(calls[0].init.body)).toEqual({ action: 'recheck', claim_id: 'c1', expected_recheck_credits: 100 });
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok-1');
    expect(out).toEqual({ claim, creditsCharged: 100, balance: 900, chargePending: false });
  });

  it('carries charge_pending, and a delayed charge has no amount yet', async () => {
    const { client } = make(() => json(200, { claim, credits_charged: null, balance: 900, charge_pending: true }));
    expect(await client.recheck({ claimId: 'c1', expectedRecheckCredits: 100 })).toEqual({ claim, creditsCharged: null, balance: 900, chargePending: true });
  });

  it('a saved error claim comes back with nothing charged', async () => {
    const bad = { ...claim, status: 'error', verdict: null };
    const { client } = make(() => json(200, { claim: bad, credits_charged: 0, balance: 900, charge_pending: false }));
    expect(await client.recheck({ claimId: 'c1', expectedRecheckCredits: 100 })).toEqual({ claim: bad, creditsCharged: 0, balance: 900, chargePending: false });
  });

  it('a 409 not_recheckable carries the newer claim when the server sent one', async () => {
    const { client } = make(() => json(409, { reason: 'not_recheckable', claim }));
    const err = await client.recheck({ claimId: 'c1', expectedRecheckCredits: 100 }).catch((e) => e);
    expect(err).toMatchObject({ status: 409, reason: 'not_recheckable', claim });
    const { client: plain } = make(() => json(409, { reason: 'not_recheckable' }));
    expect((await plain.recheck({ claimId: 'c1', expectedRecheckCredits: 100 }).catch((e) => e)).claim).toBeUndefined();
  });

  it('too_many_failures is a 429 with no wait', async () => {
    const { client } = make(() => json(429, { reason: 'too_many_failures' }));
    const err = await client.recheck({ claimId: 'c1', expectedRecheckCredits: 100 }).catch((e) => e);
    expect(err).toMatchObject({ status: 429, reason: 'too_many_failures' });
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('a 500 is a server error', async () => {
    const { client } = make(() => json(500, {}));
    expect(await client.recheck({ claimId: 'c1', expectedRecheckCredits: 100 }).catch((e) => e)).toMatchObject({ status: 500, reason: 'server_error' });
  });

  it('passes an abort signal through', async () => {
    const { client, calls } = make(() => json(200, { claim, credits_charged: 0, balance: 1 }));
    const ctl = new AbortController();
    await client.recheck({ claimId: 'c1', expectedRecheckCredits: 100, signal: ctl.signal });
    expect(calls[0].init.signal).toBe(ctl.signal);
  });

  it('a body without a claim is a bad response, not a result', async () => {
    const { client } = make(() => json(200, { credits_charged: 0 }));
    const err = await client.recheck({ claimId: 'c1', expectedRecheckCredits: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(FactCheckError);
    expect(err).toMatchObject({ status: 0, reason: 'bad_response' });
  });

  it.each([
    [402, { reason: 'insufficient', needed: 100, available: 40 }, { status: 402, reason: 'insufficient', needed: 100, available: 40 }],
    [403, { reason: 'off' }, { status: 403, reason: 'off' }],
    [403, { reason: 'not_allowed' }, { status: 403, reason: 'not_allowed' }],
    [404, { reason: 'claim_not_found' }, { status: 404, reason: 'claim_not_found' }],
    [409, { reason: 'not_recheckable' }, { status: 409, reason: 'not_recheckable' }],
    [409, { reason: 'price_changed', recheck_credits: 150 }, { status: 409, reason: 'price_changed', recheckCredits: 150 }],
    [502, {}, { status: 502, reason: 'server_error' }],
    [401, {}, { status: 401, reason: 'unauthorized' }],
  ])('HTTP %s %j', async (status, body, expected) => {
    const { client } = make(() => json(status, body));
    const err = await client.recheck({ claimId: 'c1', expectedRecheckCredits: 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(FactCheckError);
    expect(err).toMatchObject(expected);
  });

  it.each(['rate_limited', 'in_progress'])('429 %s keeps the Retry-After wait', async (reason) => {
    const { client } = make(() => json(429, { reason }, { 'retry-after': '7' }));
    const err = await client.recheck({ claimId: 'c1', expectedRecheckCredits: 100 }).catch((e) => e);
    expect(err).toMatchObject({ status: 429, reason, retryAfterMs: 7000, retryable: true });
  });

  it('a lost connection is status 0', async () => {
    const { client } = make(() => { throw new TypeError('offline'); });
    const err = await client.recheck({ claimId: 'c1', expectedRecheckCredits: 100 }).catch((e) => e);
    expect(err).toMatchObject({ status: 0, reason: 'network' });
  });

  it('is exported as a function of the default client', async () => {
    const mod = await import('./client.js');
    expect(typeof mod.recheck).toBe('function');
  });
});
