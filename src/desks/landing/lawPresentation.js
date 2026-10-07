import { DESK_VISUALS } from './deskImages.js';

const visual = DESK_VISUALS.law;
const lines = html => html.replace(/<\/?span>/g, '').split('<br>');
const module = (feature, title = feature) => ({ tier: 'judiciary', feature, title, configured: true });
const groups = [
  { id: 'judicial-intelligence', name: 'Judicial Intelligence', short: 'Judicial Intelligence', description: 'Stored Supreme Court orders and limited court reporting. Reporting coverage is not an official docket or case count.', modules: [
    module('Supreme Court Order & Judgment Feed', 'Supreme Court Orders & Judgments'),
    module('Order Archive by Topic (Cross-Court)', 'Supreme Court orders by topic'),
    module('UP High Court (Allahabad) Order Feed', 'Allahabad High Court reporting'),
    module('District Court Case Tracker'),
    module('NGT Environmental Litigation Tracker'),
    module('CAT & Consumer Disputes (NCDRC) Watch'),
  ] },
  { id: 'judicial-analytics', name: 'Judicial Analytics', short: 'Judicial Analytics', description: 'Judge and bench reporting; structured profiles and bench analytics are not established.', modules: [module('HC Judge Profiles & Bench Analytics', 'Judge & bench reporting')] },
  { id: 'international-courts', name: 'International Courts', short: 'International Courts', description: 'ICC, ICJ and WTO reporting. Official proceedings and docket completeness are not established.', modules: [module('ICC Proceedings'), module('ICJ Proceedings'), module('WTO Dispute Settlement')] },
  { id: 'tribunals', name: 'Tribunals', short: 'Tribunals', description: 'NCLT orders, IBBI public announcements and sector tribunal reporting. NCLAT coverage and completeness are not established.', modules: [module('NCLT / NCLAT (Insolvency)'), module('Sector Tribunals (ITAT / TDSAT / SAT / DRT)')] },
];

// Exact reference images and copy; values and coverage come only from summaries.
export const LAW_PRESENTATION = {
  id: 'law', name: 'Law', title: lines(visual.title), description: visual.desc,
  image: visual.image, imageLabel: visual.label, heading: visual.heading,
  groups: groups.map((group, index) => ({ ...group, image: visual.images[index], title: lines(visual.titles[index]), cardDescription: visual.summaries[index] })),
};
