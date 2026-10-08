import features from '../data/html-feature-map.json';
import registry from '../data/source-registry.json';
import { DESK_CATALOGUE } from './landing/deskCatalogue.js';

export const TABS = [
  { id: 'home', label: 'Home', labelHi: 'मुखपृष्ठ', tier: 'home' },
  { id: 'global', label: 'Global', labelHi: 'वैश्विक', tier: 'geopolitics' },
  { id: 'national', label: 'National', labelHi: 'राष्ट्रीय', tier: 'national' },
  { id: 'state', label: 'State', labelHi: 'राज्य', tier: 'state' },
  { id: 'law', label: 'Law', labelHi: 'विधि', tier: 'judiciary' },
  { id: 'economics', label: 'Economics', labelHi: 'अर्थव्यवस्था', tier: 'finance' },
  { id: 'carbon', label: 'Carbon', labelHi: 'कार्बन', tier: 'climate' },
  { id: 'sports', label: 'Sports', labelHi: 'खेल', tier: 'sports' },
  { id: 'entertainment', label: 'Entertainment', labelHi: 'मनोरंजन', tier: 'entertainment' },
];

const registryByKey = new Map(registry.map((r) => [r.key, r]));

export function allModules() {
  return features;
}

/**
 * Curated module lists per desk (product nav). Route ids stay on htmlFeature names
 * from the feature map; display aliases live in featureMenuLabel.
 */
const DESK_FEATURES = {
  geopolitics: [
    'Open Fronts',
    'Global Intelligence',
    'Alliances',
    'Sanctions',
    'Global Aid',
    'Infra',
    'Nuclear Watch',
    'Satellite Infrastructure',
    'Maritime Choke-Points',
    'World Constitutions',
    'Growth Indicators',
    'Geopolitics News Wire',
    'Heads of State',
    'Global Commodities',
    'Global Trade',
    'Energy',
  ],
  national: [
    'Bill Passage Probability Index',
    'Policy Intelligence Graph',
    'Parliamentary Question Database',
    'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)',
    'Candidate Affidavit Database (Structured + API)',
    'MP Profiles & Performance (MPLAD, attendance, debates)',
    'Central Tender Aggregator + Constituency Filter',
    'Bureaucratic Transfers — AGMUT Cadre',
    'Cabinet Decisions',
    'Centre-sanctioned Projects & Completion Rate',
    'Budget Utilisation & Schemes',
    'Industry Updates (Ministry Data)',
  ],
  // State nav includes former Local booth / municipal modules (still local-tier in the map).
  state: [
    'Constituency Register',
    'MLA Directory',
    'MLA Report Card + Statement Tracker',
    'Roll Demography',
    'Community Bloc Matrix',
    'Cabinet Decisions',
    'Bureaucrat Transfer & Posting Tracker (State Cadre)',
    'State Tender Aggregator (State e-Procurement)',
    'Booth-level Results Database',
    'Booth Political History',
    'Municipal Watch',
    'Panchayat Watch',
    'Municipal & Panchayat Tender Aggregator',
    'Local Governance Brief',
  ],
  judiciary: [
    'Supreme Court Order & Judgment Feed',
    'Order Archive by Topic (Cross-Court)',
    'UP High Court (Allahabad) Order Feed',
    'District Court Case Tracker',
    'NGT Environmental Litigation Tracker',
    'CAT & Consumer Disputes (NCDRC) Watch',
    'HC Judge Profiles & Bench Analytics',
    'ICC Proceedings',
    'ICJ Proceedings',
    'WTO Dispute Settlement',
    'NCLT / NCLAT (Insolvency)',
    'Sector Tribunals (ITAT / TDSAT / SAT / DRT)',
  ],
  finance: [
    'NSE/BSE Delayed Market Feed',
    'Live Global Stock Exchanges',
    'Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop)',
    'Sector Policy — Power/Energy/Green/Critical Minerals',
    'AI & the Tech Industry',
    'Prediction Market Political Odds',
  ],
  climate: [
    'Carbon Border (CBAM) Watch',
    'Global Carbon Pricing Tracker',
    'India CCTS & Green Credits',
    'Carbon Registry Wire',
  ],
  sports: [
    'Cricket Wire',
    'Football Wire',
    'ISL Tracker',
    'Indian Sports Wire',
    'Sports Governance & Policy',
    'Athlete Index',
  ],
  entertainment: [
    'TV & Streaming Tonight',
    'Box Office Tracker',
    'Music Charts — India Top 25',
    'Music Charts — Global Top 25',
    'OTT & Studio Intelligence',
  ],
};

const DESK_FEATURE_SET = Object.fromEntries(
  Object.entries(DESK_FEATURES).map(([tier, list]) => [tier, new Set(list)]),
);

/** Registry mapping with no shipped view — must never borrow a sibling desk's rows. */
export function isHtmlOnlyModule(mod) {
  return String(mod?.mapping || '').toUpperCase() === 'HTML-ONLY';
}

function featureIndex(tier, name) {
  const list = DESK_FEATURES[tier] || [];
  const i = list.indexOf(name);
  return i === -1 ? 999 : i;
}

export function modulesForTier(tier) {
  const approved = DESK_CATALOGUE.filter(entry => tier === 'state' ? entry.tab === 'state' : entry.tier === tier);
  if (approved.length) return approved.map(entry => features.find(module => module.htmlTier === entry.tier && module.htmlFeature === entry.feature));
  return groundingModulesForTier(tier);
}

/** Frozen shipped grounding inventory; navigation expansion is not ingestion. */
export function groundingModulesForTier(tier) {
  const allow = DESK_FEATURE_SET[tier];
  if (!allow) return features.filter((f) => f.htmlTier === tier);

  // State desk also surfaces curated local-tier booth / municipal modules.
  const list = features.filter((f) => {
    if (!allow.has(f.htmlFeature)) return false;
    if (tier === 'state') return f.htmlTier === 'state' || f.htmlTier === 'local';
    return f.htmlTier === tier;
  });

  // Prefer the tier-native copy when the same title exists on two tiers (e.g. Cabinet Decisions).
  const byName = new Map();
  for (const m of list) {
    const prev = byName.get(m.htmlFeature);
    if (!prev) {
      byName.set(m.htmlFeature, m);
      continue;
    }
    if (m.htmlTier === tier && prev.htmlTier !== tier) byName.set(m.htmlFeature, m);
  }

  return [...byName.values()].sort(
    (a, b) => featureIndex(tier, a.htmlFeature) - featureIndex(tier, b.htmlFeature),
  );
}

export function groundingCatalogModules() {
  return TABS.filter((t) => t.id !== 'home').flatMap((t) => groundingModulesForTier(t.tier));
}

export function catalogModules() {
  return TABS.filter((t) => t.id !== 'home').flatMap((t) => modulesForTier(t.tier));
}

// Match HTML BUCKET_REMAP so Security includes Global Intelligence, not Strategic Assets.
const GEO_BUCKET_LABEL = [
  { re: /^(conflict intelligence|defense intelligence|maritime & border security)$/i, label: 'Security' },
  { re: /^diplomacy/i, label: 'Diplomacy' },
  { re: /^(strategic assets|infra)$/i, label: 'Strategic Assets' },
  { re: /^(news & media monitoring|comparative governance|intelligence)$/i, label: 'Global Resources' },
  { re: /^geoeconom/i, label: 'Geonomics' },
];

const BUCKET_REMAP = {
  national: {
    'Public Finance': 'Economy, Finance & Industry',
    'Sector & Industry Intelligence': 'Economy, Finance & Industry',
    'Regulatory & Judicial': 'Legislative & Policy Intelligence',
    'News & Media Monitoring': 'Representative & Media Intelligence',
    'Representative Intelligence': 'Representative & Media Intelligence',
  },
  state: {
    Electoral: 'State of Play',
    'Electoral Roll': 'The Roll',
    Elections: 'State of Play',
    'Roll Integrity': 'The Roll',
    'Community & Society': 'The Roll',
    'News & Media Monitoring': 'Districts',
    'Development Indicators': 'Local watch',
    Governance: 'Legislature',
    'Legislative & Policy Intelligence': 'Legislature',
    'Government Operations': 'Government Operations',
    'Public Finance': 'Public Finance',
    'Audit & Oversight': 'Local watch',
    'Electoral Data & Analytics': 'State of Play',
    'Representative Intelligence': 'State of Play',
    'Political Operations Intelligence': 'State of Play',
    'Comparative Analytics': 'Districts',
    Assembly: 'Booths',
    Booths: 'Booths',
    'Contest Analysis': 'Booths',
    'Local Wires': 'Local watch',
    Municipality: 'Local watch',
    Panchayats: 'Local watch',
    Representatives: 'Local watch',
    'Local Governance': 'Local watch',
  },
  judiciary: { 'Legal Research': 'Judicial Analytics' },
  finance: {
    'Analytical Tools': 'Macro, Trade & Economy',
    'Macro & Economic Indicators': 'Macro, Trade & Economy',
    'Trade & Sanctions': 'Macro, Trade & Economy',
  },
};

const BUCKET_ORDER = {
  geopolitics: ['Security', 'Diplomacy', 'Strategic Assets', 'Global Resources', 'Geonomics'],
  national: [
    'Legislative & Policy Intelligence',
    'Electoral Data & Analytics',
    'Representative & Media Intelligence',
    'Government Operations',
    'Economy, Finance & Industry',
  ],
  state: ['State of Play', 'The Roll', 'Government Operations', 'Booths', 'Local watch'],
  judiciary: ['Judicial Intelligence', 'Judicial Analytics', 'International Courts', 'Tribunals'],
  finance: ['Market Intelligence', 'Macro, Trade & Economy', 'Sector & Industry Intelligence', 'Prediction Markets'],
  climate: ['Border Mechanisms', 'Carbon Markets', 'India Carbon Market', 'Registries & Wire'],
  sports: ['Scores & Fixtures', 'Football Desk', 'India Sports Desk', 'Sports Business'],
  entertainment: ['Screens & Streaming', 'Music', 'Screen Intelligence'],
};

const FEATURE_ORDER = {
  geopolitics: {
    Security: ['Open Fronts', 'Global Intelligence'],
    Diplomacy: ['Alliances', 'Sanctions', 'Global Aid'],
    'Strategic Assets': ['Infra', 'Nuclear Watch', 'Satellite Infrastructure', 'Maritime Choke-Points'],
    'Global Resources': [
      'Geopolitics News Wire',
      'World Constitutions',
      'Growth Indicators',
      'Heads of State',
      'Global Commodities',
    ],
    Geonomics: ['Global Trade', 'Energy'],
  },
  national: {
    'Legislative & Policy Intelligence': [
      'Bill Passage Probability Index',
      'Policy Intelligence Graph',
      'Parliamentary Question Database',
      'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)',
    ],
    'Electoral Data & Analytics': ['Candidate Affidavit Database (Structured + API)'],
    'Representative & Media Intelligence': ['MP Profiles & Performance (MPLAD, attendance, debates)'],
    'Government Operations': [
      'Central Tender Aggregator + Constituency Filter',
      'Bureaucratic Transfers — AGMUT Cadre',
      'Cabinet Decisions',
      'Centre-sanctioned Projects & Completion Rate',
    ],
    'Economy, Finance & Industry': ['Budget Utilisation & Schemes', 'Industry Updates (Ministry Data)'],
  },
  state: {
    'State of Play': ['Constituency Register', 'MLA Directory', 'MLA Report Card + Statement Tracker'],
    'The Roll': ['Roll Demography', 'Community Bloc Matrix'],
    'Government Operations': [
      'Cabinet Decisions',
      'Bureaucrat Transfer & Posting Tracker (State Cadre)',
      'State Tender Aggregator (State e-Procurement)',
    ],
    Booths: ['Booth-level Results Database', 'Booth Political History'],
    'Local watch': [
      'Municipal Watch',
      'Panchayat Watch',
      'Municipal & Panchayat Tender Aggregator',
      'Local Governance Brief',
    ],
  },
  judiciary: {
    'Judicial Intelligence': [
      'Supreme Court Order & Judgment Feed',
      'Order Archive by Topic (Cross-Court)',
      'UP High Court (Allahabad) Order Feed',
      'District Court Case Tracker',
      'NGT Environmental Litigation Tracker',
      'CAT & Consumer Disputes (NCDRC) Watch',
    ],
    'Judicial Analytics': ['HC Judge Profiles & Bench Analytics'],
    'International Courts': ['ICC Proceedings', 'ICJ Proceedings', 'WTO Dispute Settlement'],
    Tribunals: ['NCLT / NCLAT (Insolvency)', 'Sector Tribunals (ITAT / TDSAT / SAT / DRT)'],
  },
  finance: {
    'Market Intelligence': ['NSE/BSE Delayed Market Feed', 'Live Global Stock Exchanges'],
    'Macro, Trade & Economy': ['Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop)'],
    'Sector & Industry Intelligence': [
      'Sector Policy — Power/Energy/Green/Critical Minerals',
      'AI & the Tech Industry',
    ],
    'Prediction Markets': ['Prediction Market Political Odds'],
  },
  climate: {
    'Border Mechanisms': ['Carbon Border (CBAM) Watch'],
    'Carbon Markets': ['Global Carbon Pricing Tracker'],
    'India Carbon Market': ['India CCTS & Green Credits'],
    'Registries & Wire': ['Carbon Registry Wire'],
  },
  sports: {
    'Scores & Fixtures': ['Cricket Wire'],
    'Football Desk': ['Football Wire', 'ISL Tracker'],
    'India Sports Desk': ['Indian Sports Wire', 'Sports Governance & Policy'],
    'Sports Business': ['Athlete Index'],
  },
  entertainment: {
    'Screens & Streaming': ['TV & Streaming Tonight', 'Box Office Tracker'],
    Music: ['Music Charts — India Top 25', 'Music Charts — Global Top 25'],
    'Screen Intelligence': ['OTT & Studio Intelligence'],
  },
};

export function bucketLabel(name, tier) {
  if (tier === 'geopolitics') {
    const hit = GEO_BUCKET_LABEL.find((x) => x.re.test(name || ''));
    return hit?.label || name;
  }
  const map = BUCKET_REMAP[tier];
  return (map && map[name]) || name;
}

export function bucketsFor(mods, tier) {
  const approved = DESK_CATALOGUE.filter(entry => tier === 'state' ? entry.tab === 'state' : entry.tier === tier);
  if (approved.length) {
    const groups = new Map();
    for (const entry of approved) {
      const module = mods.find(module => module.htmlTier === entry.tier && module.htmlFeature === entry.feature);
      if (!module) continue;
      if (!groups.has(entry.groupId)) groups.set(entry.groupId, { name: entry.group, label: entry.group, items: [] });
      groups.get(entry.groupId).items.push(module);
    }
    return [...groups.values()];
  }
  return groundingBucketsFor(mods, tier);
}

export function groundingBucketsFor(mods, tier) {
  const featOrderByBucket = FEATURE_ORDER[tier] || {};
  const merged = new Map();
  for (const m of mods) {
    let label;
    if (FEATURE_ORDER[tier]) {
      label = Object.keys(featOrderByBucket).find((k) => featOrderByBucket[k].includes(m.htmlFeature));
    }
    if (!label) label = bucketLabel(m.bucket || 'Desk', tier);
    if (!merged.has(label)) merged.set(label, { name: m.bucket, label, items: [] });
    merged.get(label).items.push(m);
  }
  const order = BUCKET_ORDER[tier];
  const list = [...merged.values()]
    .map((b) => {
      const featOrder = featOrderByBucket[b.label];
      if (!featOrder) {
        // Only curated modules — drop unlisted extras.
        const allow = DESK_FEATURE_SET[tier];
        return {
          ...b,
          items: allow ? b.items.filter((m) => allow.has(m.htmlFeature)) : b.items,
        };
      }
      const ordered = featOrder
        .map((name) => b.items.find((m) => m.htmlFeature === name))
        .filter(Boolean);
      return { ...b, items: ordered };
    })
    .filter((b) => b.items.length);
  if (!order) return list;
  return list.sort((a, b) => {
    const ai = order.indexOf(a.label);
    const bi = order.indexOf(b.label);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

export function bucketContaining(buckets, featureName) {
  if (!featureName) return null;
  return buckets.find((b) => b.items.some((m) => m.htmlFeature === featureName)) || null;
}

export function registryEntries(mod) {
  return (mod?.registryKeys || []).map((k) => registryByKey.get(k)).filter(Boolean);
}

export function primaryAdapter(mod) {
  const entry = registryEntries(mod)[0];
  return (entry?.adapter || mod?.adapters || '').split(/[|,]/)[0].trim().toLowerCase() || 'unmapped';
}

export const HOME_SHORTCUTS = [
  { tab: 'national', tier: 'national', feature: 'Bill Passage Probability Index', label: 'Bill Passage Tracker' },
  { tab: 'global', tier: 'geopolitics', feature: 'Open Fronts', label: 'Open Fronts' },
  { tab: 'global', tier: 'geopolitics', feature: 'Growth Indicators', label: 'World Bank growth' },
  { tab: 'national', tier: 'national', feature: 'Parliamentary Question Database', label: 'Parliamentary questions' },
  { tab: 'global', tier: 'geopolitics', feature: 'Geopolitics News Wire', label: 'Geopolitics wire' },
  { tab: 'carbon', tier: 'climate', feature: 'Global Carbon Pricing Tracker', label: 'Carbon pricing' },
];
