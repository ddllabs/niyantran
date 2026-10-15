// Owner-approved entry points. Do not infer defaults from catalogue order or live counts.
export const DESK_DEFAULTS = {
  national: {
    legislation: 'Bill Passage Probability Index',
    electoral: 'Candidate Affidavit Database (Structured + API)',
    representatives: 'MP Profiles & Performance (MPLAD, attendance, debates)',
    operations: 'Central Tender Aggregator + Constituency Filter',
    economy: 'Budget Utilisation & Schemes',
  },
  global: {
    security: 'Open Fronts', diplomacy: 'Alliances', assets: 'Infra',
    resources: 'Energy', geonomics: 'Global Trade',
  },
  law: {
    'judicial-intelligence': 'Supreme Court Order & Judgment Feed',
    'judicial-analytics': 'HC Judge Profiles & Bench Analytics',
    'international-courts': 'ICJ Proceedings', tribunals: 'NCLT / NCLAT (Insolvency)',
  },
  economics: {
    markets: 'NSE/BSE Delayed Market Feed',
    macro: 'Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop)',
    industry: 'Trade Agreements & Economic Sanctions', predictions: 'Prediction Market Political Odds',
  },
  carbon: {
    markets: 'Global Carbon Pricing Tracker', border: 'Carbon Border (CBAM) Watch',
    india: 'India CCTS & Green Credits', wire: 'Carbon Registry Wire',
  },
  sports: {
    cricket: 'Cricket Wire', football: 'Football Wire', india: 'Indian Sports Wire',
    business: 'Sports Business & Media Rights',
  },
  entertainment: {
    screens: 'TV & Streaming Tonight', wire: 'Entertainment News Wire',
    music: 'Music Charts — India Top 25', 'screen-intelligence': 'OTT & Studio Intelligence',
  },
  state: {
    elections: 'Constituency Register', government: 'State Governance Brief',
    finance: 'Centre-State Fund Flow Tracker', districts: 'Cross-State Comparison Engine',
    media: 'District Media Monitor (Vernacular District Editions)',
  },
};
