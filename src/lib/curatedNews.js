/**
 * F196: modules answered by a curated Google News topic search. The search words are the module's
 * entry in FEATURE_TOPIC_Q (server/featureFeed.mjs); this table says how the answer is kept: only
 * headlines the module's title guard accepts (the search alone lets through off-topic stories),
 * each link and each headline once, no story older than the module's window, newest first. Each
 * module is news coverage and says so; none is a register.
 *
 * F202 (module quality audit 2026-10-15, causes C2–C6) adds the older news modules the audit found
 * off topic, the outlet-wire guards (Geopolitics News Wire, Climate Newswire) and the Policy
 * Pipeline's PIB guard. A module in this table is answered by its own search even when the source
 * registry or the feature map still stores an older, name-built search.
 * Kept free of imports so the server, the summaries and the tests can all read it.
 */

const TIER = {
  economics: 'finance',
  finance: 'finance',
  state: 'state',
  local: 'local',
  sports: 'sports',
  law: 'judiciary',
  judiciary: 'judiciary',
};

const DAY_MS = 86_400_000;
/** The age window of a news module that names none (F202: wires keep a month). */
export const DEFAULT_NEWS_DAYS = 30;

// ---------------------------------------------------------------------------------------------
// Text helpers.

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·', rupee: '₹',
};

/** A title with its HTML entities unescaped (twice over, for feeds that escape twice), on one line. */
export function decodeEntities(value) {
  let out = String(value ?? '');
  for (let pass = 0; pass < 2 && /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(out); pass += 1) {
    out = out.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
      if (name[0] === '#') {
        const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    });
  }
  return out.replace(/\s+/g, ' ').trim();
}

// " - Publisher" (Google News), at most six words and 40 characters, so a headline's own dash clause stays.
const PUBLISHER_SUFFIX = /\s+[|\-–—]\s+(?:[^\s|\-–—]+\s?){1,6}$/;
const SECTION_PREFIX = /^(?:india news|world news|latest news|breaking news|watch|video)\s*[|:]\s*/i;

/** The headline without its publisher suffix or a section prefix such as "India News |". */
export function headlineOf(title, publisher = '') {
  let h = decodeEntities(title);
  const pub = decodeEntities(publisher);
  if (pub && h.endsWith(` - ${pub}`)) h = h.slice(0, -(pub.length + 3));
  for (let i = 0; i < 2; i += 1) {
    const cut = h.replace(PUBLISHER_SUFFIX, '');
    if (cut.length >= 12 && cut.length <= h.length - 3 && h.slice(cut.length).length <= 44) h = cut;
  }
  return h.replace(SECTION_PREFIX, '').trim();
}

/** One story's key: its headline, lower case, letters and digits only. */
export function headlineKey(title, publisher = '') {
  return headlineOf(title, publisher).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const STORY_STOP = new Set(('a an the of to in on for by with and at from is as are was be it its his her their '
  + 'after over into amid says said will has have here what this that new more').split(' '));

// Spellings that mean one word in the headlines of one event ("Guv"/"Governor", "TN"/"Tamil Nadu",
// "twelve"/"12"). Applied to a lower-case token before it is cut to its stem. Only numbers of two
// digits or more are spelled out: "3 months" is a figure of speech, "12 bills" is an event.
// "govt" is not folded into "government": that made a Kerala motion on UPI charges and another on
// the Western Ghats "the same story" through "Union govt".
const STORY_ALIASES = {
  guv: 'governor', guvnor: 'governor', tn: 'tamil nadu',
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
};
// Capitalised words that name nothing in particular (title-case headlines capitalise them all), and
// states and union territories, which every headline of a state module names.
const STORY_GENERIC = new Set(('bill bills act acts house court courts state states centre center government ministry '
  + 'minister cabinet india indian news report reports session assembly pradesh nadu andhra arunachal assam bihar '
  + 'chhattisgarh goa gujarat haryana himachal jharkhand karnataka kerala keralam madhya maharashtra manipur '
  + 'meghalaya mizoram nagaland odisha orissa punjab rajasthan sikkim tamil telangana tripura uttar uttarakhand '
  + 'bengal delhi jammu kashmir ladakh puducherry pondicherry chandigarh').split(' '));

/** A count a headline states: two digits or more, and not a year (a year is a date, not a count). */
const isCount = (w) => /^\d{2,}$/.test(w) && !(w.length === 4 && +w >= 1900 && +w <= 2100);

// A number as a headline states it ("5.50" is one number; "45,185" and "5,000" are read as 45185 and 5000).
const NUMBER = /\p{N}+(?:\.\p{N}+)?/gu;

/**
 * A headline's content words, each cut to its first five letters so that outlets' variants of one
 * word meet ("Kerala"/"Keralam", "passes"/"passed", "summons"/"summoned"), with the counts it
 * states and the proper names it carries (capitalised words that are not generic nouns or places).
 * Pass the headline itself for the names and for "45,185" to read as one word.
 */
function storyWords(key, headline = '') {
  const split = (text) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .flatMap((t) => (STORY_ALIASES[t.toLowerCase()] ?? t.toLowerCase()).split(' '));
  const text = headline ? headline.replace(/(\d),(?=\d{3}\b)/g, '$1') : key;
  const words = new Set();
  for (const w of split(text.toLowerCase())) {
    if (w.length < 2 || STORY_STOP.has(w)) continue;
    words.add(w.slice(0, 5));
  }
  // Counts are read whole: the 50 in "5.50%" is not a count of 50.
  const nums = new Set();
  for (const n of text.match(NUMBER) || []) if (isCount(n)) nums.add(n);
  for (const t of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (isCount(STORY_ALIASES[t] || '')) nums.add(STORY_ALIASES[t]);
  const names = new Set();
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    if (!/^\p{Lu}/u.test(raw)) continue;
    for (const w of split(raw)) if (w.length > 1 && !STORY_STOP.has(w) && !STORY_GENERIC.has(w)) names.add(w.slice(0, 5));
  }
  return { words, nums, names };
}

/**
 * The same story told by another outlet: at least five content words shared, covering at least
 * 55% of the shorter headline. Measured on the 2026-10-15 live probe: the eight rewordings of the
 * Kerala Assembly's resolution on the CEC fold into one, while the same Assembly's motions on UPI
 * charges, a railway division and the Western Ghats (four or five shared words, 40-57%) stay apart.
 * Four shared words are enough when they include a count both headlines state (two digits or more,
 * not a year) and a proper name both carry (a person, office or body, not a state): "Governor
 * Arlekar gives assent to 12 bills" and "12 Bills passed in House get Governor's assent" are one event.
 */
function sameStory(a, b) {
  let shared = 0;
  for (const w of a.words) if (b.words.has(w)) shared += 1;
  const coverage = shared / Math.min(a.words.size, b.words.size);
  if (shared >= 5 && coverage >= 0.55) return true;
  if (shared < 4 || coverage < 0.55) return false;
  const sharedCount = [...a.nums].some((n) => b.nums.has(n));
  const sharedName = [...a.names].some((n) => b.names.has(n) && a.words.has(n) && b.words.has(n));
  return sharedCount && sharedName;
}

// UPSC / GK study guides, not news (audit C4: Vajiram & Ravi, GK Today, Insights IAS…).
const STUDY_SITES = /vajiram|gk ?today|insights ?(?:ias|on ?india)|drishti ?ias|clear ?ias|next ?ias|study ?iq|testbook|adda ?247|jagran josh|pw ?only ?ias|ias ?express|shankar ias|legal ?service ?india|\bupsc\b/i;

function dayOf(value) {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : NaN;
}

/**
 * The fields a row's date is read from, in the order server/feedStore.mjs reads them for an item's
 * published_at: the first one that is not empty.
 */
export const DATE_FIELDS = Object.freeze(['date', 'published_at', 'published', 'pub_date']);
const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The time a row's age is judged by (ms), NaN when it has no readable date. Review of 1d2bdb7
 * (2026-10-16): the date is the first of DATE_FIELDS that is not empty, so a row the store counts as
 * dated (by its published_at) is always aged; and a bare day (YYYY-MM-DD, as this file and
 * src/lib/carbonPack.js write a row's date) lasts to the end of that day (UTC), so a story the live
 * branch kept on its full time is not dropped from the store up to a day early.
 */
export function ageTime(row) {
  const raw = DATE_FIELDS.map((key) => row?.[key]).find((v) => v != null && String(v).trim() !== '');
  if (raw == null) return NaN;
  const s = String(raw).trim();
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return NaN;
  return BARE_DAY.test(s) ? t + DAY_MS - 1 : t;
}

function isoDay(value) {
  const t = dayOf(value);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}

/**
 * The rows of a news answer worth showing: titles unescaped; no study guide or bare navigation
 * page ("India News - LatestLY"); nothing older than `days` (by ageTime; an undated row is kept: its
 * age cannot be judged); each link and each story once (a reworded headline counts as the same story);
 * newest first; at most `cap`.
 * `keep(row, headline)` may refuse a row (a module's title guard).
 */
function keptNews(rows, { days = DEFAULT_NEWS_DAYS, now = Date.now(), cap = 100, keep = null, isoDates = false } = {}) {
  const oldest = now - days * DAY_MS;
  const links = new Set();
  const stories = new Set();
  const storySets = [];
  const kept = [];
  // Newest first before choosing, so the copy of a story that is kept is its newest telling.
  const ordered = (rows || [])
    .map((row, i) => ({ row, i, t: dayOf(row?.date) }))
    .sort((a, b) => (Number.isFinite(b.t) ? b.t : -Infinity) - (Number.isFinite(a.t) ? a.t : -Infinity) || a.i - b.i)
    .map(({ row }) => row);
  for (const row of ordered) {
    const title = decodeEntities(row?.title);
    if (!title) continue;
    const publisher = decodeEntities(row?.publisher || row?.outlet || '');
    const headline = headlineOf(title, publisher);
    // A navigation page ("India News - LatestLY") is a name, not a story.
    if (headline.replace(PUBLISHER_SUFFIX, '').split(/\s+/).filter(Boolean).length < 3) continue;
    if (STUDY_SITES.test(`${title} ${publisher}`)) continue;
    if (keep && !keep(row, headline)) continue;
    const t = ageTime(row);
    if (Number.isFinite(t) && t < oldest) continue;
    const link = String(row?.source_url || '').trim();
    const story = headlineKey(title, publisher);
    if ((link && links.has(link)) || stories.has(story)) continue;
    const words = storyWords(story, headline);
    if (storySets.some((seen) => sameStory(words, seen))) continue;
    if (link) links.add(link);
    stories.add(story);
    storySets.push(words);
    kept.push({
      ...row,
      title,
      ...(row?.publisher ? { publisher } : {}),
      ...(isoDates ? { date: isoDay(row?.date) || String(row?.date || '') } : {}),
    });
  }
  return kept
    .map((row, i) => ({ row, i, t: dayOf(row.date) }))
    .sort((a, b) => (Number.isFinite(b.t) ? b.t : -Infinity) - (Number.isFinite(a.t) ? a.t : -Infinity) || a.i - b.i)
    .slice(0, cap)
    .map(({ row }) => row);
}

/** F202: any news wire's rows, kept by age and one row per story (no topic guard). */
export function freshNewsRows(rows, { days = DEFAULT_NEWS_DAYS, now = Date.now(), cap = 100 } = {}) {
  return keptNews(rows, { days, now, cap });
}

// ---------------------------------------------------------------------------------------------
// Guards.

const STATE_NAMES =
  'Andhra(?: Pradesh)?|Arunachal(?: Pradesh)?|Assam|Bihar|Chhattisgarh|Goa|Gujarat|Haryana|Himachal(?: Pradesh)?|' +
  'Jharkhand|Karnataka|Keralam?|Madhya Pradesh|Maharashtra|Manipur|Meghalaya|Mizoram|Nagaland|Odisha|Orissa|Punjab|' +
  'Rajasthan|Sikkim|Tamil ?Nadu|Telangana|Tripura|Uttar Pradesh|Uttarakhand|Bengal|Delhi|Jammu|Kashmir|J&K|Ladakh|' +
  'Puducherry|Pondicherry|Chandigarh|Andaman|Lakshadweep|Dadra|Daman';
const STATE_CAPITALS =
  'Mumbai|Chennai|Kolkata|Hyderabad|Bengaluru|Bangalore|Lucknow|Patna|Bhopal|Jaipur|Gandhinagar|Thiruvananthapuram|' +
  'Shimla|Dehradun|Raipur|Ranchi|Bhubaneswar|Guwahati|Dispur|Imphal|Shillong|Aizawl|Kohima|Agartala|Gangtok|Itanagar|' +
  'Srinagar|Panaji|Amaravati';
/** A headline that names a state or UT, its capital, a chief minister or a state body. */
const STATE_SIGNAL = new RegExp(
  `\\b(?:${STATE_NAMES}|${STATE_CAPITALS})\\b|\\b(?:UP|MP|AP|TN|HP)\\s+(?:cabinet|govt|government|CM|assembly|minister|ministers|police|polls?)\\b|` +
    'chief minister|\\bCMs?\\b|\\bstate (?:government|govt|cabinet|minister|ministers|assembly|legislature)\\b|vidhan (?:sabha|parishad)|legislative assembly',
  'i',
);
const NEIGHBOURS = 'Pakistan|Lahore|Islamabad|Gilgit|Sindh|Bangladesh|Dhaka|Nepal|Kathmandu|Sri Lanka|Island\\.lk';

const re = (source, flags = 'i') => new RegExp(source, flags);

const LAW_FIELDS = Object.freeze({
  section: 'COVERAGE — GOOGLE NEWS RSS',
  reporting_search: 'Google News RSS — coverage mentions, not an official court dataset',
});

export const CURATED_NEWS = Object.freeze({
  'sports:Sports Governance & Policy': Object.freeze({
    // The Sports desk's wires answer as `api` (its summary reads only that adapter).
    adapter: 'api',
    section: 'SPORTS GOVERNANCE & POLICY',
    title: /ministry|minister|mandaviya|federation|\bNSFs?\b|association|\bIOA\b|olympic|paralympic|doping|\bNADA\b|\bWADA\b|governance|polic(?:y|ies)|sports code|sports (?:bill|act)|\bSAI\b|sports authority|\bTOPS\b|athletes?'? commission|election|suspend|\bban(?:ned)?\b|2036|\bbid\b|review|funding/i,
    note: 'Google News search for the sports ministry, sports federations, the Indian Olympic Association, anti-doping (NADA) and sports governance law. Reporting, not an official MYAS or National Sports Code register.',
  }),
  "state:Governor Friction & President's Rule Tracker": Object.freeze({
    adapter: 'news-search',
    section: "GOVERNOR FRICTION & PRESIDENT'S RULE",
    title: /governor|\bguv\b|raj bhavan|lok bhavan|president'?s rule|article 356|\bL-?G\b/i,
    note: "Google News search for disputes between governors and state governments: walkouts and rows over the governor's address, withheld assent, Raj Bhavan standoffs, President's Rule (Article 356). Reporting, not a register of proclamations or withheld bills.",
  }),
  'state:Legislative Productivity Comparison': Object.freeze({
    adapter: 'news-search',
    section: 'STATE ASSEMBLY SESSIONS (NEWS)',
    title: /assembly|vidhan sabha|vidhan parishad|legislat|\bhouse\b|sittings?\b|session/i,
    exclude: /national assembly|parliament|lok sabha|rajya sabha|general assembly|pakistan|nepal/i,
    note: 'Google News search for state assembly sessions: sittings, sessions cut short or adjourned sine die, bills passed, walkouts. News coverage only: sittings, hours and bills-passed counts are not measured or compared.',
  }),
  'state:MLA Defection & Anti-defection Case Tracker': Object.freeze({
    adapter: 'news-search',
    section: 'DEFECTION & ANTI-DEFECTION (NEWS)',
    title: /defect|tenth schedule|disqualif|switch(?:ed|es|ing)? (?:sides|parties|party|over)|chang(?:ed|es|ing) parties|\bjoin(?:s|ed|ing)?\b|crossed over|jump(?:ed|s)? ship|turncoat|poach|horse-?trading|merge/i,
    note: 'Google News search for MLA defections, anti-defection (Tenth Schedule) cases, disqualification petitions and Speakers\' decisions. Reporting only: not a register of defections or of pending petitions.',
  }),

  // F202: the State and Local desks' news modules.
  'state:State Governance Brief': Object.freeze({
    adapter: 'news-search',
    section: 'STATE GOVERNANCE (NEWS)',
    days: 7,
    title: STATE_SIGNAL,
    exclude: re(`union cabinet|\\bunion (?:minister|ministry|government|govt|budget)\\b|central government employees|cabinet secretar(?:iat|y)|\\bDA hike\\b|${NEIGHBOURS}`),
    fields: Object.freeze({ section: 'State coverage', reporting_search: 'Google News RSS — coverage mentions, not an official briefing' }),
    note: 'Google News search for state governments: chief ministers, state cabinets and ministers, the Vidhan Sabha. Each headline names a state or union territory, a chief minister or a state body; Union Cabinet and central-government stories are left out. Reporting, not a personalised governance digest.',
  }),
  'state:Cabinet Decisions': Object.freeze({
    adapter: 'news-search',
    section: 'STATE CABINET DECISIONS (NEWS)',
    days: 7,
    title: /cabinet/i,
    also: STATE_SIGNAL,
    exclude: re(`union cabinet|\\bunion\\b|modi cabinet|central government|\\bcentre['’]s\\b|\\bcentre (?:approves|clears|nods|okays)\\b|railway employees|\\bIDBI\\b|cabinet secretar(?:iat|y)|${NEIGHBOURS}`),
    note: 'Google News search for state cabinet meetings and decisions. Each headline names a state or union territory (or its chief minister); Union Cabinet decisions are left out (they are in the National desk’s Cabinet Decisions). Reporting, not an official record of cabinet decisions.',
  }),
  'state:Governor Assent Tracker': Object.freeze({
    adapter: 'news-search',
    section: 'GOVERNOR ASSENT (NEWS)',
    days: 30,
    when: '30d',
    title: /governor|\bguv\b|\bL-?G\b|raj bhavan|lok bhavan|president/i,
    also: /assent|withh[eo]ld|\bbills?\b|ordinance/i,
    exclude: re(`\\bRBI\\b|reserve bank|central bank|treasury bills?|\\bcounty\\b|kenya|\\bU\\.?S\\.?\\b|senate|newsom|${NEIGHBOURS}`),
    note: 'Google News search for governors’ assent to state bills: assent given, withheld or delayed, bills returned or reserved for the President, ordinances. Each headline names a governor (or the President) and a bill, assent or ordinance. Reporting, not a register of pending bills.',
  }),
  'state:CAG Audit Tracker': Object.freeze({
    adapter: 'news-search',
    section: 'CAG AUDIT REPORTS (NEWS)',
    days: 30,
    when: '30d',
    title: /\bCAG\b|comptroller/i,
    exclude: /cricket|\bBCCI\b|cricinfo/i,
    note: 'Google News search for reports of the Comptroller and Auditor General (CAG) and their scrutiny by Public Accounts Committees. Each headline names the CAG. Reporting, not the CAG’s register of audit reports.',
  }),
  'state:Assembly Proceedings Digest (Vernacular, Translated)': Object.freeze({
    adapter: 'news-search',
    section: 'ASSEMBLY PROCEEDINGS (NEWS)',
    days: 7,
    title: /assembly|vidhan (?:sabha|parishad)|legislative council|\bhouse\b/i,
    also: /session|sitting|\bpass(?:es|ed)?\b|\bbills?\b|resolution|walk-?out|adjourn|question hour|debate|motion|tabled|introduc|privilege|ruckus|uproar|summon|prorogu|budget|speaker (?:suspends|adjourns|rules|disqualifies)/i,
    exclude: re(`national assembly|general assembly|parliament|lok sabha|rajya sabha|assembly (?:polls?|elections?|seats?|constituenc\\w*|bypolls?|by-?elections?|segments?|tickets?|candidates?)|${NEIGHBOURS}`),
    note: 'Google News search (English) for state assembly proceedings: sessions and sittings, bills and resolutions passed, walkouts, adjournments. English-language reporting only; nothing is translated from vernacular editions, and this is not an official record of proceedings.',
  }),
  'state:District Media Monitor (Vernacular District Editions)': Object.freeze({
    adapter: 'news-search',
    section: 'DISTRICT MEDIA — GOOGLE NEWS RSS',
    days: 7,
    // "India" as a whole word, never "Indian" (audit C5: Indian River County, Menominee Indian High School).
    title: re(`\\bIndia\\b|${STATE_SIGNAL.source}|\\bdistrict\\b|collector(?:ate)?|zilla|\\btehsil\\b|\\btaluk`),
    exclude: re(`indian river|indian creek|\\bcounty\\b|vero beach|\\bU\\.?S\\.?\\b|${NEIGHBOURS}|nepalis?`),
    archive: 'up_district_media.csv',
    note: 'Google News search (English) for district administration and local issues in India: collectors, district magistrates, zilla parishads; protests, land, water, roads, schools, hospitals. Each headline names India, a state or union territory, or a district body. English-language reporting only; nothing is translated from vernacular district editions.',
  }),
  'local:Municipal Watch': Object.freeze({
    adapter: 'news-search',
    section: 'MUNICIPAL BODIES (NEWS)',
    days: 7,
    title: /municipal|municipality|civic (?:body|bodies|polls?|chief|administration|agency|election)|corporators?|\bmayors?\b|nagar (?:nigam|palika|parishad|panchayat)|urban local bod|\bULBs?\b|\bMCD\b|\bBMC\b|\bBBMP\b|\bGHMC\b|councillors?|\bward (?:member|councillor|committee)/i,
    exclude: re(`new york|norway|yorkshire|london|liverpool|manchester|man city|everton|mayor world school|\\bU\\.?S\\.?\\b|${NEIGHBOURS}`),
    note: 'Google News search for India’s municipal bodies: municipal corporations and councils, urban local bodies, mayors, corporators and civic polls. Each headline names a municipal body, office or election. Reporting, not an official municipal record.',
  }),
  'local:Panchayat Watch': Object.freeze({
    adapter: 'news-search',
    section: 'PANCHAYATS (NEWS)',
    days: 7,
    title: /panchayat|sarpanch|gram sabha|zilla parishad|zila parishad|panchayati raj|\bpradhans?\b|mukhiya|block development|local body polls?|rural local bod/i,
    exclude: re(NEIGHBOURS),
    note: 'Google News search for panchayats: gram panchayats, sarpanches, zilla parishads, panchayati raj and panchayat polls. Each headline names a panchayat body, office or election. Reporting, not an official panchayat record.',
  }),

  // F202: the Law desk's news wires the audit found off topic (C5).
  'judiciary:District Court Case Tracker': Object.freeze({
    adapter: 'news-search',
    section: 'COVERAGE — GOOGLE NEWS RSS',
    days: 7,
    title: /\bcourts?\b|magistrate|sessions judge|district judge/i,
    exclude: /supreme court|high court|\bHCs?\b|\bSC\b|\bCJI\b|international (?:criminal )?court|world court|\bICC\b|\bICJ\b|food court|tennis|badminton|basketball|federal (?:court|judge)/i,
    fields: LAW_FIELDS,
    note: 'Google News RSS — court / litigation coverage of district and sessions courts and magistrates. Not an official docket or cause list; Supreme Court and High Court stories are left out.',
  }),
  'judiciary:HC Judge Profiles & Bench Analytics': Object.freeze({
    adapter: 'news-search',
    section: 'COVERAGE — GOOGLE NEWS RSS',
    // Appointments come a few times a month: 3 stories in 7 days, about 30 in 30 (live, 2026-10-15).
    days: 30,
    when: '30d',
    title: /high courts?|\bHCs?\b|collegium|\bCJI\b/i,
    also: /judges?|justices?|\bCJ\b|chief justice|bench|collegium|judicial officers?/i,
    exclude: re(`israel|azerbaijan|texas|california|michigan|\\bU\\.?S\\.?\\b|senate|republicans?|democrats?|${NEIGHBOURS}`),
    fields: LAW_FIELDS,
    note: 'Google News RSS — court / litigation coverage of Indian High Court judges: appointments, elevations, transfers, oaths, retirements, collegium recommendations. Not an official docket or cause list.',
  }),
  'judiciary:ICJ Proceedings': Object.freeze({
    adapter: 'news-search',
    section: 'COVERAGE — GOOGLE NEWS RSS',
    days: 30,
    when: '30d',
    title: /international court of justice|\bICJ\b|world court/i,
    exclude: /nobel|cricket/i,
    fields: LAW_FIELDS,
    note: 'Google News RSS — court / litigation coverage of the International Court of Justice: cases, hearings, rulings, advisory opinions and judges. Not an official docket or cause list.',
  }),
});

/**
 * F202: guards for the outlet wires that are not a Google News search. Geopolitics News Wire reads
 * BBC World (every world story) and a geopolitics search; Climate Newswire reads Mongabay India,
 * whose feed also carries wildlife features.
 */
export const WIRE_GUARDS = Object.freeze({
  geopolitics: Object.freeze({
    days: 7,
    title: /\bwars?\b|conflict|ceasefire|truce|\bstrikes?\b|missiles?|drones?|military|troops|\barmy\b|\bnavy\b|soldiers|militants?|rebels?|insurg|attack|invasion|battlefield|sanction|tariffs?|trade (?:deal|war|talks)|diplomat|embass|ambassador|envoy|summit|\btalks\b|treaty|accord|\bpeace\b|\bNATO\b|\bUN\b|united nations|security council|nuclear|election|referendum|\bcoup\b|protest|parliament|president|prime minister|foreign minister|\bminister\b|government|regime|border|refugee|hostage|\bIDF\b|gaza|israel|ukraine|russia|kremlin|iran|taiwan|china|beijing|north korea|syria|yemen|houthi|hamas|hezbollah|sudan|afghanistan|taliban|venezuela|geopolit|alliance|\bBRICS\b|\bG7\b|\bG20\b|european union|\bEU\b/i,
    exclude: /collapse|earthquake|flood(?:s|ing)?\b|rainfall|heatwave|weather|storm|typhoon|hurricane|wildfire|murder|poison|celebrity|football|cricket|tennis|olympic|recipe|pupils|kelly clarkson|lonely/i,
  }),
  climate: Object.freeze({
    days: 30,
    title: /climate|carbon|emission|warming|heat ?wave|\bCOP\d*\b|net[- ]zero|renewable|solar|wind (?:power|energy|farm)|\bcoal\b|fossil|energy|flood|drought|monsoon|glacier|sea[- ]level|deforest|methane|greenhouse|pollution|air quality|electric vehicle|\bEVs?\b|clean power|hydrogen|hydro|\bdams?\b|cyclone|extreme weather|rainfall|disaster|adaptation/i,
  }),
});

/**
 * F202: a PIB release about policy in the making: a draft, consultation, notification, rules,
 * regulations, amendment, gazette, bill, policy, ordinance or guidelines, or an approved scheme.
 * PIB's English RSS carries titles only (no body), so the title decides.
 */
const PIPELINE_TERMS = /\bdrafts?\b|consultation|(?:public|stakeholder) comments|comments (?:invited|sought)|\bnotif(?:y|ies|ied|ication|ications)\b|\brules\b|\bregulations?\b|\bamend(?:s|ed|ment|ments)?\b|gazette|\bbills?\b|\bpolic(?:y|ies)\b|ordinance|guidelines/i;
const APPROVED_SCHEME = /\b(?:scheme|programme|program|mission|yojana|project|bonus)\b[^.]{0,80}\bapprov|\bapprov\w*\b[^.]{0,80}\b(?:scheme|programme|program|mission|yojana|policy|project|bonus)\b|cabinet approves/i;
export function isPipelineRelease(title) {
  const t = decodeEntities(title);
  if (t.split(/\s+/).filter(Boolean).length < 4) return false;
  return PIPELINE_TERMS.test(t) || APPROVED_SCHEME.test(t);
}

/** The curated-news settings of a module (by the tier and feature a request names), or null. */
export function curatedNewsFor(tier, feature) {
  const t = String(tier || '').toLowerCase();
  return CURATED_NEWS[`${TIER[t] || t}:${String(feature || '').trim()}`] || null;
}

/** A spec's window in days (DEFAULT_NEWS_DAYS when it names none). */
export function newsDays(spec) {
  return Number(spec?.days) > 0 ? Number(spec.days) : DEFAULT_NEWS_DAYS;
}

/**
 * The rows a curated-news module shows: headlines its title guard (and its `also` guard) accepts
 * and its exclusion does not, no older than its window, each link and headline once, newest first,
 * dated YYYY-MM-DD, at most `cap`. The spec's `fields` are added to every row.
 */
export function curatedNewsRows(rows, spec, { cap = 100, now = Date.now() } = {}) {
  const fields = spec.fields || {};
  const keep = (row, headline) =>
    spec.title.test(headline) && (!spec.also || spec.also.test(headline)) && !spec.exclude?.test(headline);
  return keptNews(rows, { days: newsDays(spec), now, cap, keep, isoDates: true }).map((row) => ({ ...row, ...fields }));
}
