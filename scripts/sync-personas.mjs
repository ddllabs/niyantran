/**
 * Copy the shipped persona prompts into the edge functions' shared folder
 * (streaming spec §C, dynamic block). src/data/personas/*.md stays the
 * source; supabase/functions/_shared/personas/ is a byte-for-byte copy that
 * the function bundle can read. src/lib/personas.sync.test.js fails when
 * the two differ.
 *
 *   node scripts/sync-personas.mjs
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const src = resolve(root, 'src/data/personas');
const dst = resolve(root, 'supabase/functions/_shared/personas');

mkdirSync(dst, { recursive: true });
for (const f of readdirSync(dst)) if (f.endsWith('.md')) rmSync(resolve(dst, f));
const files = readdirSync(src).filter((f) => f.endsWith('.md')).sort();
for (const f of files) copyFileSync(resolve(src, f), resolve(dst, f));
console.log(`synced ${files.length} persona file(s): ${files.join(', ')}`);
