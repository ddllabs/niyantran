/**
 * F169 phase 4 (C1): which modules the 5-minute timer refreshes, how often, and how long their
 * items are kept (F170 rules 1–2). A module is scheduled when its loader calls an outside source
 * (measured 2026-10-15: 58 of 120 desk modules); stored registers and planned modules are not. A test
 * (src/lib/feedSchedule.test.js) checks this table against what the loaders actually call.
 */
import { createHash } from 'node:crypto';
import { STATEMENT_LEADERS } from '../src/data/nationalCurated.js';
import { billDocumentKey } from '../src/lib/deskRows.js';

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
  'finance:NSE/BSE Delayed Market Feed': 'markets',
  'finance:Live Global Stock Exchanges': 'markets',
  'finance:Prediction Market Political Odds': 'markets',

  'entertainment:Music Charts — India Top 25': 'charts',
  'entertainment:Music Charts — Global Top 25': 'charts',

  'national:Policy Pipeline Tracker (Draft-to-Gazette)': 'official',
  'national:Regulatory Body Watch (RBI/SEBI/TRAI/CCI)': 'official',
  'national:Cabinet Decisions': 'official',
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
  'state:MLA Directory': 'reference',
  'state:Centre-State Fund Flow Tracker': 'reference',
});

/** Modules refreshed once per value of a request parameter (the Statement Tracker's leaders). */
export const FEED_VARIANTS = Object.freeze({
  'national:Statement & Quote Tracker with Contradiction Detection': { param: 'person', values: STATEMENT_LEADERS },
});

/** Every scheduled run: one per module, or one per variant, with its class settings. */
export function scheduledRuns() {
  return Object.entries(FEED_SCHEDULE).flatMap(([id, cls]) => {
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
export function feedRunsForDb() {
  return scheduledRuns().map((r) => ({
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
  const bill = billDocumentKey(row);
  if (bill) return bill;
  const link = linkKey(row?.source_url || row?.link || row?.url || row?.detail_url);
  if (link) return `url:${link}`;
  const basis = `${String(row?.title || row?.name || '').replace(/\s+/g, ' ').trim().toLowerCase()}|${String(row?.date || row?.as_of || '').trim()}`;
  return `h:${createHash('sha256').update(basis).digest('hex').slice(0, 16)}`;
}
