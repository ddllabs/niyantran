import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  type DeskBriefDeps,
  handleDeskBrief,
  MAX_LABEL_CHARS,
  MAX_ROW_BYTES,
  MAX_SOURCE_EXTRACT_CHARS,
  type ModelCallRow,
} from './handler.ts';

const ROLE_MODEL = 'google/gemini-3.5-flash-lite';
const OTHER_ENABLED = 'deepseek/deepseek-v4-flash';

const REGISTRY = {
  models: [{ model_id: 'google/gemini-3.7-flash' }, { model_id: ROLE_MODEL }, { model_id: OTHER_ENABLED }],
  roles: [
    { role_id: 'VISUAL_RESEARCH', model_id: 'google/gemini-3.7-flash' },
    { role_id: 'DEFAULT_ANALYST', model_id: ROLE_MODEL },
  ],
};

const BRIEF = {
  headline: 'The Act amends the customs tariff schedule',
  summary: ['Purpose: revise duty rates', 'What it changes: two schedules'],
  findings: [{ title: 'Scope', detail: 'Applies to imports only', band: 'strong' }],
  kpis: [{ label: 'Stage', value: 'Passed', sub: 'Lok Sabha', tone: 'ok' }],
  confidence: 'moderate',
  caveats: ['Extract covers the first pages only'],
};

function completion(content: string, over: Record<string, unknown> = {}) {
  return {
    id: 'gen-123',
    model: ROLE_MODEL,
    provider: 'Google',
    choices: [{ message: { role: 'assistant', content } }],
    usage: {
      prompt_tokens: 900,
      completion_tokens: 120,
      total_tokens: 1020,
      cost: 0.00042,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
    ...over,
  };
}

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

function provider(respond: () => Response | Promise<Response> = () => Response.json(completion(JSON.stringify(BRIEF)))) {
  const calls: Call[] = [];
  const fetch = ((input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init, body: JSON.parse(String(init.body ?? '{}')) });
    return Promise.resolve().then(respond);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function setup(over: Partial<DeskBriefDeps> = {}, respond?: () => Response | Promise<Response>) {
  const p = provider(respond);
  const rows: ModelCallRow[] = [];
  let registryReads = 0;
  let t = 1_000;
  const deps: DeskBriefDeps = {
    verify: () => Promise.resolve({ id: 'user-1' }),
    registry: () => {
      registryReads++;
      return Promise.resolve(REGISTRY);
    },
    deskModel: null,
    apiKey: 'or-test-key',
    fetch: p.fetch,
    logModelCall: (row) => {
      rows.push(row);
      return Promise.resolve();
    },
    now: () => (t += 250),
    origins: ['http://localhost:5173'],
    ...over,
  };
  return { deps, calls: p.calls, rows, registryReads: () => registryReads };
}

const ROW = { title: 'Customs Tariff (Amendment) Bill', status: 'Passed', ministry: 'Finance' };

function post(body: unknown, auth: string | null = 'Bearer a.b.c') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.authorization = auth;
  return new Request('https://f/desk-brief', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const valid = (over: Record<string, unknown> = {}) => ({
  feature: 'Bills',
  tier: 'Legislative',
  hash: 'abc123',
  scope: 'entry',
  row: ROW,
  ...over,
});

// ---- authentication and method -------------------------------------------

Deno.test('401 without a bearer, before the registry or provider is touched', async () => {
  const s = setup();
  const res = await handleDeskBrief(post(valid(), null), s.deps);
  assertEquals(res.status, 401);
  assertEquals(s.calls.length, 0);
  assertEquals(s.registryReads(), 0);
  assertEquals(s.rows.length, 0);
});

Deno.test('405 for a GET, and preflight answers 204', async () => {
  const s = setup();
  assertEquals((await handleDeskBrief(new Request('https://f/desk-brief'), s.deps)).status, 405);
  const pre = await handleDeskBrief(
    new Request('https://f/desk-brief', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }),
    s.deps,
  );
  assertEquals(pre.status, 204);
  assertEquals(s.calls.length, 0);
});

// ---- model choice ---------------------------------------------------------

Deno.test('the model comes from the DEFAULT_ANALYST role and usage accounting is requested', async () => {
  const s = setup();
  const res = await handleDeskBrief(post(valid()), s.deps);
  assertEquals(res.status, 200);
  assertEquals(s.calls.length, 1);
  assertEquals(s.calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assertEquals(s.calls[0].body.model, ROLE_MODEL);
  assertEquals(s.calls[0].body.usage, { include: true });
  assertEquals((s.calls[0].init.headers as Record<string, string>).Authorization, 'Bearer or-test-key');
});

Deno.test('OPENROUTER_DESK_MODEL is honoured when it names an enabled model', async () => {
  const s = setup({ deskModel: ` ${OTHER_ENABLED} ` });
  assertEquals((await handleDeskBrief(post(valid()), s.deps)).status, 200);
  assertEquals(s.calls[0].body.model, OTHER_ENABLED);
});

Deno.test('OPENROUTER_DESK_MODEL is ignored when it is not an enabled model', async () => {
  const s = setup({ deskModel: 'vendor/retired-model' });
  assertEquals((await handleDeskBrief(post(valid()), s.deps)).status, 200);
  assertEquals(s.calls[0].body.model, ROLE_MODEL);
});

Deno.test('a missing DEFAULT_ANALYST role returns 503 with no provider detail', async () => {
  const s = setup({
    registry: () => Promise.resolve({ models: REGISTRY.models, roles: REGISTRY.roles.slice(0, 1) }),
  });
  const res = await handleDeskBrief(post(valid()), s.deps);
  assertEquals(res.status, 503);
  const body = await res.json();
  assert(!/openrouter|model|role/i.test(body.error), body.error);
  assertEquals(s.calls.length, 0);
  assertEquals(s.rows.length, 0);
});

Deno.test('a role whose model is not enabled returns 503', async () => {
  const s = setup({
    registry: () =>
      Promise.resolve({ models: [{ model_id: OTHER_ENABLED }], roles: [{ role_id: 'DEFAULT_ANALYST', model_id: ROLE_MODEL }] }),
  });
  assertEquals((await handleDeskBrief(post(valid()), s.deps)).status, 503);
  assertEquals(s.calls.length, 0);
});

Deno.test('a registry read failure returns 503 without its message', async () => {
  const s = setup({ registry: () => Promise.reject(new Error('ai_models: permission denied for table')) });
  const res = await handleDeskBrief(post(valid()), s.deps);
  assertEquals(res.status, 503);
  assert(!/permission|ai_models/.test((await res.json()).error));
  assertEquals(s.calls.length, 0);
});

Deno.test('a missing provider key returns 503 and makes no provider call', async () => {
  const s = setup({ apiKey: '' });
  assertEquals((await handleDeskBrief(post(valid()), s.deps)).status, 503);
  assertEquals(s.calls.length, 0);
  assertEquals(s.rows.length, 0);
});

// ---- bounds ---------------------------------------------------------------

Deno.test('feature and tier are limited to 64 characters', async () => {
  const s = setup();
  const at = 'f'.repeat(MAX_LABEL_CHARS);
  const over = 'f'.repeat(MAX_LABEL_CHARS + 1);
  assertEquals(MAX_LABEL_CHARS, 64);
  assertEquals((await handleDeskBrief(post(valid({ feature: at, tier: at })), s.deps)).status, 200);
  assertEquals((await handleDeskBrief(post(valid({ feature: over })), s.deps)).status, 400);
  assertEquals((await handleDeskBrief(post(valid({ tier: over })), s.deps)).status, 400);
  assertEquals(s.calls.length, 1);
});

Deno.test('feature is required and row must be an object', async () => {
  const s = setup();
  assertEquals((await handleDeskBrief(post(valid({ feature: '  ' })), s.deps)).status, 400);
  assertEquals((await handleDeskBrief(post(valid({ feature: 42 })), s.deps)).status, 400);
  assertEquals((await handleDeskBrief(post(valid({ row: null })), s.deps)).status, 400);
  assertEquals((await handleDeskBrief(post(valid({ row: ['a'] })), s.deps)).status, 400);
  assertEquals((await handleDeskBrief(post(valid({ row: { status: 'source_status' } })), s.deps)).status, 400);
  assertEquals((await handleDeskBrief(post('{oops'), s.deps)).status, 400);
  assertEquals(s.calls.length, 0);
});

Deno.test('the serialised row is limited to 32,768 bytes', async () => {
  const s = setup();
  assertEquals(MAX_ROW_BYTES, 32_768);
  // {"a":"…"} is 8 bytes of framing around the value.
  const at = { a: 'x'.repeat(MAX_ROW_BYTES - 8) };
  const over = { a: 'x'.repeat(MAX_ROW_BYTES - 7) };
  assertEquals(new TextEncoder().encode(JSON.stringify(at)).length, MAX_ROW_BYTES);
  assertEquals((await handleDeskBrief(post(valid({ row: at })), s.deps)).status, 200);
  assertEquals((await handleDeskBrief(post(valid({ row: over })), s.deps)).status, 413);
  // Bytes, not characters: 10,923 three-byte characters is 32,769 bytes of value.
  const wide = { a: 'क'.repeat(10_923) };
  assertEquals((await handleDeskBrief(post(valid({ row: wide })), s.deps)).status, 413);
  assertEquals(s.calls.length, 1);
});

Deno.test('the largest row the client sends fits, even in Devanagari', async () => {
  // src/lib/deskBrief.js slimEntry keeps at most 40 fields and cell() cuts each
  // value to 220 characters; Devanagari is three bytes per character.
  const s = setup();
  const row: Record<string, string> = {};
  for (let i = 0; i < 40; i += 1) row[`field_name_number_${String(i).padStart(2, '0')}`] = 'क'.repeat(220);
  assertEquals(new TextEncoder().encode(JSON.stringify(row)).length <= MAX_ROW_BYTES, true);
  assertEquals((await handleDeskBrief(post(valid({ row })), s.deps)).status, 200);
});

Deno.test('sourceExtract is truncated to 12,000 characters and reaches the prompt', async () => {
  const s = setup();
  assertEquals(MAX_SOURCE_EXTRACT_CHARS, 12_000);
  const extract = 'y'.repeat(MAX_SOURCE_EXTRACT_CHARS) + 'TAIL-BEYOND-LIMIT';
  const res = await handleDeskBrief(post(valid({ scope: 'substance', sourceExtract: extract })), s.deps);
  assertEquals(res.status, 200);
  const user = (s.calls[0].body.messages as { role: string; content: string }[]).find((m) => m.role === 'user')!;
  assertStringIncludes(user.content, 'y'.repeat(MAX_SOURCE_EXTRACT_CHARS));
  assert(!user.content.includes('TAIL-BEYOND-LIMIT'));
  assert(!user.content.includes('y'.repeat(MAX_SOURCE_EXTRACT_CHARS + 1)));
});

Deno.test('the substance prompt asks for what the document does, the entry prompt organises the row', async () => {
  const s = setup();
  await handleDeskBrief(post(valid({ scope: 'substance', sourceExtract: 'An Act to amend the tariff.' })), s.deps);
  await handleDeskBrief(post(valid({ scope: 'entry', sourceNote: 'Source PDF from example.gov' })), s.deps);
  const userOf = (i: number) =>
    (s.calls[i].body.messages as { role: string; content: string }[]).find((m) => m.role === 'user')!.content;
  assertStringIncludes(userOf(0), 'What this bill / Act does');
  assertStringIncludes(userOf(0), 'PRIMARY evidence');
  assertStringIncludes(userOf(0), 'An Act to amend the tariff.');
  assertStringIncludes(userOf(1), 'Selected entry only');
  assertStringIncludes(userOf(1), 'Source PDF from example.gov');
  assertStringIncludes(userOf(1), 'Customs Tariff (Amendment) Bill');
});

// ---- response -------------------------------------------------------------

Deno.test('a successful brief keeps the response shape', async () => {
  const s = setup();
  const res = await handleDeskBrief(post(valid()), s.deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  for (const key of ['ok', 'headline', 'summary', 'findings', 'kpis', 'confidence', 'hash', 'model', 'generatedAt']) {
    assert(key in body, `missing ${key}`);
  }
  assertEquals(body.ok, true);
  assertEquals(body.headline, BRIEF.headline);
  assertEquals(body.summary, BRIEF.summary);
  assertEquals(body.findings, BRIEF.findings);
  assertEquals(body.kpis, BRIEF.kpis);
  assertEquals(body.confidence, 'moderate');
  assertEquals(body.hash, 'abc123');
  assertEquals(body.model, ROLE_MODEL);
  assert(!Number.isNaN(Date.parse(body.generatedAt)));
});

Deno.test('malformed model JSON returns 502', async () => {
  const s = setup({}, () => Response.json(completion('this is not json at all')));
  const res = await handleDeskBrief(post(valid()), s.deps);
  assertEquals(res.status, 502);
  assertEquals(s.rows.length, 1);
  assertEquals(s.rows[0].status, 'error');
});

Deno.test('an empty model reply returns 502', async () => {
  const s = setup({}, () => Response.json(completion('')));
  assertEquals((await handleDeskBrief(post(valid()), s.deps)).status, 502);
});

Deno.test('a provider failure returns 503 with a generic message', async () => {
  const s = setup({}, () => Response.json({ error: { message: 'upstream secret detail' } }, { status: 500 }));
  const res = await handleDeskBrief(post(valid()), s.deps);
  assertEquals(res.status, 503);
  const body = await res.json();
  assert(!/upstream secret detail/.test(JSON.stringify(body)));
});

// ---- telemetry ------------------------------------------------------------

Deno.test('one model_call_logs row on success, with model, latency, tokens and cost', async () => {
  const s = setup();
  assertEquals((await handleDeskBrief(post(valid()), s.deps)).status, 200);
  assertEquals(s.rows.length, 1);
  const row = s.rows[0];
  assertEquals(row.user_id, 'user-1');
  assertEquals(row.caller, 'desk-brief');
  assertEquals(row.purpose, 'desk_brief');
  assertEquals(row.status, 'success');
  assertEquals(row.model_requested, ROLE_MODEL);
  assertEquals(row.model_served, ROLE_MODEL);
  assertEquals(row.provider, 'Google');
  assertEquals(row.error_message, null);
  assertEquals(row.latency_ms, 250);
  assertEquals(row.prompt_tokens, 900);
  assertEquals(row.completion_tokens, 120);
  assertEquals(row.total_tokens, 1020);
  assertEquals(row.cost_usd, 0.00042);
  assertEquals(row.openrouter_generation_id, 'gen-123');
  assertEquals(row.conversation_id, null);
  assertEquals(row.message_id, null);
});

Deno.test('one error row when the provider fails, and none of its text is stored', async () => {
  const s = setup({}, () => Response.json({ error: { message: 'upstream secret detail' } }, { status: 429 }));
  assertEquals((await handleDeskBrief(post(valid()), s.deps)).status, 503);
  assertEquals(s.rows.length, 1);
  assertEquals(s.rows[0].status, 'error');
  assertEquals(s.rows[0].model_requested, ROLE_MODEL);
  assert(!JSON.stringify(s.rows[0]).includes('upstream secret detail'));
});

Deno.test('one error row when the provider cannot be reached', async () => {
  const s = setup({}, () => {
    throw new TypeError('connection reset');
  });
  assertEquals((await handleDeskBrief(post(valid()), s.deps)).status, 503);
  assertEquals(s.rows.length, 1);
  assertEquals(s.rows[0].status, 'error');
  assertEquals(s.rows[0].cost_usd, null);
});

Deno.test('a telemetry insert failure never fails the brief', async () => {
  const s = setup({ logModelCall: () => Promise.reject(new Error('insert refused')) });
  const res = await handleDeskBrief(post(valid()), s.deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).headline, BRIEF.headline);
});

Deno.test('a telemetry insert that hangs never holds the brief', async () => {
  const s = setup({ logModelCall: () => new Promise<void>(() => {}), telemetryTimeoutMs: 10 });
  assertEquals((await handleDeskBrief(post(valid()), s.deps)).status, 200);
});
