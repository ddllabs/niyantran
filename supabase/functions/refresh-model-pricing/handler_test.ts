import { assertEquals } from 'jsr:@std/assert@1';
import { authorised, handleRefresh, mapCatalogue, type PricingRow, type ReconcileResult } from './handler.ts';

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
