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
