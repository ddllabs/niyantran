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
