import features from '../../data/html-feature-map.json';
import { feedColumns } from '../../lib/columns.js';
import { NATIONAL_PRESENTATION } from './deskPresentation.js';
import { GLOBAL_PRESENTATION } from './globalPresentation.js';
import { LAW_PRESENTATION } from './lawPresentation.js';
import { ECONOMICS_PRESENTATION } from './economicsPresentation.js';
import { CARBON_PRESENTATION } from './carbonPresentation.js';
import { SPORTS_PRESENTATION } from './sportsPresentation.js';
import { ENTERTAINMENT_PRESENTATION } from './entertainmentPresentation.js';

const presentations = [NATIONAL_PRESENTATION, GLOBAL_PRESENTATION, LAW_PRESENTATION, ECONOMICS_PRESENTATION, CARBON_PRESENTATION, SPORTS_PRESENTATION, ENTERTAINMENT_PRESENTATION];
const canonicalIds = new Set(features.map(module => `${module.htmlTier}:${module.htmlFeature}`));
const seen = new Set();

/** Configured identity and schema metadata only; summaries establish availability. */
export const DESK_CATALOGUE = presentations.flatMap(desk => desk.groups.flatMap(group => group.modules.map(module => {
  const id = `${module.tier}:${module.feature}`;
  if (!canonicalIds.has(id)) throw new Error(`Unknown desk catalogue identity: ${id}`);
  if (seen.has(id)) throw new Error(`Duplicate desk catalogue identity: ${id}`);
  seen.add(id);
  return {
    id, tab: desk.id, tier: module.tier, feature: module.feature, title: module.title,
    desk: desk.name, groupId: group.id, group: group.name,
    description: group.description,
    aliases: [...new Set([module.feature, module.title])],
    // Empty rows never establish populated columns. Only explicit keep presets
    // are known configured schema labels; other modules wait for a real summary.
    fields: feedColumns(module.feature, []).filter(column => column.keep).map(column => column.label),
    configured: module.configured,
  };
})));

const searchable = DESK_CATALOGUE.map(entry => [entry, [entry.desk, entry.group, ...entry.aliases, entry.description, ...entry.fields].join(' ').toLowerCase()]);

/** Catalogue discovery does not fetch records or imply live provider coverage. */
export function searchDeskCatalogue(query) {
  const terms = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const score = entry => entry.aliases.some(alias => alias.toLowerCase() === terms.join(' ')) ? 0
    : entry.aliases.some(alias => terms.every(term => alias.toLowerCase().includes(term))) ? 1 : 2;
  return searchable.filter(([, text]) => terms.every(term => text.includes(term))).map(([entry]) => entry)
    .sort((a, b) => score(a) - score(b));
}
