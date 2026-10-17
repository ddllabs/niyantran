import features from '../../data/html-feature-map.json';
import { feedColumns } from '../../lib/columns.js';
import { DESK_CATALOGUE_IDENTITY } from './deskCatalogueIdentity.js';

const canonicalIds = new Set(features.map(module => `${module.htmlTier}:${module.htmlFeature}`));
/** Terminal catalogue: validated identities plus configured schema labels for field search. */
export const DESK_CATALOGUE = DESK_CATALOGUE_IDENTITY.map(entry => {
  if (!canonicalIds.has(entry.id)) throw new Error(`Unknown desk catalogue identity: ${entry.id}`);
  return { ...entry, fields: feedColumns(entry.feature, []).filter(column => column.keep).map(column => column.label) };
});

const searchable = DESK_CATALOGUE.map(entry => [entry, [entry.desk, entry.group, ...entry.aliases, entry.description, ...entry.fields].join(' ').toLowerCase()]);

/** Catalogue discovery does not fetch records or imply live provider coverage. */
export function searchDeskCatalogue(query) {
  const terms = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const score = entry => entry.aliases.some(alias => alias.toLowerCase() === terms.join(' ')) ? 0
    : entry.aliases.some(alias => terms.every(term => alias.toLowerCase().includes(term))) ? 1 : 2;
  return searchable.filter(([, text]) => terms.every(term => text.includes(term))).map(([entry]) => entry)
    .sort((a, b) => score(a) - score(b));
}
