/**
 * Regenerate supabase/functions/_shared/deskCatalog.json — the module list the
 * model sees (desk-row-grounding spec §D) and the loader loads.
 *
 *   npx vite-node --config vitest.config.js scripts/build-desk-catalog.mjs
 *
 * Runs under vite-node because src/desks/catalog.js imports JSON the Vite
 * way; the Vitest config is used so the dev server's auth plugin does not
 * start. vite-node strips the script from process.argv, so this file is a
 * plain runner: nothing imports it, and the builder lives in
 * src/lib/deskCatalogBuild.js. src/lib/deskCatalog.test.js fails when the
 * committed file is stale.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_PATH, buildDeskCatalog } from '../src/lib/deskCatalogBuild.js';
import { deskRowsFor, installDiskFetch } from '../src/lib/deskRowsFeed.js';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const publicDir = resolve(root, 'public');
const restore = installDiskFetch(publicDir);
const startedAt = new Date().toISOString();
try {
  const entries = await buildDeskCatalog({
    rowsFor: async (mod) => (await deskRowsFor(mod, { publicDir, fallbackSnapshot: startedAt })).rows.length,
  });
  writeFileSync(resolve(root, CATALOG_PATH), `${JSON.stringify({ generated_at: startedAt, entries }, null, 2)}\n`);
  const withRows = entries.filter((e) => e.rows > 0).length;
  console.log(`${CATALOG_PATH}: ${entries.length} modules, ${withRows} with rows, ${entries.reduce((s, e) => s + e.rows, 0)} rows`);
} finally {
  restore();
}
