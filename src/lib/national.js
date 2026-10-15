export function isBillPassageFeature(name) {
  return /bill passage/i.test(String(name || ''));
}

export function isPolicyGraphFeature(name) {
  return /policy intelligence graph/i.test(String(name || ''));
}

export function isMpCardsFeature(name) {
  return /mp profiles|mp report cards/i.test(String(name || ''));
}

export function isDelimitationFeature(name) {
  return /delimitation/i.test(String(name || ''));
}

export function isManifestosFeature(name) {
  return /manifestos/i.test(String(name || ''));
}

export function isBudgetFeature(name) {
  return /budget utilisation|budget & schemes/i.test(String(name || ''));
}

export function isProjectsFeature(name) {
  return /centre-sanctioned|central projects/i.test(String(name || ''));
}

export function isMorningBriefFeature(name) {
  return /morning brief/i.test(String(name || ''));
}

export function isStatementsFeature(name) {
  return /statement & quote|statements & contradictions|public-figure media mention/i.test(String(name || ''));
}

/** UI display names — keep htmlFeature / route ids stable. */
const FEATURE_DISPLAY_ALIASES = {
  'Supreme Court Order & Judgment Feed': 'Supreme Court Order & Judgements Feed',
  'SUPREME COURT FEED': 'Supreme Court Order & Judgements Feed',
  'Order Archive by Topic (Cross-Court)': 'Orders by Topic (Cross-Court)',
  'ORDER ARCHIVE': 'Orders by Topic (Cross-Court)',
  'Candidate Affidavit Database (Structured + API)': 'Candidate Affidavit Database',
  'UP High Court (Allahabad) Order Feed': 'High Court Case Tracker',
  'HC Judge Profiles & Bench Analytics': 'Judge Profiles & Bench Analytics',
  'NSE/BSE Delayed Market Feed': 'NSE/BSE Market Feed',
  'Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop)':
    'All Countries Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop)',
  'Prediction Market Political Odds': 'Prediction Market',
  'Music Charts — India Top 25': 'India Music Charts',
  'Music Charts — Global Top 25': 'Global Music Charts',
  // F196: state-level figures (RBI Handbook of Statistics on Indian States); the module keys keep 'District'.
  'District Health & Nutrition Indicators': 'State Health & Nutrition Indicators',
  'District Education Indicators': 'State Education Indicators',
  'District Economic & Livelihood Indicators': 'State Economic & Livelihood Indicators',
  'District Agriculture & Rural Indicators': 'State Agriculture & Rural Indicators',
  'District Infrastructure & Connectivity': 'State Infrastructure & Connectivity',
  // F202: modules holding only the Goa geography pack say Goa (src/desks/landing/statePresentation.js).
  'Constituency Register': 'Goa Constituency Register',
  'Roll Demography': 'Goa Roll Demography',
  'Community Bloc Matrix': 'Goa Community Bloc Matrix',
  'Election Results 2017–2024': 'Goa Election Results 2017–2024',
  'Split-Ticket & Competitiveness': 'Goa Split-Ticket & Competitiveness',
  'SIR Roll Churn': 'Goa SIR Roll Churn',
  'Registration Gap': 'Goa Registration Gap',
  'Booth-level Results Database': 'Goa Booth-Level Results Database',
  'Booth Political History': 'Goa Booth Political History',
  'Local Governance Brief': 'Goa Local Governance Brief',
  // F202: English news; nothing is vernacular or translated.
  'Assembly Proceedings Digest (Vernacular, Translated)': 'Assembly Proceedings Digest',
  'District Media Monitor (Vernacular District Editions)': 'District Media Monitor',
};

export function isIndustryFeature(name) {
  return /industry updates/i.test(String(name || ''));
}

export function isImpactRecordFeature(name) {
  return /bill passage|policy pipeline|parliamentary question|regulatory (body )?watch|candidate affidavit|delimitation|manifestos/i.test(
    String(name || ''),
  );
}

export function isNationalFullscreen(name) {
  return isPolicyGraphFeature(name);
}

export function isNationalTable(name) {
  const n = String(name || '');
  return (
    isBillPassageFeature(n) ||
    isMpCardsFeature(n) ||
    isDelimitationFeature(n) ||
    isManifestosFeature(n) ||
    isBudgetFeature(n) ||
    isProjectsFeature(n) ||
    isMorningBriefFeature(n) ||
    isStatementsFeature(n) ||
    /policy pipeline|parliamentary question|regulatory body watch|candidate affidavit|central tender|agmut|bureaucratic transfers|cabinet decisions|industry updates/i.test(
      n,
    )
  );
}

export function featureMenuLabel(mod) {
  // Prefer htmlFeature for UI — workbookFunctions are often short codes ("ORDER ARCHIVE").
  const raw = String(mod?.htmlFeature || mod?.workbookFunctions || mod || '').trim();
  if (!raw) return '';
  const aliased = FEATURE_DISPLAY_ALIASES[raw] || raw;
  // Prefer British plural "judgements" in all UI labels (route ids stay on Judgment).
  const spelled = aliased
    .replace(/\bJudgments?\b/gi, 'Judgements')
    .replace(/\bJudgement\b/g, 'Judgements')
    .replace(/\bOrder Archive\b/gi, 'Orders by Topic')
    .replace(/\bORDER ARCHIVE\b/gi, 'Orders by Topic');
  // A word written with capitals after its first letter (NCLT, ICC, ECtHR) is kept as written, unless
  // the whole label is in capitals (a workbook short code), where that tells us nothing.
  const allCaps = !/[a-z]/.test(spelled);
  return spelled.replace(/[A-Za-z]+(?:['’][A-Za-z]+)*/g, (w) => {
    if (/^(IAS|IPS|AGMUT|MP|MLA|PIB|RBI|SEBI|TRAI|CCI|LS|SIR|CAG|GPDP|MGNREGA|BDO|SDO|SDM|EO)$/i.test(w)) return w.toUpperCase();
    if (/^judgements$/i.test(w)) return 'Judgements';
    if (!allCaps && /[A-Z]/.test(w.slice(1))) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
}
