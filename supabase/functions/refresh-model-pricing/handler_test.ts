import { assertEquals } from 'jsr:@std/assert@1';
import { authorised, handleRefresh, mapCatalogue, orderEfforts, type PricingRow, type ReconcileResult } from './handler.ts';

const fixture = JSON.parse(await Deno.readTextFile(new URL('./fixture_catalogue.json', import.meta.url)));
const SECRETS = { refreshSecret: 'shh-refresh', serviceKey: 'service-role-key' };
const RESULT: ReconcileResult = { upserted: 3, unavailable: 0, disabled_models: [], orphan_roles: [], run_at: '2026-09-21T00:00:00Z' };

function post(headers: Record<string, string> = {}) {
  return new Request('https://f/refresh-model-pricing', { method: 'POST', headers });
}

Deno.test('mapCatalogue reads the verified field names from a trimmed real response', () => {
  const rows = mapCatalogue(fixture);
  assertEquals(rows.length, 3);
  const lite = rows.find((r) => r.model_id === 'google/gemini-2.5-flash-lite')!;
  assertEquals(lite.prompt_usd, 1e-7);
  assertEquals(lite.completion_usd, 4e-7);
  assertEquals(lite.supported_parameters.includes('tools'), true);
  assertEquals(typeof lite.context_length, 'number');

  const cached = rows[1];
  assertEquals(typeof cached.cache_read_usd, 'number');
  assertEquals(typeof cached.cache_write_usd, 'number');
  assertEquals(typeof cached.internal_reasoning_usd, 'number');

  const noTools = rows[2];
  assertEquals(noTools.supported_parameters.includes('tools'), false);
  assertEquals(noTools.cache_write_usd, null);
});

// The three reasoning shapes the catalogue actually publishes. Getting this
// wrong is what let the allowlist offer low/medium/high on models that accept
// only xhigh/high, where OpenRouter maps the request to the nearest supported
// level and bills the difference in silence.
Deno.test('mapCatalogue reads the per-model reasoning ladder, its default, and whether it is mandatory', () => {
  const rows = mapCatalogue(fixture);
  const flash = rows.find((r) => r.model_id === 'google/gemini-3.8-flash')!;
  // Published high-to-low; stored cheapest first, so the picker needs no order of its own.
  assertEquals(flash.reasoning_efforts, ['low', 'medium', 'high']);
  assertEquals(flash.reasoning_default, 'medium');
  assertEquals(flash.reasoning_required, true);

  // `{mandatory: false}` with no ladder: the model takes no effort at all.
  const lite = rows.find((r) => r.model_id === 'google/gemini-2.5-flash-lite')!;
  assertEquals(lite.reasoning_efforts, []);
  assertEquals(lite.reasoning_default, null);
  assertEquals(lite.reasoning_required, false);

  // No `reasoning` key: a non-reasoning model, and not an error.
  const none = rows.find((r) => r.model_id === 'inference-net/schematron-v2-turbo')!;
  assertEquals(none.reasoning_efforts, []);
  assertEquals(none.reasoning_required, false);
});

Deno.test('orderEfforts folds OpenRouter `none` onto `off`, drops unknown rungs, and sorts cheapest first', () => {
  assertEquals(orderEfforts(['max', 'xhigh', 'high', 'medium', 'low']), ['low', 'medium', 'high', 'xhigh', 'max']);
  assertEquals(orderEfforts(['high', 'none']), ['off', 'high']);
  assertEquals(orderEfforts(['ultra', '', 'low', 'low']), ['low']);
  assertEquals(orderEfforts([]), []);
});

Deno.test('mapCatalogue tolerates unknown fields, skips entries without an id, and rejects a payload without data', () => {
  const rows = mapCatalogue({ data: [{ id: 'x/y', surprise: 1 }, { name: 'no id' }, null, { id: '' }] });
  assertEquals(rows.map((r) => r.model_id), ['x/y']);
  assertEquals(rows[0].prompt_usd, null);
  assertEquals(rows[0].supported_parameters, []);
  let status = 0;
  try {
    mapCatalogue({ models: [] });
  } catch (e) {
    status = (e as { status: number }).status;
  }
  assertEquals(status, 502);
});

Deno.test('authorised accepts the refresh secret header or the service key bearer, nothing else', () => {
  assertEquals(authorised(post({ 'x-refresh-secret': 'shh-refresh' }), SECRETS), true);
  assertEquals(authorised(post({ authorization: 'Bearer service-role-key' }), SECRETS), true);
  assertEquals(authorised(post({ 'x-refresh-secret': 'wrong' }), SECRETS), false);
  assertEquals(authorised(post({ authorization: 'Bearer some.user.jwt' }), SECRETS), false);
  assertEquals(authorised(post(), SECRETS), false);
  assertEquals(authorised(post({ 'x-refresh-secret': '' }), { refreshSecret: '' }), false);
});

Deno.test('401 without the secret, and the catalogue is never fetched', async () => {
  let fetched = 0;
  const res = await handleRefresh(post(), {
    fetchCatalogue: () => (fetched++, Promise.resolve(fixture)),
    reconcile: () => Promise.resolve(RESULT),
    secrets: SECRETS,
  });
  assertEquals(res.status, 401);
  assertEquals(fetched, 0);
});

Deno.test('a suspiciously small catalogue is refused before reconcile runs', async () => {
  let reconciled = 0;
  const res = await handleRefresh(post({ 'x-refresh-secret': 'shh-refresh' }), {
    fetchCatalogue: () => Promise.resolve(fixture),
    reconcile: () => (reconciled++, Promise.resolve(RESULT)),
    secrets: SECRETS,
  });
  assertEquals(res.status, 502);
  assertEquals(reconciled, 0);
});

Deno.test('happy path hands the mapped rows to reconcile and reports the counts', async () => {
  let got: PricingRow[] = [];
  const res = await handleRefresh(post({ 'x-refresh-secret': 'shh-refresh' }), {
    fetchCatalogue: () => Promise.resolve(fixture),
    reconcile: (rows) => ((got = rows), Promise.resolve(RESULT)),
    secrets: SECRETS,
    minRows: 3,
  });
  assertEquals(res.status, 200);
  assertEquals(got.length, 3);
  assertEquals(await res.json(), { fetched: 3, ...RESULT });
});

// Importing the entry point must not read real secrets or start a listener.
const { createRefreshHandler, refreshSecrets } = await import('./index.ts');
const CURRENT_KEY = 'sb_secret_current_test';
const LEGACY_KEY = 'legacy-disabled-test-key';
const CRON_SECRET = 'cron-secret-test';

function wiredRefresh(env: Record<string, string | undefined>) {
  let fetched = 0;
  let reconciled = 0;
  const readNames: string[] = [];
  const handler = createRefreshHandler((name) => (readNames.push(name), env[name]), {
    fetchCatalogue: () => {
      fetched++;
      return Promise.resolve({ data: Array.from({ length: 100 }, (_, i) => ({ ...fixture.data[0], id: `fixture/model-${i}` })) });
    },
    reconcile: () => (reconciled++, Promise.resolve({ ...RESULT, upserted: 100 })),
  });
  return { handler, readNames, calls: () => ({ fetched, reconciled }) };
}

Deno.test('entry point rejects disabled legacy bearer before fetching or reconciling', async () => {
  const wired = wiredRefresh({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: CURRENT_KEY }), SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY });
  assertEquals((await wired.handler(post({ authorization: `Bearer ${LEGACY_KEY}` }))).status, 401);
  assertEquals(wired.calls(), { fetched: 0, reconciled: 0 });
  assertEquals(wired.readNames.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
});

Deno.test('entry point accepts only the current named default secret as bearer', async () => {
  const wired = wiredRefresh({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: CURRENT_KEY, other: 'sb_secret_other_test' }), SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY });
  assertEquals((await wired.handler(post({ authorization: `Bearer ${CURRENT_KEY}` }))).status, 200);
  assertEquals(wired.calls(), { fetched: 1, reconciled: 1 });
  assertEquals((await wired.handler(post({ authorization: 'Bearer sb_secret_other_test' }))).status, 401);
  assertEquals(wired.calls(), { fetched: 1, reconciled: 1 });
});

Deno.test('entry point preserves the cron header independently of missing or malformed named keys', async () => {
  for (const raw of [undefined, 'malformed', JSON.stringify({ default: CURRENT_KEY })]) {
    const wired = wiredRefresh({ SUPABASE_SECRET_KEYS: raw, REFRESH_SECRET: CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY });
    assertEquals((await wired.handler(post({ 'x-refresh-secret': CRON_SECRET }))).status, 200);
    assertEquals(wired.calls(), { fetched: 1, reconciled: 1 });
  }
});

Deno.test('missing and malformed named-key configurations fail closed without legacy fallback', async () => {
  const malformed = [undefined, '', 'broken-json', 'null', '[]', '"string"', '{}', '{"default":null}',
    '{"default":123}', '{"default":""}', '{"default":"   "}', JSON.stringify({ default: LEGACY_KEY }),
    JSON.stringify({ default: CURRENT_KEY + '\n' }), '{"default":"sb_secret_"}', '{"default":"sb_secret_ invalid"}', JSON.stringify({ other: CURRENT_KEY })];
  for (const raw of malformed) {
    const env = { SUPABASE_SECRET_KEYS: raw, SUPABASE_SERVICE_ROLE_KEY: LEGACY_KEY };
    assertEquals(refreshSecrets((name) => env[name as keyof typeof env]).serviceKey, undefined);
    const wired = wiredRefresh(env);
    let configured: unknown;
    try { configured = JSON.parse(raw ?? 'null')?.default; } catch { configured = undefined; }
    const candidates = new Set([LEGACY_KEY, CURRENT_KEY, ...(typeof configured === 'string' && !/[\r\n]/.test(configured) ? [configured] : [])]);
    for (const bearer of candidates) {
      assertEquals((await wired.handler(post({ authorization: `Bearer ${bearer}` }))).status, 401, `configuration: ${raw}`);
    }
    assertEquals(wired.calls(), { fetched: 0, reconciled: 0 });
  }
});

Deno.test('empty credentials and unrelated headers never authorize entry-point work', async () => {
  const wired = wiredRefresh({ REFRESH_SECRET: '   ', SUPABASE_SECRET_KEYS: '{"default":""}' });
  for (const headers of [{}, { authorization: 'Bearer ' }, { 'x-refresh-secret': ' ' }, { 'x-api-key': CURRENT_KEY }] as Record<string, string>[]) {
    assertEquals((await wired.handler(post(headers))).status, 401);
  }
  assertEquals(wired.calls(), { fetched: 0, reconciled: 0 });
});
