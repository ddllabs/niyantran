/**
 * Build the desk module catalogue (desk-row-grounding spec §D): one entry per
 * navigation module, in desk and bucket order, with the number of rows the
 * desk shows for it and the registry note when there is one. Written to
 * supabase/functions/_shared/deskCatalog.json by scripts/build-desk-catalog.mjs
 * and checked for staleness by src/lib/deskCatalog.test.js. Node only.
 */
import { TABS, bucketsFor, modulesForTier, registryEntries } from '../desks/catalog.js';
import { tabForModule } from './deskRowsFeed.js';

export const CATALOG_PATH = 'supabase/functions/_shared/deskCatalog.json';

/** `rowsFor(mod)` resolves to the number of rows the desk shows for the module. */
export async function buildDeskCatalog({ rowsFor }) {
  const entries = [];
  for (const tab of TABS) {
    if (tab.id === 'home') continue;
    for (const bucket of bucketsFor(modulesForTier(tab.tier), tab.tier)) {
      for (const mod of bucket.items) {
        const note = String(registryEntries(mod)[0]?.notes || '').trim() || null;
        entries.push({
          tier: tabForModule(mod) || tab.id,
          feature: mod.htmlFeature,
          bucket: bucket.label,
          pack: mod.dataset ? String(mod.dataset) : null,
          rows: await rowsFor(mod),
          note,
        });
      }
    }
  }
  return entries;
}
