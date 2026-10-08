import { DESK_VISUALS } from './deskImages.js';

const visual = DESK_VISUALS.economics;
const lines = html => html.replace(/<\/?span>/g, '').split('<br>');
const module = (feature, title = feature) => ({ tier: 'finance', feature, title, configured: true });
const groups = [
  { id: 'markets', name: 'Market Intelligence', short: 'Markets', description: 'Delayed Indian quote snapshots and last index quotes for configured global venues. Source dates and coverage vary.', modules: [
    module('NSE/BSE Delayed Market Feed'), module('Live Global Stock Exchanges', 'Global exchange index quotes'),
  ] },
  { id: 'macro', name: 'Macro Indicators & Models', short: 'Macro & Models', description: 'World Bank country observations and historical India GDP growth. PMI and what-if scenario modelling are not supplied.', modules: [
    module('Economic Overview of All Countries', 'Country GDP observations'),
    module('Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop)', 'GDP, CPI & employment indicators'),
    module('Economic Simulator', 'India GDP growth baseline'),
  ] },
  { id: 'industry', name: 'Industry, Trade & Technology', short: 'Industry & Trade', description: 'India electricity-access observations, DGFT notifications, enterprise chief-executive identities and PIB reporting. Coverage is narrower than the full module catalogue.', modules: [
    module('Sector Policy — Power/Energy/Green/Critical Minerals', 'India electricity-access series'),
    module('Trade Agreements & Economic Sanctions', 'DGFT trade notifications'),
    module('Top Financial & Business Players', 'Indian enterprise chief executives'),
    module('AI & the Tech Industry', 'PIB technology reporting'),
  ] },
  { id: 'predictions', name: 'Prediction Markets', short: 'Prediction Markets', description: 'Manifold political markets, live or stored according to source availability. A separate election-forecast table is not supplied.', modules: [
    module('Prediction Market Political Odds'), module('Election Forecast Aggregator'),
  ] },
];

export const ECONOMICS_PRESENTATION = {
  id: 'economics', name: 'Economics', title: lines(visual.title), description: visual.desc,
  image: visual.image, imageLabel: visual.label, heading: visual.heading,
  groups: groups.map((group, index) => ({ ...group, image: visual.images[index], title: lines(visual.titles[index]), cardDescription: index === 1 ? 'Country indicators and historical GDP observations.' : index === 3 ? 'Political market questions; election forecasts unavailable.' : visual.summaries[index] })),
};
