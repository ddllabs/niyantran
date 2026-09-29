/**
 * Load the rows the desk shows into NTER's desk_rows — the snapshot behind
 * search_desk_rows (desk-row-grounding spec §A and its plan amendments).
 *
 *   npx vite-node --config vitest.config.js scripts/load-desk-rows.mjs [--dry-run] [--tier <tab>] [--feature "<name>"] [--batch 500]
 *
 * Runs under vite-node because the desk feed pipeline imports JSON the Vite
 * way (vite-node strips the script from process.argv, so this is a plain
 * runner that nothing imports). For every navigation module it runs the
 * desk's own pipeline with fetch served from public/ (src/lib/deskRowsFeed.js),
 * reads the module's stored rows, and writes only the difference
 * (src/lib/deskRowSync.js, open-work F20): new or changed rows are upserted on
 * (tier, feature, row_key), and keys the module no longer shows are deleted.
 * An unchanged module writes nothing, and loaded_at records a row's last
 * change. The first run after F20 rewrites most rows once: rows loaded on
 * 2026-09-21 hold record_text lines in jsonb key order, and the pipeline now
 * writes them in source order (same content, checked on Cabinet Decisions). Re-runnable; --dry-run reads and compares but writes nothing.
 *
 * Environment: SUPABASE_URL, SUPABASE_SECRET_KEY (sb_secret_…; never in a
 * browser, never committed). A .env.local beside package.json is read when
 * present.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { deskRowsFor, installDiskFetch, loadableModules } from '../src/lib/deskRowsFeed.js';
import { planDeskRowSync } from '../src/lib/deskRowSync.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(["'])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function parseArgs(argv) {
  const out = { dryRun: false, tier: null, feature: null, batch: 500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--tier') out.tier = argv[++i];
    else if (a === '--feature') out.feature = argv[++i];
    else if (a === '--batch') out.batch = Math.max(1, Number(argv[++i]) || 500);
  }
  return out;
}

function ok(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (!res.status || res.status < 200 || res.status >= 300) throw new Error(`${what}: HTTP ${res.status} ${res.statusText || ''}`.trim());
  return res;
}

async function upsertRows(client, rows, batch, loadedAt) {
  let n = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch).map((r) => ({ ...r, loaded_at: loadedAt }));
    const res = ok(
      await client.from('desk_rows').upsert(slice, { onConflict: 'tier,feature,row_key', count: 'exact' }),
      `desk_rows upsert (${slice[0].feature}, batch at ${i})`,
    );
    if (res.count !== slice.length) throw new Error(`desk_rows upsert (${slice[0].feature}, batch at ${i}): ${res.count} of ${slice.length} rows written`);
    n += slice.length;
  }
  return n;
}

/** Every stored row of one module, paged: PostgREST returns at most 1,000 rows a request. */
async function storedRows(client, tab, feature) {
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const res = ok(
      await client.from('desk_rows').select('row_key,row,record_text,document_key,snapshot_at')
        .eq('tier', tab).eq('feature', feature).order('row_key', { ascending: true }).range(from, from + page - 1),
      `desk_rows read (${feature}, from ${from})`,
    );
    out.push(...(res.data || []));
    if (!res.data || res.data.length < page) return out;
  }
}

/** Delete the keys a module no longer shows, in slices small enough for a URL. */
async function deleteKeys(client, tab, feature, keys) {
  let n = 0;
  for (let i = 0; i < keys.length; i += 200) {
    const slice = keys.slice(i, i + 200);
    const res = ok(
      await client.from('desk_rows').delete({ count: 'exact' }).eq('tier', tab).eq('feature', feature).in('row_key', slice),
      `desk_rows delete (${feature}, slice at ${i})`,
    );
    n += res.count ?? 0;
  }
  return n;
}

async function main(argv) {
  const opts = parseArgs(argv);
  loadDotEnv(resolve(ROOT, '.env.local'));
  // The desk pipeline's relative fetches are served from disk below; the
  // Supabase client keeps the real fetch, captured before the swap.
  const realFetch = globalThis.fetch;
  let client = null;
  {
    // A dry run still reads the stored rows, so its table shows the real difference.
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (environment or .env.local)');
    if (!key.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_… key');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: realFetch } });
  }

  const restore = installDiskFetch(resolve(ROOT, 'public'));
  const loadedAt = new Date().toISOString();
  const totals = { modules: 0, withRows: 0, rows: 0, collisions: 0, unchanged: 0, upserted: 0, pruned: 0, snapshot: {} };
  try {
    const modules = loadableModules().filter(({ mod, tab }) => (!opts.tier || tab === opts.tier) && (!opts.feature || mod.htmlFeature === opts.feature));
    console.log(`${opts.dryRun ? 'DRY RUN' : 'LIVE'} ${loadedAt}: ${modules.length} module(s)`);
    console.log('tab           feature                                                     shown   rows  coll  snapshot  unchanged  upserted  pruned');
    for (const { mod } of modules) {
      const r = await deskRowsFor(mod, { publicDir: resolve(ROOT, 'public'), fallbackSnapshot: loadedAt });
      const plan = planDeskRowSync(await storedRows(client, r.tab, r.feature), r.rows, { ignoreSnapshot: r.snapshot.source === 'run' });
      let upserted = 0;
      let pruned = 0;
      if (!opts.dryRun) {
        if (plan.upserts.length) upserted = await upsertRows(client, plan.upserts, opts.batch, loadedAt);
        if (plan.deleteKeys.length) pruned = await deleteKeys(client, r.tab, r.feature, plan.deleteKeys);
      } else {
        upserted = plan.upserts.length;
        pruned = plan.deleteKeys.length;
      }
      totals.modules++;
      if (r.rows.length) totals.withRows++;
      totals.rows += r.rows.length;
      totals.collisions += r.collisions.length;
      totals.unchanged += plan.unchanged;
      totals.upserted += upserted;
      totals.pruned += pruned;
      totals.snapshot[r.snapshot.source] = (totals.snapshot[r.snapshot.source] || 0) + 1;
      console.log(
        `${r.tab.padEnd(13)} ${r.feature.slice(0, 58).padEnd(58)} ${String(r.shown).padStart(6)} ${String(r.rows.length).padStart(6)} ${String(r.collisions.length).padStart(5)}  ${r.snapshot.source.padEnd(8)} ${String(plan.unchanged).padStart(10)} ${String(upserted).padStart(9)} ${String(pruned).padStart(7)}`,
      );
      if (r.collisions.length) console.log(`  collisions (last row wins): ${r.collisions.join(' | ')}`);
    }
  } finally {
    restore();
  }
  console.log('totals', totals);
  return totals;
}

// vite-node drops the script from process.argv; the script's own arguments
// follow it on the command line, so they are everything after "--" when
// present, else everything after the vite-node options and the script.
function scriptArgs() {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf('--');
  if (dash !== -1) return argv.slice(dash + 1);
  const i = argv.findIndex((a) => /load-desk-rows\.mjs$/.test(a));
  return i === -1 ? argv : argv.slice(i + 1);
}

main(scriptArgs()).catch((e) => {
  console.error(e);
  process.exit(1);
});
