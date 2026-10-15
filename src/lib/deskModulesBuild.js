/**
 * Build the desk module list the record brief (desk-brief scope 'record', F123) accepts module
 * names from: every module the desks show (DESK_CATALOGUE), planned modules excluded, keyed by
 * desk tab id, which is the id record.ts normaliseTier gives for either naming of a tier. Unlike
 * deskCatalog.json it does not depend on desk_rows, so live and composite modules are included.
 * Written to supabase/functions/_shared/deskModules.json by scripts/build-desk-modules.mjs and
 * checked for staleness by src/lib/deskModules.test.js.
 */
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';
import { isPlannedModule } from './plannedModules.js';

export const DESK_MODULES_PATH = 'supabase/functions/_shared/deskModules.json';

export function buildDeskModules() {
  const modules = DESK_CATALOGUE
    .filter((e) => !isPlannedModule(e.tier, e.feature))
    .map((e) => ({ tier: e.tab, feature: e.feature }));
  return { modules };
}
