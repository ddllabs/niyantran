import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { namedKey, publishableKey, secretKey } from './supabase.ts';

Deno.test('namedKey reads the default key from the platform JSON object', () => {
  assertEquals(namedKey('{"default":"sb_secret_abc","billing":"sb_secret_def"}'), 'sb_secret_abc');
  assertEquals(namedKey('{"default":"sb_secret_abc","billing":"sb_secret_def"}', 'billing'), 'sb_secret_def');
});

Deno.test('namedKey returns null for absent, empty, unparsable or non-string values', () => {
  assertEquals(namedKey(undefined), null);
  assertEquals(namedKey(''), null);
  assertEquals(namedKey('not json'), null);
  assertEquals(namedKey('{"default":""}'), null);
  assertEquals(namedKey('{"other":"x"}'), null);
  assertEquals(namedKey('{"default":42}'), null);
});

// F9: the legacy anon and service_role keys were disabled on 2026-09-21 after a
// service_role JWT leaked. Only the platform's named keys are read.
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const names = ['SUPABASE_SECRET_KEYS', 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];
  const saved = Object.fromEntries(names.map((n) => [n, Deno.env.get(n)]));
  try {
    for (const n of names) {
      if (vars[n] === undefined) Deno.env.delete(n);
      else Deno.env.set(n, vars[n] as string);
    }
    fn();
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) Deno.env.delete(n);
      else Deno.env.set(n, saved[n] as string);
    }
  }
}

Deno.test('secretKey and publishableKey never fall back to the legacy variables', () => {
  withEnv({ SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-jwt', SUPABASE_ANON_KEY: 'legacy-anon-jwt' }, () => {
    assertThrows(() => secretKey());
    assertThrows(() => publishableKey());
  });
});

Deno.test('secretKey and publishableKey read the platform named keys', () => {
  withEnv({
    SUPABASE_SECRET_KEYS: '{"default":"sb_secret_test"}',
    SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_test"}',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-jwt',
    SUPABASE_ANON_KEY: 'legacy-anon-jwt',
  }, () => {
    assertEquals(secretKey(), 'sb_secret_test');
    assertEquals(publishableKey(), 'sb_publishable_test');
  });
});
