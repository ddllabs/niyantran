/**
 * F196: the RBI Handbook of Statistics on Indian States as stored State registers (owner decision
 * 2026-10-15: "use the RBI handbook as a yearly stored register"). Plain data, shared by the
 * fetcher (scripts/fetch-rbi-handbook.mjs), the loader (scripts/load-feed-register.mjs), the server
 * (server/feedSchedule.mjs FEED_REGISTERS, server/featureFeed.mjs) and the page's Table picker, so the
 * browser bundle takes no server code.
 *
 * HANDBOOK_TABLES lists the tables the modules use with their titles in this edition, as the
 * publication listing named them on 2026-10-15. In this edition table N's page is
 * PublicationsView.aspx?id=(23449 + N) for every one of the 182 tables. A new edition renumbers the
 * pages: `node scripts/fetch-rbi-handbook.mjs --check` compares this file with the listing; then
 * update the edition, the date, the page-id base and any changed titles here.
 *
 * State figures only: the handbook has no district tables, so the five themes once named "District …"
 * keep their module keys (links, saved views and the catalogue stay valid) and show "State …" labels.
 */
import { MLA_STATE_NAMES } from './mlaStates.js';

export const HANDBOOK = Object.freeze({
  title: 'Handbook of Statistics on Indian States',
  publisher: 'Reserve Bank of India',
  edition: '2024-25',
  // The date on every table page of this edition ("Date : Dec 11, 2025").
  published: '2025-12-11',
  publishedLabel: '11 Dec 2025',
  listingUrl: 'https://www.rbi.org.in/Scripts/AnnualPublications.aspx?head=Handbook%20of%20Statistics%20on%20Indian%20States',
  // Table N's page id is PAGE_ID_BASE + N in this edition.
  pageIdBase: 23449,
});

/** The note every handbook module carries. */
export const HANDBOOK_NOTE = `RBI Handbook of Statistics on Indian States, ${HANDBOOK.edition} edition (published ${HANDBOOK.publishedLabel}); state level.`;

export const handbookTableUrl = (id) => `https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=${id}`;

// [table number, title as the listing names it] for the edition above.
const TABLE_LIST = [
  [1, 'State-wise Gross Enrolment Ratio'],
  [2, 'State-wise Birth Rate'],
  [3, 'State-wise Death Rate'],
  [4, 'State-wise Infant Mortality Rate'],
  [5, 'State-wise Maternal Mortality Ratio'],
  [6, 'State-wise Total Fertility Rate'],
  [7, 'State-wise Life Expectancy'],
  [8, 'State-wise Unemployment Rate: Usual Status (Adjusted) (Rural)'],
  [9, 'State-wise Unemployment Rate: Usual Status (Adjusted) (Urban)'],
  [10, 'State-wise Poverty Estimates - Multi-dimensional Poverty Index'],
  [11, 'State-wise Natural Population Growth Rate'],
  [12, 'State-wise Gender Parity Index of Gross Enrolment Ratio by Level of School Education'],
  [14, 'State-wise Children Aged 6-59 Months who are Anaemic'],
  [15, 'State-wise Pregnant Women Aged 15-49 Years who are Anaemic'],
  [16, 'State-wise Health Infrastructure - Doctors and Specialists'],
  [18, 'State-wise Public Expenditure on Health'],
  [19, 'Per Capita Net State Domestic Product (Current Prices)'],
  [20, 'Per Capita Net State Domestic Product (Constant Prices)'],
  [21, 'Gross State Domestic Product (Current Prices)'],
  [22, 'Gross State Domestic Product (Constant Prices)'],
  [23, 'Net State Domestic Product (Current Prices)'],
  [24, 'Net State Domestic Product (Constant Prices)'],
  [25, 'Gross State Value Added (Current Prices)'],
  [26, 'Gross State Value Added (Constant Prices)'],
  [27, 'Net State Value Added (Current Prices)'],
  [28, 'Net State Value Added (Constant Prices)'],
  [29, 'Gross State Value Added by Economic Activity - Agriculture (Current Prices)'],
  [30, 'Gross State Value Added by Economic Activity - Agriculture (Constant Prices)'],
  [31, 'Net State Value Added by Economic Activity - Agriculture (Current Prices)'],
  [32, 'Net State Value Added by Economic Activity - Agriculture (Constant Prices)'],
  [33, 'Gross State Value Added by Economic Activity - Manufacturing (Current Prices)'],
  [34, 'Gross State Value Added by Economic Activity - Manufacturing (Constant Prices)'],
  [35, 'Net State Value Added by Economic Activity - Manufacturing (Current Prices)'],
  [36, 'Net State Value Added by Economic Activity - Manufacturing (Constant Prices)'],
  [37, 'Gross State Value Added by Economic Activity - Construction (Current Prices)'],
  [38, 'Gross State Value Added by Economic Activity - Construction (Constant Prices)'],
  [39, 'Net State Value Added by Economic Activity - Construction (Current Prices)'],
  [40, 'Net State Value Added by Economic Activity - Construction (Constant Prices)'],
  [41, 'Gross State Value Added by Economic Activity - Industry (Current Prices)'],
  [42, 'Gross State Value Added by Economic Activity - Industry (Constant Prices)'],
  [43, 'Net State Value Added by Economic Activity - Industry (Current Prices)'],
  [44, 'Net State Value Added by Economic Activity - Industry (Constant Prices)'],
  [45, 'Gross State Value Added by Economic Activity - Financial Services (Current Prices)'],
  [46, 'Gross State Value Added by Economic Activity - Financial Services (Constant Prices)'],
  [47, 'Net State Value Added by Economic Activity - Financial Services (Current Prices)'],
  [48, 'Net State Value Added by Economic Activity - Financial Services (Constant Prices)'],
  [49, 'Gross State Value Added by Economic Activity - Services (Current Prices)'],
  [50, 'Gross State Value Added by Economic Activity - Services (Constant Prices)'],
  [51, 'Net State Value Added by Economic Activity - Services (Current Prices)'],
  [52, 'Net State Value Added by Economic Activity - Services (Constant Prices)'],
  [53, 'State-wise Pattern of Land Use - Gross Sown Area'],
  [54, 'State-wise Pattern of Land Use- Net Sown Area'],
  [55, 'State-wise Pattern of Land Use - Gross Irrigated Area'],
  [56, 'State-wise Pattern of Land Use - Net Irrigated Area'],
  [57, 'State-wise Pattern of Land Use - Cropping Intensity'],
  [58, 'State-wise Production of Foodgrains - Rice'],
  [59, 'State-wise Production of Foodgrains - Wheat'],
  [60, 'State-wise Production of Foodgrains - Coarse Cereals'],
  [61, 'State-wise Production of Foodgrains - Pulses'],
  [62, 'State-wise Production of Total Foodgrains'],
  [63, 'State-wise Production of Non-Foodgrains - Oilseeds'],
  [64, 'State-wise Production of Non-Foodgrains - Cotton (Lint)'],
  [65, 'State-wise Production of Non-Foodgrains - Sugarcane'],
  [66, 'State-wise Production of Non-Foodgrains - Raw Jute & Mesta'],
  [67, 'State-wise Area of Foodgrains - Rice'],
  [68, 'State-wise Area of Foodgrains - Wheat'],
  [69, 'State-wise Area of Foodgrains - Coarse Cereals'],
  [70, 'State-wise Area of Foodgrains - Pulses'],
  [71, 'State-wise Area of Total Foodgrains'],
  [72, 'State-wise Area of Total Fruits'],
  [73, 'State-wise Area of Total Vegetables'],
  [74, 'State-wise Production of Total Fruits'],
  [75, 'State-wise Production of Total Vegetables'],
  [76, 'State-wise Area of Non-Foodgrains - Oilseeds'],
  [77, 'State-wise Area of Non-Foodgrains - Cotton (Lint)'],
  [78, 'State-wise Area of Non-Foodgrains - Sugarcane'],
  [79, 'State-wise Area of Non-Foodgrains - Raw Jute & Mesta'],
  [80, 'State-wise Estimates of Yield - Rice'],
  [81, 'State-wise Estimates of Yield - Wheat'],
  [82, 'State-wise Estimates of Yield - Coarse Cereals'],
  [83, 'State-wise Estimates of Yield - Pulses'],
  [84, 'State-wise Estimates of Yield - Total Foodgrains'],
  [85, 'State-wise Estimates of Yield - Oilseeds'],
  [86, 'State-wise Estimates of Yield - Cotton (Lint)'],
  [87, 'State-wise Estimates of Yield - Sugarcane'],
  [88, 'State-wise Estimates of Yield - Raw Jute & Mesta'],
  [89, 'State-wise Consumption of Fertiliser (N,P&K)'],
  [90, 'State-wise Meat Production'],
  [91, 'State-wise Milk Production'],
  [92, 'State-wise Egg Production'],
  [93, 'State-wise Fish Production'],
  [94, 'State-wise Wool Production'],
  [95, 'State-wise RIDF Sanction and Disbursements'],
  [96, 'State-wise Storage Capacity of Foodgrains'],
  [97, 'Storage Capacity for Foodgrains and Utilisation under FCI'],
  [98, 'State-wise Cold Storage Capacity'],
  [106, 'State-wise Sustainable Development Goals (SDGs) Score'],
  [107, 'State-wise Status of Ground Water Extraction in India'],
  [108, 'State-wise Average Inflation (CPI) - General'],
  [109, 'State-wise Average Inflation (CPI) - Food and Beverages'],
  [110, 'State-wise Average Inflation (CPI) - Fuel and Light'],
  [111, 'State-wise Average Inflation (CPI) - Housing (Urban)'],
  [112, 'State-wise Average Daily Wage Rates in Rural India (Men - Construction Workers)'],
  [113, 'State-wise Average Daily Wage Rates in Rural India (Men - General Agricultural Labourers)'],
  [114, 'State-wise Average Daily Wage Rates in Rural India (Men - Horticulture Workers)'],
  [115, 'State-wise Average Daily Wage Rates in Rural India (Men - Non-Agricultural Labourers)'],
  [138, 'State-wise Per Capita Availability of Power'],
  [139, 'State-wise Availability of Power'],
  [140, 'State-wise Installed Capacity of Power'],
  [141, 'State-wise Power Requirement'],
  [142, 'State-wise Actual Power Supply Position in terms of Peak Demand vis-à-vis Peak Met'],
  [143, 'State-wise Total Installed Capacity of Grid Interactive Renewable Power'],
  [144, 'State-wise Length of National Highways'],
  [145, 'State-wise Railway Route'],
  [146, 'State-wise Length of Roads'],
  [147, 'State-wise Length of State Highways'],
  [148, 'State-wise Electricity Transmission & Distribution Losses'],
  [150, 'State-wise Road Constructed under PMGSY'],
  [151, 'State-wise Number of Schools by Management and Availability of Functional Computer Facility'],
  [152, 'State-wise Distribution of Offices of Scheduled Commercial Banks'],
  [153, 'State-wise Credit-Deposit Ratio of Scheduled Commercial Banks - According to Place of Sanction'],
  [154, 'State-wise Credit-Deposit Ratio of Scheduled Commercial Banks - According to Place of Utilisation'],
  [155, 'State-wise Deposits by Scheduled Commercial Banks in India'],
  [156, 'State-wise Credit by Scheduled Commercial Banks in India'],
  [157, 'State-wise Credit to Agriculture by Scheduled Commercial Banks'],
  [158, 'State-wise Credit to Industry by Scheduled Commercial Banks'],
  [159, 'State-wise Personal Loans by Scheduled Commercial Banks'],
  [160, 'State-wise Deposits of Regional Rural Banks'],
  [161, 'State-wise Credit of Regional Rural Banks'],
  [162, 'State-wise Credit-Deposit Ratio of Regional Rural Banks'],
  [163, 'State-wise Number of Branches of Regional Rural Banks'],
  [164, 'State-wise Gross Fiscal Deficit'],
  [165, 'State-wise Revenue Deficit'],
  [166, 'State-wise Revenue Expenditure'],
  [167, 'State-wise Primary Deficit'],
  [168, 'State-wise Own Tax Revenue'],
  [169, 'State-wise Own Non-Tax Revenue'],
  [170, 'State-wise Interest Payments'],
  [171, 'State-wise Pension'],
  [172, 'State-wise Capital Receipts'],
  [173, 'State-wise Capital Expenditure'],
  [174, 'State-wise Capital Outlay'],
  [175, 'State-wise Social Sector Expenditure'],
  [176, 'State-wise Composition of Outstanding Liabilities'],
  [177, 'State-wise Outstanding Guarantees of State Governments'],
  [178, 'Market Borrowings of State Governments'],
  [179, 'State-wise Gender-wise Subscribers of National Pension System (NPS) All Citizen'],
  [180, 'State-wise Gender-wise Enrolments under Atal Pension Yojana (APY)'],
];

/** Table number -> { no, id, title, url }. */
export const HANDBOOK_TABLES = new Map(
  TABLE_LIST.map(([no, title]) => {
    const id = HANDBOOK.pageIdBase + no;
    return [no, Object.freeze({ no, id, title, url: handbookTableUrl(id) })];
  }),
);

const range = (a, b) => Array.from({ length: b - a + 1 }, (_v, i) => a + i);

/**
 * The modules and their tables, in the order the Table picker offers them (the first is the view a
 * request without a table gets). label: what the page calls a state-level theme whose module key
 * still says "District". Tables were mapped by their titles in the listing and checked against each
 * page (scripts/fetch-rbi-handbook.mjs). Tables 13, 99–105, 116–137, 181 and 182 (tourism, forests and
 * weather, factories and small industry, exports) fit none of the modules and are not loaded. Table 17
 * (government hospitals and beds) states no year on its page and is left out rather than dated by
 * guess; table 149 (telephones per 100 people) is by telecom circle (Kolkata, Mumbai, "North East-I"),
 * not by state.
 */
export const HANDBOOK_MODULES = Object.freeze({
  'state:State Economic Data (GSDP, sectors)': Object.freeze({ tables: Object.freeze([21, 22, 19, 20, ...range(23, 52)]) }),
  'state:State Fiscal Deep-Dive': Object.freeze({ tables: Object.freeze(range(164, 178)) }),
  'state:NITI Aayog State Indices': Object.freeze({ tables: Object.freeze([106, 10]) }),
  'state:District Health & Nutrition Indicators': Object.freeze({
    label: 'State Health & Nutrition Indicators',
    tables: Object.freeze([...range(2, 7), 11, 14, 15, 16, 18]),
  }),
  'state:District Education Indicators': Object.freeze({ label: 'State Education Indicators', tables: Object.freeze([1, 12, 151]) }),
  'state:District Economic & Livelihood Indicators': Object.freeze({
    label: 'State Economic & Livelihood Indicators',
    tables: Object.freeze([8, 9, 19, 20, ...range(108, 115), ...range(152, 163), 179, 180]),
  }),
  'state:District Agriculture & Rural Indicators': Object.freeze({
    label: 'State Agriculture & Rural Indicators',
    tables: Object.freeze([...range(53, 98), 107, 150]),
  }),
  'state:District Infrastructure & Connectivity': Object.freeze({
    label: 'State Infrastructure & Connectivity',
    tables: Object.freeze([...range(138, 148), 150]),
  }),
});

/** The module key ("tier:Feature") -> its handbook spec, or null. */
export function handbookModule(id) {
  return Object.hasOwn(HANDBOOK_MODULES, id) ? HANDBOOK_MODULES[id] : null;
}

/** By tier and feature name (the page's names), as handbookModule. */
export function handbookModuleFor(tier, feature) {
  return handbookModule(`${String(tier ?? '').trim()}:${String(feature ?? '').trim()}`);
}

/** "Table 21: Gross State Domestic Product (Current Prices)". */
export function handbookTableLabel(no) {
  const t = HANDBOOK_TABLES.get(Number(no));
  return t ? `Table ${t.no}: ${t.title}` : `Table ${no}`;
}

/**
 * F201: the most figures one store variant holds: feed_record's cap on one record
 * (scripts/load-feed-register.mjs MAX_ITEMS). A table larger than this is stored as whole-year blocks
 * (src/lib/rbiHandbook.js yearBlocks), each its own variant.
 */
export const HANDBOOK_BLOCK_MAX = 2000;

// A year as the handbook writes one: "2005", "2019-20", "2019-21", "1993-97".
const YEAR_TOKEN = /^(19|20)\d{2}(-\d{2,4})?$/;

/** True when `value` is a handbook year token ("2005", "2019-20", "1993-97"). */
export const isHandbookYear = (value) => YEAR_TOKEN.test(String(value ?? ''));

/** A block's store variant: the table alone ("176", its newest block) or with its oldest year ("176@2005"). */
export function handbookVariant(no, from = '') {
  return from ? `${no}@${from}` : String(no);
}

/** A store variant as { no, from } ('' for the newest block), or null when it is not one. */
export function parseHandbookVariant(value) {
  const m = /^(\d{1,3})(?:@(.*))?$/.exec(String(value ?? ''));
  if (!m) return null;
  if (m[2] !== undefined && !isHandbookYear(m[2])) return null;
  return { no: Number(m[1]), from: m[2] || '' };
}

/**
 * A request's table (and F201: its `years`, a block's oldest year) as a store variant of the module
 * `spec`: '' when the module does not hold the table, else handbookVariant(table, years). Accepts "21",
 * "T21", "Table 21". A `years` that is not a year token is ignored: the table's newest block.
 */
export function handbookTableVariant(spec, value, years = '') {
  const m = /^\s*(?:t(?:able)?\s*)?(\d{1,3})\s*$/i.exec(String(value ?? ''));
  if (!spec || !m) return '';
  const no = Number(m[1]);
  if (!spec.tables.includes(no)) return '';
  const from = String(years ?? '').trim();
  return handbookVariant(no, isHandbookYear(from) ? from : '');
}

/** Every handbook table any module uses, in number order. */
export const HANDBOOK_TABLE_NUMBERS = Object.freeze(
  [...new Set(Object.values(HANDBOOK_MODULES).flatMap((m) => m.tables))].sort((a, b) => a - b),
);

/** The table the Cross-State Comparison Engine shows when none is asked for: GSDP at current prices. */
export const COMPARISON_DEFAULT_TABLE = 21;

/** The module that holds a table first (the Cross-State Comparison Engine reads it from there). */
export function handbookOwner(no) {
  const n = Number(no);
  return Object.keys(HANDBOOK_MODULES).find((id) => HANDBOOK_MODULES[id].tables.includes(n)) || '';
}

// ---------------------------------------------------------------------------------------------
// States. The repository's state names (src/lib/mlaStates.js: the 31 states and union territories
// with an assembly) and the five union territories without one, each with the spellings the handbook
// uses; then the all-India rows.

export const ALL_INDIA = 'All India';

const OTHER_UTS = [
  ['Andaman & Nicobar Islands', 'Andaman and Nicobar', 'A and N Islands'],
  ['Chandigarh'],
  ['Dadra & Nagar Haveli and Daman & Diu', 'Dadra and Nagar Haveli and Daman and Diu', 'DNH and DD'],
  ['Ladakh'],
  ['Lakshadweep'],
];

/** The handbook's 36 states and union territories, by the repository's names, in alphabetical order. */
export const HANDBOOK_STATES = Object.freeze(
  [...MLA_STATE_NAMES.map(([name]) => name), ...OTHER_UTS.map(([name]) => name)].sort((a, b) => a.localeCompare(b, 'en')),
);

// Spellings found in the 2024-25 edition's tables (fetched 2026-10-15), each with the state it names.
const HANDBOOK_SPELLINGS = [
  ['Andhra Pradesh', 'Andhra Pradhesh'],
  ['Arunachal Pradesh', 'Arunanchal Pradesh'],
  ['Gujarat', 'Gujrat'],
  ['Tamil Nadu', 'Tamilnadu'],
  ['Telangana', 'Telengana'],
  ['Delhi', 'New Delhi'],
];

// Case, spacing, punctuation, footnote marks and "&" against "and" do not matter. Two-letter state
// codes are not matched: the handbook spells states out.
const fold = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const STATE_BY_NAME = new Map(
  [...MLA_STATE_NAMES, ...OTHER_UTS, ...HANDBOOK_SPELLINGS].flatMap(([name, ...others]) => [name, ...others].filter((n) => !/^[A-Z]{2}$/.test(n)).map((n) => [fold(n), name])),
);
const AGGREGATE = /^(all india|india|all states|all states and uts|all states uts|all states and union territories|total|grand total)$/;

/**
 * A handbook row label as { state, aggregate }: a state or union territory by its repository name, or
 * ALL_INDIA (aggregate true) for the all-India, all-states and total rows. A row's serial number ("5 NCT
 * of Delhi"), a footnote number stuck to the name ("Odisha3"), a footnote mark and a "(UT)" or " UT"
 * after the name are ignored. null for anything else (a former union territory such as "Daman & Diu"
 * before 2020, "Jammu & Kashmir and Ladakh" before 2019, a region or zone, a note).
 */
export function handbookState(label) {
  const text = String(label ?? '')
    .replace(/^\s*\d{1,2}\s*[.)]?\s+(?=[A-Za-z])/, '')
    .replace(/(?<=[A-Za-z)])\d{1,2}\s*$/, '')
    .replace(/\(\s*ut\s*\)|\s+ut\s*$/gi, ' ');
  const key = fold(text);
  if (!key) return null;
  if (AGGREGATE.test(key)) return { state: ALL_INDIA, aggregate: true };
  const state = STATE_BY_NAME.get(key) || STATE_BY_NAME.get(key.replace(/^(nct|national capital territory)( of)? /, '')) || '';
  return state ? { state, aggregate: false } : null;
}
