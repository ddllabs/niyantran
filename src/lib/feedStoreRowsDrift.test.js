// Task B follow-up (2026-10-16): the store path's row rule for a module (server/feedRows.mjs) and the
// module's live branch must show the same rows, or the two have drifted apart. Each scheduled module with
// a rule is asked live with every source stubbed by one RSS feed whose stories suit most modules' guards
// (plus a story 20 days old and two copies of a story already told), and:
//  - every row live shows is kept by the rule (the store is not stricter than live);
//  - the rule applied to the source's own rows, unfiltered (off-topic, old and duplicate ones included),
//    keeps none that live does not show (the store is not laxer than live: review of 1d2bdb7, finding 2;
//    an identity rule fails here);
//  - a story just inside the module's age window is shown by both, one just outside by neither.
// It tests server/featureFeed.mjs and lives here because Vitest collects tests from src/ only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_TECH_DAYS, BRIEF_DAYS, INDIA_SPORTS_DAYS, STORE_ROW_RULES, WIRE_DAYS, storeRowsFor } from '../../server/feedRows.mjs';
import { FEED_CLASSES, FEED_SCHEDULE, itemKeysFor } from '../../server/feedSchedule.mjs';
import { CURATED_NEWS, WIRE_GUARDS, decodeEntities, newsDays } from './curatedNews.js';
import { STATEMENT_LEADERS } from '../data/nationalCurated.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const STORIES = [
  'Kerala Assembly passes bill as Governor gives assent to 12 bills',
  'Pune Municipal Corporation mayor election held for corporators',
  'Gram panchayat sarpanch polls held across Bihar zilla parishad seats',
  'CAG report flags losses in Maharashtra power utilities',
  'Karnataka cabinet approves new industrial policy for investors',
  'District court sentences accused in Lucknow murder case',
  'Collegium recommends judges for Bombay High Court elevation',
  'International Court of Justice hears genocide case against Israel',
  'Sports ministry suspends wrestling federation over election row',
  "Governor and state government row over Raj Bhavan address in Tamil Nadu",
  'Two MLAs face disqualification petition under Tenth Schedule after defection',
  'District collector reviews water supply in Nashik district villages',
  'Ceasefire talks resume as UN Security Council meets on Gaza',
  'Heat wave and coal power demand rise across India this month',
  'IndiaAI mission opens GPU compute portal for startups',
  'Allahabad High Court grants bail to accused in Prayagraj land case',
  'National Green Tribunal orders action on Yamuna pollution in Delhi',
  'NCDRC orders insurer to pay claim to consumer with interest',
  'ITAT deletes addition in tax case of Mumbai trader',
  'International Criminal Court issues warrant in war crimes case',
  'Uttar Pradesh transfers 12 IAS officers in major reshuffle',
  'Draft rules notified for public consultation on drone operations',
  'RBI keeps repo rate unchanged as rupee steadies against dollar',
  'Parliament panel meets on data protection rules for platforms',
  'India beat Pakistan in hockey Asia Cup final in Chennai',
  // A second story for each narrow guard, so that every module with a window shows two.
  'Punjab Governor withholds assent to university amendment bill',
  'West Bengal Governor returns two bills to Assembly for reconsideration',
  'Odisha Vidhan Sabha monsoon session begins with question hour debate',
  'Maharashtra Legislative Council session adjourned after opposition walkout',
  'Three Goa MLAs switch sides and join ruling party',
  'Telangana cabinet clears new housing scheme for urban poor',
  'CAG audit finds irregularities in Rajasthan mining leases',
  'Nagpur municipality corporators approve property tax revision',
  'Gram sabha in Odisha village rejects mining project',
  'Magistrate court in Jaipur grants bail in cheating case',
  'Chief Justice of Madras High Court constitutes new bench for tax appeals',
  'World Court rules on maritime border dispute between two nations',
];
const OLD_STORY = 'Tamil Nadu chief minister launches breakfast scheme for schools';
// Copies of stories already told: one reworded (one row per story), one the same link again.
const REWORDED = ['Governor gives assent to 12 bills as Kerala Assembly passes bill', STORIES[0]];

/** The window, in days, each module's live branch holds its rows to (src/lib/curatedNews.js, server/feedRows.mjs). */
const WINDOW_DAYS = Object.freeze({
  ...Object.fromEntries(Object.entries(CURATED_NEWS).filter(([id]) => Object.hasOwn(STORE_ROW_RULES, id)).map(([id, spec]) => [id, newsDays(spec)])),
  'judiciary:UP High Court (Allahabad) Order Feed': WIRE_DAYS,
  'judiciary:NGT Environmental Litigation Tracker': WIRE_DAYS,
  'judiciary:CAT & Consumer Disputes (NCDRC) Watch': WIRE_DAYS,
  'judiciary:ICC Proceedings': WIRE_DAYS,
  'judiciary:Sector Tribunals (ITAT / TDSAT / SAT / DRT)': WIRE_DAYS,
  'geopolitics:Geopolitics News Wire': WIRE_GUARDS.geopolitics.days,
  'climate:Climate Newswire': WIRE_GUARDS.climate.days,
  'finance:AI & the Tech Industry': AI_TECH_DAYS,
  'national:National Morning Brief (Auto-digest)': BRIEF_DAYS,
  'national:Statement & Quote Tracker with Contradiction Detection': WIRE_DAYS,
  'state:Bureaucrat Transfer & Posting Tracker (State Cadre)': WIRE_DAYS,
  'sports:Indian Sports Wire': INDIA_SPORTS_DAYS,
  'state:District Performance Tracker (Composite)': WIRE_DAYS,
});
/** The modules whose live branch has no age window (a release filter only). */
const NO_WINDOW = Object.freeze(['national:Policy Pipeline Tracker (Draft-to-Gazette)', 'national:Cabinet Decisions']);

/** The stub's stories: [title, published ms, link slug], with `at` overriding a story's time. */
function storyItems(now, at = {}) {
  return [
    ...STORIES.map((t, i) => [t, at[t] ?? now - (i + 1) * HOUR, t]),
    [OLD_STORY, now - 20 * DAY, OLD_STORY],
    [REWORDED[0], now - 30 * HOUR, REWORDED[0]],
    [REWORDED[1], now - 31 * HOUR, REWORDED[1]],
  ];
}

// A PIB feed's links are PIB release pages, a Google News search's are its article links, any other
// outlet's are on its own site.
function linkFor(url, slug, i) {
  if (/pib\.gov\.in/i.test(url)) return `https://www.pib.gov.in/PressReleasePage.aspx?PRID=${2000 + i}`;
  if (/news\.google\.com/i.test(url)) return `https://news.google.com/rss/articles/${encodeURIComponent(slug)}`;
  return `https://${new URL(url).host}/${encodeURIComponent(slug)}`;
}
const STORY_INDEX = new Map([...STORIES, OLD_STORY, REWORDED[0]].map((t, i) => [t, i]));

function rssBody(url, items) {
  const date = (ms) => new Date(ms).toUTCString();
  const xml = items.map(([title, ms, slug]) => `<item><title>${title} - Example News</title><link>${linkFor(url, slug, STORY_INDEX.get(slug))}</link><pubDate>${date(ms)}</pubDate><description>${title}</description><source url="https://news.example">Example News</source></item>`);
  return `<?xml version="1.0"?><rss><channel>${xml.join('')}</channel></rss>`;
}

/**
 * Stubs every source with the stories; returns the URLs asked for, in order. The Wikidata query fails
 * (it answers with JSON, not news), so District Performance Tracker answers from its news fallback.
 */
function stubSources(items) {
  const asked = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    asked.push(String(url));
    if (/wikidata/i.test(String(url))) return { ok: false, status: 503, url: String(url), headers: new Headers(), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    const body = rssBody(String(url), items);
    return {
      ok: true, status: 200, url: String(url), headers: new Headers({ 'content-type': 'application/rss+xml' }),
      text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    };
  }));
  return asked;
}

/**
 * The rows the module's sources gave, before any of its filters, as the store could hold them: each feed
 * the live branch read (not a release page it opened to date a release, not the Wikidata query), every
 * item, tagged as the live branch tags its source (BBC World's outlet, a Climate outlet, a Morning Brief
 * section, the leader), one row per store item key (the store keys an item by its link: a link listed
 * twice is one stored item, a reworded story under another link is two).
 */
function sourceRows(id, asked, items, person) {
  const feeds = [...new Set(asked)].filter((u) => !/PressReleasePage|wikidata/i.test(u));
  const rows = feeds.flatMap((url) => {
    const tag = {};
    if (id === 'geopolitics:Geopolitics News Wire' && /bbc/i.test(url)) Object.assign(tag, { outlet: 'BBC World', source: 'BBC World' });
    if (id === 'climate:Climate Newswire') tag.outlet = /mongabay/i.test(url) ? 'Mongabay India' : /carbonbrief/i.test(url) ? 'Carbon Brief' : 'Climate Home News';
    if (id === 'national:National Morning Brief (Auto-digest)') {
      tag.section = /pib\.gov\.in/i.test(url) ? 'Government Wire' : /government%20OR%20parliament/i.test(url) ? 'Top of the Day' : 'Economy';
    }
    if (person) tag.person = person;
    return items.map(([title, ms, slug]) => ({
      title: `${title} - Example News`,
      date: new Date(ms).toUTCString(),
      source_url: linkFor(url, slug, STORY_INDEX.get(slug)),
      summary: title,
      publisher: 'Example News',
      ...tag,
    }));
  });
  const keys = itemKeysFor(rows, FEED_CLASSES[FEED_SCHEDULE[id]].kind);
  return rows.filter((_r, i) => keys.indexOf(keys[i]) === i);
}

const real = (body) => (Array.isArray(body?.rows) ? body.rows : []).filter((r) => r && r.status !== 'source_status');
const keyOf = (r) => `${r.title}|${r.source_url || ''}`;
/** A story, however a row tells it: its title without the publisher, decoded, in lower case. */
const storyOf = (r) => decodeEntities(r?.title || '').replace(/\s+-\s+Example News$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
const counts = (rows) => rows.reduce((m, r) => m.set(storyOf(r), (m.get(storyOf(r)) || 0) + 1), new Map());
/** The stories `rows` tells more often than `than` does (none: `rows` is a subset of `than`). */
function beyond(rows, than) {
  const limit = counts(than);
  return [...counts(rows)].filter(([story, n]) => n > (limit.get(story) || 0)).map(([story]) => story);
}

async function askLive(id, items) {
  const asked = stubSources(items);
  const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
  const [tier, feature] = id.split(/:(.*)/s);
  const person = id.startsWith('national:Statement') ? STATEMENT_LEADERS[1] : '';
  const body = await serveFeatureFeed(new URLSearchParams({ tier, feature, ...(person ? { person } : {}) }));
  return { rows: real(body), asked, person };
}

describe("the store path's row rule and the module's live branch show the same rows", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('every module with a rule has an age window here, or is named as having none', () => {
    for (const id of Object.keys(STORE_ROW_RULES)) {
      expect(Object.hasOwn(WINDOW_DAYS, id) !== NO_WINDOW.includes(id), id).toBe(true);
    }
  });

  it('for every scheduled module with a rule: the rule keeps every live row, and keeps no source row live leaves out', async () => {
    const now = Date.now();
    const items = storyItems(now);
    const checked = [];
    for (const id of Object.keys(STORE_ROW_RULES)) {
      vi.resetModules();
      const { rows, asked, person } = await askLive(id, items);
      if (!rows.length) continue;
      const at = { now: Date.now(), variant: person };
      // Live → store: nothing live shows is dropped.
      expect(storeRowsFor(id, rows, at).map(keyOf).sort(), `${id}: live rows the rule drops`).toEqual(rows.map(keyOf).sort());
      // Source → store: nothing live leaves out (off-topic, 20 days old, a story told twice) is kept.
      const raw = sourceRows(id, asked, items, person);
      // Not vacuous: the source gave stories live leaves out (at least the one 20 days old, or off-topic ones).
      expect(beyond(raw, rows).length, `${id}: source stories live leaves out`).toBeGreaterThan(0);
      expect(beyond(storeRowsFor(id, raw, at), rows), `${id}: source rows the rule keeps and live does not show`).toEqual([]);
      checked.push(id);
    }
    // The stub suits every module with a rule, so none is skipped: the check is not vacuous.
    expect(checked).toEqual(Object.keys(STORE_ROW_RULES));
  }, 60_000);

  it('for every module with an age window: a story just inside it is shown by both, one just outside by neither', async () => {
    const checked = [];
    for (const [id, days] of Object.entries(WINDOW_DAYS)) {
      // Two stories the module shows when they are fresh …
      vi.resetModules();
      const fresh = await askLive(id, storyItems(Date.now()));
      // (Not the story told twice: its newer copy would stand in for it.)
      const shown = [...new Set(fresh.rows.map(storyOf))].map((s) => STORIES.find((t) => t.toLowerCase() === s)).filter((t) => t && t !== STORIES[0]);
      expect(shown.length, `${id}: stories shown fresh`).toBeGreaterThanOrEqual(2);
      const [inside, outside] = shown;
      // … dated an hour inside its window, and an hour before the first day of it: a bare day lasts to its
      // end (src/lib/curatedNews.js ageTime), so for a source whose dates are cut to the day (Indian Sports
      // Wire, Climate Newswire) the window's edge is a day's start.
      vi.resetModules();
      const now = Date.now();
      const oldest = now - days * DAY;
      const items = storyItems(now, { [inside]: oldest + HOUR, [outside]: oldest - (oldest % DAY) - HOUR });
      const { rows, asked, person } = await askLive(id, items);
      const at = { now: Date.now(), variant: person };
      const liveStories = rows.map(storyOf);
      const storedStories = storeRowsFor(id, rows, at).map(storyOf);
      const sourceStories = storeRowsFor(id, sourceRows(id, asked, items, person), at).map(storyOf);
      for (const [side, list] of [['live', liveStories], ['store, live rows', storedStories], ['store, source rows', sourceStories]]) {
        expect(list, `${id} (${days} days), ${side}: just inside`).toContain(inside.toLowerCase());
        expect(list, `${id} (${days} days), ${side}: just outside`).not.toContain(outside.toLowerCase());
      }
      checked.push(id);
    }
    expect(checked.length).toBe(Object.keys(WINDOW_DAYS).length);
  }, 120_000);
});
