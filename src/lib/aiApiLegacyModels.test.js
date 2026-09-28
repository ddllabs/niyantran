import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAiChat } from '../../server/aiApi.mjs';

// The live registry on 2026-09-28 (spec 2026-09-28-ai-path-fixes, Task B).
const ENABLED = [
  'google/gemini-3.5-flash-lite',
  'google/gemini-3.7-flash',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro',
  'openai/gpt-6-astra',
  'anthropic/claude-sonnet-5',
  'google/gemini-2.5-flash-lite',
  'google/gemma-4-31b-it',
];
const ROLES = [
  { role_id: 'DEFAULT_ANALYST', model_id: 'google/gemini-3.5-flash-lite' },
  { role_id: 'EXPERT_ESCALATION', model_id: 'openai/gpt-6-astra' },
  { role_id: 'PDF_PARSER', model_id: 'google/gemini-3.5-flash-lite' },
  { role_id: 'VISUAL_RESEARCH', model_id: 'google/gemini-3.7-flash' },
];
const RETIRED = /gemini-2\.0-flash|gemini-flash-1\.5|gpt-4o/;
const TOKEN = 'token-user-1';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sseResponse() {
  const sse = 'data: {"chunk":"Answer from the record."}\n\ndata: [DONE]\n\n';
  return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/**
 * A fake network: PostgREST reads of the registry, the research-chat
 * function, and OpenRouter. Every call is recorded for assertions.
 */
function installFetch({ models = ENABLED.map((model_id) => ({ model_id })), roles = ROLES, registry = 'ok' } = {}) {
  const calls = { registry: [], forwarded: [], openrouter: [] };
  const fake = vi.fn(async (input, init = {}) => {
    const url = String(typeof input === 'string' ? input : input.url);
    const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
    if (url.includes('/rest/v1/ai_models') || url.includes('/rest/v1/ai_roles')) {
      calls.registry.push({ url, authorization: headers.get('authorization'), apikey: headers.get('apikey') });
      if (registry === 'throw') throw new TypeError('fetch failed');
      if (registry === 'error') return jsonResponse({ message: 'permission denied' }, 500);
      return jsonResponse(url.includes('ai_models') ? models : roles);
    }
    if (url.includes('/functions/v1/research-chat')) {
      calls.forwarded.push({ body: JSON.parse(init.body), authorization: headers.get('authorization') });
      return sseResponse();
    }
    if (url.includes('openrouter.ai')) {
      calls.openrouter.push(JSON.parse(init.body).model);
      return jsonResponse({ error: { message: 'unavailable' } }, 503);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fake);
  return calls;
}

function ask(model, extra = {}) {
  return runAiChat(
    { messages: [{ role: 'user', content: 'What does this record say?' }], ...(model === undefined ? {} : { model }), ...extra },
    `Bearer ${TOKEN}`,
  );
}

describe('legacy /api/ai/chat resolves the model against the live registry', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['OPENROUTER_API_KEY', 'NIYANTRAN_AI_KEY']) {
      saved[k] = process.env[k];
      // An empty value keeps loadEnv from filling it and selects the Supabase proxy.
      process.env[k] = '';
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.unstubAllGlobals();
  });

  it.each([
    ['gemini-lite', 'google/gemini-3.5-flash-lite'],
    ['gemini-flash', 'google/gemini-3.7-flash'],
    ['gpt-astra', 'openai/gpt-6-astra'],
    ['DEFAULT_ANALYST', 'google/gemini-3.5-flash-lite'],
    ['EXPERT_ESCALATION', 'openai/gpt-6-astra'],
    ['PDF_PARSER', 'google/gemini-3.5-flash-lite'],
    ['VISUAL_RESEARCH', 'google/gemini-3.7-flash'],
  ])('%s becomes its role\'s live model %s', async (requested, expected) => {
    const calls = installFetch();
    const out = await ask(requested);
    expect(calls.forwarded).toHaveLength(1);
    expect(calls.forwarded[0].body.model).toBe(expected);
    expect(out.text).toBe('Answer from the record.');
  });

  it.each(ENABLED)('an enabled model %s passes through unchanged', async (id) => {
    const calls = installFetch();
    await ask(id);
    expect(calls.forwarded[0].body.model).toBe(id);
  });

  it.each([
    'google/gemini-2.0-flash-001',
    'google/gemini-2.0-flash-lite-001',
    'google/gemini-flash-1.5',
    'openai/gpt-4o-mini',
    'google/gemini-2.5-flash',
    'not-a-model',
  ])('an unknown or retired model %s is omitted so research-chat uses its default', async (id) => {
    const calls = installFetch();
    await ask(id);
    expect(calls.forwarded).toHaveLength(1);
    expect(calls.forwarded[0].body).not.toHaveProperty('model');
  });

  it('omits a role whose live model is not enabled', async () => {
    const calls = installFetch({
      models: ENABLED.filter((m) => m !== 'openai/gpt-6-astra').map((model_id) => ({ model_id })),
    });
    await ask('gpt-astra');
    expect(calls.forwarded[0].body).not.toHaveProperty('model');
  });

  it('reads the registry with the caller\'s own bearer and the publishable key', async () => {
    const calls = installFetch();
    await ask('gemini-lite');
    expect(calls.registry.length).toBeGreaterThanOrEqual(2);
    for (const r of calls.registry) {
      expect(r.authorization).toBe(`Bearer ${TOKEN}`);
      expect(r.apikey).toBeTruthy();
    }
    expect(calls.forwarded[0].authorization).toBe(`Bearer ${TOKEN}`);
  });

  it.each(['error', 'throw'])('a registry read failure (%s) omits the model and still forwards', async (mode) => {
    const calls = installFetch({ registry: mode });
    const out = await ask('gemini-lite');
    expect(calls.forwarded).toHaveLength(1);
    expect(calls.forwarded[0].body).not.toHaveProperty('model');
    expect(out.text).toBe('Answer from the record.');
  });

  it('keeps the rest of the forwarded contract (turn_key, attachments, focus)', async () => {
    const calls = installFetch();
    await ask('gemini-flash', { turn_key: 'turn-abc', focus: 'desk', attachments: [{ kind: 'row', title: 'Row', text: 'body' }] });
    const body = calls.forwarded[0].body;
    expect(body.turn_key).toBe('turn-abc');
    expect(body.focus).toBe('desk');
    expect(body.attachments).toEqual([{ kind: 'row', title: 'Row', text: 'body' }]);
    expect(body.message).toBe('What does this record say?');
  });

  it('never forwards a retired model ID, whatever is requested', async () => {
    const inputs = [
      undefined, '', 'gemini-lite', 'gemini-flash', 'gpt-astra', 'google/gemini-2.5-flash',
      'google/gemini-2.0-flash-001', 'google/gemini-flash-1.5', 'openai/gpt-4o-mini',
      'DEFAULT_ANALYST', 'EXPERT_ESCALATION', 'PDF_PARSER', 'VISUAL_RESEARCH',
    ];
    for (const registry of ['ok', 'error']) {
      for (const model of inputs) {
        const calls = installFetch({ registry });
        await ask(model);
        const body = calls.forwarded[0].body;
        expect(JSON.stringify(body)).not.toMatch(RETIRED);
        if ('model' in body) expect(ENABLED).toContain(body.model);
      }
    }
  });
});

describe('a server-side OpenRouter key never bypasses Supabase (ADR 0008)', () => {
  const saved = {};
  beforeEach(() => {
    for (const k of ['OPENROUTER_API_KEY', 'NIYANTRAN_AI_KEY']) {
      saved[k] = process.env[k];
      process.env[k] = 'must-not-be-used';
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.unstubAllGlobals();
  });

  it.each(['gemini-lite', 'gpt-astra', 'google/gemini-3.7-flash', 'custom-model'])(
    'for %s the turn goes to research-chat and never to OpenRouter',
    async (model) => {
      const calls = installFetch();
      const out = await ask(model);
      expect(out.text).toBe('Answer from the record.');
      expect(calls.forwarded).toHaveLength(1);
      expect(calls.forwarded[0].authorization).toBe(`Bearer ${TOKEN}`);
      expect(calls.openrouter).toEqual([]);
    },
  );

  it('the proxy module holds no OpenRouter endpoint or key lookup', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../server/aiApi.mjs', import.meta.url), 'utf8');
    expect(source).not.toMatch(/openrouter\.ai|OPENROUTER_API_KEY|NIYANTRAN_AI_KEY/);
  });
});
