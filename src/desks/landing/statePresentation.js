import { DESK_VISUALS } from './deskImages.js';
const visual = DESK_VISUALS.state;
const lines = html => html.replace(/<\/?span>/g, '').split('<br>');
// title: the name the page shows when it differs from the module's key (F196: the five state-level themes
// keep their 'District …' keys and show 'State …' names; src/lib/rbiHandbookTables.js HANDBOOK_MODULES).
const module = (feature, { tier = 'state', configured = true, existingOnly = false, title = feature } = {}) => ({ tier, feature, title, configured, existingOnly });
const groups = [
  { id: "elections", name: "Elections & Electoral Rolls", short: "Elections & Rolls", modules: [
    module("Constituency Register"),
    module("Roll Demography"),
    module("Community Bloc Matrix"),
    module("Election Results 2017–2024"),
    module("Split-Ticket & Competitiveness"),
    module("SIR Roll Churn"),
    module("Registration Gap"),
    module("Booth-level Results Database", {"tier": "local"}),
    module("Party Organisation Map"),
    module("MLA Defection & Anti-defection Case Tracker"),
    module("Booth Political History", {"tier": "local", "existingOnly": true}),
  ] },
  { id: "government", name: "Government & Legislature", short: "Government", modules: [
    module("State Governance Brief"),
    module("Governor Assent Tracker"),
    module("Assembly Proceedings Digest (Vernacular, Translated)"),
    module("MLA Report Card + Statement Tracker"),
    module("Legislative Productivity Comparison"),
    module("Governor Friction & President's Rule Tracker"),
    module("MLA Directory", {"existingOnly": true}),
    module("Municipal Watch", {"tier": "local", "existingOnly": true}),
    module("Panchayat Watch", {"tier": "local", "existingOnly": true}),
    module("Municipal & Panchayat Tender Aggregator", {"tier": "local", "existingOnly": true, "configured": false}),
    module("Local Governance Brief", {"tier": "local", "existingOnly": true}),
  ] },
  { id: "finance", name: "Public Finance & Operations", short: "Finance & Operations", modules: [
    module("Bureaucrat Transfer & Posting Tracker (State Cadre)"),
    module("State Tender Aggregator (State e-Procurement)"),
    module("Centre-State Fund Flow Tracker"),
    module("Cabinet Decisions"),
    module("State Economic Data (GSDP, sectors)"),
    module("State Fiscal Deep-Dive"),
    module("SDL Auction & Borrowing Tracker"),
    module("CAG Audit Tracker"),
  ] },
  { id: "districts", name: "Districts & Development", short: "District Development", modules: [
    module("Cross-State Comparison Engine"),
    module("NITI Aayog State Indices"),
    module("District Performance Tracker (Composite)"),
    module("District Health & Nutrition Indicators", {"title": "State Health & Nutrition Indicators"}),
    module("District Education Indicators", {"title": "State Education Indicators"}),
    module("District Economic & Livelihood Indicators", {"title": "State Economic & Livelihood Indicators"}),
    module("District Agriculture & Rural Indicators", {"title": "State Agriculture & Rural Indicators"}),
    module("District Infrastructure & Connectivity", {"title": "State Infrastructure & Connectivity"}),
    module("District Governance & Grievance Indicators", {"configured": false}),
    module("District Crime & Safety Indicators", {"configured": false}),
  ] },
  { id: "media", name: "District Media", short: "District Media", modules: [
    module("District Media Monitor (Vernacular District Editions)"),
  ] },
];
export const STATE_PRESENTATION = {
  id: 'state', name: 'State', coverageCounts: true, title: lines(visual.title), description: visual.desc,
  image: visual.image, imageLabel: visual.label, heading: visual.heading,
  groups: groups.map((group, index) => ({ ...group, description: visual.summaries[index], cardDescription: visual.summaries[index], image: visual.images[index], title: lines(visual.titles[index]) })),
};
