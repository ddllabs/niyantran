import { assertEquals } from 'jsr:@std/assert@1';
import { defaultModel, invalidateRegistry, loadRegistry, resolveModel } from './models.ts';

const MODELS = [
  { model_id: 'v/a', label: 'A', vendor: 'v', tier: 1, efforts: ['low'], params: {}, is_default: true, sort_order: 10 },
  { model_id: 'v/b', label: 'B', vendor: 'v', tier: 2, efforts: [], params: {}, is_default: false, sort_order: 20 },
];
const ROLES = [{ role_id: 'DEFAULT_ANALYST', label: 'Default', hint: 'h', model_id: 'v/a', sort_order: 10 }];

/** A fake client that records how many times each table was read. */
function fakeClient(calls: Record<string, number>) {
  const table = (name: string, rows: unknown[]) => {
    const result = Promise.resolve({ data: rows, error: null });
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => {
        calls[name] = (calls[name] ?? 0) + 1;
        return result;
      },
    };
    return builder;
  };
  return {
    from(name: string) {
      return table(name, name === 'ai_models' ? MODELS : ROLES);
    },
  };
}

Deno.test('loads enabled models and roles, then serves from cache within the TTL', async () => {
  invalidateRegistry();
  const calls: Record<string, number> = {};
  let t = 1_000_000;
  const now = () => t;
  const client = fakeClient(calls);

  const first = await loadRegistry({ client, now });
  assertEquals(first.models.map((m) => m.model_id), ['v/a', 'v/b']);
  assertEquals(first.roles.length, 1);

  t += 59_000;
  const second = await loadRegistry({ client, now });
  assertEquals(second, first);
  assertEquals(calls.ai_models, 1);

  t += 2_000;
  const third = await loadRegistry({ client, now });
  assertEquals(calls.ai_models, 2);
  assertEquals(third.loaded_at, t);
});

Deno.test('resolveModel returns the row for a listed id and null otherwise', async () => {
  invalidateRegistry();
  const client = fakeClient({});
  assertEquals((await resolveModel('v/b', { client }))?.label, 'B');
  assertEquals(await resolveModel('openai/gpt-6-astra', { client }), null);
  assertEquals((await defaultModel({ client }))?.model_id, 'v/a');
});

Deno.test('a database error is surfaced, not swallowed into an empty registry', async () => {
  invalidateRegistry();
  const failing = {
    from() {
      const b = { select: () => b, eq: () => b, order: () => Promise.resolve({ data: null, error: { message: 'boom' } }) };
      return b;
    },
  };
  let message = '';
  try {
    await loadRegistry({ client: failing });
  } catch (e) {
    message = (e as Error).message;
  }
  assertEquals(message.includes('boom'), true);
});
