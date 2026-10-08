import { DESK_VISUALS } from './deskImages.js';
const visual = DESK_VISUALS.state;
const lines = html => html.replace(/<\/?span>/g, '').split('<br>');
const module = (feature, { tier = 'state', configured = true, existingOnly = false } = {}) => ({ tier, feature, title: feature, configured, existingOnly });
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
    module("Party Organisation Map", {"configured": false}),
    module("MLA Defection & Anti-defection Case Tracker", {"configured": false}),
    module("Booth Political History", {"tier": "local", "existingOnly": true}),
  ] },
  { id: "government", name: "Government & Legislature", short: "Government", modules: [
    module("State Governance Brief"),
    module("Governor Assent Tracker"),
    module("Assembly Proceedings Digest (Vernacular, Translated)"),
    module("MLA Report Card + Statement Tracker"),
    module("Legislative Productivity Comparison", {"configured": false}),
    module("Governor Friction & President's Rule Tracker", {"configured": false}),
    module("MLA Directory", {"existingOnly": true}),
    module("Municipal Watch", {"tier": "local", "existingOnly": true}),
    module("Panchayat Watch", {"tier": "local", "existingOnly": true}),
    module("Municipal & Panchayat Tender Aggregator", {"tier": "local", "existingOnly": true}),
    module("Local Governance Brief", {"tier": "local", "existingOnly": true}),
  ] },
  { id: "finance", name: "Public Finance & Operations", short: "Finance & Operations", modules: [
    module("Bureaucrat Transfer & Posting Tracker (State Cadre)"),
    module("State Tender Aggregator (State e-Procurement)"),
    module("Centre-State Fund Flow Tracker"),
    module("Cabinet Decisions"),
    module("State Economic Data (GSDP, sectors)", {"configured": false}),
    module("State Fiscal Deep-Dive"),
    module("SDL Auction & Borrowing Tracker", {"configured": false}),
    module("CAG Audit Tracker"),
  ] },
  { id: "districts", name: "Districts & Development", short: "District Development", modules: [
    module("Cross-State Comparison Engine", {"configured": false}),
    module("NITI Aayog State Indices", {"configured": false}),
    module("District Performance Tracker (Composite)"),
    module("District Health & Nutrition Indicators", {"configured": false}),
    module("District Education Indicators", {"configured": false}),
    module("District Economic & Livelihood Indicators", {"configured": false}),
    module("District Agriculture & Rural Indicators", {"configured": false}),
    module("District Infrastructure & Connectivity", {"configured": false}),
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
