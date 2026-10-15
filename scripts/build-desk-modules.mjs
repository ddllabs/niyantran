/**
 * Regenerate supabase/functions/_shared/deskModules.json — the desk modules the record brief
 * accepts (desk-brief scope 'record', F123).
 *
 *   npx vite-node --config vitest.config.js scripts/build-desk-modules.mjs
 *
 * Runs under vite-node because DESK_CATALOGUE imports JSON the Vite way. The builder lives in
 * src/lib/deskModulesBuild.js; src/lib/deskModules.test.js fails when the committed file is stale.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESK_MODULES_PATH, buildDeskModules } from '../src/lib/deskModulesBuild.js';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const list = buildDeskModules();
writeFileSync(resolve(root, DESK_MODULES_PATH), `${JSON.stringify(list, null, 2)}\n`);
console.log(`${DESK_MODULES_PATH}: ${list.modules.length} modules`);
