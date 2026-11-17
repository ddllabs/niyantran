import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';

const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));

Deno.test('function entry uses the OpenRouter key and no other provider key', () => {
  assertStringIncludes(source, "Deno.env.get('OPENROUTER_API_KEY')");
  for (
    const other of [
      'OPENAI_API_KEY',
      'MISTRAL_API_KEY',
      'ELEVENLABS',
      'PERPLEXITY',
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'ANTHROPIC_API_KEY',
      'SONIOX',
      'DEEPGRAM',
    ]
  ) {
    assertEquals(source.includes(other), false, other);
  }
  assertEquals(
    (source.match(/Deno\.env\.get\(/g) ?? []).length,
    2,
    'OPENROUTER_API_KEY and LIVETV_API_BASE are the only env reads in index.ts',
  );
  assertStringIncludes(source, "Deno.env.get('LIVETV_API_BASE')");
});

Deno.test('function entry serves only when run as the main module', () => {
  assertStringIncludes(source, 'if (import.meta.main) Deno.serve(');
});

Deno.test('is_admin is asked with the caller client, the SQL functions and tables use the service client', () => {
  assertStringIncludes(source, "userClient(token).rpc('is_platform_admin')");
  assertStringIncludes(source, "userClient(token).rpc('get_my_profile')");
  assertStringIncludes(source, 'serviceClient()');
  assertStringIncludes(source, ".from('model_call_logs').insert(row)");
  assertStringIncludes(source, 'EdgeRuntime');
  assertStringIncludes(source, 'waitUntil');
});

Deno.test('config.toml registers the function with verify_jwt = false and a comment', async () => {
  const toml = await Deno.readTextFile(new URL('../../config.toml', import.meta.url));
  const at = toml.indexOf('[functions.factcheck]');
  assertEquals(at > 0, true);
  const block = toml.slice(at, at + 80);
  assertStringIncludes(block, 'verify_jwt = false');
  const before = toml.slice(Math.max(0, at - 160), at);
  assertStringIncludes(before, '# ');
  assertStringIncludes(before.toLowerCase(), 'checks');
});
