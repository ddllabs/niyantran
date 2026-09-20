import { assertEquals } from 'jsr:@std/assert@1';
import { allowedOrigins, corsHeaders, preflight } from './cors.ts';

const ORIGINS = ['https://app.example', 'http://localhost:5173'];

Deno.test('allowedOrigins parses the comma list and falls back to the dev origin', () => {
  assertEquals(allowedOrigins('https://a.example, https://b.example'), ['https://a.example', 'https://b.example']);
  assertEquals(allowedOrigins(''), ['http://localhost:5173']);
  assertEquals(allowedOrigins(undefined), ['http://localhost:5173']);
});

Deno.test('preflight answers 204 and echoes only an allowed origin', () => {
  const ok = preflight(new Request('https://f/x', { method: 'OPTIONS', headers: { origin: 'https://app.example' } }), ORIGINS);
  assertEquals(ok?.status, 204);
  assertEquals(ok?.headers.get('Access-Control-Allow-Origin'), 'https://app.example');

  const bad = preflight(new Request('https://f/x', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), ORIGINS);
  assertEquals(bad?.status, 204);
  assertEquals(bad?.headers.get('Access-Control-Allow-Origin'), null);
});

Deno.test('preflight returns null for non-OPTIONS so the handler continues', () => {
  assertEquals(preflight(new Request('https://f/x', { method: 'GET' }), ORIGINS), null);
});

Deno.test('corsHeaders always varies on Origin and lists the refresh secret header', () => {
  const h = corsHeaders(new Request('https://f/x'), ORIGINS);
  assertEquals(h.Vary, 'Origin');
  assertEquals(h['Access-Control-Allow-Headers'].includes('x-refresh-secret'), true);
  assertEquals('Access-Control-Allow-Origin' in h, false);
});
