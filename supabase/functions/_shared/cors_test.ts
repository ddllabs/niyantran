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

// F8: Vercel previews each get their own hostname, so ALLOWED_ORIGINS takes one
// wildcard pattern. The * stands for part of a single DNS label, never a dot.
const WITH_PREVIEWS = ['https://niyantran-six.vercel.app', 'http://localhost:5173', 'https://niyantran-*-ddl-labs.vercel.app'];
const allowOf = (origin: string, origins = WITH_PREVIEWS) =>
  corsHeaders(new Request('https://f/x', { headers: { origin } }), origins)['Access-Control-Allow-Origin'] ?? null;

Deno.test('a wildcard entry allows the team\'s preview hostnames', () => {
  for (const origin of [
    'https://niyantran-git-main-ddl-labs.vercel.app',
    'https://niyantran-1z31hj9xo-ddl-labs.vercel.app',
    'https://niyantran-git-task-f8-cors-ddl-labs.vercel.app',
  ]) assertEquals(allowOf(origin), origin);
  assertEquals(allowOf('https://niyantran-six.vercel.app'), 'https://niyantran-six.vercel.app');
});

Deno.test('a wildcard entry refuses look-alike hosts', () => {
  for (const origin of [
    'https://niyantran-x-ddl-labs.vercel.app.evil.test',
    'https://evil.test/niyantran-x-ddl-labs.vercel.app',
    'https://niyantran-a.b-ddl-labs.vercel.app',
    'http://niyantran-git-main-ddl-labs.vercel.app',
    'https://niyantran--ddl-labs.vercel.app',
    'https://xniyantran-git-main-ddl-labs.vercel.app',
    'https://niyantran-git-main-ddl-labs.vercel.app:8443',
    'https://niyantran-git-main-other-team.vercel.app',
  ]) assertEquals(allowOf(origin), null, origin);
});

Deno.test('plain entries still match exactly, and a bare * or a wildcard outside the host allows nothing', () => {
  assertEquals(allowOf('http://localhost:5301'), null);
  assertEquals(allowOf('https://anything.example', ['*']), null);
  assertEquals(allowOf('https://a.example', ['https://*']), null);
  assertEquals(allowOf('https://a.example', ['*://a.example']), null);
  assertEquals(allowOf('https://a-b-c.example', ['https://a-*-*.example']), null);
});
