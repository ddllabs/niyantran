/**
 * F196: the Table control of the RBI handbook modules and the Cross-State Comparison Engine (MLA
 * Directory keeps its own State control, src/desks/MlaStatePicker.jsx). Plain data from
 * src/lib/rbiHandbookTables.js, so the page asks for exactly the variants the server stores.
 *
 * modulePicker(tier, feature) is null for every other module, else
 *   { id, param, label, defaultValue, options: [{ value, label, group? }] }
 * where `param` is the request parameter the server reads (`table`) and defaultValue the table the
 * server answers when none is named (a handbook module's first table; GSDP for the Comparison Engine).
 * F201: a second control (yearsPicker, comparisonYearPicker) is built from the answer once it is in.
 */
import {
  COMPARISON_DEFAULT_TABLE,
  HANDBOOK_MODULES,
  handbookModuleFor,
  handbookTableLabel,
  isHandbookYear,
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

const text = (v) => String(v ?? '');

/**
 * F201: the Years control of a handbook module whose table is stored as more than one whole-year block
 * (2024-25 edition: Tables 176 and 151), from the answer's `meta.blocks` (src/lib/rbiHandbook.js
 * blockList). null for every other module, and for an answer of one block or none (a table in one
 * block, or data loaded before F201). `years` is a block's oldest year; '' is the newest block.
 */
export function yearsPicker(tier, feature, feed) {
  if (!handbookModuleFor(tier, String(feature ?? '').trim())) return null;
  const blocks = (Array.isArray(feed?.meta?.blocks) ? feed.meta.blocks : [])
    .filter((b) => b && (text(b.value) === '' || isHandbookYear(b.value)) && text(b.from) && text(b.through));
  if (blocks.length < 2) return null;
  return {
    id: 'handbook-years',
    param: 'years',
    label: 'Years',
    defaultValue: '',
    options: blocks.map((b) => ({ value: text(b.value), label: b.from === b.through ? text(b.from) : `${b.from} to ${b.through}` })),
  };
}

/**
 * F201: the Cross-State Comparison Engine's Year control, from the answer's `meta.years` (every year of
 * the table, newest first): "Latest" ('', each indicator's latest year) and then each year. null for
 * every other module and for an answer that lists no years.
 */
export function comparisonYearPicker(tier, feature, feed) {
  if (!(tier === 'state' && String(feature ?? '').trim().toLowerCase() === COMPARISON_FEATURE.toLowerCase())) return null;
  const years = [...new Set((Array.isArray(feed?.meta?.years) ? feed.meta.years : []).map(text).filter(isHandbookYear))];
  if (!years.length) return null;
  return {
    id: 'comparison-year',
    param: 'year',
    label: 'Year',
    defaultValue: '',
    options: [{ value: '', label: 'Latest' }, ...years.map((y) => ({ value: y, label: y }))],
  };
}
