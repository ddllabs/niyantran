// Frozen reference imagery: exact bytes, no record or availability data.
// Titles contain trusted reference markup; page models must convert it to text lines.
export const DESK_IMAGES = Object.freeze({
  "india-hero.png": "/images/desks-v6/c12f6f76ce8623b84fca.png",
  "logo.svg": "/images/desks-v6/db840e0eaa55fe5d715f.svg",
  "parliament-new.jpg": "/images/desks-v6/53e480286532ece900b1.jpg",
  "parliament-new-wide.jpg": "/images/desks-v6/6c7f28af8c6ef572ae3b.jpg",
  "voters.jpg": "/images/desks-v6/abb0a90fe140851e53c2.jpg",
  "press-cameras.jpg": "/images/desks-v6/485abb7393c6e20c46ef.jpg",
  "emblem.svg": "/images/desks-v6/f6b7475f96250c408c51.svg",
  "steel-web.jpg": "/images/desks-v6/43ee31d94e7ffc16ca50.jpg",
  "earth.jpg": "/images/desks-v6/0a9e50592936b072020b.jpg",
  "global-earth.jpg": "/images/desks-v6/ddc31bd30cf098243de4.jpg",
  "elections.jpg": "/images/desks-v6/a0efb2586e83ce0bfda6.jpg",
  "trade.jpg": "/images/desks-v6/bd6616317b4a22ed2e98.jpg",
  "nuclear.jpg": "/images/desks-v6/d4681dda3e2fbbadf0b9.jpg",
  "thermal-web.jpg": "/images/desks-v6/fedc79fb5ccf840ed7e4.jpg",
  "supreme-front-web.jpg": "/images/desks-v6/5be5938cbe580e129bdb.jpg",
  "law.jpg": "/images/desks-v6/6db9fc0f41f47fe4e925.jpg",
  "indian-courtroom.jpg": "/images/desks-v6/9187888c74eba5dcf044.jpg",
  "legal-files.jpg": "/images/desks-v6/1b2408a6d161f9e2f7f1.jpg",
  "economy.jpg": "/images/desks-v6/eb0200a8cb847c54b9ab.jpg",
  "government.jpg": "/images/desks-v6/1a7bfdbd0300b99e4f58.jpg",
  "resources.jpg": "/images/desks-v6/f132a5801c0196184424.jpg",
  "sports-hero.png": "/images/desks-v6/d9eb9dddacde798dad0e.png",
  "entertainment-hero.png": "/images/desks-v6/efa4cebfdb846b114498.png",
  "state-hero.png": "/images/desks-v6/47cff565e81039be1f78.png",
  "local-hero.png": "/images/desks-v6/a0fa290636bb7ca41d06.png",
  "football-hero.png": "/images/desks-v6/d0ea7dcfd0ca443ffa56.png",
  "music-hero.png": "/images/desks-v6/544cc9e98583582f60f1.png",
  "india-evm.jpg": "/images/desks-v6/f1f7872b35eda38180c0.jpg",
  "nse-mumbai.jpg": "/images/desks-v6/f6429a32d33fa96e2451.jpg",
  "bse-mumbai.jpg": "/images/desks-v6/aa22ad4d8b51394eea40.jpg",
  "civic-highways.png": "/images/desks-v6/5dc079c08f3e54518a36.png",
  "public-welfare.png": "/images/desks-v6/f13368b928e1277e1267.png",
  "local-media.png": "/images/desks-v6/1468ee1f36d94c6a1848.png",
  "macro-indicators.png": "/images/desks-v6/612045bbcf106371b52a.png",
  "industry-machinery.png": "/images/desks-v6/3706d807894c70ac1614.png",
  "sports-industry.png": "/images/desks-v6/6b6eec8ee50bc077816c.png",
  "state-administration-photo.jpg": "/images/desks-v6/cd65a10d9d2b82cdb81b.jpg",
  "local-development-hero.png": "/images/desks-v6/2d2369d77fd65b46438f.png",
  "economics-markets-hero.png": "/images/desks-v6/5bc6d5cd3f2c090014e5.png",
  "national-people-tricolour.png": "/images/desks-v6/a675cbad2d7f9b9d7e3b.png"
});

export const DESK_IMAGE_CREDITS = "/images/desks-v6/9f040bde79dbc5e1a488.txt";

// Composite keys require all listed image layers; layout is owned by the shared UI.
export const DESK_IMAGE_COMPOSITES = Object.freeze({
  "government-emblem": [
    "parliament-new.jpg",
    "emblem.svg"
  ],
  "energy-plants": [
    "nuclear.jpg",
    "thermal-web.jpg"
  ],
  "judicial-books": [
    "law.jpg",
    "indian-courtroom.jpg"
  ],
  "insolvency": [
    "legal-files.jpg",
    "economy.jpg"
  ],
  "global-trade": [
    "trade.jpg"
  ],
  "nse-bse": [
    "nse-mumbai.jpg",
    "bse-mumbai.jpg"
  ]
});

export const DESK_VISUALS = Object.freeze({
  "national": {
    "title": "A nation's decisions.<br><span>All in perspective.</span>",
    "desc": "From the floor of Parliament to the forces shaping the economy. Explore the records behind the Republic.",
    "label": "INDIA · PEOPLE & COMMUNITIES",
    "image": "national-people-tricolour.png",
    "heading": "A connected view of the nation.",
    "images": [
      "parliament-new",
      "voters",
      "press-cameras",
      "government-emblem",
      "steel-web"
    ],
    "titles": [
      "Legislation &<br>Policy",
      "Elections &<br>Democracy",
      "Representatives &<br>Media",
      "Government &<br>Operations",
      "Economy &<br>Industry"
    ],
    "summaries": [
      "Bills, questions & regulatory notices",
      "Candidates, constituencies & promises",
      "MP profiles, performance & news",
      "Cabinet, tenders & public projects",
      "Budgets, schemes & ministry data"
    ]
  },
  "global": {
    "title": "A world of signals.<br><span>One clear perspective.</span>",
    "desc": "Explore the connections between power, resources and the world economy. Put every development in context.",
    "label": "A WORLD OF CONNECTED INTELLIGENCE",
    "image": "global-earth",
    "heading": "The world, through five lenses.",
    "images": [
      "earth",
      "elections",
      "trade",
      "energy-plants",
      "global-trade"
    ],
    "titles": [
      "Security &<br>Intelligence",
      "Diplomacy &<br>Alliances",
      "Strategic<br>Assets",
      "Energy &<br>Resources",
      "Trade &<br>Geonomics"
    ],
    "summaries": [
      "Conflicts, procurement & geopolitics",
      "Alliances, sanctions & world leaders",
      "Nuclear sites, satellites & corridors",
      "Aid, energy & critical minerals",
      "Constitutions, growth & global trade"
    ]
  },
  "law": {
    "title": "Every record matters.<br><span>See the bigger picture.</span>",
    "desc": "Navigate courts, tribunals and international proceedings. Understand what is available before you open a record.",
    "label": "SUPREME COURT OF INDIA · NEW DELHI",
    "image": "supreme-front-web",
    "heading": "Your map of the legal landscape.",
    "images": [
      "supreme-front-web",
      "judicial-books",
      "elections",
      "insolvency"
    ],
    "titles": [
      "Judicial<br>Intelligence",
      "Judicial<br>Analytics",
      "International<br>Courts",
      "Tribunals &<br>Insolvency"
    ],
    "summaries": [
      "Supreme, High & district courts",
      "Judges, benches & legal news",
      "ICC, ICJ & WTO proceedings",
      "Insolvency & sector tribunals"
    ]
  },
  "sports": {
    "title": "Every game. Every angle.<br><span>Stay ahead of the field.</span>",
    "desc": "From the cricket ground to the business of sport. Explore fixtures, headlines and the decisions behind the game.",
    "image": "sports-hero.png",
    "label": "THE GAME. THE PEOPLE. THE BUSINESS.",
    "heading": "A complete view of the sporting world.",
    "images": [
      "sports-hero.png",
      "football-hero.png",
      "press-cameras.jpg",
      "sports-industry.png"
    ],
    "titles": [
      "Cricket &<br>Fixtures",
      "Football<br>Desk",
      "Indian Sport &<br>Governance",
      "Business &<br>Athletes"
    ],
    "summaries": [
      "Cricket headlines, world fixtures and results.",
      "World football coverage and the ISL.",
      "Indian sports reporting and sports policy.",
      "Media rights, sports economics and athlete profiles."
    ]
  },
  "entertainment": {
    "title": "Beyond the spotlight.<br><span>See the whole story.</span>",
    "desc": "Explore what is on screen, what is making news and what is climbing the charts. A clearer view of the entertainment world.",
    "image": "entertainment-hero.png",
    "label": "SCREENS · STORIES · SOUND",
    "heading": "Find your next cultural insight.",
    "images": [
      "entertainment-hero.png",
      "press-cameras.jpg",
      "music-hero.png",
      "entertainment-hero.png"
    ],
    "titles": [
      "Screens &<br>Streaming",
      "Film &<br>Industry Wire",
      "Music &<br>Charts",
      "Studios &<br>Influence"
    ],
    "summaries": [
      "TV schedules, streaming and box-office coverage.",
      "Entertainment reporting and the Bollywood beat.",
      "India and global music purchase charts.",
      "OTT platforms, studios and cultural influence."
    ]
  },
  "state": {
    "title": "Closer to the state.<br><span>Clearer on the detail.</span>",
    "desc": "Explore assembly constituencies, governance, public finance and district outcomes. Understand the forces shaping every state.",
    "image": "state-administration-photo.jpg",
    "label": "VIDHANA SOUDHA · KARNATAKA",
    "heading": "Five perspectives on state affairs.",
    "images": [
      "india-evm.jpg",
      "civic-highways.png",
      "economy.jpg",
      "public-welfare.png",
      "local-media.png"
    ],
    "titles": [
      "Elections &<br>Electoral Rolls",
      "Government &<br>Legislature",
      "Finance &<br>Operations",
      "Districts &<br>Development",
      "District<br>Media"
    ],
    "summaries": [
      "Constituencies, roll changes, communities and results.",
      "State governance, legislative activity and elected members.",
      "Budgets, borrowing, audits, tenders and transfers.",
      "Health, education, livelihoods and district comparisons.",
      "News coverage scoped to the selected geography."
    ]
  },
  "local": {
    "title": "Every neighbourhood.<br><span>A sharper perspective.</span>",
    "desc": "Go from constituencies to communities. Explore booth records, civic services, local finance and the places people call home.",
    "image": "local-development-hero.png",
    "label": "LOCAL DEVELOPMENT · CIVIC ADMINISTRATION",
    "heading": "A closer view of the places that matter.",
    "images": [
      "india-evm.jpg",
      "civic-highways.png",
      "economy.jpg",
      "public-welfare.png",
      "local-media.png"
    ],
    "titles": [
      "Booths &<br>Elections",
      "Civic Life &<br>Representatives",
      "Finance &<br>Accountability",
      "Places &<br>Public Services",
      "Hyperlocal<br>News"
    ],
    "summaries": [
      "Booth registers, political history and roll integrity.",
      "Local governance, officers, tenders and elected representatives.",
      "Local-body finances, public works and revenue.",
      "Land use, infrastructure and service-delivery scorecards.",
      "Local news from across the selected geography."
    ]
  },
  "economics": {
    "title": "Follow the economy.<br><span>Understand the forces.</span>",
    "desc": "Connect market moves with macro indicators, industry policy and trade. Understand the forces behind every economic signal.",
    "image": "economics-markets-hero.png",
    "label": "NSE · BSE · GLOBAL MARKETS · GOLD · BONDS",
    "heading": "Put economic signals in perspective.",
    "images": [
      "nse-bse",
      "macro-indicators.png",
      "trade.jpg",
      "industry-machinery.png"
    ],
    "titles": [
      "Markets &<br>Exchanges",
      "Macro &<br>Models",
      "Industry, Trade<br>& Technology",
      "Prediction<br>Markets"
    ],
    "summaries": [
      "Indian market snapshots and global exchange coverage.",
      "Country indicators, economic context and scenario tools.",
      "Energy, trade policy, major businesses and technology.",
      "Market questions, political odds and forecast coverage."
    ]
  },
  "carbon": {
    "title": "Track the transition.<br><span>See what changes.</span>",
    "desc": "Explore carbon pricing, policy milestones and registry updates. Connect the evidence behind the move to a lower-carbon economy.",
    "image": "resources.jpg",
    "label": "CARBON · CLIMATE · THE TRANSITION",
    "heading": "The climate economy, in context.",
    "images": [
      "resources.jpg",
      "trade.jpg",
      "steel-web.jpg",
      "earth.jpg"
    ],
    "titles": [
      "Carbon<br>Markets",
      "Trade &<br>CBAM",
      "India &<br>Green Credits",
      "Registries &<br>Climate News"
    ],
    "summaries": [
      "Pricing jurisdictions, annual observations and adoption timelines.",
      "Carbon-border policy and regulatory milestones.",
      "CCTS, green credits and national policy milestones.",
      "Registry announcements and climate reporting."
    ]
  }
});
