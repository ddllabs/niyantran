/**
 * F173 (F171 B9): the desk modules that have no data source yet (19 at first; F196 built five, so 14
 * remain). Each shows the same "Module planned" state, the client asks the server nothing for them,
 * and the server answers the planned state without fetching news nobody sees. The desk catalogue marks the same modules
 * `configured: false`; a test keeps the two lists equal. Kept free of imports so the server can
 * read it.
 */
export const PLANNED_MODULES = new Set([
  'state:Cross-State Comparison Engine',
  'state:District Agriculture & Rural Indicators',
  'state:District Crime & Safety Indicators',
  'state:District Economic & Livelihood Indicators',
  'state:District Education Indicators',
  'state:District Governance & Grievance Indicators',
  'state:District Health & Nutrition Indicators',
  'state:District Infrastructure & Connectivity',
  'local:Municipal & Panchayat Tender Aggregator',
  'state:NITI Aayog State Indices',
  'state:Party Organisation Map',
  'state:SDL Auction & Borrowing Tracker',
  'state:State Economic Data (GSDP, sectors)',
  'state:State Fiscal Deep-Dive',
]);

const TIER = { economics: 'finance', finance: 'finance', state: 'state', local: 'local', sports: 'sports' };

/** Whether a module (by the tier and feature a request names) has no data source yet. */
export function isPlannedModule(tier, feature) {
  return PLANNED_MODULES.has(`${TIER[String(tier || '').toLowerCase()] || tier}:${String(feature || '').trim()}`);
}

export const PLANNED_NOTE = 'Module planned. No data source is connected for this module yet.';
