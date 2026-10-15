/**
 * F169 phase 4 (C1): which modules the 5-minute timer refreshes, how often, and how long their
 * items are kept (F170 rules 1–2). A module is scheduled when its loader calls an outside source
 * (measured 2026-10-15: 58 of 120 desk modules; 63 after F196 batch 1, 64 with the SDL auctions); stored registers and planned modules are not. A test
 * (src/lib/feedSchedule.test.js) checks this table against what the loaders actually call: every
 * module whose loader calls a source is on it, except the register modules (FEED_REGISTERS) and the
 * modules deliberately off the timer (OFF_TIMER), each listed with its reason.
 */
import { createHash } from 'node:crypto';
import { STATEMENT_LEADERS } from '../src/data/nationalCurated.js';
import { MLA_STATE_NAMES, MLA_STATES } from '../src/lib/mlaStates.js';
import { billDocumentKey } from '../src/lib/deskRows.js';
import { HANDBOOK_MODULES, handbookTableVariant } from '../src/lib/rbiHandbookTables.js';

/**
 * every: minutes between refreshes. kind: how items are kept.
 * - official: forever. news: headline, link, date and excerpt, kept. events: kept.
 * - measurement: latest value plus one summary a day; detail 30 days.
 * - latest: only the current list (charts). reference: the current set, replaced each run.
 */
export const FEED_CLASSES = Object.freeze({
  markets: { every: 15, kind: 'measurement' },
  news: { every: 30, kind: 'news' },
  official: { every: 60, kind: 'official' },
  events: { every: 60, kind: 'events' },
  charts: { every: 60, kind: 'latest' },
  leaders: { every: 360, kind: 'news' },
  reference: { every: 1440, kind: 'reference' },
});

export const FEED_SCHEDULE = Object.freeze({
  'finance:Live Global Stock Exchanges': 'markets',
  'finance:Prediction Market Political Odds': 'markets',
  'finance:Election Forecast Aggregator': 'markets',

  'entertainment:Music Charts — India Top 25': 'charts',
  'entertainment:Music Charts — Global Top 25': 'charts',

  'national:Policy Pipeline Tracker (Draft-to-Gazette)': 'official',
  'national:Regulatory Body Watch (RBI/SEBI/TRAI/CCI)': 'official',
  'national:Cabinet Decisions': 'official',
  // F196: RBI's State Government Securities auction releases, kept as they are seen (RBI's feed lists ten).
  'state:SDL Auction & Borrowing Tracker': 'official',
  'climate:Carbon Registry Wire': 'official',

  'geopolitics:Satellite Infrastructure': 'events',
  'sports:Fixtures & Results — World Leagues': 'events',
  'sports:ISL Tracker': 'events',
  'entertainment:TV & Streaming Tonight': 'events',

  'national:National Morning Brief (Auto-digest)': 'news',
  'finance:AI & the Tech Industry': 'news',
  'state:State Governance Brief': 'news',
  'geopolitics:Geopolitics News Wire': 'news',
  'judiciary:UP High Court (Allahabad) Order Feed': 'news',
  'judiciary:District Court Case Tracker': 'news',
  'judiciary:NGT Environmental Litigation Tracker': 'news',
  'judiciary:CAT & Consumer Disputes (NCDRC) Watch': 'news',
  'judiciary:HC Judge Profiles & Bench Analytics': 'news',
  'judiciary:ICC Proceedings': 'news',
  'judiciary:ICJ Proceedings': 'news',
  'judiciary:Sector Tribunals (ITAT / TDSAT / SAT / DRT)': 'news',
  'climate:Climate Newswire': 'news',
  'sports:Cricket Wire': 'news',
  'sports:Football Wire': 'news',
  'sports:Indian Sports Wire': 'news',
  'entertainment:Entertainment News Wire': 'news',
  'entertainment:Bollywood & Film Wire': 'news',
  'state:Governor Assent Tracker': 'news',
  'state:Assembly Proceedings Digest (Vernacular, Translated)': 'news',
  'state:MLA Report Card + Statement Tracker': 'news',
  'local:Municipal Watch': 'news',
  'local:Panchayat Watch': 'news',
  'state:Bureaucrat Transfer & Posting Tracker (State Cadre)': 'news',
  'state:Cabinet Decisions': 'news',
  'state:CAG Audit Tracker': 'news',
  'state:District Performance Tracker (Composite)': 'news',
  'state:District Media Monitor (Vernacular District Editions)': 'news',
  // F196: built from curated news searches (src/lib/curatedNews.js).
  'sports:Sports Governance & Policy': 'news',
  "state:Governor Friction & President's Rule Tracker": 'news',
  'state:Legislative Productivity Comparison': 'news',
  'state:MLA Defection & Anti-defection Case Tracker': 'news',

  'national:Statement & Quote Tracker with Contradiction Detection': 'leaders',

  'national:Industry Updates (Ministry Data)': 'reference',
  'geopolitics:World Constitutions': 'reference',
  'geopolitics:Growth Indicators': 'reference',
  'geopolitics:Global Trade': 'reference',
  'finance:Economic Overview of All Countries': 'reference',
  'finance:Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop)': 'reference',
  'finance:Economic Simulator': 'reference',
  'finance:Sector Policy — Power/Energy/Green/Critical Minerals': 'reference',
  'finance:Top Financial & Business Players': 'reference',
  'sports:Sports Business & Media Rights': 'reference',
  'sports:Athlete Index': 'reference',
  'entertainment:Box Office Tracker': 'reference',
  'entertainment:OTT & Studio Intelligence': 'reference',
  'entertainment:Celebrity Influence Index': 'reference',
  'state:Centre-State Fund Flow Tracker': 'reference',
});

/** Modules refreshed once per value of a request parameter (the Statement Tracker's leaders). */
export const FEED_VARIANTS = Object.freeze({
  'national:Statement & Quote Tracker with Contradiction Detection': { param: 'person', values: STATEMENT_LEADERS },
});

/**
 * Modules a loader serves from a source but the timer never refreshes, with the reason. A module here is
 * not served from the store either (the page keeps its live path).
 */
export const OFF_TIMER = Object.freeze({
  // F186: no live source; the loader answers a frozen snapshot, which the store refuses, so every refresh failed.
  'finance:NSE/BSE Delayed Market Feed': 'no live source: it answers a frozen snapshot, which the store refuses (F186)',
  // F196: built on request from the handbook registers (the stored table, else the table's page); it has no list of its own to keep.
  'state:Cross-State Comparison Engine': 'built on request from the RBI handbook registers; nothing of its own to store (F196)',
});

/**
 * MLA Directory's variants: the 31 states and union territories of the register, by the register's own
 * names, each with the register's state code and other spellings a request may use. The list is
 * src/lib/mlaStates.js (the State picker on MLA Directory offers the same names).
 */
export { MLA_STATES };

// Case, spacing, punctuation and "&" against "and" do not matter.
const foldName = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const MLA_STATE_BY_NAME = new Map(MLA_STATE_NAMES.flatMap(([name, ...others]) => [name, ...others].map((n) => [foldName(n), name])));

/** A state as its MLA Directory variant (the register's name for it), or '' when it names none. */
export function mlaStateVariant(value) {
  return MLA_STATE_BY_NAME.get(foldName(value)) || '';
}

/**
 * How a register's variants are kept in feed_state: kind reference, so each load replaces the
 * variant's list (feed_record drops the items a load does not list, with its shrink guard: after an
 * election a reload leaves out the members who have gone, and an item whose key changed leaves no
 * copy behind), and the longest interval feed_state allows (30 days). Nothing schedules by the
 * interval: no refresh lists a register, so none claims it; only scripts/load-feed-register.mjs does
 * (public.feed_make_due lets it reload a register within the 30 days).
 */
export const REGISTER_CLASS = Object.freeze({ name: 'register', every: 43200, kind: 'reference' });

/**
 * Register modules (owner decision C6, option 1): served from the store but never refreshed by the
 * timer. Loaded from a stored register, one store variant per value of `param` (each under
 * feed_record's 2,000-item cap); a reload replaces a variant's list (REGISTER_CLASS). Valid until
 * loaded again, so the page serves them whatever their age (server/feedServe.mjs). variantOf(value): a request's or a row's value as its variant,
 * '' when it names none. noun and unit name what the page shows across variants.
 */
export const FEED_REGISTERS = Object.freeze({
  'state:MLA Directory': Object.freeze({
    param: 'state',
    values: MLA_STATES,
    variantOf: mlaStateVariant,
    noun: 'MLAs',
    unit: 'states and union territories',
  }),
  // F196: the RBI Handbook of Statistics on Indian States (src/lib/rbiHandbookTables.js), loaded yearly
  // from scripts/fetch-rbi-handbook.mjs's register: one store variant per table (at most one store page,
  // 500 figures, its newest whole years: MAX_PER_TABLE), named by the table's number. A request names its table with `table`; one that names none
  // (or a table the module does not hold) gets the module's first table (defaultVariant), never a
  // page across all of them.
  ...Object.fromEntries(
    Object.entries(HANDBOOK_MODULES).map(([id, spec]) => [
      id,
      Object.freeze({
        param: 'table',
        values: Object.freeze(spec.tables.map(String)),
        variantOf: (value) => handbookTableVariant(spec, value),
        defaultVariant: String(spec.tables[0]),
        noun: 'figures',
        unit: 'tables',
      }),
    ]),
  ),
});

/** Modules the page reads from the store first: the scheduled modules and the registers. */
export function isStoreServed(id) {
  return Object.hasOwn(FEED_SCHEDULE, id) || Object.hasOwn(FEED_REGISTERS, id);
}

/** A register's variants as feed_claim_due takes them (for the loader only; never in feedRunsForDb). */
export function registerRunsForDb(id) {
  const register = FEED_REGISTERS[id];
  if (!register) return [];
  const [tier, feature] = id.split(/:(.*)/s);
  return register.values.map((variant) => ({
    tier,
    feature,
    variant,
    class: REGISTER_CLASS.name,
    kind: REGISTER_CLASS.kind,
    interval_minutes: REGISTER_CLASS.every,
  }));
}

const offTimer = (id) => Object.hasOwn(FEED_REGISTERS, id) || Object.hasOwn(OFF_TIMER, id);

/**
 * Every scheduled run: one per module, or one per variant, with its class settings. A register module or
 * a module off the timer is never a run, even if it is listed in the schedule by mistake.
 */
export function scheduledRuns(schedule = FEED_SCHEDULE) {
  return Object.entries(schedule).filter(([id]) => !offTimer(id)).flatMap(([id, cls]) => {
    const [tier, feature] = id.split(/:(.*)/s);
    const base = { tier, feature, cls, ...FEED_CLASSES[cls] };
    const v = FEED_VARIANTS[id];
    return v
      ? v.values.map((value) => ({ ...base, variant: value, params: { [v.param]: value } }))
      : [{ ...base, variant: '', params: {} }];
  });
}

/**
 * The schedule as public.feed_claim_due takes it (p_runs). The database stores class, kind and
 * interval from this list, and feed_record keeps items by the stored kind, so the refresh route
 * never chooses a module's keeping rule itself. params is ignored by the database.
 */
export function feedRunsForDb(schedule = FEED_SCHEDULE) {
  return scheduledRuns(schedule).map((r) => ({
    tier: r.tier,
    feature: r.feature,
    variant: r.variant,
    class: r.cls,
    kind: r.kind,
    interval_minutes: r.every,
    params: r.params,
  }));
}

const TRACKING = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|cmpid)$/i;

function linkKey(url) {
  let u;
  try {
    u = new URL(String(url || '').trim());
  } catch {
    return '';
  }
  if (!/^https?:$/.test(u.protocol)) return '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  // A PIB release has one identity, its PRID, whichever page and language parameters link it (the RSS
  // links PressReleaseIframePage, the register PressReleasePage with lang and reg) (C6, 2026-10-15).
  const prid = host === 'pib.gov.in' && /^\/PressRelease(Iframe)?Page\.aspx$/i.test(u.pathname)
    ? (u.searchParams.get('PRID') || u.searchParams.get('prid') || '').trim()
    : '';
  if (/^\d+$/.test(prid)) return `pib.gov.in/PressRelease?PRID=${prid}`;
  const path = u.pathname.replace(/\/+$/, '');
  const query = u.searchParams.toString();
  return `${host}${path}${query ? `?${query}` : ''}`;
}

/**
 * F170 rule 1: one stable key per item, so a refresh updates the item instead of adding a copy.
 * The corpus identity where the corpus holds the document (bills), else the item's link, else a
 * hash of its title and date.
 */
export function itemKeyFor(row) {
  // F196: one line of an RBI State Government Securities auction release (src/lib/rbiSdl.js) names its
  // own key, so the lines that share the release's link stay separate items. Only that loader's keys
  // (prefix "sdl:") are honoured: a feed_key field arriving in any other upstream row cannot merge or
  // split items.
  const own = typeof row?.feed_key === 'string' ? row.feed_key.trim() : '';
  if (/^sdl:\d{1,12}:[a-z0-9:-]{1,180}$/.test(own)) return `key:${own}`;
  const bill = billDocumentKey(row);
  if (bill) return bill;
  const link = linkKey(row?.source_url || row?.link || row?.url || row?.detail_url);
  if (link) return `url:${link}`;
  // A market quote with no link is one instrument whatever its time: keyed by exchange and name, never
  // by its date or as_of, so each refresh updates it instead of adding a copy (C2 review).
  const exchange = String(row?.exchange || '').trim().toLowerCase();
  const name = String(row?.name || row?.title || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (exchange && name) return `q:${exchange}:${name}`;
  const basis = `${String(row?.title || row?.name || '').replace(/\s+/g, ' ').trim().toLowerCase()}|${String(row?.date || row?.as_of || '').trim()}`;
  return `h:${createHash('sha256').update(basis).digest('hex').slice(0, 16)}`;
}

/** Kinds whose list is replaced or updated in place each run, rather than kept item by item. */
export const REPLACING_KINDS = Object.freeze(new Set(['latest', 'reference', 'measurement']));

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Keys for one answer's rows, by the module's kind (C3 review). A key never depends on the other
 * rows of the answer, so an item keeps its key from run to run.
 * - Kept kinds (official, news, events): itemKeyFor alone. Rows that share a link are one item; the
 *   caller keeps the first.
 * - Replacing kinds (latest, reference, measurement): a link is a dataset's page (a World Bank
 *   indicator for 186 countries, a budget statement's lines), so a link key always becomes
 *   `url:<link>#<hash>` of the fields that name the row, and for latest and reference also its date
 *   or year. A measurement's date is left out: an instrument is one item updated in place, its
 *   values by day kept in feed_daily (as itemKeyFor keys a quote without a link, C2 review).
 */
export function itemKeysFor(rows, kind) {
  return rows.map((row) => {
    const key = itemKeyFor(row);
    if (!REPLACING_KINDS.has(kind) || !key.startsWith('url:')) return key;
    const r = row || {};
    const naming = [
      r.title || r.name || r.category || r.question || '',
      r.iso3 || r.country || r.state || '',
      r.indicator || '',
      r.line ?? '',
      r.exchange || r.symbol || '',
    ];
    const when = kind === 'measurement' ? [] : [r.date || r.as_of || '', r.year || r.period || ''];
    const basis = [...naming, ...when].map(norm).join('|');
    return `${key}#${createHash('sha256').update(basis).digest('hex').slice(0, 16)}`;
  });
}
