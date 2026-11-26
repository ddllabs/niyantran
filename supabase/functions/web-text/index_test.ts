import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { buildWorkDeps, supabaseWebTextDb } from './index.ts';

function fakeClient(answer: (name: string) => { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      return Promise.resolve(answer(name));
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

Deno.test('supabaseWebTextDb: each call is the database function with its named arguments', async () => {
  const { client, calls } = fakeClient((name) => ({
    data: name === 'web_text_claim' ? { claimed: [{ id: 'a' }], refused: 'cap' } : { outcome: 'done' },
    error: null,
  }));
  const db = supabaseWebTextDb(client);
  assertEquals(await db.claim(2, 300), { claimed: [{ id: 'a' }] as never, refused: 'cap' });
  const result = { text: 't', source_status: 200, final_url_host: 'www.rbi.org.in', content_type: 'text/html' };
  assertEquals(await db.finish('i', 'k', result), 'done');
  assertEquals(await db.fail('i', 'k', 'not_html', false, true), 'done');
  assertEquals(calls, [
    ['web_text_claim', { p_limit: 2, p_lease_seconds: 300 }],
    ['web_text_finish', { p_id: 'i', p_token: 'k', p_result: result }],
    ['web_text_fail', { p_id: 'i', p_token: 'k', p_code: 'not_html', p_uncertain: false, p_permanent: true }],
  ]);
});

Deno.test('supabaseWebTextDb: an empty claim answer is an empty claim; an error throws without the database message', async () => {
  const empty = supabaseWebTextDb(fakeClient(() => ({ data: null, error: null })).client);
  assertEquals(await empty.claim(1, 300), { claimed: [], refused: null });
  const broken = supabaseWebTextDb(
    fakeClient(() => ({ data: null, error: { message: 'secret detail https://x' } })).client,
  );
  const e = await assertRejects(() => broken.claim(1, 300));
  assertEquals((e as Error).message, 'web_text_claim failed');
});

Deno.test('buildWorkDeps: no Firecrawl key, no work (the handler answers 503); the claim limit from the environment', () => {
  const client = fakeClient(() => ({ data: null, error: null })).client;
  assertThrows(() => buildWorkDeps(client, () => undefined), Error, 'FIRECRAWL_API_KEY is not set');
  assertThrows(
    () => buildWorkDeps(client, (n) => (n === 'FIRECRAWL_API_KEY' ? '' : undefined)),
    Error,
    'FIRECRAWL_API_KEY',
  );
  const env = (v: Record<string, string>) => (n: string) => v[n];
  assertEquals(buildWorkDeps(client, env({ FIRECRAWL_API_KEY: 'fc-x' })).claimLimit, 2);
  assertEquals(buildWorkDeps(client, env({ FIRECRAWL_API_KEY: 'fc-x', WEB_TEXT_CLAIM_LIMIT: '5' })).claimLimit, 5);
  assertEquals(buildWorkDeps(client, env({ FIRECRAWL_API_KEY: 'fc-x', WEB_TEXT_CLAIM_LIMIT: '50' })).claimLimit, 2);
  assert(typeof buildWorkDeps(client, env({ FIRECRAWL_API_KEY: 'fc-x' })).scrape === 'function');
});
