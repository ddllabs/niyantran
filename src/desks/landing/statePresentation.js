import { DESK_VISUALS } from './deskImages.js';
const visual = DESK_VISUALS.state;
const lines = html => html.replace(/<\/?span>/g, '').split('<br>');
// title: the name the page shows when it differs from the module's key (F196: the five state-level themes
// keep their 'District …' keys and show 'State …' names; src/lib/rbiHandbookTables.js HANDBOOK_MODULES).
const module = (feature, { tier = 'state', configured = true, existingOnly = false, title = feature } = {}) => ({ tier, feature, title, configured, existingOnly });
const groups = [
  { id: "elections", name: "Elections & Electoral Rolls", short: "Elections & Rolls", modules: [
    // F202: these modules hold only the Goa geography pack, so their names say Goa (keys unchanged;
    // the same names are in src/lib/national.js FEATURE_DISPLAY_ALIASES for the page and menus).
    module("Constituency Register", {"title": "Goa Constituency Register"}),
    module("Roll Demography", {"title": "Goa Roll Demography"}),
    module("Community Bloc Matrix", {"title": "Goa Community Bloc Matrix"}),
    module("Election Results 2017–2024", {"title": "Goa Election Results 2017–2024"}),
    module("Split-Ticket & Competitiveness", {"title": "Goa Split-Ticket & Competitiveness"}),
    module("SIR Roll Churn", {"title": "Goa SIR Roll Churn"}),
    module("Registration Gap", {"title": "Goa Registration Gap"}),
    module("Booth-level Results Database", {"tier": "local", "title": "Goa Booth-Level Results Database"}),
    module("Party Organisation Map"),
    module("MLA Defection & Anti-defection Case Tracker"),
    module("Booth Political History", {"tier": "local", "existingOnly": true, "title": "Goa Booth Political History"}),
  ] },
  { id: "government", name: "Government & Legislature", short: "Government", modules: [
    module("State Governance Brief"),
    module("Governor Assent Tracker"),
    // F202: English news on assembly sessions; nothing is vernacular or translated (key unchanged).
    module("Assembly Proceedings Digest (Vernacular, Translated)", {"title": "Assembly Proceedings Digest"}),
    module("MLA Report Card + Statement Tracker"),
    module("Legislative Productivity Comparison"),
    module("Governor Friction & President's Rule Tracker"),
    module("MLA Directory", {"existingOnly": true}),
    module("Municipal Watch", {"tier": "local", "existingOnly": true}),
    module("Panchayat Watch", {"tier": "local", "existingOnly": true}),
    module("Municipal & Panchayat Tender Aggregator", {"tier": "local", "existingOnly": true, "configured": false}),
    module("Local Governance Brief", {"tier": "local", "existingOnly": true, "title": "Goa Local Governance Brief"}),
  ] },
  { id: "finance", name: "Public Finance & Operations", short: "Finance & Operations", modules: [
    module("Bureaucrat Transfer & Posting Tracker (State Cadre)"),
    // F202: planned (src/lib/plannedModules.js) until the owner supplies a source.
    module("State Tender Aggregator (State e-Procurement)", {"configured": false}),
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
    // F202: English Google News coverage; no vernacular editions are read (key unchanged).
    module("District Media Monitor (Vernacular District Editions)", {"title": "District Media Monitor"}),
  ] },
];
export const STATE_PRESENTATION = {
  id: 'state', name: 'State', coverageCounts: true, title: lines(visual.title), description: visual.desc,
  image: visual.image, imageLabel: visual.label, heading: visual.heading,
  groups: groups.map((group, index) => ({ ...group, description: visual.summaries[index], cardDescription: visual.summaries[index], image: visual.images[index], title: lines(visual.titles[index]) })),
};
