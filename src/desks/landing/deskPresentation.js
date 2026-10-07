// Visual copy is reference-derived; counts and coverage come only from summaries.
export const NATIONAL_PRESENTATION = {
  "id": "national",
  "name": "National",
  "title": [
    "A nation's decisions.",
    "All in perspective."
  ],
  "description": "From the floor of Parliament to the forces shaping the economy. Explore the records behind the Republic.",
  "image": "national-people-tricolour.png",
  "imageLabel": "INDIA · PEOPLE & COMMUNITIES",
  "heading": "A connected view of the nation.",
  "groups": [
    {
      "id": "legislation",
      "name": "Legislative & Policy Intelligence",
      "short": "Legislative & Policy",
      "title": [
        "Legislation &",
        "Policy"
      ],
      "description": "Bills, policy graph, pipeline, questions and regulators.",
      "cardDescription": "Bills, questions & regulatory notices",
      "image": "parliament-new",
      "modules": [
        {
          "tier": "national",
          "feature": "Bill Passage Probability Index",
          "title": "Bill Passage Probability Index",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "Policy Intelligence Graph",
          "title": "Policy Intelligence Graph",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "Parliamentary Question Database",
          "title": "Parliamentary Question Database",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "Policy Pipeline Tracker (Draft-to-Gazette)",
          "title": "Policy Pipeline Tracker",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "Regulatory Body Watch (RBI/SEBI/TRAI/CCI)",
          "title": "Regulatory Body Watch",
          "configured": true
        }
      ]
    },
    {
      "id": "electoral",
      "name": "Electoral Data & Analytics",
      "short": "Electoral",
      "title": [
        "Elections &",
        "Democracy"
      ],
      "description": "Affidavits, delimitation and manifesto trackers.",
      "cardDescription": "Candidates, constituencies & promises",
      "image": "voters",
      "modules": [
        {
          "tier": "national",
          "feature": "Candidate Affidavit Database (Structured + API)",
          "title": "Candidate Affidavit Database",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "Delimitation Impact Simulator",
          "title": "Delimitation Impact Simulator",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "LS Manifestos & Promises Tracker",
          "title": "LS Manifestos & Promises",
          "configured": true
        }
      ]
    },
    {
      "id": "representatives",
      "name": "Representative & Media Intelligence",
      "short": "Representative & Media",
      "title": [
        "Representatives &",
        "Media"
      ],
      "description": "Statements, MP profiles and morning brief.",
      "cardDescription": "MP profiles, performance & news",
      "image": "press-cameras",
      "modules": [
        {
          "tier": "national",
          "feature": "MP Profiles & Performance (MPLAD, attendance, debates)",
          "title": "MP Profiles & Performance",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "National Morning Brief (Auto-digest)",
          "title": "National Morning Brief",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "Statement & Quote Tracker with Contradiction Detection",
          "title": "Statements & Quote Tracker",
          "configured": true
        }
      ]
    },
    {
      "id": "operations",
      "name": "Government Operations",
      "short": "Gov. Operations",
      "title": [
        "Government &",
        "Operations"
      ],
      "description": "Tenders, transfers, cabinet and centre-sanctioned projects.",
      "cardDescription": "Cabinet, tenders & public projects",
      "image": "government-emblem",
      "modules": [
        {
          "tier": "national",
          "feature": "Cabinet Decisions",
          "title": "Cabinet Decisions",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "Central Tender Aggregator + Constituency Filter",
          "title": "Central Tender Aggregator",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "Bureaucratic Transfers — AGMUT Cadre",
          "title": "Bureaucratic Transfers (AGMUT)",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "Centre-sanctioned Projects & Completion Rate",
          "title": "Centre-Sanctioned Projects",
          "configured": true
        }
      ]
    },
    {
      "id": "economy",
      "name": "Economy, Finance & Industry",
      "short": "Economy & Finance",
      "title": [
        "Economy &",
        "Industry"
      ],
      "description": "Budget utilisation and industry updates.",
      "cardDescription": "Budgets, schemes & ministry data",
      "image": "steel-web",
      "modules": [
        {
          "tier": "national",
          "feature": "Budget Utilisation & Schemes",
          "title": "Budget Utilisation & Schemes",
          "configured": true
        },
        {
          "tier": "national",
          "feature": "Industry Updates (Ministry Data)",
          "title": "Industry Updates (Ministry Data)",
          "configured": true
        }
      ]
    }
  ]
};

export function summarizeModules(modules, summaries) {
  const resources = new Map();
  let pending = 0, knownModules = 0;
  for (const module of modules) {
    const summary = summaries[module.feature];
    if (!summary) pending++;
    if (Number.isInteger(summary?.count) && summary.count >= 0) {
      knownModules++;
      resources.set(summary.resourceKey || `${module.tier}:${module.feature}`, summary.count);
    }
  }
  return { count: resources.size ? [...resources.values()].reduce((a, b) => a + b, 0) : null, loaded: resources.size, pending, knownModules };
}

export function moduleAvailability(module, summary) {
  if (!summary) return 'Loading summary';
  if (summary.availability === 'error') return 'Summary unavailable';
  if (summary.availability === 'unavailable') return 'Measured data unavailable';
  if (module.feature === 'Parliamentary Question Database' && summary.sourceMode === 'stored') return 'Stored · Sampled questions';
  if (!module.configured && summary.sourceMode === 'unknown' && !summary.count) return 'Not connected';
  const modes = { stored: 'Stored register', 'feed-backed': 'Feed-backed', curated: 'Curated records', unknown: 'Source scope unavailable' };
  return `${modes[summary.sourceMode] || modes.unknown}${summary.availability === 'empty' ? ' · empty' : ''}`;
}

export const formatCount = value => value == null ? '—' : value.toLocaleString('en-IN');
export function sourceDate(value) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Source date unavailable';
}
