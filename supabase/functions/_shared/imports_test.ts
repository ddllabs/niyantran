// F418: a deployed Edge Function only has the files under supabase/functions. A relative import that leaves that
// folder (for example into the website's node_modules) works in a full checkout and in tests, but not once deployed,
// and a function whose import fails does not start. Every relative import in function code must stay inside.
import { assertEquals } from 'jsr:@std/assert@1';
import { dirname, fromFileUrl, join, normalize, relative, resolve } from 'jsr:@std/path@1';

const FUNCTIONS = resolve(dirname(fromFileUrl(import.meta.url)), '..');

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory) { if (e.name !== '__fixtures__' && e.name !== 'node_modules') yield* sourceFiles(p); }
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && !/_test\.(ts|tsx|js)$/.test(e.name)) yield p;
  }
}

Deno.test('F418: no function imports a file outside supabase/functions', async () => {
  const escapes: string[] = [];
  const spec = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
  for await (const file of sourceFiles(FUNCTIONS)) {
    const text = await Deno.readTextFile(file);
    for (const m of text.matchAll(spec)) {
      const target = normalize(resolve(dirname(file), m[1] ?? m[2]));
      if (relative(FUNCTIONS, target).startsWith('..')) escapes.push(`${relative(FUNCTIONS, file)} -> ${m[1] ?? m[2]}`);
    }
  }
  assertEquals(escapes, []);
});

// F419: the bundler behind `supabase functions deploy --use-api` refuses a plain URL import ("Cannot import from
// cdn.sheetjs.com:443", 2026-11-28), so a function that has one deploys only with the local bundler. Use npm:, jsr:
// or a file under supabase/functions instead.
Deno.test('F419: no function imports from an http(s) URL', async () => {
  const remote: string[] = [];
  const spec =
    /(?:import|export)\s[^'"]*?from\s*['"](https?:\/\/[^'"]+)['"]|import\(\s*['"](https?:\/\/[^'"]+)['"]\s*\)/g;
  for await (const file of sourceFiles(FUNCTIONS)) {
    if (file.includes('/vendor/')) continue;
    const text = await Deno.readTextFile(file);
    for (const m of text.matchAll(spec)) remote.push(`${relative(FUNCTIONS, file)} -> ${m[1] ?? m[2]}`);
  }
  assertEquals(remote, []);
});

// The vendored SheetJS build is byte-identical to the 0.20.3 release (vendor/sheetjs-0.20.3/README.md).
Deno.test('F419: vendored SheetJS matches its recorded hash', async () => {
  const bytes = await Deno.readFile(join(FUNCTIONS, '_shared/vendor/sheetjs-0.20.3/xlsx.mjs'));
  const hex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const readme = await Deno.readTextFile(join(FUNCTIONS, '_shared/vendor/sheetjs-0.20.3/README.md'));
  assertEquals(readme.includes(hex), true, `sha256 ${hex} is not the one in README.md`);
});
