/**
 * F196: the Table control of the RBI handbook modules and the Cross-State Comparison Engine (MLA
 * Directory keeps its own State control, src/desks/MlaStatePicker.jsx). Plain data from
 * src/lib/rbiHandbookTables.js, so the page asks for exactly the variants the server stores.
 *
 * modulePicker(tier, feature) is null for every other module, else
 *   { id, param, label, defaultValue, options: [{ value, label, group? }] }
 * where `param` is the request parameter the server reads (`table`) and defaultValue the table the
 * server answers when none is named (a handbook module's first table; GSDP for the Comparison Engine).
 */
import {
  COMPARISON_DEFAULT_TABLE,
  HANDBOOK_MODULES,
  handbookModuleFor,
  handbookTableLabel,
} from './rbiHandbookTables.js';

export const COMPARISON_FEATURE = 'Cross-State Comparison Engine';

const moduleLabel = (id) => HANDBOOK_MODULES[id].label || id.split(/:(.*)/s)[1];

export function modulePicker(tier, feature) {
  const name = String(feature ?? '').trim();
  const spec = handbookModuleFor(tier, name);
  if (spec) {
    return {
      id: 'handbook-table',
      param: 'table',
      label: 'Table',
      defaultValue: String(spec.tables[0]),
      options: spec.tables.map((no) => ({ value: String(no), label: handbookTableLabel(no) })),
    };
  }
  if (tier === 'state' && name.toLowerCase() === COMPARISON_FEATURE.toLowerCase()) {
    // Every table of every handbook module, grouped by module; a table two modules share is listed once.
    const seen = new Set();
    const options = [];
    for (const id of Object.keys(HANDBOOK_MODULES)) {
      for (const no of HANDBOOK_MODULES[id].tables) {
        if (seen.has(no)) continue;
        seen.add(no);
        options.push({ value: String(no), label: handbookTableLabel(no), group: moduleLabel(id) });
      }
    }
    return { id: 'comparison-table', param: 'table', label: 'Table', defaultValue: String(COMPARISON_DEFAULT_TABLE), options };
  }
  return null;
}
