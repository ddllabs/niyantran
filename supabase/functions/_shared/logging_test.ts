import { assertEquals } from 'jsr:@std/assert@1';
import { log, redact } from './logging.ts';

Deno.test('redact hides credential-looking keys at any depth and keeps the rest', () => {
  const out = redact({
    user_id: 'u1',
    api_key: 'sk-live',
    nested: { authorization: 'Bearer x', count: 2 },
    list: ['token-looking-value-is-kept-because-it-is-a-value'],
  });
  assertEquals(out, {
    user_id: 'u1',
    api_key: '[redacted]',
    nested: { authorization: '[redacted]', count: 2 },
    list: ['token-looking-value-is-kept-because-it-is-a-value'],
  });
});

Deno.test('log emits one JSON line with the event name and a timestamp', () => {
  const lines: string[] = [];
  log('health.ok', { user_id: 'u1', token: 'abc' }, (l) => lines.push(l));
  assertEquals(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assertEquals(parsed.event, 'health.ok');
  assertEquals(parsed.user_id, 'u1');
  assertEquals(parsed.token, '[redacted]');
  assertEquals(typeof parsed.t, 'string');
});

// F36 (F171 B12): names containing "token" or "key" were hidden even when they hold counts or
// record keys (embed_tokens, document_key); a secret under a harmless name, or inside an array, was
// logged. Secrets are now found by exact name and by shape.
Deno.test('counts and record keys are logged; secrets are hidden by name and by shape', () => {
  const out = redact({
    embed_tokens: 512,
    prompt_tokens: 40,
    document_key: 'bill:2025:113',
    expected_key: 'bill:2025:114',
    key_holder: 'ingest-1',
    token: 'abc',
    access_token: 'abc',
    service_role_key: 'x',
    note: 'Bearer abc.def',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    openrouter: 'sk-or-v1-abcdef',
    list: [{ api_key: 's' }, 'plain'],
  });
  assertEquals(out, {
    embed_tokens: 512,
    prompt_tokens: 40,
    document_key: 'bill:2025:113',
    expected_key: 'bill:2025:114',
    key_holder: 'ingest-1',
    token: '[redacted]',
    access_token: '[redacted]',
    service_role_key: '[redacted]',
    note: '[redacted]',
    jwt: '[redacted]',
    openrouter: '[redacted]',
    list: [{ api_key: '[redacted]' }, 'plain'],
  });
});
