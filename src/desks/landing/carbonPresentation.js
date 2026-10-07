import { DESK_VISUALS } from './deskImages.js';
const visual = DESK_VISUALS.carbon;
const lines = html => html.replace(/<\/?span>/g, '').split('<br>');
const module = feature => ({ tier: 'climate', feature, title: feature, configured: true });
const groups = [
  { id: 'markets', name: 'Carbon Markets', short: 'Carbon Markets', description: 'Stored jurisdiction pricing, annual observations and adoption years. These are not live market ticks.', modules: [module('Global Carbon Pricing Tracker'), module('Carbon Price Monitor'), module('ETS & Tax Adoption Timeline')] },
  { id: 'border', name: 'Border Mechanisms', short: 'Border Mechanisms', description: 'Extracted EU and UK carbon-border milestones with official source links. Effective dates are not retrieval dates.', modules: [module('Carbon Border (CBAM) Watch')] },
  { id: 'india', name: 'India Carbon Market', short: 'India Carbon Market', description: 'Stored CCTS and Green Credit Programme milestones with Ministry of Power, BEE and MoEFCC sources.', modules: [module('India CCTS & Green Credits')] },
  { id: 'wire', name: 'Registries & Wire', short: 'Registries & Wire', description: 'Registry publications and outlet climate reporting. Live feeds, mixed publications and snapshot fallbacks are identified per module.', modules: [module('Carbon Registry Wire'), module('Climate Newswire')] },
];
export const CARBON_PRESENTATION = {
  id: 'carbon', name: 'Carbon', title: lines(visual.title), description: visual.desc,
  image: visual.image, imageLabel: visual.label, heading: visual.heading,
  groups: groups.map((group, index) => ({ ...group, image: visual.images[index], title: lines(visual.titles[index]), cardDescription: visual.summaries[index] })),
};
