import { DESK_VISUALS } from './deskImages.js';

const visual = DESK_VISUALS.global;
const lines = html => html.replace(/<\/?span>/g, '').split('<br>');
const module = (feature, title = feature) => ({ tier: 'geopolitics', feature, title, configured: true });
const groups = [
  { id: 'security', name: 'Security', short: 'Security', description: 'Conflict theatres, open fronts, intelligence context and live transit.', modules: [module('Open Fronts'), module('Global Intelligence'), module('Geopolitics News Wire')] },
  { id: 'diplomacy', name: 'Diplomacy', short: 'Diplomacy', description: 'Blocs, sanctions and heads of state.', modules: [module('Alliances'), module('Sanctions'), module('Heads of State')] },
  { id: 'assets', name: 'Strategic Assets', short: 'Strategic Assets', description: 'Infrastructure, nuclear sites, upcoming launches and chokepoints.', modules: [module('Infra'), module('Nuclear Watch'), module('Satellite Infrastructure', 'Upcoming launches'), module('Maritime Choke-Points')] },
  { id: 'resources', name: 'Global Resources', short: 'Resources', description: 'Humanitarian appeals and critical minerals.', modules: [module('Global Aid'), module('Energy', 'Energy & Critical Minerals')] },
  { id: 'geonomics', name: 'Geonomics', short: 'Geonomics', description: 'Constitutions, growth, commodities and trade.', modules: [module('World Constitutions'), module('Growth Indicators'), module('Global Commodities'), module('Global Trade')] },
];

// Visual identity comes from the frozen reference; summaries alone supply values.
export const GLOBAL_PRESENTATION = {
  id: 'global', name: 'Global', title: lines(visual.title), description: visual.desc,
  image: visual.image, imageLabel: visual.label, heading: visual.heading,
  groups: groups.map((group, index) => ({ ...group, image: visual.images[index], title: lines(visual.titles[index]), cardDescription: visual.summaries[index] })),
};
