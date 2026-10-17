/**
 * Build the desk module catalogue (desk-row-grounding spec §D): one entry per
 * grounded module, in desk and bucket order, with the number of rows the
 * desk shows for it and the registry note when there is one. Written to
 * supabase/functions/_shared/deskCatalog.json by scripts/build-desk-catalog.mjs
 * and checked for staleness by src/lib/deskCatalog.test.js. Node only.
 *
 * The eight RBI Handbook modules (src/lib/rbiHandbookTables.js HANDBOOK_MODULES) follow the State
 * desk's modules. They are not pack modules: scripts/load-desk-rows.mjs --handbook writes their rows
 * (src/lib/handbookDeskRows.js), one feature each on the State desk, and the generic loader must never
 * see them (groundingModulesForTier leaves them out for that reason), so they are added here. Each
 * entry also says what the model needs to search a figure: its tables ("Table 176: …"), the fields
 * the rows answer to and how a year is written. The row count is 0 (the register is not in the repo),
 * which the prompt does not print for an entry with tables.
 */
import { TABS, allModules, groundingBucketsFor, groundingModulesForTier, registryEntries } from '../desks/catalog.js';
import { tabForModule } from './deskRowsFeed.js';
import { HANDBOOK_MODULES, HANDBOOK_NOTE, handbookTableLabel } from './rbiHandbookTables.js';

export const CATALOG_PATH = 'supabase/functions/_shared/deskCatalog.json';

/** The fields a handbook row can be searched on (src/lib/handbookDeskRows.js writes each of them). */
export const HANDBOOK_CATALOGUE_FIELDS = Object.freeze([
  'state',
  'indicator',
  'year',
  'value',
  'unit',
  'table_no',
  'table_title',
  'as_of',
  'source_url',
  'date',
  'period',
]);

/** How a handbook year is written and dated (handbookYearDate in src/lib/handbookDeskRows.js). */
export const HANDBOOK_YEARS =
  '"2019-20" = financial year (1 April 2019 to 31 March 2020); "2005" = calendar year; "2019-21" = inclusive calendar-year survey span; date ranges match interval overlap; filter year exactly as written';

/** The State desk's handbook entries, in the module order the handbook defines. */
function handbookEntries() {
  const state = allModules().filter((m) => m.htmlTier === 'state');
  return Object.entries(HANDBOOK_MODULES).map(([id, spec]) => {
    const [tier, feature] = id.split(/:(.*)/s);
    const mod = state.find((m) => m.htmlFeature === feature);
    const named = spec.label ? ` Desk name: "${spec.label}".` : '';
    return {
      tier,
      feature,
      bucket: mod?.bucket || 'Development Indicators',
      pack: null,
      rows: 0,
      note: `${HANDBOOK_NOTE}${named}`,
      tables: spec.tables.map((no) => handbookTableLabel(no)),
      fields: [...HANDBOOK_CATALOGUE_FIELDS],
      years: HANDBOOK_YEARS,
    };
  });
}

/** `rowsFor(mod)` resolves to the number of rows the desk shows for the module. */
export async function buildDeskCatalog({ rowsFor }) {
  const entries = [];
  for (const tab of TABS) {
    if (tab.id === 'home') continue;
    for (const bucket of groundingBucketsFor(groundingModulesForTier(tab.tier), tab.tier)) {
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
    if (tab.id === 'state') entries.push(...handbookEntries());
  }
  return entries;
}
