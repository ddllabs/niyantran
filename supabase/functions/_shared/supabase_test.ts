import { assertEquals } from 'jsr:@std/assert@1';
import { namedKey } from './supabase.ts';

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
