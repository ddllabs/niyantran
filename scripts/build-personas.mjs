/**
 * Regenerate supabase/functions/_shared/personas.json from the markdown prompts
 * in supabase/functions/_shared/personas/.
 *
 *   node scripts/build-personas.mjs
 *
 * Why this exists. The edge function used to read a persona at runtime with
 * Deno.readTextFile(new URL(`../_shared/personas/${file}`, import.meta.url)).
 * That works locally, where the files are on disk, and fails in production:
 * `supabase functions deploy` bundles the static import graph, and a runtime
 * file read with a computed name is not in it, so the markdown was never
 * uploaded. Every research turn then died on
 *
 *   path not found: /var/tmp/sb-compile-edge-runtime/functions/_shared/personas/analyst.md
 *
 * before reaching a model, which is why model_call_logs held no chat rows.
 *
 * A statically imported JSON module is in the import graph, which is exactly
 * how deskCatalog.json already ships. The markdown files stay the source of
 * truth; this script mirrors them, and personas_test.ts fails when the
 * committed JSON is stale.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/functions/_shared/personas';
const OUT = 'supabase/functions/_shared/personas.json';

const files = readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();
if (!files.length) throw new Error(`no .md prompts in ${DIR}`);

const personas = {};
for (const file of files) personas[file] = readFileSync(join(DIR, file), 'utf8');

writeFileSync(OUT, `${JSON.stringify(personas, null, 2)}\n`);
console.log(`${OUT}: ${files.length} prompts, ${JSON.stringify(personas).length} bytes`);
for (const f of files) console.log(`  ${f}  ${personas[f].length} chars`);
