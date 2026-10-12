import openFronts from './adapters/openFronts.js';
import globalIntelligence from './adapters/globalIntelligence.js';
import infra from './adapters/infra.js';

/**
 * Which Global modules render the record panel (F121), by feature name. A module not listed here
 * keeps the existing record view. Batches 2 and 3 add their adapters here.
 */
const ADAPTERS = [
  [/^open fronts$/i, openFronts],
  [/^(global intelligence|defence procurement intelligence)$/i, globalIntelligence],
  [/^infra$/i, infra],
];

export function adapterFor(feature) {
  const name = String(feature ?? '').trim();
  if (!name) return null;
  return ADAPTERS.find(([pattern]) => pattern.test(name))?.[1] || null;
}
