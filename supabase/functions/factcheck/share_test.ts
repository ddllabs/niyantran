import { assertEquals } from 'jsr:@std/assert@1';
import { handleFactcheck } from './handler.ts';
import {
  chatPayload,
  extraction,
  type Harness,
  harness,
  jsonRequest,
  modelClaim,
  NEW_CLAIM,
  SESSION,
  STRETCH,
  transcribeRequest,
  USER,
  VIDEO,
  wav,
} from './testkit.ts';

const BASE = 'https://app.example';
const startBody = (o: Record<string, unknown> = {}) => ({
  action: 'start',
  video_id: VIDEO,
  channel_id: 'aaj-tak',
  video_kind: 'recorded',
  start_position_s: 12,
  minutes: 5,
  ...o,
});
const fromYoutube = (recentVideos: unknown) => ({
  ok: true,
  source: 'youtube-api',
  dataOrigin: 'youtube-api',
  recentVideos,
});
const sharing = () => harness({ livetvApiBase: BASE });
const calls = (h: Harness, name: string) => h.rpcCalls.filter((c) => c.name === name);

// ---- start: confirmation ------------------------------------------------------------------------

Deno.test('a confirmed recorded video is marked shareable and the answer says so', async () => {
  const h = sharing();
  const res = await handleFactcheck(jsonRequest(startBody()), h.deps);
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.shareable, true);
  assertEquals(json.session_id, SESSION);
  assertEquals(h.livetvCalls.length, 1);
  assertEquals(h.livetvCalls[0].url, `${BASE}/api/livetv/videos?channelId=aaj-tak`);
  assertEquals(calls(h, 'factcheck_mark_shareable'), [{
    name: 'factcheck_mark_shareable',
    args: { p_user: USER, p_session: SESSION },
  }]);
  assertEquals(h.events.indexOf('rpc:factcheck_start') < h.events.indexOf('rpc:factcheck_mark_shareable'), true);
  assertEquals(h.livetvCalls[0].signal !== undefined && h.livetvCalls[0].signal !== null, true, 'has a timeout signal');
});

Deno.test('with sharing off nothing is fetched and the answer has no shareable key, even with the base set', async () => {
  for (
    const off of [{ data: false, error: null }, { data: null, error: { code: 'XX000' } }, { data: 'yes', error: null }]
  ) {
    const h = sharing();
    h.rpcResult.factcheck_share_on = off;
    const res = await handleFactcheck(jsonRequest(startBody()), h.deps);
    assertEquals(res.status, 200);
    assertEquals(Object.keys(await res.json()).sort(), ['credits_held', 'credits_per_minute', 'ends_at', 'session_id']);
    assertEquals(h.livetvCalls.length, 0);
    assertEquals(calls(h, 'factcheck_mark_shareable'), []);
  }
  const h = sharing();
  h.admin.value = false;
  await handleFactcheck(jsonRequest(startBody({ is_admin: true })), h.deps);
  assertEquals(calls(h, 'factcheck_share_on'), [{ name: 'factcheck_share_on', args: { p_is_admin: false } }]);
});

Deno.test('the confirmation does not follow redirects', async () => {
  const h = sharing();
  await handleFactcheck(jsonRequest(startBody()), h.deps);
  assertEquals(h.livetvCalls[0].redirect, 'error');
});

Deno.test('a body that streams past the cap is abandoned without being read whole', async () => {
  const h = sharing();
  let pulled = 0;
  h.models.livetv = () =>
    new Response(
      new ReadableStream({
        pull(c) {
          pulled += 100_000;
          c.enqueue(new Uint8Array(100_000));
          if (pulled > 50_000_000) c.close();
        },
      }),
    );
  assertEquals((await (await handleFactcheck(jsonRequest(startBody()), h.deps)).json()).shareable, false);
  assertEquals(pulled < 5_000_000, true, `pulled ${pulled}`);
});

Deno.test('a trailing slash on the base is tolerated and the channel id is encoded', async () => {
  const h = harness({ livetvApiBase: `${BASE}/` });
  await handleFactcheck(jsonRequest(startBody({ channel_id: 'a.b:c' })), h.deps);
  assertEquals(h.livetvCalls[0].url, `${BASE}/api/livetv/videos?channelId=a.b%3Ac`);
});

Deno.test('a live or upcoming video, an absent one and a video with missing flags are not shareable, and start still succeeds', async () => {
  const lists: [string, unknown][] = [
    ['live', fromYoutube([{ videoId: VIDEO, isLive: true, isUpcoming: false }])],
    ['upcoming', fromYoutube([{ videoId: VIDEO, isLive: false, isUpcoming: true }])],
    ['not in the list', fromYoutube([{ videoId: 'someoneElse1', isLive: false, isUpcoming: false }])],
    ['no flags', fromYoutube([{ videoId: VIDEO }])],
    ['id key instead of videoId, but live', fromYoutube([{ id: VIDEO, isLive: true, isUpcoming: false }])],
    ['empty', fromYoutube([])],
    ['curated fallback', {
      ok: true,
      source: 'curated-fallback',
      recentVideos: [{ videoId: VIDEO, isLive: false, isUpcoming: false }],
    }],
    ['stale cache', {
      ok: true,
      source: 'stale-cache',
      recentVideos: [{ videoId: VIDEO, isLive: false, isUpcoming: false }],
    }],
    ['cache (may hold fallback data)', {
      ok: true,
      source: 'cache',
      recentVideos: [{ videoId: VIDEO, isLive: false, isUpcoming: false }],
    }],
    ['no origin', { ok: true, recentVideos: [{ videoId: VIDEO, isLive: false, isUpcoming: false }] }],
    ['not ok', {
      ok: false,
      source: 'youtube-api',
      recentVideos: [{ videoId: VIDEO, isLive: false, isUpcoming: false }],
    }],
    ['no list', { other: 1 }],
    ['list not an array', { recentVideos: 'x' }],
    ['array at top', []],
  ];
  for (const [why, list] of lists) {
    const h = sharing();
    h.models.livetv = () => list;
    const res = await handleFactcheck(jsonRequest(startBody()), h.deps);
    assertEquals(res.status, 200, why);
    assertEquals((await res.json()).shareable, false, why);
    assertEquals(calls(h, 'factcheck_mark_shareable'), [], why);
  }
});

Deno.test('a cached API answer is accepted: only dataOrigin counts, not source', async () => {
  const h = sharing();
  h.models.livetv = () => ({
    ok: true,
    source: 'cache',
    dataOrigin: 'youtube-api',
    recentVideos: [{ videoId: VIDEO, isLive: false, isUpcoming: false }],
  });
  assertEquals((await (await handleFactcheck(jsonRequest(startBody()), h.deps)).json()).shareable, true);
});

Deno.test('the id key is accepted as well as videoId', async () => {
  const h = sharing();
  h.models.livetv = () => fromYoutube([{ id: VIDEO, isLive: false, isUpcoming: false }]);
  assertEquals((await (await handleFactcheck(jsonRequest(startBody()), h.deps)).json()).shareable, true);
});

Deno.test('start never fails because confirmation failed: a failed request, a non-200, bad JSON, a missing env, a slow answer, a failing mark', async () => {
  const cases: [string, () => Harness][] = [
    ['network error', () =>
      Object.assign(sharing(), {
        models: {
          livetv: () => {
            throw new Error('net');
          },
        },
      }) as Harness],
    ['non-200', () => {
      const h = sharing();
      h.models.livetv = () => new Response('no', { status: 500 });
      return h;
    }],
    ['bad json', () => {
      const h = sharing();
      h.models.livetv = () => new Response('<html>');
      return h;
    }],
    ['no env', () => harness()],
    ['mark refuses', () => {
      const h = sharing();
      h.rpcResult.factcheck_mark_shareable = { data: { ok: false, reason: 'off' }, error: null };
      return h;
    }],
    ['mark errors', () => {
      const h = sharing();
      h.rpcResult.factcheck_mark_shareable = { data: null, error: { code: 'XX000' } };
      return h;
    }],
  ];
  for (const [why, make] of cases) {
    const h = make();
    if (why === 'network error') {
      const inner = h.deps.fetch;
      h.deps.fetch = (
        url,
        init,
      ) => (url.includes('/api/livetv/') ? Promise.reject(new Error('net')) : inner(url, init));
    }
    const res = await handleFactcheck(jsonRequest(startBody()), h.deps);
    assertEquals(res.status, 200, why);
    const json = await res.json();
    assertEquals(json.session_id, SESSION, why);
    assertEquals(json.shareable === true, false, why);
  }
});

Deno.test('a timeout on the confirmation does not fail start', async () => {
  const h = sharing();
  const inner = h.deps.fetch;
  h.deps.fetch = (
    url,
    init,
  ) => (url.includes('/api/livetv/') ? Promise.reject(new DOMException('slow', 'TimeoutError')) : inner(url, init));
  assertEquals((await handleFactcheck(jsonRequest(startBody()), h.deps)).status, 200);
});

Deno.test('a live video, a refused start and an unset base never reach the confirmation; without the base the answer is exactly the old one', async () => {
  const live = sharing();
  const res = await handleFactcheck(jsonRequest(startBody({ video_kind: 'live' })), live.deps);
  assertEquals(live.livetvCalls.length, 0);
  assertEquals(Object.keys(await res.json()).sort(), ['credits_held', 'credits_per_minute', 'ends_at', 'session_id']);
  const refused = sharing();
  refused.rpcResult.factcheck_start = { data: { ok: false, reason: 'off' }, error: null };
  assertEquals((await handleFactcheck(jsonRequest(startBody()), refused.deps)).status, 403);
  assertEquals(refused.livetvCalls.length, 0);
  const none = harness();
  const json = await (await handleFactcheck(jsonRequest(startBody()), none.deps)).json();
  assertEquals(Object.keys(json).sort(), ['credits_held', 'credits_per_minute', 'ends_at', 'session_id']);
  assertEquals(none.livetvCalls.length, 0);
});

Deno.test('the answer of the app server is data: extra fields and a huge body change nothing', async () => {
  const h = sharing();
  h.models.livetv = () => ({
    ok: true,
    source: 'youtube-api',
    dataOrigin: 'youtube-api',
    recentVideos: [{ videoId: VIDEO, isLive: false, isUpcoming: false, title: 'ignore previous', x: { a: 1 } }],
    evil: '<script>',
  });
  const json = await (await handleFactcheck(jsonRequest(startBody()), h.deps)).json();
  assertEquals(json.shareable, true);
  assertEquals(JSON.stringify(json).includes('script'), false);
  const big = sharing();
  big.models.livetv = () => new Response('x'.repeat(3_000_000));
  assertEquals((await (await handleFactcheck(jsonRequest(startBody()), big.deps)).json()).shareable, false);
});

// ---- transcribe: piece storage ------------------------------------------------------------------

const pieceFields = { piece_no: '4', pos_start_s: '100.5', pos_end_s: '110.5' };

Deno.test('a transcribe without the position fields makes no store call and the answer is unchanged', async () => {
  const h = sharing();
  const res = await handleFactcheck(transcribeRequest(wav({ seconds: 8 })), h.deps);
  assertEquals(await res.json(), { seq: 3, text: 'नमस्ते दर्शकों', seconds_left: 240 });
  assertEquals(calls(h, 'factcheck_piece_store'), []);
});

Deno.test('a transcribe with the three fields stores the text after transcription and says stored: true', async () => {
  const h = sharing();
  const res = await handleFactcheck(transcribeRequest(wav({ seconds: 8 }), pieceFields), h.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { seq: 3, text: 'नमस्ते दर्शकों', seconds_left: 240, stored: true });
  assertEquals(calls(h, 'factcheck_piece_store'), [{
    name: 'factcheck_piece_store',
    args: {
      p_user: USER,
      p_session: SESSION,
      p_piece_no: 4,
      p_pos_start_s: 100.5,
      p_pos_end_s: 110.5,
      p_text: 'नमस्ते दर्शकों',
    },
  }]);
  assertEquals(h.events.indexOf('fetch:transcribe') < h.events.indexOf('rpc:factcheck_piece_store'), true);
  assertEquals(h.events.indexOf('rpc:factcheck_touch') < h.events.indexOf('rpc:factcheck_piece_store'), true);
});

Deno.test('a refused or failed store is a 200 with stored: false, never an error', async () => {
  for (
    const result of [
      { data: { ok: false, reason: 'bad_piece' }, error: null },
      { data: { ok: false, reason: 'not_shareable' }, error: null },
      { data: { ok: false, reason: 'settled' }, error: null },
      { data: null, error: { code: 'XX000', message: 'secret' } },
      { data: 'weird', error: null },
    ]
  ) {
    const h = sharing();
    h.rpcResult.factcheck_piece_store = result;
    const res = await handleFactcheck(transcribeRequest(wav({ seconds: 8 }), pieceFields), h.deps);
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals([json.stored, json.text], [false, 'नमस्ते दर्शकों']);
  }
});

Deno.test('a silent piece or an empty transcript is not stored', async () => {
  const silent = sharing();
  const j1 =
    await (await handleFactcheck(transcribeRequest(wav({ samples: new Int16Array(32000) }), pieceFields), silent.deps))
      .json();
  assertEquals([j1.text, j1.stored], ['', false]);
  assertEquals(calls(silent, 'factcheck_piece_store'), []);
  const empty = sharing();
  empty.models.transcribe = () => ({ text: '   ' });
  const j2 = await (await handleFactcheck(transcribeRequest(wav({ seconds: 8 }), pieceFields), empty.deps)).json();
  assertEquals(j2.stored, false);
  assertEquals(calls(empty, 'factcheck_piece_store'), []);
});

Deno.test('malformed or partial position fields do not fail the transcription: it is a slice 1 piece with no stored key and no store call', async () => {
  const bad: Record<string, string>[] = [
    { piece_no: '4' },
    { piece_no: '4', pos_start_s: '1' },
    { piece_no: '-1', pos_start_s: '1', pos_end_s: '2' },
    { piece_no: '1.5', pos_start_s: '1', pos_end_s: '2' },
    { piece_no: '1', pos_start_s: 'x', pos_end_s: '2' },
    { piece_no: '1', pos_start_s: '1', pos_end_s: 'Infinity' },
    { piece_no: '1', pos_start_s: '-3', pos_end_s: '2' },
    { piece_no: '1', pos_start_s: '1', pos_end_s: '99999999999' },
  ];
  for (const f of bad) {
    const h = sharing();
    const res = await handleFactcheck(transcribeRequest(wav({ seconds: 8 }), f), h.deps);
    assertEquals(res.status, 200, JSON.stringify(f));
    assertEquals(await res.json(), { seq: 3, text: 'नमस्ते दर्शकों', seconds_left: 240 }, JSON.stringify(f));
    assertEquals(calls(h, 'factcheck_piece_store'), []);
  }
});

// ---- extract by range ---------------------------------------------------------------------------

const rangeBody = (o: Record<string, unknown> = {}) => ({
  action: 'extract',
  session_id: SESSION,
  turn: { piece_from: 4, piece_to: 5, spoken_at: '2026-11-16T10:00:00.000Z', position_s: 999 },
  recent: [],
  ledger: null,
  seed: {},
  ...o,
});
const respond = (h: Harness, claims: unknown[]) => {
  h.models.extract = () => chatPayload(extraction(claims, []));
};
const rc = (o: Record<string, unknown> = {}) => modelClaim({ quote: 'raised the repo rate by 25 basis points', ...o });
const sentUser = (h: Harness) => (h.fetches[0].body as { messages: { content: string }[] }).messages[1].content;

Deno.test('extract by range builds the text from the stored pieces, ignores any text sent with it, takes the position from the first piece and sets shared', async () => {
  const h = sharing();
  respond(h, [rc()]);
  const body = rangeBody();
  (body.turn as Record<string, unknown>).text = 'FORGED text from the browser';
  const res = await handleFactcheck(jsonRequest(body), h.deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).claims.length, 1);
  // the range itself, then the pieces before it as context
  assertEquals(calls(h, 'factcheck_turn_pieces').map((c) => c.args), [
    { p_user: USER, p_session: SESSION, p_from: 4, p_to: 5 },
    { p_user: USER, p_session: SESSION, p_from: 1, p_to: 3 },
  ]);
  const user = sentUser(h);
  assertEquals(user.includes('FORGED'), false);
  assertEquals(user.includes('the central bank raised the repo rate by 25 basis points'), true);
  const row = h.store.rows[0] as unknown as Record<string, unknown>;
  assertEquals([row.shared, row.position_s], [true, 100]);
  assertEquals(h.events.indexOf('rpc:factcheck_touch') < h.events.indexOf('rpc:factcheck_turn_pieces'), true);
});

Deno.test('extract with text never sets shared and never reads stored pieces; a range needs no text', async () => {
  const h = sharing();
  respond(h, [rc()]);
  await handleFactcheck(
    jsonRequest({ ...rangeBody(), turn: { text: 'hello there', spoken_at: '2026-11-16T10:00:00Z', position_s: 5 } }),
    h.deps,
  );
  assertEquals(calls(h, 'factcheck_turn_pieces'), []);
  const row = h.store.rows[0] as unknown as Record<string, unknown>;
  assertEquals('shared' in row, false);
  const withBoth = sharing();
  respond(withBoth, [rc()]);
  await handleFactcheck(
    jsonRequest({
      ...rangeBody(),
      turn: { text: 'hello', piece_from: 4, piece_to: 5, spoken_at: '2026-11-16T10:00:00Z', position_s: null },
    }),
    withBoth.deps,
  );
  assertEquals(calls(withBoth, 'factcheck_turn_pieces').length >= 1, true, 'a range wins over text');
});

Deno.test('stored pieces that do not overlap in time are not merged; ones that do are', async () => {
  const h = sharing();
  h.rpcResult.factcheck_turn_pieces = {
    data: {
      ok: true,
      pieces: [
        { piece_no: 4, pos_start_s: 100, pos_end_s: 110, text: 'one two three four five' },
        { piece_no: 5, pos_start_s: 120, pos_end_s: 130, text: 'four five six seven' },
      ],
    },
    error: null,
  };
  respond(h, []);
  await handleFactcheck(jsonRequest(rangeBody()), h.deps);
  assertEquals(sentUser(h).includes('one two three four five four five six seven'), true);
});

Deno.test('turn_pieces refusals: not_found is 404, bad_range is 400, an error follows the SQLSTATE mapping, and no model is called', async () => {
  for (
    const [data, error, status] of [
      [{ ok: false, reason: 'not_found' }, null, 404],
      [{ ok: false, reason: 'bad_range' }, null, 400],
      [null, { code: '22023' }, 400],
      [{ ok: false, reason: 'surprise' }, null, 500],
      [{ ok: true }, null, 500],
    ] as [unknown, { code: string } | null, number][]
  ) {
    const h = sharing();
    h.rpcResult.factcheck_turn_pieces = { data, error };
    assertEquals((await handleFactcheck(jsonRequest(rangeBody()), h.deps)).status, status);
    assertEquals(h.fetches.length, 0);
  }
});

Deno.test('a bad range is a 400 before the touch: one bound only, negative, reversed, over 12 pieces, not integers', async () => {
  const bad = [
    { piece_from: 4 },
    { piece_to: 5 },
    { piece_from: -1, piece_to: 2 },
    { piece_from: 5, piece_to: 4 },
    { piece_from: 0, piece_to: 12 },
    { piece_from: 1.5, piece_to: 3 },
    { piece_from: '1', piece_to: 3 },
  ];
  for (const t of bad) {
    const h = sharing();
    const res = await handleFactcheck(
      jsonRequest(rangeBody({ turn: { ...t, spoken_at: '2026-11-16T10:00:00Z', position_s: null } })),
      h.deps,
    );
    assertEquals(res.status, 400, JSON.stringify(t));
    assertEquals(h.rpcCalls, []);
  }
});

Deno.test('a range whose pieces merge to nothing returns no claims and calls no model', async () => {
  const h = sharing();
  h.rpcResult.factcheck_turn_pieces = {
    data: { ok: true, pieces: [{ piece_no: 4, pos_start_s: 1, pos_end_s: 5, text: '[संगीत]' }] },
    error: null,
  };
  const json = await (await handleFactcheck(jsonRequest(rangeBody()), h.deps)).json();
  assertEquals(json.claims, []);
  assertEquals(h.fetches.length, 0);
});

Deno.test('extract by range logs one model row as before and a retry returns the saved claims', async () => {
  const h = sharing();
  respond(h, [rc()]);
  const first = await (await handleFactcheck(jsonRequest(rangeBody()), h.deps)).json();
  assertEquals(h.logRows.length, 1);
  assertEquals(h.logRows[0].purpose, 'claim_extraction');
  const retry = await (await handleFactcheck(jsonRequest(rangeBody()), h.deps)).json();
  assertEquals(retry.claims.map((c: { id: string }) => c.id), first.claims.map((c: { id: string }) => c.id));
  assertEquals(h.store.rows.length, 1);
});

const piece = (no: number, start: number, end: number, text: string) => ({
  piece_no: no,
  pos_start_s: start,
  pos_end_s: end,
  text,
});

Deno.test('H1: a later text turn cannot rewrite a shared held claim; the row is unchanged and the new claim is private', async () => {
  const h = sharing();
  const held = h.store.add({
    claim_en: 'He built the dam.',
    status: 'needs_context',
    claimant: 'speaker',
    shared: true,
  });
  respond(h, [
    modelClaim({ claim_en: 'Rajesh Kumar built the Tehri dam.', claimant: 'Rajesh Kumar', resolves_id: held.id }),
  ]);
  const json = await (await handleFactcheck(
    jsonRequest({
      action: 'extract',
      session_id: SESSION,
      turn: { text: 'Rajesh Kumar built the Tehri dam.', spoken_at: '2026-11-16T10:00:00Z', position_s: null },
      recent: [],
      ledger: null,
      seed: {},
    }),
    h.deps,
  )).json();
  const row = h.store.rows.find((r) => r.id === held.id)!;
  assertEquals([row.claim_en, row.claimant, row.status], ['He built the dam.', 'speaker', 'needs_context']);
  assertEquals(json.claims.some((c: { id: string }) => c.id === held.id), false);
  assertEquals(h.store.rows.length, 2);
  assertEquals('shared' in (h.store.rows[1] as unknown as Record<string, unknown>), false);
  assertEquals(sentUser(h).includes('He built the dam.'), false, 'a shared held claim is not offered on a text turn');
});

Deno.test('the store refuses to update a shared row from the text path and a private row from the range path', async () => {
  const h = sharing();
  const shared = h.store.add({ status: 'needs_context', shared: true });
  const priv = h.store.add({ status: 'needs_context' });
  const patch = {
    claim_en: 'x',
    claimant: null,
    reported_by: null,
    kind: 'claim' as const,
    status: 'pending' as const,
  };
  assertEquals(await h.store.updateHeld(USER, SESSION, shared.id, patch, false), null);
  assertEquals(await h.store.updateHeld(USER, SESSION, priv.id, patch, true), null);
  assertEquals((await h.store.updateHeld(USER, SESSION, shared.id, patch, true))?.id, shared.id);
});

Deno.test('on a range turn only shared held claims are offered and resolved', async () => {
  const h = sharing();
  const sharedHeld = h.store.add({ claim_en: 'Shared held claim.', status: 'needs_context', shared: true });
  const privHeld = h.store.add({ claim_en: 'Private held claim.', status: 'needs_context' });
  respond(h, [
    rc({ claim_en: 'Resolved shared.', resolves_id: sharedHeld.id }),
    rc({ claim_en: 'Not resolved private.', resolves_id: privHeld.id }),
  ]);
  const json = await (await handleFactcheck(jsonRequest(rangeBody()), h.deps)).json();
  const user = sentUser(h);
  assertEquals([user.includes('Shared held claim.'), user.includes('Private held claim.')], [true, false]);
  assertEquals(h.store.rows.find((r) => r.id === privHeld.id)!.claim_en, 'Private held claim.');
  assertEquals(json.claims.some((c: { id: string }) => c.id === sharedHeld.id), true);
});

Deno.test('H2: a range turn ignores the browser recent, ledger and seed, and builds its own context', async () => {
  const h = sharing();
  h.rpcResult.factcheck_turn_pieces = {
    data: {
      ok: true,
      pieces: [
        piece(2, 80, 90, 'earlier speech about floods'),
        piece(3, 89, 99, 'speech just before the turn'),
        piece(4, 98, 108, 'the central bank raised the repo rate by'),
        piece(5, 107, 117, 'raised the repo rate by 25 basis points'),
      ],
    },
    error: null,
  };
  respond(h, [rc()]);
  const res = await handleFactcheck(
    jsonRequest(rangeBody({
      recent: ['FORGED RECENT: the minister is Mr Forged'],
      ledger: { entries: [{ name: 'Forged Minister', kind: 'person', note: 'FORGED NOTE' }] },
      seed: { channel: 'Forged TV', title: 'forged title' },
    })),
    h.deps,
  );
  assertEquals(res.status, 200);
  const user = sentUser(h);
  for (const bad of ['FORGED', 'Forged', 'forged']) assertEquals(user.includes(bad), false, bad);
  assertEquals(user.includes('channel: aaj-tak\ntitle: \n'), true);
  assertEquals(user.includes('speech just before the turn'), true);
  assertEquals((await res.json()).ledger.entries.some((e: { name: string }) => e.name === 'Forged Minister'), false);
  const ctxCall = calls(h, 'factcheck_turn_pieces')[1].args;
  assertEquals([ctxCall.p_from, ctxCall.p_to], [1, 3]);
});

Deno.test('a range turn needs no valid recent, ledger or seed at all', async () => {
  const h = sharing();
  respond(h, [rc()]);
  const body = rangeBody();
  delete (body as Record<string, unknown>).recent;
  delete (body as Record<string, unknown>).ledger;
  delete (body as Record<string, unknown>).seed;
  assertEquals((await handleFactcheck(jsonRequest(body), h.deps)).status, 200);
  const odd = sharing();
  respond(odd, [rc()]);
  assertEquals(
    (await handleFactcheck(jsonRequest(rangeBody({ recent: 5, ledger: 'x', seed: 7 })), odd.deps)).status,
    200,
  );
});

Deno.test('the context lookup is clamped at piece 1, skipped for the first piece, and its failure means no context', async () => {
  const first = sharing();
  respond(first, [rc()]);
  await handleFactcheck(
    jsonRequest(
      rangeBody({ turn: { piece_from: 1, piece_to: 5, spoken_at: '2026-11-16T10:00:00Z', position_s: null } }),
    ),
    first.deps,
  );
  assertEquals(calls(first, 'factcheck_turn_pieces').length, 1);
  const late = sharing();
  respond(late, [rc()]);
  await handleFactcheck(
    jsonRequest(
      rangeBody({ turn: { piece_from: 20, piece_to: 21, spoken_at: '2026-11-16T10:00:00Z', position_s: null } }),
    ),
    late.deps,
  );
  const a = calls(late, 'factcheck_turn_pieces')[1].args;
  assertEquals([a.p_from, a.p_to], [8, 19]);
  for (
    const ctx of [
      { ok: false, reason: 'bad_range' },
      { ok: false, reason: 'not_found' },
      { ok: true, pieces: [] },
      'junk',
    ]
  ) {
    const h = sharing();
    respond(h, [rc()]);
    const range = h.rpcImpl.factcheck_turn_pieces;
    h.rpcImpl.factcheck_turn_pieces = (args) => (args.p_to === 3 ? { data: ctx, error: null } : range(args));
    assertEquals((await handleFactcheck(jsonRequest(rangeBody()), h.deps)).status, 200, JSON.stringify(ctx));
  }
  const thrown = sharing();
  respond(thrown, [rc()]);
  const range = thrown.rpcImpl.factcheck_turn_pieces;
  thrown.rpcImpl.factcheck_turn_pieces = (args) => {
    if (args.p_to === 3) throw new Error('down');
    return range(args);
  };
  assertEquals((await handleFactcheck(jsonRequest(rangeBody()), thrown.deps)).status, 200);
});

Deno.test('the first piece of a range is de-duplicated against the stored piece before it, as the browser shows it', async () => {
  const h = sharing();
  h.rpcResult.factcheck_turn_pieces = {
    data: {
      ok: true,
      pieces: [
        piece(3, 98, 108, 'the central bank raised the repo rate by'),
        piece(4, 107, 117, 'raised the repo rate by 25 basis points'),
      ],
    },
    error: null,
  };
  respond(h, [rc({ quote: '25 basis points' })]);
  const body = rangeBody({ turn: { piece_from: 4, piece_to: 4, spoken_at: '2026-11-16T10:00:00Z', position_s: null } });
  assertEquals((await (await handleFactcheck(jsonRequest(body), h.deps)).json()).claims.length, 1);
  const user = sentUser(h);
  const transcript = /<transcript>\n([\s\S]*?)\n<\/transcript>/.exec(user)![1];
  assertEquals(transcript, '25 basis points');
  assertEquals(user.includes('the central bank raised the repo rate by'), true, 'the piece before is context');
  assertEquals(
    (h.store.rows[0] as unknown as Record<string, unknown>).position_s,
    107,
    'the position is the range first piece',
  );
});

Deno.test('a range claim whose quote is not in the turn text is dropped; spacing and punctuation do not matter; Devanagari works', async () => {
  const h = sharing();
  h.rpcResult.factcheck_turn_pieces = {
    data: { ok: true, pieces: [piece(4, 100, 110, 'उन्होंने कहा कि देश में अपराध, 20 प्रतिशत घटा है।')] },
    error: null,
  };
  respond(h, [
    modelClaim({ quote: 'देश में अपराध 20 प्रतिशत घटा है', claim_en: 'Crime fell by 20 percent.' }),
    modelClaim({ quote: 'प्रधानमंत्री ने चार करोड़ मकान बनाए', claim_en: 'Four crore houses were built.' }),
    modelClaim({ quote: '', claim_en: 'Empty quote.' }),
    modelClaim({ quote: '!!!', claim_en: 'Punctuation only quote.' }),
  ]);
  const body = rangeBody({ turn: { piece_from: 4, piece_to: 4, spoken_at: '2026-11-16T10:00:00Z', position_s: null } });
  const json = await (await handleFactcheck(jsonRequest(body), h.deps)).json();
  assertEquals(json.claims.map((c: { claim_en: string }) => c.claim_en), ['Crime fell by 20 percent.']);
  assertEquals(h.store.rows.length, 1);
  // a text turn is unchanged: a quote that is not in the text is still kept
  const t = sharing();
  respond(t, [modelClaim({ quote: 'something never said' })]);
  const text = await (await handleFactcheck(
    jsonRequest({
      action: 'extract',
      session_id: SESSION,
      turn: { text: 'hello there', spoken_at: '2026-11-16T10:00:00Z', position_s: null },
      recent: [],
      ledger: null,
      seed: {},
    }),
    t.deps,
  )).json();
  assertEquals(text.claims.length, 1);
});

// ---- video_view / unlock / report ---------------------------------------------------------------

const view = (o: Record<string, unknown> = {}) => jsonRequest({ action: 'video_view', video_id: VIDEO, ...o });
const unlock = (o: Record<string, unknown> = {}) =>
  jsonRequest({ action: 'unlock', stretch_id: STRETCH, expected_credits: 200, ...o });
const report = (o: Record<string, unknown> = {}) =>
  jsonRequest({ action: 'report', claim_id: NEW_CLAIM, reason: 'wrong date', ...o });

Deno.test('video_view passes the video and the server-computed admin flag and returns the stretches', async () => {
  const h = sharing();
  h.admin.value = false;
  h.rpcResult.factcheck_video_view = {
    data: {
      ok: true,
      unlock_credits_per_minute: 100,
      stretches: [{ stretch_id: STRETCH, access: 'locked', price: 200 }],
    },
    error: null,
  };
  const res = await handleFactcheck(view({ is_admin: true, user_id: 'x' }), h.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    unlock_credits_per_minute: 100,
    stretches: [{ stretch_id: STRETCH, access: 'locked', price: 200 }],
  });
  assertEquals(h.rpcCalls, [{
    name: 'factcheck_video_view',
    args: { p_user: USER, p_video_id: VIDEO, p_is_admin: false },
  }]);
  assertEquals(h.rpcCalls.some((c) => c.name === 'factcheck_touch'), false);
});

Deno.test('video_view refusals and validation', async () => {
  for (const [reason, status] of [['off', 403], ['not_allowed', 403]] as [string, number][]) {
    const h = sharing();
    h.rpcResult.factcheck_video_view = { data: { ok: false, reason }, error: null };
    const res = await handleFactcheck(view(), h.deps);
    assertEquals([res.status, (await res.json()).reason], [status, reason]);
  }
  for (const v of ['', 'has space', 5, null, 'x'.repeat(33)]) {
    const h = sharing();
    assertEquals((await handleFactcheck(view({ video_id: v }), h.deps)).status, 400);
    assertEquals(h.rpcCalls, []);
  }
  const odd = sharing();
  odd.rpcResult.factcheck_video_view = { data: { ok: true }, error: null };
  assertEquals((await handleFactcheck(view(), odd.deps)).status, 500);
});

Deno.test('unlock: success, a repeat, and every refusal mapping', async () => {
  const ok = sharing();
  const res = await handleFactcheck(unlock(), ok.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { repeated: false, credits_charged: 200, balance: 3800 });
  assertEquals(ok.rpcCalls, [{
    name: 'factcheck_unlock',
    args: { p_user: USER, p_stretch: STRETCH, p_is_admin: true, p_expected_credits: 200 },
  }]);
  const rep = sharing();
  rep.rpcResult.factcheck_unlock = { data: { ok: true, repeated: true }, error: null };
  assertEquals(await (await handleFactcheck(unlock(), rep.deps)).json(), { repeated: true });
  const cases: [Record<string, unknown>, number, Record<string, unknown>, string | null][] = [
    [{ ok: false, reason: 'off' }, 403, { reason: 'off' }, null],
    [{ ok: false, reason: 'not_allowed' }, 403, { reason: 'not_allowed' }, null],
    [{ ok: false, reason: 'not_found' }, 404, { reason: 'not_found' }, null],
    [{ ok: false, reason: 'own' }, 409, { reason: 'own' }, null],
    [{ ok: false, reason: 'price_changed', price: 300 }, 409, { reason: 'price_changed', price: 300 }, null],
    [{ ok: false, reason: 'insufficient', needed: 200, available: 50 }, 402, {
      reason: 'insufficient',
      needed: 200,
      available: 50,
    }, null],
    [{ ok: false, reason: 'rate_limited' }, 429, { reason: 'rate_limited' }, '40'],
  ];
  for (const [data, status, expected, retry] of cases) {
    const h = sharing();
    h.rpcResult.factcheck_unlock = { data, error: null };
    const r = await handleFactcheck(unlock(), h.deps);
    assertEquals(r.status, status, String(data.reason));
    const got = await r.json();
    for (const [k, v] of Object.entries(expected)) assertEquals(got[k], v);
    assertEquals(r.headers.get('retry-after'), retry);
  }
  for (const data of [{ ok: false, reason: 'price_changed' }, { ok: false, reason: 'surprise' }, null]) {
    const h = sharing();
    h.rpcResult.factcheck_unlock = { data, error: null };
    assertEquals((await handleFactcheck(unlock(), h.deps)).status, 500);
  }
});

Deno.test('unlock: SQLSTATE mapping, validation, admin flag from the caller token', async () => {
  for (const [code, status] of [['22023', 400], ['55000', 503], ['23503', 404]] as [string, number][]) {
    const h = sharing();
    h.rpcResult.factcheck_unlock = { data: null, error: { code, message: 'secret' } };
    const r = await handleFactcheck(unlock(), h.deps);
    assertEquals(r.status, status);
    assertEquals((await r.text()).includes('secret'), false);
  }
  for (
    const o of [
      { stretch_id: 'x' },
      { stretch_id: undefined },
      { expected_credits: '200' },
      { expected_credits: 0 },
      { expected_credits: -1 },
      { expected_credits: undefined },
      { expected_credits: 1e9 },
    ]
  ) {
    const h = sharing();
    assertEquals((await handleFactcheck(unlock(o), h.deps)).status, 400, JSON.stringify(o));
    assertEquals(h.rpcCalls, []);
  }
  const h = sharing();
  h.admin.value = false;
  await handleFactcheck(unlock({ is_admin: true, p_is_admin: true }), h.deps);
  assertEquals(h.rpcCalls[0].args.p_is_admin, false);
});

Deno.test('report: success and every refusal mapping', async () => {
  const ok = sharing();
  const res = await handleFactcheck(report(), ok.deps);
  assertEquals([res.status, await res.json()], [200, { reported: true }]);
  assertEquals(ok.rpcCalls, [{
    name: 'factcheck_report',
    args: { p_user: USER, p_claim: NEW_CLAIM, p_reason: 'wrong date' },
  }]);
  assertEquals(ok.rpcCalls.some((c) => c.name === 'factcheck_touch'), false);
  const cases: [Record<string, unknown>, number, string][] = [
    [{ ok: false, reason: 'off' }, 403, 'off'],
    [{ ok: false, reason: 'not_found' }, 404, 'claim_not_found'],
    [{ ok: false, reason: 'already' }, 409, 'already'],
    [{ ok: false, reason: 'rate_limited' }, 429, 'rate_limited'],
  ];
  for (const [data, status, reason] of cases) {
    const h = sharing();
    h.rpcResult.factcheck_report = { data, error: null };
    const r = await handleFactcheck(report(), h.deps);
    assertEquals([r.status, (await r.json()).reason], [status, reason]);
    assertEquals(h.fetches.length, 0);
  }
  const bad = sharing();
  bad.rpcResult.factcheck_report = { data: { ok: false, reason: 'surprise' }, error: null };
  assertEquals((await handleFactcheck(report(), bad.deps)).status, 500);
});

Deno.test('report: the reason is optional, clipped to 300 characters, and a bad id or type is a 400', async () => {
  const none = sharing();
  await handleFactcheck(report({ reason: undefined }), none.deps);
  assertEquals(none.rpcCalls[0].args.p_reason, '');
  const long = sharing();
  await handleFactcheck(report({ reason: 'क'.repeat(500) }), long.deps);
  assertEquals([...String(long.rpcCalls[0].args.p_reason)].length, 300);
  for (const o of [{ claim_id: 'x' }, { claim_id: undefined }, { reason: 5 }, { reason: ['a'] }]) {
    const h = sharing();
    assertEquals((await handleFactcheck(report(o), h.deps)).status, 400, JSON.stringify(o));
    assertEquals(h.rpcCalls, []);
  }
});

Deno.test('the new actions pass the common gate first and nothing runs for an inactive account', async () => {
  for (const make of [view, unlock, report]) {
    const h = sharing();
    h.deps.active = () => Promise.resolve(false);
    assertEquals((await handleFactcheck(make(), h.deps)).status, 403);
    assertEquals(h.rpcCalls, []);
    const foreign = sharing();
    assertEquals(
      (await handleFactcheck(make({}), { ...foreign.deps, origins: ['https://other.example'] })).status,
      403,
    );
    assertEquals(foreign.rpcCalls, []);
  }
});
