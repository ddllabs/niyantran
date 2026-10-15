import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURATED_NEWS,
  WIRE_GUARDS,
  curatedNewsFor,
  curatedNewsRows,
  decodeEntities,
  freshNewsRows,
  headlineKey,
  isPipelineRelease,
} from './curatedNews.js';

/**
 * F202 (module quality audit 2026-10-15, causes C2–C6): the older news modules get the F196
 * treatment: their own search, a title guard, an age window and one row per story. Headlines below
 * are the audit's sampled production rows (docs/research/2026-10-15-module-quality-audit.md) and
 * live Google News results for each new search on 2026-10-15.
 */
const NOW = Date.parse('2026-10-15T12:00:00Z');
const day = (n) => new Date(NOW - n * 86_400_000).toUTCString();

const SAMPLES = {
  'state:State Governance Brief': {
    on: [
      '"Difficult": Chennai Auto Drivers On Chief Minister Vijay\'s Free Bus Scheme - NDTV',
      'Bengal Cabinet sanctions 45,185 new recruitments – here are the departments - The Indian Express',
      'Karnataka cabinet rejects Ring Road murder case accused’s clemency plea - ThePrint',
      '40,000 Displaced People A Financial Challenge In Mizoram: Chief Minister - NDTV',
      'Gujarat PSUs pay record Rs. 385 crore dividend to State Government - The Financial Express',
    ],
    off: [
      'Cabinet approves Rs 52,878 crore sale of 60.72% stake in IDBI Bank to Fairfax entity - DD India',
      'Cabinet Secretariat Recruitment Through GATE 2026: Apply for Jobs - Careers360',
      'L Murugan writes to PM Modi seeking exit from Union Cabinet, says wants to return to grassroots - The Times of India',
      'DA hike for central government employees: AIDEF urges cabinet secretary, Finance Ministry to announce DA h - The Economic Times',
      'Hyundai Motor Group eyes hydrogen expansion in India, from buses to locomotives - 헤럴드경제',
      'India will prove its friendship by giving sufficient water in the Padma, hopes Farhad - Bangladesh Sangbad Sangstha (BSS)',
    ],
  },
  'state:Cabinet Decisions': {
    on: [
      'Himachal Cabinet approves 12,000 new jobs in departments - ThePrint',
      'Odisha Cabinet approves free textbooks for 28.7 lakh students, ₹500-crore urban drainage scheme | India News - ABP Live English',
      'MP cabinet approves Rs 3,000 crore for setting up Sandipani schools, allied facilities - EdexLive',
      'Cabinet nod for 45,185 government jobs: 33,199 teaching posts across schools, says CM - Telegraph India',
      'Meghalaya cabinet approves closure of Cherra Cement, writes off Rs 24.43 crore in dues - India Today NE',
    ],
    off: [
      'Cabinet approves continuation of the National Social Assistance Programme for five years from 2026-27 to 2030-31 - PIB',
      'Cabinet approves 78-day bonus for 11.4 lakh railway employees, up to Rs 17,951 each - The Indian Express',
      'Centre Approves 60.72% Stake Sale In IDBI Bank To Fairfax For Rs 52,878 Crore - NDTV',
      "From 'Indira Gandhi' to 'PM': Cabinet approves renaming of pension schemes - The Times of India",
      'Cabinet approves revised State Asset Management Bill - Island.lk',
    ],
  },
  'state:Governor Assent Tracker': {
    on: [
      "Deadline for industrial nod reduced after Governor's assent - DT Next",
      'LG Sinha Gives Assent to Six Bills Passed During Jammu Kashmir Assembly’s Autumn Session - Kashmir Life',
      'President Murmu returns Bengal anti-Goonda Bill over NDPS overlap - The New Indian Express',
      'TN Guv gives assent to 12 Bills - ThePrint',
    ],
    off: [
      'Sarkaria Commission, Recommendations, Significance, UPSC PYQs - Vajiram &amp; Ravi',
      'Tamil Nadu CM Vijay greets Arlekar on full-time Governor appointment - The New Indian Express',
      'Gilgit-Baltistan Assembly passes ‘amended’ Local Govt Act 2026 - Dawn',
      'Gujarat seals four warehouses over suspected cattle-feed adulteration; stock worth Rs 25 crore under scrutiny - DeshGujarat',
      'Kisumu County explains Ksh5.9B pending bills as contractor debt drops to Ksh1.6B - People Daily',
    ],
  },
  'state:CAG Audit Tracker': {
    on: [
      "CAG flags irregularities in Rebuild Kerala's roadworks, cites Rs 67.49 crore in undue benefits to contractors - The New Indian Express",
      'Odisha Collects ₹24,455 Crore in Excise Duty Over Five Years, CAG Report Reveals - Aabkari Times',
      'PAC commences two-day sitting to examine CAG report - Eastern Sentinel',
    ],
    off: [
      'Constitutional Bodies, List, Key Institutions - Vajiram &amp; Ravi',
      'Orissa Minerals Development (NSE:ORISSAMINE): Who Has Been Named Statutory Auditor for FY27? - Kalkine India',
      'Kishan Reddy Accuses Rahul Of Undermining Institutions - Deccan Chronicle',
      'Key Institutions Regulating Cooperative Societies in India - GK Today',
      'BCCI Corporate Trophy, 2013/14 Cricket Team Records &amp; Stats - Cricinfo',
    ],
  },
  'state:Assembly Proceedings Digest (Vernacular, Translated)': {
    on: [
      'Kerala assembly passes resolution seeking removal of CEC - The Statesman',
      'Punjab Assembly session to begin on Oct 22 - ThePrint',
      'LDF walkout from Keralam Assembly over police action at University Hostel - The New Indian Express',
      'Uttarakhand Governor summons Legislative Assembly for third session on October 27 - ANI News',
    ],
    off: [
      'Ramlila reflects values of Indian civilisation, says Delhi Assembly Speaker Vijender Gupta - ANI News',
      '"Two-language policy should not remain just on paper": P Chidambaram - www.indiagazette.com',
      'Keralam Congress raises stink over poll process that brought it to power - India Today',
      'National Assembly session adjourned until Wednesday amid oppn’ obstruction - myRepublica',
      'Annamalai’s We The Leaders to Contest Tamil Nadu Civic Polls, Assembly Elections After BJP Exit - India Today',
    ],
  },
  'state:District Media Monitor (Vernacular District Editions)': {
    on: [
      'PM Modi Condoles Deaths in Road Accident in Gujarat’s Kutch - DD India',
      '13 children die after overloaded boat capsizes in India - South China Morning Post',
      '80 newborn deaths at Madhya Pradesh hospital in six months, BJP MLA calls for probe - The Indian Express',
      'Video shows patient\'s mother cleaning floor at Damoh District Hospital - NewsBytes',
    ],
    off: [
      'Menominee Indian High School evacuated after threat - WBAY',
      'Indian River County schools open search for new superintendent - Sebastian Daily',
      'Beyond the lunch line: Indian Creek’s free meals and nutrition highlighted - WTOV',
      'Misplaced cellphone sparks false weapon rumor at Vero Beach High School - WPEC',
      '6th Schedule of Indian Constitution, Provisions, States, Articles - Vajiram &amp; Ravi',
      'Health screening stepped up at Gaddachauki border as Nepalis return from India for Dashain and Tihar - OnlineKhabar English News',
    ],
  },
  'local:Municipal Watch': {
    on: [
      'Gandhinagar civic polls: BJP wins 38 seats, Congress secures 5, AAP draws a blank - India Today',
      'Gurugram Municipal Corporation to shut 94 tubewells by Jan next year - The Tribune',
      'Mohali civic body clears Rs 25-crore development works - The Tribune',
      'Mayor seeks ₹50 crore package to address water shortage in Indore - The Times of India',
      'Did AIMIM corporator’s father join Shiv Sena? Here is the truth - The Siasat Daily',
    ],
    off: [
      'Denmark Open 2026 badminton: Know where to watch live streaming in India - Olympics',
      'Watch Canada Minister Anand Says Ties with India Have Improved - Bloomberg.com',
      'Tilak Varma run out during India vs West Indies 3rd T20I, WATCH video - Sportstar',
      'New York City Mayor Zohran Mamdani invests $29.2 million into New York University\'s quantum lab; says: We - The Times of India',
      'Jalandhar: STREAM lab opens at Mayor World School - The Tribune',
    ],
  },
  'local:Panchayat Watch': {
    on: [
      'Allahabad High Court orders UP panchayat polls within three months - India Today',
      'Karnataka CM Shivakumar announces measures to strengthen Gram Panchayat finances - India\'s News.Net',
      'Rajasthan man runs over son, daughter-in-law with SUV for opposing his sarpanch poll bid: Cops | India News - Hindustan Times',
      'Collective Efforts Needed To Build TB-Free India: West Tripura Zilla Parishad Sabhadhipati. - TRIPURA STAR NEWS',
    ],
    off: [
      'DP World India Championship 2026 golf: Know schedule and where to watch live streaming and telecast - Olympics',
      'Watch: Cristiano Ronaldo finds the net after controversial Portugal break - The Times of India',
      "Forget Rolex, Thailand's power players want a $60 Casio watch from their PM - India Today",
      'Panchayati Raj Institutions - Vajiram &amp; Ravi',
    ],
  },
  'judiciary:District Court Case Tracker': {
    on: [
      "YouTuber Dhruv Rathee Gets Delhi Court Summons In Case Over 2018 'BJP IT Cell' Video - NDTV",
      'Muskan, boyfriend Sahil Shukla sentenced to death by district court in Meerut blue drum murder case - India TV',
      "Court Grants Bail to Luthra Brothers in Goa's Birch Nightclub NOC Forgery Case - Republic World",
    ],
    off: [
      'Supreme Court Seeks States’ Reply To PIL On Vacancies In Electricity Regulatory Commissions - LawChakra',
      'FPJ Exclusive | People See 19 Surgeries, I See 107 Medals For India: Para Swimmer Niranjan Mukundan Opens Up - Free Press Journal',
      'Bombay HC Calls Out Bandra Society’s ‘Double Standard’ Over Basement Membership, Upholds Developer’s - Free Press Journal',
      '‘Heading Back To My Village’: Abhijeet Dipke After Release From Delhi Police Detention - Free Press Journal',
    ],
  },
  'judiciary:HC Judge Profiles & Bench Analytics': {
    on: [
      'President transfers Justice T. Vinod Kumar to Telangana High Court - SCC Online',
      'Madras high court gets two new additional judges - The Times of India',
      'Justices Lingeswaran, Karthikeyan sworn in as HC judges - ThePrint',
    ],
    off: [
      'Supreme Court Justice Yael Willner appointed to Judicial Selection Committee - The Times of Israel',
      'Republicans can confirm a Supreme Court justice if Democrats take the Senate, but at what cost? - The Conversation',
      '2026 Texas Judicial Elections: Full guide to Supreme Court and Criminal Appeals candidates - KRIS 6 News Corpus Christi',
      '39 newly appointed judges sworn in at Azerbaijan’s Supreme Court - Operativ Məlumat Mərkəzi',
      'Calcutta High Court Mulls Metal Detectors On Court Premises After Attacks On Lawyers - Live Law',
    ],
  },
  'judiciary:ICJ Proceedings': {
    on: [
      'Electing ICJ Judges: The Complex Battle for a Seat on the World’s Highest Court - Center on International Cooperation',
      'The International Court of Justice sided with Rosatom in a dispute with Finnish Fennovoima - EADaily',
      'ICJ ruling sets historic precedent: Saudi envoy - The Business Standard',
    ],
    off: [
      'Nobel Peace Prize awarded to Navi Pillay of International Court of Justice - CBC',
      'United Nations - Global Issues, Reforms, Solutions - Britannica',
      'Who pays for the climate catastrophe? - DW.com',
      'Belize protests Guatemala’s violation of our airspace - Amandala Newspaper',
    ],
  },
};

const NEW_MODULES = Object.keys(SAMPLES);
const rowsOf = (titles, age = 1) => titles.map((title, i) => ({ title, source_url: `https://example.com/${encodeURIComponent(title)}/${i}`, date: day(age) }));

describe('entities, headlines and the age window', () => {
  it('unescapes HTML entities in titles, including double-escaped ones', () => {
    expect(decodeEntities('Vajiram &amp; Ravi')).toBe('Vajiram & Ravi');
    expect(decodeEntities('Brazil&#8217;s election could undo &#8220;fragile&#8221; gains')).toBe('Brazil’s election could undo “fragile” gains');
    expect(decodeEntities('J&amp;amp;K &amp;#8216;row&amp;#8217;')).toBe('J&K ‘row’');
    expect(decodeEntities('Legarda recalls ICJ opinion&#13;(NO PHOTO)')).toBe('Legarda recalls ICJ opinion (NO PHOTO)');
    expect(decodeEntities('A &#x2014; B &lt;i&gt;')).toBe('A — B <i>');
    expect(decodeEntities('AT&T and &unknown; stay')).toBe('AT&T and &unknown; stay');
  });

  it('a headline is the same story whoever published it, with or without a section prefix', () => {
    const a = headlineKey('Allahabad High Court orders UP panchayat polls within three months - India Today');
    expect(headlineKey('Allahabad High Court orders UP panchayat polls within three months - The Hindu')).toBe(a);
    expect(headlineKey('India News | Goa: Court Grants Bail to Luthra Brothers - LatestLY')).toBe(headlineKey('Goa: Court Grants Bail to Luthra Brothers - Republic World'));
    expect(headlineKey('India and China aren’t friends - but Nepal wants to unite them against climate threats'))
      .toMatch(/nepal wants/);
  });

  it('drops rows older than the window, one row per link and per headline, newest first', () => {
    const rows = freshNewsRows([
      { title: 'Old story about a court ruling - A', source_url: 'https://a/1', date: day(40) },
      { title: 'Allahabad High Court orders UP panchayat polls within three months - India Today', source_url: 'https://a/2', date: day(2) },
      { title: 'Allahabad High Court orders UP panchayat polls within three months - India Today', source_url: 'https://a/3', date: day(2) },
      { title: 'Allahabad High Court orders UP panchayat polls within three months - The Hindu', source_url: 'https://a/4', date: day(1) },
      { title: 'A different story the same link carries twice - B', source_url: 'https://a/2', date: day(1) },
      { title: 'Fresh story &amp; more about civic polls - C', source_url: 'https://a/5', date: day(0) },
      { title: 'Undated row is kept because its age cannot be judged - D', source_url: 'https://a/6', date: '' },
    ], { days: 30, now: NOW });
    // The newest of a story's copies stays (a/4); a/2's other story then still has its link.
    expect(rows.map((r) => r.source_url)).toEqual(['https://a/5', 'https://a/4', 'https://a/2', 'https://a/6']);
    expect(rows[0].title).toBe('Fresh story & more about civic polls - C');
    expect(freshNewsRows([{ title: 'Eight days old court story here - X', source_url: 'https://b/1', date: day(8) }], { days: 7, now: NOW })).toEqual([]);
  });

  it('drops navigation pages and study-guide sites that are not stories', () => {
    const rows = freshNewsRows([
      { title: 'India News - LatestLY', source_url: 'https://l/1', date: day(1) },
      { title: 'World News - LatestLY', source_url: 'https://l/2', date: day(1) },
    ], { days: 7, now: NOW });
    expect(rows).toEqual([]);
    const spec = CURATED_NEWS['local:Panchayat Watch'];
    expect(curatedNewsRows([{ title: 'Panchayati Raj Institutions, Powers, Functions - Vajiram &amp; Ravi', source_url: 'https://v/1', date: day(1), publisher: 'Vajiram & Ravi' }], spec, { now: NOW })).toEqual([]);
  });
});

describe('the audit’s news modules keep on-topic headlines only (F202)', () => {
  it('each named module has a guard, an age window and an honest note', () => {
    for (const id of NEW_MODULES) {
      const spec = CURATED_NEWS[id];
      expect(spec, id).toBeTruthy();
      expect(spec.adapter, id).toBe('news-search');
      expect(spec.days, id).toBeGreaterThan(0);
      expect(spec.note, id).toMatch(/Google News/);
      expect(spec.note, id).not.toMatch(/curated|editorial/i);
    }
    expect(curatedNewsFor('law', 'ICJ Proceedings')).toBe(CURATED_NEWS['judiciary:ICJ Proceedings']);
    expect(curatedNewsFor('local', 'Municipal Watch')).toBe(CURATED_NEWS['local:Municipal Watch']);
    // The national Cabinet Decisions module is PIB's own; only the state one is a news search.
    expect(curatedNewsFor('national', 'Cabinet Decisions')).toBeNull();
    // Nothing in either module is vernacular or translated, and the notes say so.
    expect(CURATED_NEWS['state:Assembly Proceedings Digest (Vernacular, Translated)'].note).toMatch(/nothing is translated/i);
    expect(CURATED_NEWS['state:District Media Monitor (Vernacular District Editions)'].note).toMatch(/nothing is translated/i);
  });

  it.each(NEW_MODULES)('%s keeps on-topic headlines and drops the audit’s off-topic ones', (id) => {
    const { on, off } = SAMPLES[id];
    const kept = curatedNewsRows(rowsOf([...on, ...off]), CURATED_NEWS[id], { now: NOW }).map((r) => r.title);
    expect(kept.sort()).toEqual(on.map(decodeEntities).sort());
  });

  it.each(NEW_MODULES)('%s drops stories older than its window', (id) => {
    const spec = CURATED_NEWS[id];
    expect(curatedNewsRows(rowsOf(SAMPLES[id].on, spec.days + 1), spec, { now: NOW })).toEqual([]);
  });
});

describe('wire guards for the outlet feeds', () => {
  it('Geopolitics News Wire keeps world-affairs headlines from BBC World, not crime or celebrity items', () => {
    const on = [
      'Russia accuses Ukraine of attacking oil refinery after Zelensky says strikes to resume',
      'North Korea and China open new bridge after 12-year delay',
      'Student protesters attack government buildings in Albania',
      'Why is Starlink internet so important on the battlefield in Ukraine?',
      'Hundreds of IDF investigations into killings still have no public outcome, BBC Verify finds',
    ];
    const off = [
      "Trump calls off livestream for Fort Hood shooter's execution by firing squad",
      'Two dead in Istanbul after heaviest rainfall in 84 years, governor says',
      "At the Brooklyn shop in 'surreal' row with Kelly Clarkson over mechanical bird",
      "Australian woman charged with lacing colleague's curry with snail poison",
      "Watch: Pupils heard 'cracking' sound heard moments before Pakistan school roof collapse",
      "Why the lonely in China are hiring 'temporary children'",
    ];
    const kept = curatedNewsRows(rowsOf([...on, ...off]), WIRE_GUARDS.geopolitics, { now: NOW }).map((r) => r.title);
    expect(kept.sort()).toEqual([...on].sort());
  });

  it('Climate Newswire keeps climate stories from Mongabay and drops wildlife features', () => {
    const on = ['Protests over dam heat up as crackdown on activists continues', 'Glacier melt threatens Himalayan villages as heatwave lingers'];
    const off = ['Invaders get better at competition in introduced ranges: Study', 'Study identifies rare case of moth and lichen association', 'The giants with one horn'];
    const kept = curatedNewsRows(rowsOf([...on, ...off]), WIRE_GUARDS.climate, { now: NOW }).map((r) => r.title);
    expect(kept.sort()).toEqual([...on].sort());
  });
});

describe('Policy Pipeline keeps PIB releases about policy in the making', () => {
  it.each([
    'Cabinet approves the Example Scheme for 2026-27',
    'Ministry of Environment notifies draft E-Waste (Management) Amendment Rules, 2026 for public consultation',
    'Government invites public comments on draft National Logistics Policy',
    'Centre notifies amendments to the Drugs and Cosmetics Rules',
    'Cabinet approves Productivity Linked Bonus scheme for railway employees',
    'Gazette notification issued for the Digital Personal Data Protection Rules',
  ])('keeps %s', (title) => expect(isPipelineRelease(title)).toBe(true));

  it.each([
    '12th session of India – Japan Joint Working Group (JWG) on Roads and Road Transportation Sector',
    'DRI seizes around 6.2 kg foreign-origin gold; busts sophisticated gold smuggling modus operandi through unaccompanied baggage',
    'Prime Minister Shri Narendra Modi interacts with the contingent of Indian athletes who participated in Asian Games 2026',
    'Customs officers detect 148.67 kg hydroponic weed from Bangkok at air cargo complex at IGI Airport',
    'PRESS COMMUNIQUE',
    'SHILP SAMAGAM MELA 2026-Mysuru',
    'Mahila Kisan Diwas 2026 celebrated today',
  ])('drops %s', (title) => expect(isPipelineRelease(title)).toBe(false));
});

// Server wiring: the loader asks the module's own search, keeps the guard's rows and says how many.
const rssOf = (titles, age = 1) =>
  `<?xml version="1.0"?><rss><channel>${titles
    .map((t, i) => `<item><title>${t.replace(/&(?!amp;|#)/g, '&amp;')}</title><link>https://example.com/s/${i}</link><pubDate>${day(age)}</pubDate></item>`)
    .join('')}</channel></rss>`;
const respond = (url, body, type = 'application/rss+xml') => ({
  ok: true, status: 200, url: String(url), headers: new Headers({ 'content-type': type }),
  text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer,
});

describe('the loader answers these modules from their own searches (F202)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  it.each(NEW_MODULES)('%s asks only its own search and keeps the on-topic headlines', async (id) => {
    const [tier, feature] = id.split(/:(.*)/s);
    const asked = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      asked.push(String(url));
      return respond(url, rssOf([...SAMPLES[id].on, ...SAMPLES[id].off]));
    }));
    const { serveFeatureFeed, newsRssUrlForFeature } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier, feature }));
    expect(asked).toEqual([newsRssUrlForFeature(feature, tier)]);
    expect(asked.some((u) => /pib\.gov\.in/i.test(u))).toBe(false);
    expect(out.rows.map((r) => r.title).sort()).toEqual(SAMPLES[id].on.map(decodeEntities).sort());
    expect(out.rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
    const days = CURATED_NEWS[id].days;
    expect(out.coverage.through).toBe(`${days}d`);
    expect(out.source.note).toContain(`${SAMPLES[id].on.length} on-topic stories in the last ${days} days`);
  }, 30_000);

  it('a search that returns only off-topic headlines says so and shows no padding', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => respond(url, rssOf(SAMPLES['local:Municipal Watch'].off))));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'local', feature: 'Municipal Watch' }));
    expect(out.rows.every((r) => r.status === 'source_status')).toBe(true);
    expect(out.source.note).toMatch(/No on-topic stories in the last 7 days/);
  });

  it('the module searches are their own words, never the module name', async () => {
    const { newsRssUrlForFeature } = await import('../../server/featureFeed.mjs');
    const q = (feature, tier) => decodeURIComponent(newsRssUrlForFeature(feature, tier));
    expect(q('Municipal Watch', 'local')).toMatch(/"municipal corporation"/);
    expect(q('Municipal Watch', 'local')).not.toMatch(/"Watch"/);
    expect(q('Panchayat Watch', 'local')).toMatch(/"gram panchayat"/);
    expect(q('Cabinet Decisions', 'state')).toMatch(/"state cabinet"/);
    expect(q('Cabinet Decisions', 'state')).not.toBe(q('Cabinet Decisions', 'national'));
    expect(q('State Governance Brief', 'state')).not.toMatch(/OR cabinet OR secretariat/);
    expect(q('Governor Assent Tracker', 'state')).toMatch(/when:30d/);
    expect(q('ICJ Proceedings', 'judiciary')).toMatch(/-Nobel/);
    // Judges are appointed a few times a month; the live search (2026-10-15) had 3 stories in 7 days
    // and about 30 in 30, so this module keeps a month.
    expect(q('HC Judge Profiles & Bench Analytics', 'judiciary')).toMatch(/when:30d/);
  });

  it('a name-built search never searches product words such as Watch, Impact or Engine', async () => {
    const { newsRssUrlForFeature } = await import('../../server/featureFeed.mjs');
    for (const name of ['Delimitation Impact Simulator', 'Coastal Erosion Watch', 'Scheme Comparison Engine', 'Ward Report Card Dashboard']) {
      const q = decodeURIComponent(newsRssUrlForFeature(name));
      expect(q, name).not.toMatch(/"(?:Impact|Watch|Engine|Report|Card|Dashboard|Simulator|Comparison)"/);
    }
    expect(decodeURIComponent(newsRssUrlForFeature('Delimitation Impact Simulator'))).toMatch(/"Delimitation"/);
  });

  it('one module’s search cannot serve another by a substring of its name', async () => {
    const { newsRssUrlForFeature } = await import('../../server/featureFeed.mjs');
    const sector = decodeURIComponent(newsRssUrlForFeature('Sector Policy — Power/Energy/Green/Critical Minerals'));
    expect(sector).not.toBe(decodeURIComponent(newsRssUrlForFeature('Critical Minerals')));
    // A parenthesised edition note is not part of the module's name.
    expect(newsRssUrlForFeature('Assembly Proceedings Digest (Vernacular, Translated)', 'state'))
      .toBe(newsRssUrlForFeature('Assembly Proceedings Digest', 'state'));
  });

  it('RSS titles are unescaped for every feed the loader reads', async () => {
    const body = `<?xml version="1.0"?><rss><channel><item><title>Brazil&amp;#8217;s election could undo &amp;#8220;fragile&amp;#8221; gains &amp; more</title><link>https://example.com/x</link><pubDate>${day(1)}</pubDate></item></channel></rss>`;
    vi.stubGlobal('fetch', vi.fn(async (url) => respond(url, body)));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'judiciary', feature: 'ICC Proceedings' }));
    expect(out.rows[0].title).toBe('Brazil’s election could undo “fragile” gains & more');
  });

  it('a law wire without its own guard still drops stale and repeated stories', async () => {
    const body = rssOf(['ICC prosecutor seeks arrest warrant in Darfur case - Reuters', 'ICC prosecutor seeks arrest warrant in Darfur case - AP'], 1)
      .replace('</channel>', `<item><title>Old ICC appeal hearing coverage - Old</title><link>https://example.com/old</link><pubDate>${day(30)}</pubDate></item></channel>`);
    vi.stubGlobal('fetch', vi.fn(async (url) => respond(url, body)));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'judiciary', feature: 'ICC Proceedings' }));
    expect(out.rows.map((r) => r.title)).toEqual(['ICC prosecutor seeks arrest warrant in Darfur case - Reuters']);
  });

  it('the National desk’s news searches drop stale and repeated stories too', async () => {
    const body = rssOf(['Modi chairs NITI Aayog governing council meeting - Reuters', 'Modi chairs NITI Aayog governing council meeting - PTI'], 1)
      .replace('</channel>', `<item><title>Modi chairs 2019 council meeting coverage - Old</title><link>https://example.com/old</link><pubDate>${day(40)}</pubDate></item></channel>`);
    vi.stubGlobal('fetch', vi.fn(async (url) => (/pib\.gov\.in/i.test(String(url)) ? respond(url, '<rss><channel></channel></rss>') : respond(url, body))));
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const statements = await serveFeatureFeed(new URLSearchParams({ tier: 'national', feature: 'Statement & Quote Tracker with Contradiction Detection' }));
    expect(statements.rows.map((r) => r.title)).toEqual(['Modi chairs NITI Aayog governing council meeting - Reuters']);
    const brief = await serveFeatureFeed(new URLSearchParams({ tier: 'national', feature: 'National Morning Brief (Auto-digest)' }));
    // The same story in both searches is one row; nothing older than the brief's 3 days.
    expect(brief.rows.map((r) => r.title)).toEqual(['Modi chairs NITI Aayog governing council meeting - Reuters']);
  });
});

describe('PIB rows are dated from their release pages, within limits (C2)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  const pibRss = (items) => `<?xml version="1.0"?><rss><channel>${items.map(([t, prid]) => `<item><title>${t}</title><link>https://pib.gov.in/PressReleaseIframePage.aspx?PRID=${prid}</link></item>`).join('')}</channel></rss>`;
  const pibPage = (title) => `<html><head><meta property="og:title" content="${title} | Press Information Bureau" /></head><body><div class="MinistryNameSubhead">Ministry</div> Posted On: 14 Oct 2026</body></html>`;

  function stubPib(items, newsBody = rssOf([])) {
    const pages = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const u = String(url);
      if (/RssMain/i.test(u)) return respond(u, pibRss(items));
      if (/PressReleasePage/i.test(u)) {
        pages.push(u);
        const prid = (/PRID=(\d+)/.exec(u) || [])[1];
        const title = (items.find(([, p]) => String(p) === prid) || [])[0] || 'Unknown';
        return respond(u, pibPage(title), 'text/html');
      }
      return respond(u, newsBody);
    }));
    return pages;
  }

  it('the Policy Pipeline keeps policy releases, dates them, and reads only their pages', async () => {
    const pages = stubPib([
      ['Cabinet approves the Example Scheme for 2026-27', 701],
      ['DRI seizes around 6.2 kg foreign-origin gold at airport', 702],
      ['Ministry notifies draft Example Rules, 2026 for public consultation', 703],
      ['Mahila Kisan Diwas 2026 celebrated today across the country', 704],
    ]);
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'national', feature: 'Policy Pipeline Tracker (Draft-to-Gazette)' }));
    expect(out.rows.map((r) => r.title)).toEqual(['Cabinet approves the Example Scheme for 2026-27', 'Ministry notifies draft Example Rules, 2026 for public consultation']);
    expect(out.rows.every((r) => r.date === '2026-10-14')).toBe(true);
    expect(pages.map((u) => (/PRID=(\d+)/.exec(u) || [])[1]).sort()).toEqual(['701', '703']);
    expect(out.source.note).toMatch(/2 of 4/);
  });

  it('the Policy Pipeline says so when no release is about policy, and pads nothing', async () => {
    stubPib([['DRI seizes around 6.2 kg foreign-origin gold at airport', 702], ['Mahila Kisan Diwas 2026 celebrated today across the country', 704]]);
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'national', feature: 'Policy Pipeline Tracker (Draft-to-Gazette)' }));
    expect(out.rows.every((r) => r.status === 'source_status')).toBe(true);
    expect(out.source.note).toMatch(/None of the 2 latest PIB press releases/);
  });

  it('AI & Tech PIB rows carry their release dates', async () => {
    stubPib([['MeitY launches IndiaAI compute portal for startups', 801], ['DRI seizes around 6.2 kg foreign-origin gold at airport', 802]]);
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'finance', feature: 'AI & the Tech Industry' }));
    const row = out.rows.find((r) => /IndiaAI/.test(r.title));
    expect(row?.date).toBe('2026-10-14');
  });

  // F202 leftovers: titles are real PIB releases. The first group is from PIB's English RSS on 2026-10-16
  // (the two the loose filter let through: "digital" in a rural-livelihood workshop and in an Ayurveda
  // institute's initiatives); the second are PIB's MeitY releases.
  const PIB_NOT_TECH = [
    ['National Workshop held on “Strengthening Digital Data Systems and Evidence-Based Learning” under Deendayal Antyodaya Yojana-National Rural Livelihood Mission at Gurugram, Haryana on 12th and 13th October, 2026', 1101],
    ['Vice-President inaugurates KAUMARACON-2026 and launches digital initiatives of the All India Institute of Ayurveda', 1102],
    ['Union Commerce and Industry Minister Shri Piyush Goyal Launches National Strategic Trade Command Centre at Vanijya Bhawan', 1103],
    ['Legislative Department, Ministry of Law &amp; Justice organises workshop on E-Waste Disposal under Special Campaign 6', 1104],
    ['DRI seizes around 6.2 kg foreign-origin gold; busts sophisticated gold smuggling modus operandi through unaccompanied baggage; three arrested', 1105],
  ];
  const PIB_TECH = [
    ['India’s Common Compute Capacity Crosses 34,000 GPUs', 2132817],
    ['Nationwide Momentum in Chip Design as India Prepares Workforce for AI Age: Shri Ashwini Vaishnaw', 2230976],
    ['Prime Minister Shri Narendra Modi presented with First set of Made-in-India Chips; Union Minister Ashwini Vaishnaw Calls It a Moment of Pride', 2163184],
    ['Meeting of the Parliamentary Consultative Committee for the Ministry of Electronics and Information Technology (MeitY) held under the Chairmanship of Union Minister Shri Ashwini Vaishnaw', 2245449],
    ['Union Minister of Electronics and Information Technology Shri Ashwini Vaishnaw highlights India AI Mission’s Seven Pillars for inclusive development', 2083189],
    ['MeitY launches AIKosha, a secured platform that provides a repository of datasets, models and use cases to enable AI innovation', 2108961],
    ['India to Add 20,000 GPUs Beyond Existing 38,000 to Strengthen National AI Infrastructure', 2229171],
  ];

  it('AI & Tech takes PIB releases about the technology industry and not a "digital" in any title', async () => {
    stubPib([...PIB_NOT_TECH, ...PIB_TECH]);
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'finance', feature: 'AI & the Tech Industry' }));
    const pib = out.rows.filter((r) => r.publisher === 'Press Information Bureau').map((r) => r.title);
    expect(pib.sort()).toEqual(PIB_TECH.map(([t]) => t).sort());
  });

  it('a release page read once is not read again within the cache window', async () => {
    const pages = stubPib([['Cabinet approves the Example Scheme for 2026-27', 901]]);
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const ask = () => serveFeatureFeed(new URLSearchParams({ tier: 'national', feature: 'Policy Pipeline Tracker (Draft-to-Gazette)' }));
    await ask();
    await ask();
    expect(pages).toHaveLength(1);
  });
});

describe('one row per story, however it is worded (F202 live probe: one Kerala resolution 13 times)', () => {
  it('keeps the newest telling of a story reworded by other outlets', () => {
    const rows = freshNewsRows([
      { title: 'Kerala Assembly passes resolution seeking removal of Chief Election Commissioner - The Hindu', publisher: 'The Hindu', source_url: 'https://a/1', date: day(1) },
      { title: 'Kerala Assembly adopts resolution seeking removal of Chief Election Commissioner - Mathrubhumi', publisher: 'Mathrubhumi', source_url: 'https://a/2', date: day(2) },
      { title: 'Resolution seeking removal of Chief Election Commissioner passed by Kerala Assembly - Onmanorama', publisher: 'Onmanorama', source_url: 'https://a/3', date: day(2) },
    ], { days: 7, now: NOW });
    expect(rows.map((r) => r.source_url)).toEqual(['https://a/1']);
  });

  it('keeps the newest telling whatever order the rows arrive in', () => {
    const rows = freshNewsRows([
      { title: 'Kerala Assembly adopts resolution seeking removal of Chief Election Commissioner - Mathrubhumi', publisher: 'Mathrubhumi', source_url: 'https://c/old', date: day(3) },
      { title: 'Kerala Assembly passes resolution seeking removal of Chief Election Commissioner - The Hindu', publisher: 'The Hindu', source_url: 'https://c/new', date: day(1) },
    ], { days: 7, now: NOW });
    expect(rows.map((r) => r.source_url)).toEqual(['https://c/new']);
  });

  it('keeps two different stories that share names', () => {
    const rows = freshNewsRows([
      { title: 'Kerala Assembly passes resolution against Chief Election Commissioner - The Hindu', publisher: 'The Hindu', source_url: 'https://b/1', date: day(1) },
      { title: 'Kerala Assembly passes Fisheries Amendment Bill after walkout - The Hindu', publisher: 'The Hindu', source_url: 'https://b/2', date: day(1) },
      { title: 'Kerala Assembly session to discuss flood relief package - Mathrubhumi', publisher: 'Mathrubhumi', source_url: 'https://b/3', date: day(2) },
    ], { days: 7, now: NOW });
    expect(rows).toHaveLength(3);
  });
});

describe('reworded stories on the 2026-10-15 live probe', () => {
  const at = (title, n, url) => ({ title, source_url: url, date: day(n) });
  it('folds the CEC resolution rewordings and keeps the Assembly\'s other motions', () => {
    const rows = freshNewsRows([
      at('Keralam Assembly passes motion urging Centre to withdraw MDR on UPI transactions - ThePrint', 0, 'u/1'),
      at('Keralam Assembly passes motion against bifurcation of Mangaluru from Palakkad Rly division - ThePrint', 0, 'u/2'),
      at('Keralam assembly passes resolution urging Centre to accept revised Western Ghats ESA proposal - ThePrint', 0, 'u/3'),
      at('Kerala Assembly Passes Resolution Seeking CEC Gyanesh Kumar’s Removal: Here’s What It Means - The Logical Indian', 2, 'u/4'),
      at('Kerala Assembly Passes Resolution Against CEC Gyanesh Kumar: 3 Key Demands - Newsd.in', 3, 'u/5'),
      at('Kerala assembly passes resolution seeking removal of CEC - The Statesman', 3, 'u/6'),
      at('CEC Gyanesh Kumar Faces Fresh Challenge as Kerala Assembly Passes Removal Resolution - Dynamite News', 3, 'u/7'),
      at('Keralam Assembly passes resolution seeking removal of CEC Gyanesh Kumar, BJP MLAs oppose - The News Minute', 3, 'u/8'),
      at("'Crores Of Voters Omitted’: Kerala Assembly Passes Resolution Seeking CEC’s Removal, Electoral Reforms - News18", 3, 'u/9'),
      at('Punjab Assembly session from Oct 22-27 - The Times of India', 6, 'u/10'),
    ], { days: 7, now: NOW });
    expect(rows.map((r) => r.source_url)).toEqual(['u/1', 'u/2', 'u/3', 'u/4', 'u/10']);
  });
});

describe('one event told in different words (F202 leftovers: three Tamil Nadu Governor assent rows)', () => {
  const at = (title, n, url) => ({ title, source_url: url, date: day(n) });
  const kept = (rows) => freshNewsRows(rows, { days: 30, now: NOW }).map((r) => r.source_url);

  // Google News, 2026-10-15/16. The same event: Tamil Nadu's Governor assented to 12 of 13 bills.
  const TN = [
    at('Governor Arlekar gives assent to 12 bills - DT Next', 3, 'tn/1'),
    at('TN Guv gives assent to 12 Bills - ThePrint', 4, 'tn/2'),
    at('Tamil Nadu Governor R V Arlekar clears 12 of 13 bills - The Times of India', 4, 'tn/3'),
    at('12 Bills passed in House get Governor\'s assent - The New Indian Express', 5, 'tn/4'),
  ];

  it('folds the Governor assenting to 12 Tamil Nadu bills, however an outlet words it', () => {
    expect(kept(TN)).toEqual(['tn/1']);
  });

  it('folds the telling whatever order the rows arrive in', () => {
    expect(kept([...TN].reverse())).toEqual(['tn/1']);
  });

  it('folds the story into its newest telling even when that is the shortest wording', () => {
    // "12 Bills passed in House get Governor's assent" is newest; the wordings with "Guv" and the Governor's
    // name are older. All three are one story and the newest is the one shown.
    expect(kept([
      at('12 Bills passed in House get Governor\'s assent - The New Indian Express', 1, 'ch/1'),
      at('TN Guv gives assent to 12 Bills - ThePrint', 2, 'ch/2'),
      at('Governor Arlekar gives assent to 12 bills - DT Next', 3, 'ch/3'),
    ])).toEqual(['ch/1']);
  });

  it('folds the same event across other wordings: "Guv", a spelled-out count, a comma in the amount', () => {
    expect(kept([
      at('Governor Arlekar approves 12 Tamil Nadu bills, seeks clarification on private universities - The Hindu', 3, 'tn/8'),
      at('Tamil Nadu Bills: Governor Approves 12, Private Universities Bill Sent For Further Consideration - Free Press Journal', 4, 'tn/9'),
    ])).toEqual(['tn/8']);
    expect(kept([
      at('Academics urge Governor not to approve Inter-University Transfer Bill - The Hindu', 1, 'wb/3'),
      at('Profs Seek Guv Intervention Against Inter-University Transfer Bill - The Times of India', 2, 'wb/4'),
    ])).toEqual(['wb/3']);
    expect(kept([
      at('SIR Stay, Action Against Officials: Rahul Gandhi\'s 10 Requests To Top Court - NDTV', 1, 'sir/1'),
      at('Here are the ten directions Rahul Gandhi has sought from Supreme Court in his petition on SIR - The Hindu', 2, 'sir/2'),
    ])).toEqual(['sir/1']);
    expect(kept([
      at('Maharashtra CM Announces Diwali Gift Of Rs 5000 To Farmers, 40 More Talukas Added To \'Drought\' Category - NDTV', 1, 'mh/1'),
      at('Drought hits 85% of Maharashtra\'s talukas; Fadnavis announces Rs 5,000 farmer relief - The Hindu', 2, 'mh/2'),
      at('Maharashtra announces drought relief, Rs 5,000 aid per farmer before Diwali - Mint', 2, 'mh/3'),
    ])).toEqual(['mh/1']);
    expect(kept([
      at('TN govt’s Rs 35 per-unit electricity deal reeks of corruption: Senthil Balaji - The Hindu', 1, 'tnp/1'),
      at('TVK govt’s Rs 35 per unit power deal triggers political row in Tamil Nadu - Deccan Herald', 2, 'tnp/2'),
    ])).toEqual(['tnp/1']);
  });

  it('keeps apart different governors, different counts and different bills', () => {
    expect(kept([
      ...TN.slice(0, 1),
      at('LG Sinha Gives Assent to Six Bills Passed During Jammu Kashmir Assembly’s Autumn Session - Kashmir Life', 8, 'jk/1'),
      at('Governor Arlekar seeks clarifications from T.N. govt. on Tamil Nadu Private Universities (Amendment) Bill, 2026 - The Hindu', 4, 'tn/5'),
      at('Governor Refers Bill On Varsities To President - Deccan Chronicle', 3, 'tn/6'),
      at('Supreme Court Closes Punjab\'s Plea Against Governor Reserving Two Bills For President\'s Assent - Live Law', 20, 'pb/1'),
      at('Gujarat UCC Bill gets President Murmu’s assent, becomes 2nd state after Uttarakhand | India News - Hindustan Times', 14, 'gj/1'),
      at('Deadline for industrial nod reduced after Governor\'s assent - DT Next', 2, 'tn/7'),
      at('Anti-Goonda Bill still under President’s consideration: West Bengal CM clarifies - OpIndia', 19, 'wb/1'),
      at('Why did President Droupadi Murmu return Bengal’s ‘Anti-Goonda Bill’? Here’s what Centre flagged - Mathrubhumi English', 21, 'wb/2'),
    ]).sort()).toEqual(['gj/1', 'jk/1', 'pb/1', 'tn/1', 'tn/5', 'tn/6', 'tn/7', 'wb/1', 'wb/2']);
  });

  it.each([
    // A shared count and a shared name do not make one event (each pair is two live Google News headlines).
    ['TN Guv gives assent to 12 Bills - ThePrint', 'Tamil Nadu private universities bill sent to President for assent, land norm cut to 12 acres in Chennai - The Hindu'],
    ['RBI Repo Rate at 5.50%: Calibrated Tightening Explained - Groww', 'RBI rate hikes of 50 bps expected in next two policies, terminal repo rate to reach 6.0%: Kotak report - Mint'],
    ['Allahabad HC directs state to notify silence zones within 3 months, ban illegal hooters - The Hindu', 'Allahabad HC directs UP to hold panchayat polls within three months - The Hindu'],
    ['Kerala Assembly unanimously passes resolution asking Union government to accept State’s revised ESA proposal - The Hindu', 'Keralam Assembly passes resolution asking Union govt. to withdraw MDR charges on UPI transactions - ThePrint'],
    ['Rajasthan Cabinet approves proposal to felicitate PM Modi - The Times of India', 'Odisha Cabinet Lauds PM Modi’s 25 Years in Public Service, Clears 16 Proposals - Odisha TV'],
    ['Andhra Pradesh govt notifies mayoral post reservations for 17 municipal corporations - The Hindu', 'Andhra Pradesh Government Notifies Reservation For Zilla Parishad Chairperson Posts - Deccan Chronicle'],
    ['RBI MPC hikes repo rate by 25 bps to 5.5%, near-term cuts \'off the table\' - Mint', 'Banks Raise Lending Rates After RBI Hikes Repo Rate To 5.5% - Business Today'],
  ])('keeps two different events apart: %s | %s', (a, b) => {
    expect(kept([at(a, 1, 'x/1'), at(b, 2, 'x/2')])).toEqual(['x/1', 'x/2']);
  });

  it('the Kerala Assembly motions of one day stay apart when the aliases apply (MDR, Mangaluru, Western Ghats)', () => {
    expect(kept([
      at('Keralam Assembly passes motion urging Centre to withdraw MDR on UPI transactions - ThePrint', 0, 'k/m1'),
      at('Keralam Assembly passes motion against bifurcation of Mangaluru from Palakkad Rly division - ThePrint', 0, 'k/m2'),
      at('Keralam assembly passes resolution urging Centre to accept revised Western Ghats ESA proposal - ThePrint', 0, 'k/m3'),
    ])).toEqual(['k/m1', 'k/m2', 'k/m3']);
  });
});

describe('Climate Newswire says how many stories it shows and for how long (F202 leftovers)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  const stubClimate = (feeds) => vi.stubGlobal('fetch', vi.fn(async (url) => {
    const host = Object.keys(feeds).find((h) => String(url).includes(h));
    // Each outlet has its own links (rssOf numbers links from 0 within a feed).
    return respond(url, rssOf(host ? feeds[host] : []).replace(/example\.com\/s\//g, `${host}/s/`));
  }));
  const ask = async () => {
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    return serveFeatureFeed(new URLSearchParams({ tier: 'climate', feature: 'Climate Newswire' }));
  };

  it('opens its note with the story count and the window, like the other news modules', async () => {
    stubClimate({
      'carbonbrief.org': ['Analysis: UK emissions fall to lowest level since 1850', 'Q&A: What COP31 could deliver on fossil fuel phase-out'],
      'mongabay.com': ['Protests over dam heat up as crackdown on activists continues', 'The giants with one horn'],
      'climatechangenews.com': ['Loss and damage fund delays first project approvals as needs dwarf resources'],
    });
    const out = await ask();
    // Mongabay's wildlife feature is dropped by the climate guard: 2 + 1 + 1 stories.
    expect(out.rows).toHaveLength(4);
    expect(out.source.note).toMatch(/^4 stories in the last 30 days\. Headlines from Carbon Brief, Mongabay India and Climate Home News\./);
    expect(out.coverage.through).toBe('30d');
  });

  it('says "1 story" for one', async () => {
    stubClimate({ 'carbonbrief.org': ['Analysis: UK emissions fall to lowest level since 1850'] });
    const out = await ask();
    expect(out.source.note).toMatch(/^1 story in the last 30 days\. Headlines from /);
  });
});
