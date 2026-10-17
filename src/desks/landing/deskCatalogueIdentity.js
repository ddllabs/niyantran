import { NATIONAL_PRESENTATION } from './deskPresentation.js';
import { GLOBAL_PRESENTATION } from './globalPresentation.js';
import { LAW_PRESENTATION } from './lawPresentation.js';
import { ECONOMICS_PRESENTATION } from './economicsPresentation.js';
import { CARBON_PRESENTATION } from './carbonPresentation.js';
import { SPORTS_PRESENTATION } from './sportsPresentation.js';
import { ENTERTAINMENT_PRESENTATION } from './entertainmentPresentation.js';
import { STATE_PRESENTATION } from './statePresentation.js';

const presentations = [NATIONAL_PRESENTATION, GLOBAL_PRESENTATION, LAW_PRESENTATION, ECONOMICS_PRESENTATION, CARBON_PRESENTATION, SPORTS_PRESENTATION, ENTERTAINMENT_PRESENTATION, STATE_PRESENTATION];
const seen = new Set();

/** Lightweight canonical navigation metadata; schema enrichment belongs to the terminal. */
export const DESK_CATALOGUE_IDENTITY = presentations.flatMap(desk => desk.groups.flatMap(group => group.modules.map(module => {
  const id = `${module.tier}:${module.feature}`;
  if (seen.has(id)) throw new Error(`Duplicate desk catalogue identity: ${id}`);
  seen.add(id);
  return {
    id, tab: desk.id, tier: module.tier, feature: module.feature, title: module.title,
    desk: desk.name, groupId: group.id, group: group.name,
    description: group.description,
    aliases: [...new Set([module.feature, module.title])],
    configured: module.configured,
  };
})));
